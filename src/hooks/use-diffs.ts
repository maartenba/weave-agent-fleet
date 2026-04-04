"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { FileDiffItem } from "@/lib/api-types";
import { apiFetch } from "@/lib/api-client";

export interface UseDiffsResult {
  diffs: FileDiffItem[];
  isLoading: boolean;
  error?: string;
  fetchDiffs: () => void;
}

/**
 * Fetches file diffs for a session on demand (not auto-polling).
 * Call `fetchDiffs()` when the user activates the "Changes" tab.
 * Pass `messageID` to fetch session-scoped diffs (cumulative from that message).
 *
 * `fetchDiffs` is referentially stable — it reads `messageID` from a ref so
 * downstream consumers (effects, callbacks) don't cascade when the mode changes.
 */
export function useDiffs(sessionId: string, instanceId: string, messageID?: string): UseDiffsResult {
  const [diffs, setDiffs] = useState<FileDiffItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const isMounted = useRef(true);

  // Keep messageID in a ref so fetchDiffs stays referentially stable
  const messageIDRef = useRef(messageID);
  useEffect(() => {
    messageIDRef.current = messageID;
  }, [messageID]);

  const fetchDiffs = useCallback(async () => {
    if (!sessionId || !instanceId) return;
    setIsLoading(true);
    setError(undefined);

    try {
      const mid = messageIDRef.current;
      const url = `/api/sessions/${encodeURIComponent(sessionId)}/diffs?instanceId=${encodeURIComponent(instanceId)}${mid ? `&messageID=${encodeURIComponent(mid)}` : ""}`;
      const response = await apiFetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = (await response.json()) as FileDiffItem[];
      if (isMounted.current) {
        setDiffs(data);
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
  }, [sessionId, instanceId]);

  // Auto-refetch when messageID changes (diff mode toggle)
  useEffect(() => {
    if (sessionId && instanceId) {
      fetchDiffs();
    }
  }, [messageID, fetchDiffs, sessionId, instanceId]);

  return { diffs, isLoading, error, fetchDiffs };
}
