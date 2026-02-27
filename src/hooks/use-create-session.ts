"use client";

import { useState, useCallback } from "react";
import type { CreateSessionResponse } from "@/lib/api-types";

export interface UseCreateSessionResult {
  createSession: (
    directory: string,
    title?: string
  ) => Promise<CreateSessionResponse>;
  isLoading: boolean;
  error?: string;
}

export function useCreateSession(): UseCreateSessionResult {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const createSession = useCallback(
    async (directory: string, title?: string): Promise<CreateSessionResponse> => {
      setIsLoading(true);
      setError(undefined);
      try {
        const response = await fetch("/api/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ directory, title }),
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          const message = (data as { error?: string }).error ?? `HTTP ${response.status}`;
          setError(message);
          throw new Error(message);
        }

        return (await response.json()) as CreateSessionResponse;
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  return { createSession, isLoading, error };
}
