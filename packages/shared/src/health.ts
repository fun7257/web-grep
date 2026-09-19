import * as z from "zod";

export const HealthResponseSchema = z.object({
  ok: z.boolean(),
  engine: z.enum(["rg", "none"]),
});
export type HealthResponse = z.output<typeof HealthResponseSchema>;
