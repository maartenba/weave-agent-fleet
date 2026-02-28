"use client";

import { useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Header } from "@/components/layout/header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertCircle,
  CheckCircle2,
  MessageSquare,
  GitBranch,
  Bell,
  WifiOff,
} from "lucide-react";
import { useNotifications } from "@/hooks/use-notifications";

function getNotificationIcon(type: string) {
  switch (type) {
    case "input_required":
      return <MessageSquare className="h-4 w-4 text-amber-500" />;
    case "session_error":
      return <AlertCircle className="h-4 w-4 text-red-500" />;
    case "session_completed":
      return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    case "session_disconnected":
      return <WifiOff className="h-4 w-4 text-orange-500" />;
    case "pipeline_stage_complete":
      return <GitBranch className="h-4 w-4 text-cyan-500" />;
    default:
      return <Bell className="h-4 w-4 text-muted-foreground" />;
  }
}

function getTypeBadge(type: string) {
  switch (type) {
    case "input_required":
      return <Badge variant="secondary" className="bg-amber-500/10 text-amber-500 text-[10px]">Input Required</Badge>;
    case "session_error":
      return <Badge variant="secondary" className="bg-red-500/10 text-red-500 text-[10px]">Error</Badge>;
    case "session_completed":
      return <Badge variant="secondary" className="bg-green-500/10 text-green-500 text-[10px]">Completed</Badge>;
    case "session_disconnected":
      return <Badge variant="secondary" className="bg-orange-500/10 text-orange-500 text-[10px]">Disconnected</Badge>;
    case "pipeline_stage_complete":
      return <Badge variant="secondary" className="bg-cyan-500/10 text-cyan-500 text-[10px]">Pipeline</Badge>;
    default:
      return <Badge variant="outline" className="text-[10px]">{type}</Badge>;
  }
}

function formatTime(createdAt: string): string {
  const date = new Date(createdAt.includes("T") ? createdAt : createdAt.replace(" ", "T") + "Z");
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export default function AlertsPage() {
  const router = useRouter();
  const {
    notifications,
    isLoading,
    fetchNotifications,
    markAsRead,
    markAllAsRead,
  } = useNotifications();

  useEffect(() => {
    fetchNotifications(50);
  }, [fetchNotifications]);

  const handleNotificationClick = useCallback(
    async (id: string, sessionId: string | null, instanceId: string | null) => {
      await markAsRead(id);
      if (sessionId && instanceId) {
        router.push(`/sessions/${sessionId}?instanceId=${instanceId}`);
      } else if (sessionId) {
        router.push(`/sessions/${sessionId}`);
      }
    },
    [markAsRead, router]
  );

  const handleMarkAllRead = useCallback(async () => {
    await markAllAsRead();
    await fetchNotifications(50);
  }, [markAllAsRead, fetchNotifications]);

  const unread = notifications.filter((n) => n.read === 0);
  const read = notifications.filter((n) => n.read !== 0);

  return (
    <div className="flex flex-col h-full">
      <Header
        title="Alerts"
        subtitle={`${unread.length} unread notifications`}
        actions={
          unread.length > 0 ? (
            <Button variant="outline" size="sm" onClick={handleMarkAllRead}>
              Mark all as read
            </Button>
          ) : undefined
        }
      />
      <div className="flex-1 overflow-auto p-6 space-y-6">
        {isLoading && notifications.length === 0 && (
          <p className="text-sm text-muted-foreground">Loading notifications…</p>
        )}

        {!isLoading && notifications.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Bell className="h-8 w-8 mb-3 opacity-40" />
            <p className="text-sm">No notifications</p>
          </div>
        )}

        {unread.length > 0 && (
          <section>
            <h3 className="text-sm font-semibold text-muted-foreground mb-3 uppercase">Unread</h3>
            <div className="space-y-2">
              {unread.map((notif) => (
                <Card
                  key={notif.id}
                  className="border-l-2 border-l-amber-500 cursor-pointer hover:bg-accent/50 transition-colors"
                  onClick={() => handleNotificationClick(notif.id, notif.session_id ?? null, notif.instance_id ?? null)}
                >
                  <CardContent className="flex items-center gap-3 py-3 px-4">
                    {getNotificationIcon(notif.type)}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm">{notif.message}</p>
                      <time className="text-[10px] text-muted-foreground">
                        {formatTime(notif.created_at)}
                      </time>
                    </div>
                    {getTypeBadge(notif.type)}
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        )}

        {read.length > 0 && (
          <section>
            <h3 className="text-sm font-semibold text-muted-foreground mb-3 uppercase">Read</h3>
            <div className="space-y-2">
              {read.map((notif) => (
                <Card
                  key={notif.id}
                  className="opacity-60 cursor-pointer hover:opacity-80 transition-opacity"
                  onClick={() => handleNotificationClick(notif.id, notif.session_id ?? null, notif.instance_id ?? null)}
                >
                  <CardContent className="flex items-center gap-3 py-3 px-4">
                    {getNotificationIcon(notif.type)}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm">{notif.message}</p>
                      <time className="text-[10px] text-muted-foreground">
                        {formatTime(notif.created_at)}
                      </time>
                    </div>
                    {getTypeBadge(notif.type)}
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
