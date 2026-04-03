"use client";

import React, { useState, useCallback } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronRight, Loader2, Pencil, Pin, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { InlineEdit } from "@/components/ui/inline-edit";
import { SidebarSessionItem } from "@/components/layout/sidebar-session-item";
import { NewSessionDialog } from "@/components/session/new-session-dialog";
import { useRenameWorkspace } from "@/hooks/use-rename-workspace";
import { useTerminateSession } from "@/hooks/use-terminate-session";
import { useDeleteSession } from "@/hooks/use-delete-session";
import { usePersistedState } from "@/hooks/use-persisted-state";
import { useSessionsContext } from "@/contexts/sessions-context";
import { useOpenDirectory } from "@/hooks/use-open-directory";
import type { OpenTool } from "@/hooks/use-open-directory";
import { OpenToolContextSubmenu } from "@/components/ui/open-tool-menu";
import type { WorkspaceGroup } from "@/hooks/use-workspaces";
import { nestSessions, isInactiveSession } from "@/lib/session-utils";

const PINNED_KEY = "weave:sidebar:pinned";
const COLLAPSED_KEY = "weave:sidebar:collapsed";

interface SidebarWorkspaceItemProps {
  group: WorkspaceGroup;
  activeSessionPath: string;
  refetch: () => void;
  hideInactive?: boolean;
}

export const SidebarWorkspaceItem = React.memo(function SidebarWorkspaceItem({
  group,
  activeSessionPath,
  refetch,
  hideInactive = false,
}: SidebarWorkspaceItemProps) {
  const searchParams = useSearchParams();
  const workspaceFilter = searchParams.get("workspace");
  const isActiveWorkspace = workspaceFilter
    ? group.sessions.some((s) => s.workspaceId === workspaceFilter)
    : false;

  const { renameWorkspace } = useRenameWorkspace();
  const { patchWorkspaceDisplayName } = useSessionsContext();
  const { terminateSession } = useTerminateSession();
  const { deleteSession } = useDeleteSession();
  const { openDirectory } = useOpenDirectory();

  const [isRenaming, setIsRenaming] = useState(false);
  const [newSessionOpen, setNewSessionOpen] = useState(false);
  const [showRemoveInactiveConfirm, setShowRemoveInactiveConfirm] = useState(false);
  const [isRemovingInactive, setIsRemovingInactive] = useState(false);

  const [pinnedIds, setPinnedIds] = usePersistedState<string[]>(PINNED_KEY, []);
  const isPinned = pinnedIds.includes(group.workspaceId);

  const [collapsedIds, setCollapsedIds] = usePersistedState<string[]>(COLLAPSED_KEY, []);
  const isCollapsed = collapsedIds.includes(group.workspaceId);

  const inactiveInWorkspace = group.sessions.filter(isInactiveSession);

  const handleToggleCollapse = useCallback(
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
        patchWorkspaceDisplayName(group.workspaceId, newName);
        await renameWorkspace(group.workspaceId, newName, refetch);
      } catch {
        // error surfaced inside useRenameWorkspace
      }
    },
    [group.workspaceId, renameWorkspace, refetch, patchWorkspaceDisplayName]
  );

  const handleTogglePin = useCallback(() => {
    setPinnedIds((prev) =>
      prev.includes(group.workspaceId)
        ? prev.filter((id) => id !== group.workspaceId)
        : [...prev, group.workspaceId]
    );
  }, [group.workspaceId, setPinnedIds]);

  const handleTerminateAll = useCallback(async () => {
    const active = group.sessions.filter((s) => s.lifecycleStatus !== "stopped" && s.lifecycleStatus !== "completed" && s.lifecycleStatus !== "disconnected");
    if (active.length === 0) return;
    const confirmed = window.confirm(
      `Terminate all ${active.length} active session${active.length !== 1 ? "s" : ""} in "${group.displayName}"?`
    );
    if (!confirmed) return;
    await Promise.allSettled(
      active.map((s) => terminateSession(s.session.id, s.instanceId))
    );
    refetch();
  }, [group.sessions, group.displayName, terminateSession, refetch]);

  const handleRemoveInactive = useCallback(async () => {
    setIsRemovingInactive(true);
    try {
      await Promise.allSettled(
        inactiveInWorkspace.map((s) => deleteSession(s.session.id, s.instanceId))
      );
      refetch();
    } finally {
      setIsRemovingInactive(false);
      setShowRemoveInactiveConfirm(false);
    }
  }, [inactiveInWorkspace, deleteSession, refetch]);

  const handleOpen = useCallback(
    (directory: string, tool: OpenTool) => {
      openDirectory(directory, tool);
    },
    [openDirectory]
  );

  // Filter sessions when hideInactive is active
  const visibleSessions = hideInactive
    ? group.sessions.filter((s) => s.lifecycleStatus === "running")
    : group.sessions;

  return (
    <>
    <Collapsible open={!isCollapsed} onOpenChange={handleToggleCollapse}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            role="treeitem"
            aria-label={group.displayName}
            data-collapsed={isCollapsed ? "true" : "false"}
            tabIndex={0}
            className="focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-md"
          >
            {/* Workspace row */}
            <div
              className={cn(
                "flex items-center gap-2 rounded-md pl-1 pr-3 py-1.5 text-sm transition-colors",
                isActiveWorkspace
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
              )}
            >
              {/* Collapse/expand chevron */}
              <CollapsibleTrigger asChild>
                <button
                  className="shrink-0 p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors"
                  onClick={(e) => e.stopPropagation()}
                  aria-label={isCollapsed ? `Expand ${group.displayName}` : `Collapse ${group.displayName}`}
                >
                  <ChevronRight
                    className={cn(
                      "h-3 w-3 transition-transform duration-150",
                      !isCollapsed && "rotate-90"
                    )}
                  />
                </button>
              </CollapsibleTrigger>

              {/* Display name with tooltip for full path */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link
                    href={`/?workspace=${encodeURIComponent(group.workspaceId)}`}
                    className="flex-1 min-w-0"
                    onClick={(e) => {
                      if (isRenaming) {
                        e.preventDefault();
                      }
                    }}
                  >
                    <InlineEdit
                      value={group.displayName}
                      onSave={handleRename}
                      editing={isRenaming}
                      onEditingChange={setIsRenaming}
                      className="text-xs truncate block"
                    />
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right" className="text-xs font-mono">
                  {group.workspaceDirectory}
                </TooltipContent>
              </Tooltip>

              {/* Hidden trigger for F2 rename via keyboard navigation */}
              <button
                data-rename-trigger
                className="sr-only"
                tabIndex={-1}
                onClick={() => setIsRenaming(true)}
                aria-label={`Rename ${group.displayName}`}
              />
            </div>

            {/* Session list — collapsible */}
            <CollapsibleContent>
              <div className="space-y-0.5 mt-0.5" role="group">
                {nestSessions(visibleSessions, { sort: true }).map(({ item, children }) => (
                  <div key={`${item.instanceId}-${item.session.id}`}>
                    <SidebarSessionItem
                      item={item}
                      isActive={activeSessionPath === `/sessions/${item.session.id}`}
                      refetch={refetch}
                    />
                    {children.map((child) => (
                      <SidebarSessionItem
                        key={`${child.instanceId}-${child.session.id}`}
                        item={child}
                        isActive={activeSessionPath === `/sessions/${child.session.id}`}
                        isChild
                        refetch={refetch}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </CollapsibleContent>
          </div>
        </ContextMenuTrigger>

        <ContextMenuContent>
          <ContextMenuItem
            onClick={() => setIsRenaming(true)}
            className="gap-2 text-xs"
          >
            <Pencil className="h-3.5 w-3.5" />
            Rename
          </ContextMenuItem>
          <ContextMenuItem
            onClick={handleTogglePin}
            className="gap-2 text-xs"
          >
            <Pin className="h-3.5 w-3.5" />
            {isPinned ? "Unpin" : "Pin to top"}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            onClick={() => setNewSessionOpen(true)}
            className="gap-2 text-xs"
          >
            <Plus className="h-3.5 w-3.5" />
            New Session
          </ContextMenuItem>
          <OpenToolContextSubmenu
            directory={group.sessions[0]?.workspaceDirectory ?? group.workspaceDirectory}
            onOpen={handleOpen}
          />
          <ContextMenuSeparator />
          {inactiveInWorkspace.length > 0 && (
            <ContextMenuItem
              onClick={() => setShowRemoveInactiveConfirm(true)}
              variant="destructive"
              className="gap-2 text-xs"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Remove {inactiveInWorkspace.length} Inactive
            </ContextMenuItem>
          )}
          <ContextMenuItem
            onClick={handleTerminateAll}
            variant="destructive"
            className="gap-2 text-xs"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Terminate All
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </Collapsible>
    <NewSessionDialog
      open={newSessionOpen}
      onOpenChange={setNewSessionOpen}
      defaultDirectory={group.sessions[0]?.workspaceDirectory ?? group.workspaceDirectory}
    />

    {/* Remove inactive sessions confirmation dialog (per-workspace) */}
    <AlertDialog open={showRemoveInactiveConfirm} onOpenChange={setShowRemoveInactiveConfirm}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove Inactive Sessions</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete {inactiveInWorkspace.length} inactive session{inactiveInWorkspace.length !== 1 ? "s" : ""} in &ldquo;{group.displayName}&rdquo; (completed, stopped, errored, or disconnected). This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isRemovingInactive}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={isRemovingInactive}
            onClick={(e) => {
              e.preventDefault();
              handleRemoveInactive();
            }}
          >
            {isRemovingInactive ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Removing…
              </>
            ) : (
              `Remove ${inactiveInWorkspace.length} Session${inactiveInWorkspace.length !== 1 ? "s" : ""}`
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
});
