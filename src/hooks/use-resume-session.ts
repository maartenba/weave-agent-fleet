"use client";

import { useCallback, useState } from "react";
import type { ResumeSessionResponse } from "@/lib/api-types";

export interface UseResumeSessionResult {
  resumeSession: (sessionId: string) => Promise<ResumeSessionResponse>;
  isResuming: boolean;
  error?: string;
}

export function useResumeSession(): UseResumeSessionResult {
  const [isResuming, setIsResuming] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const resumeSession = useCallback(async (sessionId: string): Promise<ResumeSessionResponse> => {
    setIsResuming(true);
    setError(undefined);

    try {
      const response = await fetch(
        `/api/sessions/${encodeURIComponent(sessionId)}/resume`,
        { method: "POST" }
      );

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        const message =
          response.status === 409
            ? "Session is already active"
            : ((body as { error?: string }).error ?? `HTTP ${response.status}`);
        throw new Error(message);
      }

      return (await response.json()) as ResumeSessionResponse;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to resume session";
      setError(message);
      throw err;
    } finally {
      setIsResuming(false);
    }
  }, []);

  return { resumeSession, isResuming, error };
}
