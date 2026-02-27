"use client";

import { Header } from "@/components/layout/header";
import { mockNotifications } from "@/lib/mock-data";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertCircle,
  CheckCircle2,
  MessageSquare,
  GitBranch,
  Bell,
} from "lucide-react";

function getNotificationIcon(type: string) {
  switch (type) {
    case "input_required":
      return <MessageSquare className="h-4 w-4 text-amber-500" />;
    case "session_error":
      return <AlertCircle className="h-4 w-4 text-red-500" />;
    case "session_completed":
      return <CheckCircle2 className="h-4 w-4 text-green-500" />;
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
    case "pipeline_stage_complete":
      return <Badge variant="secondary" className="bg-cyan-500/10 text-cyan-500 text-[10px]">Pipeline</Badge>;
    default:
      return <Badge variant="outline" className="text-[10px]">{type}</Badge>;
  }
}

export default function AlertsPage() {
  const unread = mockNotifications.filter((n) => !n.read);
  const read = mockNotifications.filter((n) => n.read);

  return (
    <div className="flex flex-col h-full">
      <Header
        title="Alerts"
        subtitle={`${unread.length} unread notifications`}
      />
      <div className="flex-1 overflow-auto p-6 space-y-6">
        {unread.length > 0 && (
          <section>
            <h3 className="text-sm font-semibold text-muted-foreground mb-3 uppercase">Unread</h3>
            <div className="space-y-2">
              {unread.map((notif) => (
                <Card key={notif.id} className="border-l-2 border-l-amber-500">
                  <CardContent className="flex items-center gap-3 py-3 px-4">
                    {getNotificationIcon(notif.type)}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm">{notif.message}</p>
                      <time className="text-[10px] text-muted-foreground">
                        {notif.createdAt.toLocaleTimeString("en-US", {
                          hour: "2-digit",
                          minute: "2-digit",
                          hour12: false,
                        })}
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
                <Card key={notif.id} className="opacity-60">
                  <CardContent className="flex items-center gap-3 py-3 px-4">
                    {getNotificationIcon(notif.type)}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm">{notif.message}</p>
                      <time className="text-[10px] text-muted-foreground">
                        {notif.createdAt.toLocaleTimeString("en-US", {
                          hour: "2-digit",
                          minute: "2-digit",
                          hour12: false,
                        })}
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
