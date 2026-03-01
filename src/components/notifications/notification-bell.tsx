"use client";

import { useRouter } from "next/navigation";
import { Bell, AlertCircle, CheckCircle2, WifiOff, MessageSquare, GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useNotifications } from "@/contexts/notifications-context";
import type { DbNotification } from "@/lib/server/db-repository";

function getNotificationIcon(type: string) {
  switch (type) {
    case "session_completed":
      return <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />;
    case "session_error":
      return <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />;
    case "session_disconnected":
      return <WifiOff className="h-4 w-4 text-amber-500 shrink-0" />;
    case "input_required":
      return <MessageSquare className="h-4 w-4 text-amber-500 shrink-0" />;
    case "pipeline_stage_complete":
      return <GitBranch className="h-4 w-4 text-cyan-500 shrink-0" />;
    default:
      return <Bell className="h-4 w-4 text-muted-foreground shrink-0" />;
  }
}

function timeSince(dateString: string): string {
  // SQLite datetime('now') returns 'YYYY-MM-DD HH:MM:SS' (UTC, no T/Z).
  // Normalise to ISO 8601 so the Date constructor parses it as UTC.
  const iso = dateString.includes("T") ? dateString : dateString.replace(" ", "T") + "Z";
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export function NotificationBell() {
  const router = useRouter();
  const { unreadCount, notifications, fetchNotifications, markAsRead, markAllAsRead } =
    useNotifications();

  function handleOpenChange(open: boolean) {
    if (open) {
      fetchNotifications();
    }
  }

  function handleNotificationClick(notif: DbNotification) {
    markAsRead(notif.id);
    if (notif.session_id && notif.instance_id) {
      router.push(
        `/sessions/${encodeURIComponent(notif.session_id)}?instanceId=${encodeURIComponent(notif.instance_id)}`
      );
    } else {
      router.push("/alerts");
    }
  }

  return (
    <DropdownMenu onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-8 w-8">
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
          <span className="sr-only">Notifications</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <div className="flex items-center justify-between px-2 py-1.5">
          <DropdownMenuLabel className="p-0 text-sm font-semibold">
            Notifications
          </DropdownMenuLabel>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-auto p-0 text-xs text-muted-foreground hover:text-foreground"
              onClick={(e) => {
                e.preventDefault();
                markAllAsRead();
              }}
            >
              Mark all read
            </Button>
          )}
        </div>
        <DropdownMenuSeparator />
        {notifications.length === 0 ? (
          <div className="px-2 py-6 text-center text-sm text-muted-foreground">
            No notifications
          </div>
        ) : (
          notifications.map((notif) => (
            <DropdownMenuItem
              key={notif.id}
              className={`flex items-start gap-2.5 px-2 py-2 cursor-pointer ${notif.read === 0 ? "bg-muted/40" : ""}`}
              onSelect={() => handleNotificationClick(notif)}
            >
              {getNotificationIcon(notif.type)}
              <div className="flex flex-col gap-0.5 min-w-0">
                <p className={`text-xs leading-snug truncate ${notif.read === 0 ? "font-medium" : "text-muted-foreground"}`}>
                  {notif.message}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {timeSince(notif.created_at)}
                </p>
              </div>
            </DropdownMenuItem>
          ))
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="justify-center text-xs text-muted-foreground cursor-pointer"
          onSelect={() => router.push("/alerts")}
        >
          View all notifications
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
