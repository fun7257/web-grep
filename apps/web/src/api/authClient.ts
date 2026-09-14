import {
  AuthStatusSchema,
  LoginRequestSchema,
  LoginResponseSchema,
  type AuthStatus,
  type LoginResponse,
} from "@web-grep/shared";
import { apiHeaders } from "./headers.ts";
import { readJsonError } from "./searchClient.ts";

export async function fetchAuthStatus(
  signal?: AbortSignal,
): Promise<AuthStatus> {
  const res = await fetch("/api/auth/status", {
    headers: apiHeaders(),
    ...(signal !== undefined ? { signal } : {}),
  });
  if (!res.ok) {
    throw await readJsonError(res);
  }
  return AuthStatusSchema.parse(await res.json());
}

export async function loginWithPassword(
  password: string,
  signal?: AbortSignal,
): Promise<LoginResponse> {
  const body = LoginRequestSchema.parse({ password });
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", ...apiHeaders() },
    body: JSON.stringify(body),
    ...(signal !== undefined ? { signal } : {}),
  });
  if (!res.ok) {
    throw await readJsonError(res);
  }
  return LoginResponseSchema.parse(await res.json());
}

export async function logoutSession(signal?: AbortSignal): Promise<void> {
  const res = await fetch("/api/auth/logout", {
    method: "POST",
    headers: apiHeaders(),
    ...(signal !== undefined ? { signal } : {}),
  });
  if (!res.ok && res.status !== 401) {
    throw await readJsonError(res);
  }
}

export type { SearchHttpError } from "./searchClient.ts";
