import { zValidator } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import type * as z from "zod";

export function jsonErrorValidator<
  T extends z.ZodType,
  K extends keyof ValidationTargets,
>(target: K, schema: T) {
  return zValidator(target, schema, (result, c) => {
    if (!result.success) {
      const message = result.error.issues[0]?.message ?? "invalid request";
      return c.json({ code: "INVALID_QUERY" as const, message }, 400);
    }
  });
}
