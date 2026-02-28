"use client";

import { useEffect, useMemo, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Header, NewSessionButton } from "@/components/layout/header";
import { SummaryBar } from "@/components/fleet/summary-bar";
import { FleetToolbar, loadPrefs, loadSavedPrefs } from "@/components/fleet/fleet-toolbar";
import type { GroupBy, SortBy } from "@/components/fleet/fleet-toolbar";
import { SessionGroup } from "@/components/fleet/session-group";
import { LiveSessionCard } from "@/components/fleet/live-session-card";
import { useSessionsContext } from "@/contexts/sessions-context";
import { useTerminateSession } from "@/hooks/use-terminate-session";
import { useWorkspaces } from "@/hooks/use-workspaces";
import { filterSessionsByWorkspace } from "@/lib/workspace-utils";
import type { FleetSummary } from "@/lib/types";
import type { SessionListItem } from "@/lib/api-types";
import { Loader2 } from "lucide-react";

function FleetPageInner() {
  const { sessions, isLoading, error, refetch, summary: liveSummary } = useSessionsContext();
  const { terminateSession } = useTerminateSession();
  const searchParams = useSearchParams();
  const workspaceFilter = searchParams.get("workspace");

  // Toolbar state — start with defaults (SSR-safe), then hydrate from localStorage
  const [prefs, setPrefs] = useState<{ groupBy: GroupBy; sortBy: SortBy }>(
    loadPrefs
  );
  const [search, setSearch] = useState("");

  // Hydrate saved preferences after mount to avoid SSR/client mismatch
  useEffect(() => {
    setPrefs(loadSavedPrefs());
  }, []);

  const handleGroupByChange = (groupBy: GroupBy) => {
    setPrefs((prev) => ({ ...prev, groupBy }));
  };

  const handleSortByChange = (sortBy: SortBy) => {
    setPrefs((prev) => ({ ...prev, sortBy }));
  };

  const handleTerminate = async (sessionId: string, instanceId: string) => {
    try {
      await terminateSession(sessionId, instanceId);
      refetch();
    } catch {
      // error surfaced inside useTerminateSession
    }
  };

  // Apply workspace URL filter — resolves workspaceId to directory so that all
  // sessions sharing the same workspace directory are included.
  const workspaceFiltered = useMemo(
    () => filterSessionsByWorkspace(sessions, workspaceFilter),
    [sessions, workspaceFilter]
  );

  // Apply search filter
  const searchFiltered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return workspaceFiltered;
    return workspaceFiltered.filter((s) => {
      const title = s.session.title?.toLowerCase() ?? "";
      const dir = s.workspaceDirectory.toLowerCase();
      const displayName = s.workspaceDisplayName?.toLowerCase() ?? "";
      return title.includes(q) || dir.includes(q) || displayName.includes(q);
    });
  }, [workspaceFiltered, search]);

  // Apply sort within session arrays
  const sortSessions = (items: SessionListItem[]): SessionListItem[] => {
    const sorted = [...items];
    if (prefs.sortBy === "recent") {
      sorted.sort((a, b) => b.session.time.created - a.session.time.created);
    } else if (prefs.sortBy === "name") {
      sorted.sort((a, b) => {
        const aTitle = a.session.title ?? a.session.id;
        const bTitle = b.session.title ?? b.session.id;
        return aTitle.localeCompare(bTitle);
      });
    } else if (prefs.sortBy === "status") {
      const order = { active: 0, disconnected: 1, stopped: 2 } as const;
      sorted.sort((a, b) => {
        const aOrd = order[a.sessionStatus] ?? 3;
        const bOrd = order[b.sessionStatus] ?? 3;
        return aOrd - bOrd;
      });
    }
    return sorted;
  };

  // Derive workspace groups from filtered sessions
  const allWorkspaces = useWorkspaces(searchFiltered);

  const liveCount = liveSummary?.activeSessions ?? sessions.filter((s) => s.sessionStatus === "active").length;

  const summary: FleetSummary = {
    activeSessions: liveSummary?.activeSessions ?? liveCount,
    idleSessions: liveSummary?.idleSessions ?? 0,
    completedSessions: liveSummary?.completedSessions ?? sessions.filter((s) => s.sessionStatus === "stopped").length,
    errorSessions: liveSummary?.errorSessions ?? sessions.filter((s) => s.sessionStatus === "disconnected").length,
    totalTokens: liveSummary?.totalTokens ?? 0,
    totalCost: liveSummary?.totalCost ?? 0,
    runningPipelines: 0,
    queuedTasks: 0,
  };

  const subtitle =
    sessions.length > 0
      ? `${liveCount} active session${liveCount !== 1 ? "s" : ""}`
      : "No active sessions";

  // Group by "Status"
  const renderGroupedByStatus = () => {
    const statusGroups: Record<string, SessionListItem[]> = {
      active: [],
      disconnected: [],
      stopped: [],
    };
    for (const s of searchFiltered) {
      (statusGroups[s.sessionStatus] ?? []).push(s);
    }
    return (
      <div className="space-y-4">
        {(["active", "disconnected", "stopped"] as const).map((status) => {
          const items = sortSessions(statusGroups[status]);
          if (items.length === 0) return null;
          return (
            <div key={status}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {status}
                </span>
                <span className="text-xs text-muted-foreground">({items.length})</span>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {items.map((item) => (
                  <LiveSessionCard
                    key={`${item.instanceId}-${item.session.id}`}
                    item={item}
                    onTerminate={handleTerminate}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // Group by "Source" (isolationStrategy)
  const renderGroupedBySource = () => {
    const sourceMap = new Map<string, SessionListItem[]>();
    for (const s of searchFiltered) {
      const key = s.isolationStrategy ?? "existing";
      const arr = sourceMap.get(key);
      if (arr) {
        arr.push(s);
      } else {
        sourceMap.set(key, [s]);
      }
    }
    return (
      <div className="space-y-4">
        {Array.from(sourceMap.entries()).map(([source, items]) => {
          const sorted = sortSessions(items);
          return (
            <div key={source}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {source}
                </span>
                <span className="text-xs text-muted-foreground">({sorted.length})</span>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {sorted.map((item) => (
                  <LiveSessionCard
                    key={`${item.instanceId}-${item.session.id}`}
                    item={item}
                    onTerminate={handleTerminate}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderContent = () => {
    if (searchFiltered.length === 0 && !isLoading) {
      if (search.trim()) {
        return (
          <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
            No sessions match your search.
          </div>
        );
      }
      if (workspaceFilter) {
        return (
          <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
            No sessions in this workspace.
          </div>
        );
      }
      return null;
    }

    if (prefs.groupBy === "none") {
      return (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {sortSessions(searchFiltered).map((item) => (
            <LiveSessionCard
              key={`${item.instanceId}-${item.session.id}`}
              item={item}
              onTerminate={handleTerminate}
            />
          ))}
        </div>
      );
    }

    if (prefs.groupBy === "status") {
      return renderGroupedByStatus();
    }

    if (prefs.groupBy === "source") {
      return renderGroupedBySource();
    }

    // Default: "directory" — render SessionGroup per workspace
    return (
      <div className="space-y-2">
        {allWorkspaces.map((group) => (
          <SessionGroup
            key={group.workspaceId}
            group={{ ...group, sessions: sortSessions(group.sessions) }}
            onTerminate={handleTerminate}
          />
        ))}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full">
      <Header
        title="Agent Fleet"
        subtitle={subtitle}
        actions={<NewSessionButton />}
      />
      <div className="flex-1 overflow-auto p-6 space-y-6">
        <SummaryBar summary={summary} />

        <FleetToolbar
          groupBy={prefs.groupBy}
          sortBy={prefs.sortBy}
          search={search}
          onGroupByChange={handleGroupByChange}
          onSortByChange={handleSortByChange}
          onSearchChange={setSearch}
        />

        {isLoading && sessions.length === 0 && (
          <div className="flex items-center justify-center h-32 text-muted-foreground gap-2 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading sessions…
          </div>
        )}

        {error && (
          <div className="rounded-md bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400">
            Failed to load sessions: {error}
          </div>
        )}

        {renderContent()}

        {!isLoading && sessions.length === 0 && !error && (
          <div className="flex flex-col items-center justify-center h-48 text-muted-foreground text-sm gap-3">
            <p>No sessions running.</p>
            <p className="text-xs">Click &ldquo;New Session&rdquo; to spawn an OpenCode instance.</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function FleetPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-full text-muted-foreground gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      }
    >
      <FleetPageInner />
    </Suspense>
  );
}
