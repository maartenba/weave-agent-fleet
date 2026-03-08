"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { SessionListItem } from "@/lib/api-types";
import { apiFetch } from "@/lib/api-client";
import { sessionsChanged } from "@/lib/session-utils";

export interface UseSessionsResult {
  sessions: SessionListItem[];
  isLoading: boolean;
  error?: string;
  refetch: () => void;
}

const DEFAULT_POLL_INTERVAL_MS = 5_000;

export function useSessions(
  pollIntervalMs: number = DEFAULT_POLL_INTERVAL_MS
): UseSessionsResult {
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const isMounted = useRef(true);

  const fetchSessions = useCallback(async () => {
    try {
      const response = await apiFetch("/api/sessions");
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = (await response.json()) as SessionListItem[];
      if (isMounted.current) {
        setSessions(prev => sessionsChanged(prev, data) ? data : prev);
        setError(undefined);
      }
    } catch (err) {
      if (isMounted.current) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (isMounted.current) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    isMounted.current = true;
    fetchSessions();

    const interval = setInterval(fetchSessions, pollIntervalMs);
    return () => {
      isMounted.current = false;
      clearInterval(interval);
    };
  }, [fetchSessions, pollIntervalMs]);

  return { sessions, isLoading, error, refetch: fetchSessions };
}
