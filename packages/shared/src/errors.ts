import * as z from "zod";

/** Advertised v1 codes. Go never emits ENGINE_UNSUPPORTED; if a client sees it, treat as ENGINE. */
export const ErrorCodeSchema = z.enum([
  "INVALID_QUERY",
  "INVALID_PATH",
  "INVALID_GLOB",
  "DENIED",
  "BUSY",
  "ENGINE",
  "UNAUTHORIZED",
  "INVALID_AUTH",
  "FORBIDDEN_HOST",
  "INTERNAL",
]);
export type ErrorCode = z.output<typeof ErrorCodeSchema>;

/** Map leftover/unknown engine codes onto ENGINE without advertising ENGINE_UNSUPPORTED. */
export function mapLegacyErrorCode(code: string): string {
  return code === "ENGINE_UNSUPPORTED" ? "ENGINE" : code;
}

export const JsonErrorSchema = z.object({
  // ENGINE_UNSUPPORTED is not advertised; leftover payloads map to ENGINE.
  code: z.string().transform(mapLegacyErrorCode).pipe(ErrorCodeSchema),
  message: z.string(),
});
export type JsonError = z.output<typeof JsonErrorSchema>;
