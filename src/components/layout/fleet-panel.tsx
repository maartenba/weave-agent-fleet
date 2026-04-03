"use client";

import { useState, useCallback, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Eye, EyeOff, LayoutGrid, AlertTriangle, Loader2, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
import { useSessionsContext } from "@/contexts/sessions-context";
import { useWorkspaces } from "@/hooks/use-workspaces";
import { useCurrentSessionDirectory } from "@/hooks/use-current-session-directory";
import { usePersistedState } from "@/hooks/use-persisted-state";
import { useDeleteSession } from "@/hooks/use-delete-session";
import { SidebarWorkspaceItem } from "@/components/layout/sidebar-workspace-item";
import { NewSessionDialog } from "@/components/session/new-session-dialog";
import { isInactiveSession } from "@/lib/session-utils";

const HIDE_INACTIVE_KEY = "weave:sidebar:hideInactive";

export function FleetPanel() {
  const pathname = usePathname();
  const { sessions, error, refetch } = useSessionsContext();
  const workspaces = useWorkspaces(sessions);
  const currentDirectory = useCurrentSessionDirectory();
  const treeRef = useRef<HTMLDivElement>(null);

  const isFleetActive = pathname === "/" || pathname.startsWith("/?");

  const [hideInactive, setHideInactive] = usePersistedState<boolean>(HIDE_INACTIVE_KEY, false);
  const [showRemoveInactiveConfirm, setShowRemoveInactiveConfirm] = useState(false);
  const [isRemovingInactive, setIsRemovingInactive] = useState(false);

  const { deleteSession } = useDeleteSession();

  const inactiveSessions = sessions.filter(isInactiveSession);

  // When hideInactive is on, hide workspaces that have zero visible sessions
  const visibleWorkspaces = hideInactive
    ? workspaces.filter((g) => g.sessions.some((s) => !isInactiveSession(s)))
    : workspaces;

  const handleRemoveAllInactive = useCallback(async () => {
    setIsRemovingInactive(true);
    try {
      await Promise.allSettled(
        inactiveSessions.map((s) => deleteSession(s.session.id, s.instanceId))
      );
      refetch();
    } finally {
      setIsRemovingInactive(false);
      setShowRemoveInactiveConfirm(false);
    }
  }, [inactiveSessions, deleteSession, refetch]);

  const handleTreeKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const tree = treeRef.current;
      if (!tree) return;

      const items = Array.from(
        tree.querySelectorAll<HTMLElement>(
          "[role='treeitem'], [data-tree-leaf]"
        )
      );
      const focused = document.activeElement as HTMLElement | null;
      const currentIndex = focused ? items.indexOf(focused) : -1;

      switch (e.key) {
        case "ArrowDown": {
          e.preventDefault();
          const next = items[currentIndex + 1];
          next?.focus();
          break;
        }
        case "ArrowUp": {
          e.preventDefault();
          const prev = items[currentIndex - 1];
          prev?.focus();
          break;
        }
        case "ArrowRight": {
          e.preventDefault();
          if (focused?.getAttribute("role") === "treeitem") {
            const isCollapsed = focused.dataset.collapsed === "true";
            if (isCollapsed) {
              // Expand the group
              const trigger = focused.querySelector<HTMLElement>("[data-slot='collapsible-trigger']");
              trigger?.click();
            } else {
              // Move to first child
              const next = items[currentIndex + 1];
              next?.focus();
            }
          }
          break;
        }
        case "ArrowLeft": {
          e.preventDefault();
          if (focused?.getAttribute("data-tree-leaf") !== null) {
            // On a session leaf — walk backwards to find closest treeitem (parent workspace)
            for (let i = currentIndex - 1; i >= 0; i--) {
              if (items[i]?.getAttribute("role") === "treeitem") {
                items[i]?.focus();
                break;
              }
            }
          } else if (focused?.getAttribute("role") === "treeitem") {
            const isCollapsed = focused.dataset.collapsed === "true";
            if (!isCollapsed) {
              // Collapse the group
              const trigger = focused.querySelector<HTMLElement>("[data-slot='collapsible-trigger']");
              trigger?.click();
            }
          }
          break;
        }
        case "Enter": {
          e.preventDefault();
          focused?.click();
          break;
        }
        case "F2": {
          e.preventDefault();
          if (focused?.getAttribute("role") === "treeitem") {
            const renameTrigger = focused.querySelector<HTMLElement>(
              "[data-rename-trigger]"
            );
            renameTrigger?.click();
          }
          break;
        }
      }
    },
    []
  );

  return (
    <>
    <nav className="flex-1 overflow-y-auto thin-scrollbar p-2 space-y-1">
      {/* Fleet header row */}
      <div
        className={cn(
          "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
          isFleetActive
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
        )}
      >
        {/* All Sessions link */}
        <Link
          href="/"
          data-all-sessions
          tabIndex={0}
          className="flex flex-1 items-center gap-1 min-w-0"
        >
          <LayoutGrid className="h-4 w-4 shrink-0" />
          <span className="flex-1 whitespace-nowrap">Fleet</span>
        </Link>
        {/* Hide/show inactive sessions toggle */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setHideInactive((prev) => !prev)}
              className="rounded-md p-1 text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground transition-colors"
              aria-label={hideInactive ? "Show inactive sessions" : "Hide inactive sessions"}
              aria-pressed={hideInactive}
            >
              {hideInactive ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">
            {hideInactive ? "Show inactive sessions" : "Hide inactive sessions"}
          </TooltipContent>
        </Tooltip>
        {/* Remove all inactive sessions button — only shown when inactive sessions exist */}
        {inactiveSessions.length > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setShowRemoveInactiveConfirm(true)}
                className="rounded-md p-1 text-muted-foreground hover:bg-sidebar-accent/50 hover:text-destructive transition-colors"
                aria-label={`Remove ${inactiveSessions.length} inactive session${inactiveSessions.length !== 1 ? "s" : ""}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              Remove {inactiveSessions.length} inactive session{inactiveSessions.length !== 1 ? "s" : ""}
            </TooltipContent>
          </Tooltip>
        )}
        {/* New Session button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="shrink-0">
              <NewSessionDialog
                defaultDirectory={currentDirectory}
                trigger={
                  <button
                    className="rounded-md p-1 text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground transition-colors"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                }
              />
            </span>
          </TooltipTrigger>
          <TooltipContent side="right">New Session</TooltipContent>
        </Tooltip>
      </div>

      {/* Workspace tree */}
      <div
        ref={treeRef}
        role="tree"
        aria-label="Workspaces"
        onKeyDown={handleTreeKeyDown}
        className="mt-0.5 space-y-0.5"
      >
        {error ? (
          <div className="flex items-center gap-2 pl-3 pr-3 py-1.5 text-xs text-destructive">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span>Failed to load</span>
          </div>
        ) : visibleWorkspaces.length === 0 ? (
          <p className="pl-3 pr-3 py-1.5 text-xs text-muted-foreground">
            {hideInactive && workspaces.length > 0 ? "No active sessions" : "No workspaces yet"}
          </p>
        ) : (
          visibleWorkspaces.map((group) => (
            <SidebarWorkspaceItem
              key={group.workspaceDirectory}
              group={group}
              activeSessionPath={pathname}
              refetch={refetch}
              hideInactive={hideInactive}
            />
          ))
        )}
      </div>
    </nav>

    {/* Remove all inactive sessions confirmation dialog */}
    <AlertDialog open={showRemoveInactiveConfirm} onOpenChange={setShowRemoveInactiveConfirm}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove Inactive Sessions</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete {inactiveSessions.length} inactive session{inactiveSessions.length !== 1 ? "s" : ""} (completed, stopped, errored, or disconnected). This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isRemovingInactive}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={isRemovingInactive}
            onClick={(e) => {
              e.preventDefault();
              handleRemoveAllInactive();
            }}
          >
            {isRemovingInactive ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Removing…
              </>
            ) : (
              `Remove ${inactiveSessions.length} Session${inactiveSessions.length !== 1 ? "s" : ""}`
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
