import type { MetaResponse } from "@web-grep/shared";
import { MetaResponseSchema } from "@web-grep/shared";
import { useCallback, useEffect, useState } from "react";
import {
  fetchAuthStatus,
  loginWithPassword,
  logoutSession,
} from "../api/authClient.ts";
import { apiHeaders, readToken, writeToken } from "../api/headers.ts";
import { readJsonError, SearchHttpError } from "../api/searchClient.ts";

export type AuthState = {
  promptOpen: boolean;
  hostForbidden: boolean;
  meta: MetaResponse | null;
  sessionReady: boolean;
  canLogout: boolean;
  login: (password: string, remember?: boolean) => Promise<void>;
  logout: () => Promise<void>;
  handleAuthFailure: (err: SearchHttpError) => void;
};

function shouldPromptForAuth(status: number, code: string): boolean {
  if (status === 403 || code === "FORBIDDEN_HOST") {
    return false;
  }
  return status === 401 || code === "UNAUTHORIZED" || code === "INVALID_AUTH";
}

export function useAuth(): AuthState {
  const [promptOpen, setPromptOpen] = useState(false);
  const [hostForbidden, setHostForbidden] = useState(false);
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [hasSession, setHasSession] = useState(() => readToken() !== "");

  const loadMeta = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch("/api/meta", {
        headers: apiHeaders(),
        ...(signal !== undefined ? { signal } : {}),
      });
      if (res.status === 401) {
        writeToken("");
        setPromptOpen(true);
        setHasSession(false);
        return;
      }
      if (!res.ok) {
        const err = await readJsonError(res);
        if (err.body.code === "FORBIDDEN_HOST" || res.status === 403) {
          if (err.body.code === "FORBIDDEN_HOST") {
            setHostForbidden(true);
            setPromptOpen(false);
          }
        }
        return;
      }
      const parsed = MetaResponseSchema.safeParse(await res.json());
      if (!parsed.success) {
        return;
      }
      setMeta(parsed.data);
      if (parsed.data.authRequired && readToken() === "") {
        setPromptOpen(true);
        setHasSession(false);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
    }
  }, []);

  const boot = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const status = await fetchAuthStatus(signal);
        if (status.authRequired && readToken() === "") {
          setPromptOpen(true);
          setHasSession(false);
          return;
        }
        await loadMeta(signal);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }
        await loadMeta(signal);
      }
    },
    [loadMeta],
  );

  useEffect(() => {
    const ac = new AbortController();
    void boot(ac.signal);
    return () => {
      ac.abort();
    };
  }, [boot]);

  const login = useCallback(
    async (password: string, remember = true) => {
      const res = await loginWithPassword(password);
      writeToken(res.token, remember ? "local" : "session");
      setHasSession(true);
      setPromptOpen(false);
      await loadMeta();
    },
    [loadMeta],
  );

  const logout = useCallback(async () => {
    writeToken("");
    setHasSession(false);
    setMeta(null);
    setPromptOpen(true);
    try {
      await logoutSession();
    } catch {
      // still clear the local session
    }
    try {
      const status = await fetchAuthStatus();
      setPromptOpen(status.authRequired);
    } catch {
      setPromptOpen(true);
    }
  }, []);

  const handleAuthFailure = useCallback((err: SearchHttpError) => {
    if (shouldPromptForAuth(err.status, err.body.code)) {
      writeToken("");
      setHasSession(false);
      setPromptOpen(true);
      return;
    }
    if (err.body.code === "FORBIDDEN_HOST") {
      setHostForbidden(true);
      setPromptOpen(false);
    }
  }, []);

  return {
    promptOpen,
    hostForbidden,
    meta,
    sessionReady: !promptOpen && !hostForbidden,
    canLogout: hasSession && !promptOpen && !hostForbidden,
    login,
    logout,
    handleAuthFailure,
  };
}
