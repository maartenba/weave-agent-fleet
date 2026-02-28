"use client";

import { useCallback, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  ChevronRight,
  LayoutGrid,
  Bell,
  History,
  Settings,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useNotifications } from "@/hooks/use-notifications";
import { useSessionsContext } from "@/contexts/sessions-context";
import { useWorkspaces } from "@/hooks/use-workspaces";
import { usePersistedState } from "@/hooks/use-persisted-state";
import { SidebarWorkspaceItem } from "@/components/layout/sidebar-workspace-item";

const FLEET_EXPANDED_KEY = "weave:sidebar:fleet-expanded";

export function Sidebar() {
  const pathname = usePathname();
  const { unreadCount } = useNotifications();
  const { sessions, error } = useSessionsContext();
  const workspaces = useWorkspaces(sessions);
  const [fleetExpanded, setFleetExpanded] = usePersistedState<boolean>(
    FLEET_EXPANDED_KEY,
    true
  );

  const treeRef = useRef<HTMLDivElement>(null);

  // Keyboard navigation handler for the tree
  const handleTreeKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const tree = treeRef.current;
      if (!tree) return;

      // Collect all focusable tree items in DOM order
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
          // If focused item is a treeitem that is collapsed, expand it
          if (focused?.getAttribute("role") === "treeitem") {
            const expanded = focused.getAttribute("aria-expanded");
            if (expanded === "false") {
              const trigger = focused.querySelector<HTMLElement>(
                "[data-tree-expand]"
              );
              trigger?.click();
            } else {
              // Already expanded — move to first child
              const next = items[currentIndex + 1];
              next?.focus();
            }
          }
          break;
        }
        case "ArrowLeft": {
          e.preventDefault();
          if (focused?.getAttribute("role") === "treeitem") {
            const expanded = focused.getAttribute("aria-expanded");
            if (expanded === "true") {
              const trigger = focused.querySelector<HTMLElement>(
                "[data-tree-expand]"
              );
              trigger?.click();
            } else {
              // Move to parent (tree root / All Sessions row)
              const allSessionsRow = tree.querySelector<HTMLElement>(
                "[data-all-sessions]"
              );
              allSessionsRow?.focus();
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
          // Trigger rename on focused workspace item
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

  const isFleetActive = pathname === "/" || pathname.startsWith("/?");

  return (
    <aside className="flex h-screen w-56 flex-col border-r border-sidebar-border bg-sidebar">
      {/* Weave branding */}
      <div className="flex items-center gap-3 border-b border-sidebar-border px-4 py-4">
        <Image
          src="/weave_logo.png"
          alt="Weave"
          width={32}
          height={32}
          className="rounded-md"
        />
        <div>
          <h1 className="text-sm font-semibold font-mono weave-gradient-text">
            Weave
          </h1>
          <p className="text-[10px] text-muted-foreground font-mono">
            Agent Fleet
          </p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto p-2 space-y-1">
        {/* Fleet — expandable tree */}
        <Collapsible
          open={fleetExpanded}
          onOpenChange={setFleetExpanded}
        >
          {/* Fleet header row */}
          <div
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              isFleetActive
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
            )}
          >
            {/* Expand/collapse chevron */}
            <CollapsibleTrigger asChild>
              <button
                className="shrink-0 text-muted-foreground hover:text-foreground"
                aria-label={fleetExpanded ? "Collapse Fleet" : "Expand Fleet"}
              >
                <ChevronRight
                  className={cn(
                    "h-4 w-4 transition-transform duration-150",
                    fleetExpanded && "rotate-90"
                  )}
                />
              </button>
            </CollapsibleTrigger>

            {/* All Sessions link */}
            <Link
              href="/"
              data-all-sessions
              tabIndex={0}
              className="flex flex-1 items-center gap-1 min-w-0"
            >
              <LayoutGrid className="h-4 w-4 shrink-0" />
              <span className="flex-1">Fleet</span>
              {/* Total session count badge */}
              {sessions.length > 0 && (
                <Badge
                  variant="secondary"
                  className="h-5 min-w-5 justify-center px-1.5 text-xs shrink-0"
                >
                  {sessions.length}
                </Badge>
              )}
            </Link>
          </div>

          {/* Workspace tree */}
          <CollapsibleContent className="overflow-hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:slide-in-from-top-1 data-[state=closed]:slide-out-to-top-1 transition-all">
            <div
              ref={treeRef}
              role="tree"
              aria-label="Workspaces"
              onKeyDown={handleTreeKeyDown}
              className="mt-0.5 space-y-0.5"
            >
              {error ? (
                <div className="flex items-center gap-2 pl-8 pr-3 py-1.5 text-xs text-destructive">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  <span>Failed to load</span>
                </div>
              ) : workspaces.length === 0 ? (
                <p className="pl-8 pr-3 py-1.5 text-xs text-muted-foreground">
                  No workspaces yet
                </p>
              ) : (
                workspaces.map((group) => (
                  <SidebarWorkspaceItem
                    key={group.workspaceId}
                    group={group}
                    activeSessionPath={pathname}
                  />
                ))
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Alerts */}
        <Link
          href="/alerts"
          className={cn(
            "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
            pathname === "/alerts" || pathname.startsWith("/alerts")
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
          )}
        >
          <Bell className="h-4 w-4" />
          <span className="flex-1">Alerts</span>
          {unreadCount > 0 && (
            <Badge
              variant="secondary"
              className="h-5 min-w-5 justify-center px-1.5 text-xs"
            >
              {unreadCount}
            </Badge>
          )}
        </Link>

        {/* History */}
        <Link
          href="/history"
          className={cn(
            "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
            pathname === "/history" || pathname.startsWith("/history")
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
          )}
        >
          <History className="h-4 w-4" />
          <span>History</span>
        </Link>
      </nav>

      {/* Footer */}
      <div className="border-t border-sidebar-border p-2">
        <Link
          href="/settings"
          className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
        >
          <Settings className="h-4 w-4" />
          <span>Settings</span>
        </Link>
      </div>
    </aside>
  );
}
