"use client";

import Link from "next/link";
import { Header, NewSessionButton } from "@/components/layout/header";
import { SummaryBar } from "@/components/fleet/summary-bar";
import { useSessions } from "@/hooks/use-sessions";
import type { SessionListItem } from "@/lib/api-types";
import type { FleetSummary } from "@/lib/types";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, Clock, Loader2 } from "lucide-react";
import { mockFleetSummary } from "@/lib/mock-data";

function timeSince(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function LiveSessionCard({ item }: { item: SessionListItem }) {
  const { instanceId, session, instanceStatus } = item;
  const isDead = instanceStatus === "dead";

  return (
    <Link href={`/sessions/${encodeURIComponent(session.id)}?instanceId=${encodeURIComponent(instanceId)}`}>
      <Card className="transition-all hover:border-foreground/20 hover:shadow-md cursor-pointer group">
        <CardHeader className="pb-2 pt-4 px-4">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2">
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  isDead ? "bg-red-500" : "bg-green-500 animate-pulse"
                }`}
              />
              <h3 className="font-semibold text-sm font-mono truncate max-w-[140px]">
                {session.title || session.id.slice(0, 12)}
              </h3>
            </div>
            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
          <div className="flex items-center gap-1.5 mt-1">
            <Badge variant={isDead ? "destructive" : "secondary"} className="text-[10px] px-1.5 py-0">
              {isDead ? "dead" : "running"}
            </Badge>
            <span className="text-[10px] text-muted-foreground font-mono truncate max-w-[120px]">
              {session.directory}
            </span>
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            <span>{timeSince(session.time.created)}</span>
            <span className="ml-auto text-[10px] font-mono text-muted-foreground/60">
              {session.id.slice(0, 8)}…
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

export default function FleetPage() {
  const { sessions, isLoading, error } = useSessions(5000);

  // Compute summary from live sessions
  const liveCount = sessions.filter((s) => s.instanceStatus === "running").length;

  // Use mock summary for non-session stats (pipelines, queue, etc.) — those aren't wired yet
  const summary: FleetSummary = {
    ...mockFleetSummary,
    activeSessions: liveCount,
    idleSessions: 0,
    completedSessions: 0,
    errorSessions: sessions.filter((s) => s.instanceStatus === "dead").length,
  };

  const subtitle =
    sessions.length > 0
      ? `${liveCount} active session${liveCount !== 1 ? "s" : ""}`
      : "No active sessions";

  return (
    <div className="flex flex-col h-full">
      <Header
        title="Agent Fleet"
        subtitle={subtitle}
        actions={<NewSessionButton />}
      />
      <div className="flex-1 overflow-auto p-6 space-y-6">
        <SummaryBar summary={summary} />

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

        {sessions.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {sessions.map((item) => (
              <LiveSessionCard
                key={`${item.instanceId}-${item.session.id}`}
                item={item}
              />
            ))}
          </div>
        )}

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
