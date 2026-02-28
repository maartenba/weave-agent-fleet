"use client";

import { createContext, useContext } from "react";
import { useSessions } from "@/hooks/use-sessions";
import { useFleetSummary } from "@/hooks/use-fleet-summary";
import type { SessionListItem } from "@/lib/api-types";
import type { FleetSummaryResponse } from "@/hooks/use-fleet-summary";

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

export function SessionsProvider({ children }: { children: React.ReactNode }) {
  const { sessions, isLoading, error, refetch } = useSessions(5000);
  const { summary } = useFleetSummary(10000);

  return (
    <SessionsContext.Provider value={{ sessions, isLoading, error, refetch, summary }}>
      {children}
    </SessionsContext.Provider>
  );
}

export function useSessionsContext(): SessionsContextValue {
  return useContext(SessionsContext);
}
