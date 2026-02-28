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
      // Group by directory path, not workspaceId — multiple workspace records
      // can point at the same directory and should be treated as one group.
      const key = session.workspaceDirectory;
      const existing = map.get(key);
      if (existing) {
        existing.sessions.push(session);
        existing.sessionCount += 1;
        if (session.sessionStatus === "active" && session.instanceStatus === "running") {
          existing.hasRunningSession = true;
        }
        // Prefer an explicit display name if one session has it
        if (!existing.displayName || existing.displayName === deriveDisplayName(session)) {
          const candidateName = session.workspaceDisplayName;
          if (candidateName) {
            existing.displayName = candidateName;
          }
        }
      } else {
        map.set(key, {
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
