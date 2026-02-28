"use client";

import { useCallback } from "react";
import { ChevronRight, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InlineEdit } from "@/components/ui/inline-edit";
import { LiveSessionCard } from "@/components/fleet/live-session-card";
import { useRenameWorkspace } from "@/hooks/use-rename-workspace";
import { useSessionsContext } from "@/contexts/sessions-context";
import { usePersistedState } from "@/hooks/use-persisted-state";
import { useTerminateSession } from "@/hooks/use-terminate-session";
import type { WorkspaceGroup } from "@/hooks/use-workspaces";
import { cn } from "@/lib/utils";

const COLLAPSED_KEY = "weave:fleet:collapsed";

interface SessionGroupProps {
  group: WorkspaceGroup;
  onTerminate: (sessionId: string, instanceId: string) => void;
  onNewSession?: (workspaceDirectory: string) => void;
  onResume?: (sessionId: string) => void;
  onDelete?: (sessionId: string, instanceId: string) => void;
  resumingSessionId?: string | null;
}

export function SessionGroup({ group, onTerminate, onNewSession, onResume, onDelete, resumingSessionId }: SessionGroupProps) {
  const { refetch } = useSessionsContext();
  const { renameWorkspace } = useRenameWorkspace();
  const { terminateSession } = useTerminateSession();

  const [collapsedIds, setCollapsedIds] = usePersistedState<string[]>(
    COLLAPSED_KEY,
    []
  );

  const isCollapsed = collapsedIds.includes(group.workspaceId);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      setCollapsedIds((prev) =>
        open
          ? prev.filter((id) => id !== group.workspaceId)
          : [...prev, group.workspaceId]
      );
    },
    [group.workspaceId, setCollapsedIds]
  );

  const handleRename = useCallback(
    async (newName: string) => {
      try {
        await renameWorkspace(group.workspaceId, newName, refetch);
      } catch {
        // error surfaced inside useRenameWorkspace
      }
    },
    [group.workspaceId, renameWorkspace, refetch]
  );

  const handleTerminateAll = useCallback(async () => {
    const active = group.sessions.filter((s) => s.sessionStatus !== "stopped");
    await Promise.allSettled(
      active.map((s) => terminateSession(s.session.id, s.instanceId))
    );
    refetch();
  }, [group.sessions, terminateSession, refetch]);

  const hasRunning = group.hasRunningSession;

  return (
    <Collapsible open={!isCollapsed} onOpenChange={handleOpenChange}>
      <div className="flex items-center gap-2 py-1.5 px-1 group/header rounded-md hover:bg-accent/50 transition-colors">
        {/* Expand/collapse chevron */}
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            className="shrink-0 text-muted-foreground hover:text-foreground"
            onClick={(e) => e.stopPropagation()}
          >
            <ChevronRight
              className={cn(
                "size-3.5 transition-transform duration-150",
                !isCollapsed && "rotate-90"
              )}
            />
          </Button>
        </CollapsibleTrigger>

        {/* Status dot */}
        <span
          className={cn(
            "h-2 w-2 rounded-full shrink-0",
            hasRunning ? "bg-green-500 animate-pulse" : "bg-slate-500"
          )}
        />

        {/* Workspace display name (inline-editable) */}
        <InlineEdit
          value={group.displayName}
          onSave={handleRename}
          className="flex-1 min-w-0 font-medium text-sm truncate"
        />

        {/* Session count badge */}
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
          {group.sessionCount}
        </Badge>

        {/* Overflow menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              className="shrink-0 opacity-0 group-hover/header:opacity-100 transition-opacity text-muted-foreground"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {onNewSession && (
              <DropdownMenuItem
                onClick={() => onNewSession(group.workspaceDirectory)}
                className="gap-2 text-xs"
              >
                <Plus className="size-3.5" />
                New Session
              </DropdownMenuItem>
            )}
            {onNewSession && <DropdownMenuSeparator />}
            <DropdownMenuItem
              onClick={handleTerminateAll}
              variant="destructive"
              className="gap-2 text-xs"
            >
              <Trash2 className="size-3.5" />
              Terminate All
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <CollapsibleContent className="overflow-hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:slide-in-from-top-1 data-[state=closed]:slide-out-to-top-1 transition-all">
        {group.sessions.length === 0 ? (
          <div className="mt-2 ml-6 py-3 text-xs text-muted-foreground/70 italic">
            No sessions in this workspace.
          </div>
        ) : (
          <div className="mt-2 ml-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {group.sessions.map((item) => (
              <LiveSessionCard
                key={`${item.instanceId}-${item.session.id}`}
                item={item}
                onTerminate={onTerminate}
                onResume={onResume}
                onDelete={onDelete}
                isResuming={resumingSessionId === item.session.id}
              />
            ))}
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
