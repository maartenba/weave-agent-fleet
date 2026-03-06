/**
 * Pure workspace utility functions — no React dependencies.
 * Extracted from use-workspaces hook for testability and reuse.
 */

import type { SessionListItem } from "@/lib/api-types";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface WorkspaceGroup {
  workspaceId: string;
  workspaceDirectory: string;
  displayName: string;
  sessionCount: number;
  hasRunningSession: boolean;
  sessions: SessionListItem[];
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Derive a display name from the session's workspace metadata. */
export function deriveDisplayName(item: SessionListItem): string {
  if (item.workspaceDisplayName) {
    return item.workspaceDisplayName;
  }
  const parts = item.workspaceDirectory.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? item.workspaceDirectory;
}

/**
 * Groups a flat list of sessions into workspace groups, keyed by directory path.
 * Multiple workspace IDs pointing at the same directory are merged into one group.
 * Groups are sorted: running workspaces first, then alphabetical by display name.
 */
export function groupSessionsByWorkspace(
  sessions: SessionListItem[]
): WorkspaceGroup[] {
  const map = new Map<string, WorkspaceGroup>();

  for (const session of sessions) {
    const key = session.workspaceDirectory;
    const existing = map.get(key);
    if (existing) {
      existing.sessions.push(session);
      existing.sessionCount += 1;
      if (
        session.lifecycleStatus === "running" &&
        session.typedInstanceStatus === "running"
      ) {
        existing.hasRunningSession = true;
      }
      // Prefer an explicit display name if one session has it
      if (
        !existing.displayName ||
        existing.displayName === deriveDisplayName(session)
      ) {
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
          session.lifecycleStatus === "running" &&
          session.typedInstanceStatus === "running",
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
}

/**
 * Filter sessions by a workspace ID, resolving to the workspace's directory
 * so that all sessions sharing the same directory are included — matching
 * the sidebar's directory-based grouping.
 *
 * Returns all sessions when workspaceFilter is null/undefined.
 * Returns [] when the workspaceFilter doesn't match any session.
 */
export function filterSessionsByWorkspace(
  sessions: SessionListItem[],
  workspaceFilter: string | null | undefined
): SessionListItem[] {
  if (!workspaceFilter) return sessions;
  const matched = sessions.find((s) => s.workspaceId === workspaceFilter);
  if (!matched) return [];
  const targetDir = matched.workspaceDirectory;
  return sessions.filter((s) => s.workspaceDirectory === targetDir);
}
