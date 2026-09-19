import {
  AuthStatusSchema,
  LoginRequestSchema,
  LoginResponseSchema,
  type AuthStatus,
  type LoginResponse,
} from "@web-grep/shared";
import { fetchApi, fetchJson, readJsonError } from "./http.ts";

export async function fetchAuthStatus(
  signal?: AbortSignal,
): Promise<AuthStatus> {
  return AuthStatusSchema.parse(
    await fetchJson("/api/auth/status", {
      ...(signal !== undefined ? { signal } : {}),
    }),
  );
}

export async function loginWithPassword(
  password: string,
  signal?: AbortSignal,
): Promise<LoginResponse> {
  const body = LoginRequestSchema.parse({ password });
  return LoginResponseSchema.parse(
    await fetchJson("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      ...(signal !== undefined ? { signal } : {}),
    }),
  );
}

export async function logoutSession(signal?: AbortSignal): Promise<void> {
  const res = await fetchApi("/api/auth/logout", {
    method: "POST",
    ...(signal !== undefined ? { signal } : {}),
  });
  if (!res.ok && res.status !== 401) {
    throw await readJsonError(res);
  }
}
