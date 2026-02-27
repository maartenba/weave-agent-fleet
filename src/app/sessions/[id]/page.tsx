"use client";

import { useParams, useSearchParams } from "next/navigation";
import { Header } from "@/components/layout/header";
import { ActivityStreamV1 } from "@/components/session/activity-stream-v1";
import { PromptInput } from "@/components/session/prompt-input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { useSessionEvents } from "@/hooks/use-session-events";
import { useSendPrompt } from "@/hooks/use-send-prompt";
import { useCallback } from "react";

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

  const handleSend = useCallback(
    async (text: string) => {
      await sendPrompt(sessionId, instanceId, text);
    },
    [sendPrompt, sessionId, instanceId]
  );

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
                sessionStatus === "busy"
                  ? "bg-green-500 animate-pulse"
                  : status === "connected"
                  ? "bg-zinc-500"
                  : "bg-amber-500 animate-pulse"
              }`}
            />
            <Badge variant="secondary" className="text-xs">
              {sessionStatus === "busy" ? "Working" : "Idle"}
            </Badge>
          </div>
        }
      />
      <div className="flex flex-1 overflow-hidden">
        {/* Activity stream */}
        <div className="flex flex-1 flex-col overflow-hidden">
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
            disabled={sessionStatus === "busy" || isSending || status === "error"}
            sendError={sendError}
          />
        </div>

        {/* Sidebar — V1 placeholder; real session metadata in V2 */}
        <aside className="w-72 border-l overflow-auto">
          <ScrollArea className="h-full">
            <div className="p-4 text-xs text-muted-foreground">
              Session details coming in V2.
            </div>
          </ScrollArea>
        </aside>
      </div>
    </div>
  );
}
