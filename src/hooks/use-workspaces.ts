"use client";

import { useMemo } from "react";
import type { SessionListItem } from "@/lib/api-types";

export interface WorkspaceGroup {
  workspaceId: string;
  workspaceDirectory: string;
  displayName: string;
  sessionCount: number;
  hasRunningSession: boolean;
  sessions: SessionListItem[];
}

function deriveDisplayName(item: SessionListItem): string {
  if (item.workspaceDisplayName) {
    return item.workspaceDisplayName;
  }
  const parts = item.workspaceDirectory.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? item.workspaceDirectory;
}

export function useWorkspaces(sessions: SessionListItem[]): WorkspaceGroup[] {
  return useMemo(() => {
    const map = new Map<string, WorkspaceGroup>();

    for (const session of sessions) {
      const existing = map.get(session.workspaceId);
      if (existing) {
        existing.sessions.push(session);
        existing.sessionCount += 1;
        if (session.sessionStatus === "active" && session.instanceStatus === "running") {
          existing.hasRunningSession = true;
        }
      } else {
        map.set(session.workspaceId, {
          workspaceId: session.workspaceId,
          workspaceDirectory: session.workspaceDirectory,
          displayName: deriveDisplayName(session),
          sessionCount: 1,
          hasRunningSession:
            session.sessionStatus === "active" && session.instanceStatus === "running",
          sessions: [session],
        });
      }
    }

    const groups = Array.from(map.values());

    groups.sort((a, b) => {
      if (a.hasRunningSession !== b.hasRunningSession) {
        return a.hasRunningSession ? -1 : 1;
      }
      return a.displayName.localeCompare(b.displayName);
    });

    return groups;
  }, [sessions]);
}
