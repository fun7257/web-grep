import * as z from "zod";

export const AuthStatusSchema = z.object({
  authRequired: z.boolean(),
});
export type AuthStatus = z.output<typeof AuthStatusSchema>;

export const LoginRequestSchema = z.object({
  password: z.string().min(1).max(256),
});
export type LoginRequest = z.output<typeof LoginRequestSchema>;
export type LoginRequestInput = z.input<typeof LoginRequestSchema>;

export const LoginResponseSchema = z.object({
  token: z.string().min(1),
  expiresAt: z.number().int().nonnegative().optional(),
});
export type LoginResponse = z.output<typeof LoginResponseSchema>;
