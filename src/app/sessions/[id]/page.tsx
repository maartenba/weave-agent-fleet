"use client";

import { useParams, useSearchParams } from "next/navigation";
import { Header } from "@/components/layout/header";
import { ActivityStreamV1 } from "@/components/session/activity-stream-v1";
import { PromptInput } from "@/components/session/prompt-input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useSessionEvents } from "@/hooks/use-session-events";
import { useSendPrompt } from "@/hooks/use-send-prompt";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { FolderOpen, GitBranch, Server, Clock, Hash, Coins, Square } from "lucide-react";
import { useTerminateSession } from "@/hooks/use-terminate-session";
import { extractLatestTodos } from "@/lib/todo-utils";
import { TodoSidebarPanel } from "@/components/session/todo-sidebar-panel";

interface SessionMetadata {
  workspaceId: string | null;
  workspaceDirectory: string | null;
  isolationStrategy: string | null;
  createdAt?: number;
}

export default function SessionDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();

  const sessionId = params.id as string;
  const instanceId = searchParams.get("instanceId") ?? "";

  const { messages, status, sessionStatus, error } = useSessionEvents(
    sessionId,
    instanceId
  );
  const { sendPrompt, isSending, error: sendError } = useSendPrompt();
  const { terminateSession, isTerminating } = useTerminateSession();
  const [isStopped, setIsStopped] = useState(false);
  const [stopConfirm, setStopConfirm] = useState(false);

  const [metadata, setMetadata] = useState<SessionMetadata>({
    workspaceId: null,
    workspaceDirectory: null,
    isolationStrategy: null,
  });

  // Fetch session metadata on mount
  useEffect(() => {
    if (!sessionId || !instanceId) return;
    const url = `/api/sessions/${encodeURIComponent(sessionId)}?instanceId=${encodeURIComponent(instanceId)}`;
    fetch(url)
      .then((r) => r.json())
      .then((data: { workspaceId?: string; workspaceDirectory?: string; isolationStrategy?: string; session?: { time?: { created?: number } } }) => {
        setMetadata({
          workspaceId: data.workspaceId ?? null,
          workspaceDirectory: data.workspaceDirectory ?? null,
          isolationStrategy: data.isolationStrategy ?? null,
          createdAt: data.session?.time?.created,
        });
      })
      .catch(() => {/* best-effort */});
  }, [sessionId, instanceId]);

  // Compute aggregate cost + tokens from accumulated messages
  const totalCost = messages.reduce((sum, m) => sum + (m.cost ?? 0), 0);
  const totalTokens = messages.reduce(
    (sum, m) => sum + (m.tokens?.input ?? 0) + (m.tokens?.output ?? 0),
    0
  );
  const latestTodos = extractLatestTodos(messages);

  const handleSend = useCallback(
    async (text: string) => {
      await sendPrompt(sessionId, instanceId, text);
    },
    [sendPrompt, sessionId, instanceId]
  );

  const handleStop = useCallback(async () => {
    if (!stopConfirm) {
      setStopConfirm(true);
      return;
    }
    try {
      await terminateSession(sessionId, instanceId);
      setIsStopped(true);
    } catch {
      // error visible via isTerminating pattern
    } finally {
      setStopConfirm(false);
    }
  }, [stopConfirm, terminateSession, sessionId, instanceId]);

  if (!instanceId) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">
          Missing instanceId — navigate here via the fleet page.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <Header
        title={sessionId}
        subtitle={instanceId ? `Instance: ${instanceId.slice(0, 8)}…` : undefined}
        actions={
          <div className="flex items-center gap-2">
            <span
              className={`h-2 w-2 rounded-full ${
                isStopped
                  ? "bg-slate-500"
                  : sessionStatus === "busy"
                  ? "bg-green-500 animate-pulse"
                  : status === "connected"
                  ? "bg-zinc-500"
                  : "bg-amber-500 animate-pulse"
              }`}
            />
            <Badge variant="secondary" className="text-xs">
              {isStopped ? "Stopped" : sessionStatus === "busy" ? "Working" : "Idle"}
            </Badge>
            {!isStopped && (
              <Button
                variant={stopConfirm ? "destructive" : "ghost"}
                size="sm"
                className="h-7 px-2 text-xs gap-1"
                onClick={handleStop}
                disabled={isTerminating}
              >
                <Square className="h-3 w-3" />
                {stopConfirm ? "Confirm stop?" : "Stop"}
              </Button>
            )}
            {stopConfirm && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setStopConfirm(false)}
                disabled={isTerminating}
              >
                Cancel
              </Button>
            )}
          </div>
        }
      />
      <div className="flex flex-1 overflow-hidden">
        {/* Activity stream */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {isStopped && (
            <div className="px-4 py-2 bg-slate-500/10 border-b border-slate-500/20 text-sm text-slate-400 text-center">
              Session stopped — conversation history preserved above.
            </div>
          )}
          <div className="flex-1 overflow-hidden">
            <ActivityStreamV1
              messages={messages}
              status={status}
              sessionStatus={sessionStatus}
              error={error}
            />
          </div>
          <PromptInput
            onSend={handleSend}
            disabled={isStopped || status === "error"}
            sendError={sendError}
          />
        </div>

        {/* Sidebar — real session metadata */}
        <aside className="w-72 border-l overflow-auto">
          <ScrollArea className="h-full">
            <div className="p-4 space-y-4">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Session Info
              </p>

              {/* Session ID */}
              <div className="space-y-1">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Session ID</p>
                <p className="text-xs font-mono break-all">{sessionId}</p>
              </div>

              {/* Instance ID */}
              <div className="space-y-1">
                <div className="flex items-center gap-1.5">
                  <Server className="h-3 w-3 text-muted-foreground" />
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Instance</p>
                </div>
                <p className="text-xs font-mono truncate">{instanceId.slice(0, 16)}…</p>
              </div>

              <Separator />

              {/* Workspace */}
              {metadata.workspaceDirectory && (
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5">
                    <FolderOpen className="h-3 w-3 text-muted-foreground" />
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Workspace</p>
                  </div>
                  <p className="text-xs font-mono break-all">{metadata.workspaceDirectory}</p>
                </div>
              )}

              {/* Isolation Strategy */}
              {metadata.isolationStrategy && (
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5">
                    <GitBranch className="h-3 w-3 text-muted-foreground" />
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Isolation</p>
                  </div>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                    {metadata.isolationStrategy}
                  </Badge>
                </div>
              )}

              {/* Created At */}
              {metadata.createdAt && (
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5">
                    <Clock className="h-3 w-3 text-muted-foreground" />
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Created</p>
                  </div>
                  <p className="text-xs">{new Date(metadata.createdAt).toLocaleString()}</p>
                </div>
              )}

              <Separator />

              {/* Tokens */}
              <div className="space-y-1">
                <div className="flex items-center gap-1.5">
                  <Hash className="h-3 w-3 text-muted-foreground" />
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Tokens</p>
                </div>
                <p className="text-xs font-mono">{totalTokens.toLocaleString()}</p>
              </div>

              {/* Cost */}
              <div className="space-y-1">
                <div className="flex items-center gap-1.5">
                  <Coins className="h-3 w-3 text-muted-foreground" />
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Cost</p>
                </div>
                <p className="text-xs font-mono">${totalCost.toFixed(4)}</p>
              </div>

              <Separator />

              {/* Connection status */}
              <div className="space-y-1">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Connection</p>
                <div className="flex items-center gap-1.5">
                  <span className={`h-1.5 w-1.5 rounded-full ${
                    status === "connected" ? "bg-green-500" :
                    status === "connecting" ? "bg-amber-500 animate-pulse" :
                    status === "disconnected" ? "bg-amber-400" :
                    "bg-red-500"
                  }`} />
                  <p className="text-xs capitalize">{status}</p>
                </div>
              </div>

              {/* Todos — shown when agent has used todowrite */}
              {latestTodos && latestTodos.length > 0 && (
                <>
                  <Separator />
                  <TodoSidebarPanel todos={latestTodos} />
                </>
              )}
            </div>
          </ScrollArea>
        </aside>
      </div>
    </div>
  );
}
