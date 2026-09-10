import { type MetaResponse, MetaResponseSchema } from "@web-grep/shared";
import { useCallback, useEffect, useState } from "react";
import { apiHeaders, readToken, writeToken } from "../api/headers.ts";
import { readJsonError, SearchHttpError } from "../api/searchClient.ts";

export type TokenState = {
  promptOpen: boolean;
  hostForbidden: boolean;
  meta: MetaResponse | null;
  saveToken: (token: string) => void;
  handleAuthFailure: (err: SearchHttpError) => void;
};

function shouldPromptForToken(status: number, code: string): boolean {
  if (status === 403 || code === "FORBIDDEN_HOST") {
    return false;
  }
  return status === 401 || code === "UNAUTHORIZED";
}

export function useToken(): TokenState {
  const [promptOpen, setPromptOpen] = useState(false);
  const [hostForbidden, setHostForbidden] = useState(false);
  const [meta, setMeta] = useState<MetaResponse | null>(null);

  const loadMeta = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch("/api/meta", {
        headers: apiHeaders(),
        ...(signal !== undefined ? { signal } : {}),
      });
      if (res.status === 401) {
        setPromptOpen(true);
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
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
    }
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    void loadMeta(ac.signal);
    return () => {
      ac.abort();
    };
  }, [loadMeta]);

  const saveToken = useCallback(
    (token: string) => {
      writeToken(token);
      setPromptOpen(false);
      void loadMeta();
    },
    [loadMeta],
  );

  const handleAuthFailure = useCallback((err: SearchHttpError) => {
    if (shouldPromptForToken(err.status, err.body.code)) {
      setPromptOpen(true);
      return;
    }
    if (err.body.code === "FORBIDDEN_HOST") {
      setHostForbidden(true);
      setPromptOpen(false);
    }
  }, []);

  return { promptOpen, hostForbidden, meta, saveToken, handleAuthFailure };
}
