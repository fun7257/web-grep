import { constants, type Stats } from "node:fs";
import { type FileHandle, open, realpath, stat } from "node:fs/promises";
import * as nodePath from "node:path";
import {
  type FileQuery,
  type FileWindowResponse,
  LIMITS,
} from "@web-grep/shared";
import { isDenied } from "../sandbox/denylist.ts";
import {
  joinUnderRoot,
  PathSandboxError,
  resolveUnderRoot,
  toPosixRel,
} from "../sandbox/resolvePath.ts";

const BINARY_SNIFF_BYTES = 8 * 1024;

export class PreviewError extends Error {
  readonly code: "INVALID_PATH" | "DENIED";
  readonly status: 400 | 403 | 404 | 413;
  constructor(
    code: "INVALID_PATH" | "DENIED",
    status: 400 | 403 | 404 | 413,
    message: string,
  ) {
    super(message);
    this.name = "PreviewError";
    this.code = code;
    this.status = status;
  }
}

export type ReadWindowArgs = {
  rootReal: string;
  allowSecrets: boolean;
  previewBytes: number;
  previewLines: number;
  query: FileQuery;
};

function posixRelOrThrow(rootReal: string, abs: string): string {
  const rel = nodePath.relative(rootReal, abs);
  if (
    rel !== "" &&
    (rel === ".." ||
      rel.startsWith(`..${nodePath.sep}`) ||
      nodePath.isAbsolute(rel))
  ) {
    throw new PreviewError("INVALID_PATH", 404, "path escapes root");
  }
  return toPosixRel(rel);
}

function windowLines(
  rel: string,
  text: string,
  query: FileQuery,
  previewLines: number,
): FileWindowResponse {
  const raw = text.split("\n");
  if (raw.at(-1) === "") {
    raw.pop();
  }
  const total = raw.length;
  if (total === 0) {
    return {
      path: rel,
      startLine: 1,
      lineCount: 0,
      truncated: false,
      binary: false,
      lines: [],
    };
  }

  const center = Math.min(Math.max(query.line, 1), total);
  let start = Math.max(1, center - query.before);
  let end = Math.min(total, center + query.after);
  const budget = previewLines;
  if (end - start + 1 > budget) {
    start = Math.max(1, center - Math.floor((budget - 1) / 2));
    end = Math.min(total, start + budget - 1);
    start = Math.max(1, end - budget + 1);
  }

  let lineTruncated = false;
  const lines: Array<{ n: number; text: string }> = [];
  for (let n = start; n <= end; n++) {
    let lineText = (raw[n - 1] ?? "").replace(/\r$/, "");
    if (lineText.length > LIMITS.lineTextMaxChars) {
      lineText = lineText.slice(0, LIMITS.lineTextMaxChars);
      lineTruncated = true;
    }
    lines.push({ n, text: lineText });
  }

  return {
    path: rel,
    startLine: lines[0]?.n ?? 1,
    lineCount: lines.length,
    truncated: lineTruncated || start > 1 || end < total,
    binary: false,
    lines,
  };
}

function assertRegularFile(st: Stats, previewBytes: number): void {
  if (!st.isFile() || st.isDirectory()) {
    throw new PreviewError("INVALID_PATH", 400, "not a file");
  }
  if (st.size > previewBytes) {
    throw new PreviewError("INVALID_PATH", 413, "file too large");
  }
}

async function readCapped(
  fh: FileHandle,
  previewBytes: number,
): Promise<Buffer> {
  const cap = previewBytes + 1;
  const buf = Buffer.alloc(cap);
  let offset = 0;
  while (offset < cap) {
    const { bytesRead } = await fh.read(buf, offset, cap - offset, offset);
    if (bytesRead === 0) {
      break;
    }
    offset += bytesRead;
  }
  if (offset > previewBytes) {
    throw new PreviewError("INVALID_PATH", 413, "file too large");
  }
  return buf.subarray(0, offset);
}

export async function readWindow(
  args: ReadWindowArgs,
): Promise<FileWindowResponse> {
  const { rootReal, allowSecrets, previewBytes, previewLines, query } = args;

  let resolved: { abs: string; rel: string };
  try {
    resolved = await resolveUnderRoot(rootReal, query.path);
  } catch (err) {
    if (err instanceof PathSandboxError) {
      throw new PreviewError("INVALID_PATH", 404, err.message);
    }
    throw err;
  }

  const userRel = toPosixRel(
    nodePath.relative(rootReal, joinUnderRoot(rootReal, query.path)),
  );
  if (isDenied(userRel, allowSecrets) || isDenied(resolved.rel, allowSecrets)) {
    throw new PreviewError("DENIED", 403, "path is denied");
  }

  // stat before open so a FIFO/device cannot block the request.
  let pre: Stats;
  try {
    pre = await stat(resolved.abs);
  } catch {
    throw new PreviewError("INVALID_PATH", 404, "path does not exist");
  }
  assertRegularFile(pre, previewBytes);

  let fh: FileHandle;
  try {
    fh = await open(resolved.abs, constants.O_RDONLY | constants.O_NONBLOCK);
  } catch {
    throw new PreviewError("INVALID_PATH", 404, "path does not exist");
  }

  try {
    const st = await fh.stat();
    assertRegularFile(st, previewBytes);

    const realAbs = await realpath(resolved.abs);
    const realRel = posixRelOrThrow(rootReal, realAbs);
    if (isDenied(realRel, allowSecrets)) {
      throw new PreviewError("DENIED", 403, "path is denied");
    }

    const bytes = await readCapped(fh, previewBytes);
    const sniff = bytes.subarray(
      0,
      Math.min(BINARY_SNIFF_BYTES, bytes.byteLength),
    );
    if (sniff.includes(0)) {
      return {
        path: realRel,
        startLine: 1,
        lineCount: 0,
        truncated: false,
        binary: true,
        lines: [],
      };
    }

    const text = new TextDecoder("utf-8").decode(bytes);
    return windowLines(realRel, text, query, previewLines);
  } finally {
    await fh.close();
  }
}
