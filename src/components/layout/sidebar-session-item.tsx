"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { InlineEdit } from "@/components/ui/inline-edit";
import { useRenameSession } from "@/hooks/use-rename-session";
import { useSessionsContext } from "@/contexts/sessions-context";
import type { SessionListItem } from "@/lib/api-types";

interface SidebarSessionItemProps {
  item: SessionListItem;
  isActive: boolean;
  isChild?: boolean;
}

export function SidebarSessionItem({ item, isActive, isChild = false }: SidebarSessionItemProps) {
  const { instanceId, session, instanceStatus, sessionStatus } = item;
  const { refetch } = useSessionsContext();
  const { renameSession } = useRenameSession();
  const [isRenaming, setIsRenaming] = useState(false);

  const isDead = instanceStatus === "dead";
  const isDisconnected = sessionStatus === "disconnected";
  const isStopped = sessionStatus === "stopped";

  const dotColor = isDisconnected
    ? "bg-amber-400"
    : isStopped
    ? "bg-slate-500"
    : isDead
    ? "bg-red-500"
    : "bg-green-500 animate-pulse";

  const title = session.title || session.id.slice(0, 12);

  const handleRename = useCallback(
    async (newTitle: string) => {
      try {
        const dbId = item.dbId ?? item.session.id;
        await renameSession(dbId, newTitle, refetch);
      } catch {
        // error surfaced inside useRenameSession
      }
    },
    [item.dbId, item.session.id, renameSession, refetch]
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <Link
          href={`/sessions/${encodeURIComponent(session.id)}?instanceId=${encodeURIComponent(instanceId)}`}
          data-tree-leaf
          tabIndex={0}
          onClick={(e) => {
            if (isRenaming) e.preventDefault();
          }}
          className={cn(
            "flex items-center gap-2 rounded-md pr-3 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            isChild ? "pl-16" : "pl-12",
            isActive
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
          )}
        >
          {isChild && <span className="text-muted-foreground/50 text-[10px] shrink-0">↳</span>}
          <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${dotColor}`} />
          <InlineEdit
            value={title}
            onSave={handleRename}
            editing={isRenaming}
            onEditingChange={setIsRenaming}
            className="text-xs truncate block"
          />
          <button
            data-rename-trigger
            className="sr-only"
            tabIndex={-1}
            onClick={() => setIsRenaming(true)}
            aria-label={`Rename ${title}`}
          />
        </Link>
      </ContextMenuTrigger>

      <ContextMenuContent>
        <ContextMenuItem
          onClick={() => setIsRenaming(true)}
          className="gap-2 text-xs"
        >
          <Pencil className="h-3.5 w-3.5" />
          Rename
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
