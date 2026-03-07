"use client";

import { createContext, useContext, useState, useEffect, useRef, useMemo } from "react";
import { useSessions } from "@/hooks/use-sessions";
import { useFleetSummary } from "@/hooks/use-fleet-summary";
import type { SessionListItem } from "@/lib/api-types";
import type { FleetSummaryResponse } from "@/hooks/use-fleet-summary";
import type { SessionActivityStatus } from "@/lib/types";

export interface SessionsContextValue {
  sessions: SessionListItem[];
  isLoading: boolean;
  error?: string;
  refetch: () => void;
  summary: FleetSummaryResponse | null;
}

const defaultValue: SessionsContextValue = {
  sessions: [],
  isLoading: true,
  error: undefined,
  refetch: () => {},
  summary: null,
};

const SessionsContext = createContext<SessionsContextValue>(defaultValue);

/**
 * Map an incoming activityStatus to the legacy sessionStatus field.
 * Mirrors the server-side deriveActivityStatus mapping (in reverse).
 */
export function activityToSessionStatus(
  activityStatus: SessionActivityStatus
): SessionListItem["sessionStatus"] {
  switch (activityStatus) {
    case "busy":
      return "active";
    case "idle":
      return "idle";
    case "waiting_input":
      return "waiting_input";
  }
}

/**
 * Patch a single session's activity status in the sessions array.
 * Returns a new array only if a matching session was found and changed.
 */
export function patchActivityStatus(
  sessions: SessionListItem[],
  sessionId: string,
  activityStatus: SessionActivityStatus
): SessionListItem[] {
  const index = sessions.findIndex((s) => s.session.id === sessionId);
  if (index === -1) return sessions;

  const existing = sessions[index];
  // Skip patch if already the same
  if (existing.activityStatus === activityStatus) return sessions;

  const updated = sessions.slice();
  updated[index] = {
    ...existing,
    activityStatus,
    sessionStatus: activityToSessionStatus(activityStatus),
  };
  return updated;
}

export function SessionsProvider({ children }: { children: React.ReactNode }) {
  const { sessions: polledSessions, isLoading, error, refetch } = useSessions(5000);
  const { summary } = useFleetSummary(10000);

  // SSE patches stored in a ref to avoid setState-in-effect lint violations.
  // The ref is mutated by the SSE onmessage handler and read by useMemo.
  // When polledSessions changes (new poll arrived), we clear patches because
  // the poll is the source of truth.
  const ssePatchesRef = useRef<Map<string, SessionActivityStatus>>(new Map());
  const lastPolledRef = useRef(polledSessions);
  const [, forceRender] = useState(0);
  const isMounted = useRef(true);

  // Subscribe to the global notifications SSE stream for activity_status events
  useEffect(() => {
    isMounted.current = true;

    const es = new EventSource("/api/notifications/stream");

    es.onmessage = (e: MessageEvent<string>) => {
      if (!isMounted.current) return;
      try {
        const data = JSON.parse(e.data) as {
          type: string;
          payload?: {
            sessionId: string;
            activityStatus: SessionActivityStatus;
          };
        };
        if (data.type === "activity_status" && data.payload) {
          ssePatchesRef.current = new Map(ssePatchesRef.current);
          ssePatchesRef.current.set(data.payload.sessionId, data.payload.activityStatus);
          forceRender((n) => n + 1);
        }
      } catch {
        // Ignore parse errors
      }
    };

    return () => {
      isMounted.current = false;
      es.close();
    };
  }, []);

  // Merge polled sessions with any pending SSE patches.
  // Clear patches when polled data changes (poll is the source of truth).
  const sessions = useMemo(() => {
    if (lastPolledRef.current !== polledSessions) {
      lastPolledRef.current = polledSessions;
      ssePatchesRef.current = new Map();
    }

    const patches = ssePatchesRef.current;
    if (patches.size === 0) return polledSessions;

    let result = polledSessions;
    for (const [sessionId, activityStatus] of patches) {
      result = patchActivityStatus(result, sessionId, activityStatus);
    }
    return result;
    // forceRender counter is not used directly but triggers re-evaluation
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polledSessions, forceRender]);

  const contextValue = useMemo(
    () => ({ sessions, isLoading, error, refetch, summary }),
    [sessions, isLoading, error, refetch, summary]
  );

  return (
    <SessionsContext.Provider value={contextValue}>
      {children}
    </SessionsContext.Provider>
  );
}

export function useSessionsContext(): SessionsContextValue {
  return useContext(SessionsContext);
}
