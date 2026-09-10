import * as z from "zod";

export const ErrorCodeSchema = z.enum([
  "INVALID_QUERY",
  "INVALID_PATH",
  "INVALID_GLOB",
  "DENIED",
  "BUSY",
  "ENGINE",
  "ENGINE_UNSUPPORTED",
  "UNAUTHORIZED",
  "FORBIDDEN_HOST",
  "INTERNAL",
]);
export type ErrorCode = z.output<typeof ErrorCodeSchema>;

export const JsonErrorSchema = z.object({
  code: ErrorCodeSchema,
  message: z.string(),
});
export type JsonError = z.output<typeof JsonErrorSchema>;
