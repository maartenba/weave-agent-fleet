"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import type { SessionListItem } from "@/lib/api-types";

interface SidebarSessionItemProps {
  item: SessionListItem;
  isActive: boolean;
}

export function SidebarSessionItem({ item, isActive }: SidebarSessionItemProps) {
  const { instanceId, session, instanceStatus, sessionStatus } = item;

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

  return (
    <Link
      href={`/sessions/${encodeURIComponent(session.id)}?instanceId=${encodeURIComponent(instanceId)}`}
      data-tree-leaf
      tabIndex={0}
      className={cn(
        "flex items-center gap-2 rounded-md pl-12 pr-3 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        isActive
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
      )}
    >
      <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${dotColor}`} />
      <span className="truncate max-w-[120px]">{title}</span>
    </Link>
  );
}
