import {
  SseDoneSchema,
  SseErrorSchema,
  type SseEvent,
  SseHitSchema,
  SseMetaSchema,
  SseProgressSchema,
} from "@web-grep/shared";

function parseSseFrame(frame: string): SseEvent | "skip" | "malformed" {
  let eventName = "";
  const dataLines: string[] = [];
  for (const rawLine of frame.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line === "" || line.startsWith(":")) {
      continue;
    }
    if (line.startsWith("event:")) {
      eventName = line.slice("event:".length).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      let value = line.slice("data:".length);
      if (value.startsWith(" ")) {
        value = value.slice(1);
      }
      dataLines.push(value);
    }
  }
  if (dataLines.length === 0) {
    return "skip";
  }
  let json: unknown;
  try {
    json = JSON.parse(dataLines.join("\n"));
  } catch {
    return "malformed";
  }
  if (eventName === "meta") {
    const parsed = SseMetaSchema.safeParse(json);
    return parsed.success ? { event: "meta", data: parsed.data } : "malformed";
  }
  if (eventName === "progress") {
    const parsed = SseProgressSchema.safeParse(json);
    return parsed.success
      ? { event: "progress", data: parsed.data }
      : "malformed";
  }
  if (eventName === "hit") {
    const parsed = SseHitSchema.safeParse(json);
    return parsed.success ? { event: "hit", data: parsed.data } : "malformed";
  }
  if (eventName === "done") {
    const parsed = SseDoneSchema.safeParse(json);
    return parsed.success ? { event: "done", data: parsed.data } : "malformed";
  }
  if (eventName === "error") {
    const parsed = SseErrorSchema.safeParse(json);
    return parsed.success ? { event: "error", data: parsed.data } : "malformed";
  }
  return "malformed";
}

export async function* readSse(
  stream: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): AsyncGenerator<SseEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = new Uint8Array(0);
  let malformedLogged = false;

  const onAbort = (): void => {
    void reader.cancel();
  };
  if (signal.aborted) {
    await reader.cancel();
    return;
  }
  signal.addEventListener("abort", onAbort);

  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (value !== undefined && value.byteLength > 0) {
        const next = new Uint8Array(buffer.byteLength + value.byteLength);
        next.set(buffer, 0);
        next.set(value, buffer.byteLength);
        buffer = next;
      }
      let sep = indexOfDoubleNewline(buffer);
      while (sep !== -1) {
        const frameBytes = buffer.subarray(0, sep);
        buffer = buffer.subarray(sep + 2);
        const parsed = parseSseFrame(decoder.decode(frameBytes));
        if (parsed === "malformed") {
          if (!malformedLogged) {
            malformedLogged = true;
            console.warn("skipping malformed SSE frame");
          }
        } else if (parsed !== "skip") {
          yield parsed;
        }
        sep = indexOfDoubleNewline(buffer);
      }
      if (done) {
        if (buffer.byteLength > 0 && !signal.aborted) {
          const parsed = parseSseFrame(decoder.decode(buffer));
          if (parsed !== "skip" && parsed !== "malformed") {
            yield parsed;
          }
        }
        break;
      }
    }
  } catch (err) {
    if (signal.aborted) {
      return;
    }
    throw err;
  } finally {
    signal.removeEventListener("abort", onAbort);
    try {
      reader.releaseLock();
    } catch {
      // already released after cancel
    }
  }
}

function indexOfDoubleNewline(buf: Uint8Array): number {
  for (let i = 0; i < buf.length - 1; i++) {
    if (buf[i] === 10 && buf[i + 1] === 10) {
      return i;
    }
  }
  return -1;
}
