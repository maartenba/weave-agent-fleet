"use client";

import Link from "next/link";
import { Header, NewSessionButton } from "@/components/layout/header";
import { SummaryBar } from "@/components/fleet/summary-bar";
import { useSessions } from "@/hooks/use-sessions";
import { useTerminateSession } from "@/hooks/use-terminate-session";
import { useFleetSummary } from "@/hooks/use-fleet-summary";
import type { SessionListItem } from "@/lib/api-types";
import type { FleetSummary } from "@/lib/types";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowRight, Clock, Loader2, Trash2 } from "lucide-react";

function timeSince(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function LiveSessionCard({
  item,
  onTerminate,
}: {
  item: SessionListItem;
  onTerminate: (sessionId: string, instanceId: string) => void;
}) {
  const { instanceId, session, instanceStatus, sessionStatus, isolationStrategy } = item;
  const isDead = instanceStatus === "dead";
  const isDisconnected = sessionStatus === "disconnected";
  const isStopped = sessionStatus === "stopped";
  const isInactive = isDisconnected || isStopped;

  const dotColor = isDisconnected
    ? "bg-amber-400"
    : isStopped
    ? "bg-slate-500"
    : isDead
    ? "bg-red-500"
    : "bg-green-500 animate-pulse";

  const badgeVariant: "destructive" | "secondary" | "outline" =
    isDisconnected ? "outline" : isDead ? "destructive" : "secondary";

  const statusLabel = isDisconnected
    ? "disconnected"
    : isStopped
    ? "stopped"
    : isDead
    ? "dead"
    : "running";

  const canTerminate = !isStopped;

  return (
    <div className={`relative group ${isInactive ? "opacity-60" : ""}`}>
      <Link href={`/sessions/${encodeURIComponent(session.id)}?instanceId=${encodeURIComponent(instanceId)}`}>
        <Card className="transition-all hover:border-foreground/20 hover:shadow-md cursor-pointer">
          <CardHeader className="pb-2 pt-4 px-4">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                <span className={`h-2.5 w-2.5 rounded-full ${dotColor}`} />
                <h3 className="font-semibold text-sm font-mono truncate max-w-[140px]">
                  {session.title || session.id.slice(0, 12)}
                </h3>
              </div>
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <div className="flex items-center gap-1.5 mt-1">
              <Badge variant={badgeVariant} className="text-[10px] px-1.5 py-0">
                {statusLabel}
              </Badge>
              {isolationStrategy && isolationStrategy !== "existing" && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-purple-400 border-purple-400/40">
                  {isolationStrategy}
                </Badge>
              )}
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
      {canTerminate && (
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-2 right-2 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive hover:bg-destructive/10"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onTerminate(session.id, instanceId);
          }}
          title="Terminate session"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}

export default function FleetPage() {
  const { sessions, isLoading, error, refetch } = useSessions(5000);
  const { terminateSession } = useTerminateSession();
  const { summary: liveSummary } = useFleetSummary(10000);

  const handleTerminate = async (sessionId: string, instanceId: string) => {
    try {
      await terminateSession(sessionId, instanceId);
      refetch();
    } catch {
      // error surfaced inside useTerminateSession
    }
  };

  const liveCount = liveSummary?.activeSessions ?? sessions.filter((s) => s.sessionStatus === "active").length;

  // Use real summary from API; pipeline/queue default to 0 (not implemented in V2)
  const summary: FleetSummary = {
    activeSessions: liveSummary?.activeSessions ?? liveCount,
    idleSessions: liveSummary?.idleSessions ?? 0,
    completedSessions: liveSummary?.completedSessions ?? sessions.filter((s) => s.sessionStatus === "stopped").length,
    errorSessions: liveSummary?.errorSessions ?? sessions.filter((s) => s.sessionStatus === "disconnected").length,
    totalTokens: liveSummary?.totalTokens ?? 0,
    totalCost: liveSummary?.totalCost ?? 0,
    runningPipelines: 0,
    queuedTasks: 0,
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
                onTerminate={handleTerminate}
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
