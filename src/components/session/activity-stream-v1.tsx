"use client";

import { useEffect, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Bot, User, Wrench, Loader2, AlertCircle } from "lucide-react";
import type { AccumulatedMessage, AccumulatedPart } from "@/lib/api-types";
import type { SessionConnectionStatus } from "@/hooks/use-session-events";

interface ActivityStreamV1Props {
  messages: AccumulatedMessage[];
  status: SessionConnectionStatus;
  sessionStatus: "idle" | "busy";
  error?: string;
}

function ToolCallItem({ part }: { part: AccumulatedPart & { type: "tool" } }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const state = part.state as any;
  const isRunning = state?.status === "running" || !state?.status;
  const isCompleted = state?.status === "completed";
  const isError = state?.status === "error";

  return (
    <div className="flex items-center gap-2 py-0.5 text-xs text-muted-foreground">
      <Wrench className="h-3 w-3 shrink-0 text-amber-500" />
      <span className="font-mono text-amber-500/90">{part.tool}</span>
      {isRunning && <Loader2 className="h-3 w-3 animate-spin" />}
      {isCompleted && (
        <span className="text-green-500/80">
          {state?.output ? String(state.output).slice(0, 60) : "done"}
        </span>
      )}
      {isError && (
        <span className="text-red-500/80">
          {state?.error ? String(state.error).slice(0, 60) : "error"}
        </span>
      )}
    </div>
  );
}

function MessageItem({ message }: { message: AccumulatedMessage }) {
  const isUser = message.role === "user";
  const textParts = message.parts.filter((p) => p.type === "text");
  const toolParts = message.parts.filter(
    (p): p is AccumulatedPart & { type: "tool" } => p.type === "tool"
  );

  const fullText = textParts
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("");

  return (
    <div className="flex gap-3 px-4 py-3 hover:bg-accent/20 border-b border-border/40">
      <div className="mt-0.5 shrink-0">
        {isUser ? (
          <User className="h-4 w-4 text-foreground" />
        ) : (
          <Bot className="h-4 w-4 text-muted-foreground" />
        )}
      </div>
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium">
            {isUser ? "You" : "Assistant"}
          </span>
          {message.cost != null && message.cost > 0 && (
            <span className="text-[10px] text-muted-foreground">
              ${message.cost.toFixed(4)}
            </span>
          )}
        </div>

        {/* Tool calls */}
        {toolParts.length > 0 && (
          <div className="space-y-0.5">
            {toolParts.map((part) => (
              <ToolCallItem key={part.partId} part={part} />
            ))}
          </div>
        )}

        {/* Text content */}
        {fullText && (
          <p className="text-sm text-foreground/90 whitespace-pre-wrap break-words leading-relaxed">
            {fullText}
          </p>
        )}

        {/* Empty state for assistant — still streaming */}
        {!isUser && !fullText && toolParts.length === 0 && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>Thinking…</span>
          </div>
        )}
      </div>
    </div>
  );
}

export function ActivityStreamV1({
  messages,
  status,
  sessionStatus,
  error,
}: ActivityStreamV1Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new content arrives
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="flex flex-col h-full">
      {/* Connection status banner */}
      {status === "disconnected" && (
        <div className="px-4 py-2 bg-amber-500/10 border-b border-amber-500/20 text-xs text-amber-500 flex items-center gap-2">
          <AlertCircle className="h-3.5 w-3.5" />
          Connection lost — reconnecting…
        </div>
      )}
      {status === "error" && error && (
        <div className="px-4 py-2 bg-red-500/10 border-b border-red-500/20 text-xs text-red-400 flex items-center gap-2">
          <AlertCircle className="h-3.5 w-3.5" />
          {error}
        </div>
      )}

      <ScrollArea className="flex-1">
        <div>
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-48 text-muted-foreground text-sm gap-2">
              {status === "connecting" ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span>Connecting…</span>
                </>
              ) : (
                <span>No messages yet. Send a prompt to get started.</span>
              )}
            </div>
          )}

          {messages.map((message) => (
            <MessageItem key={message.messageId} message={message} />
          ))}

          {/* "Thinking" indicator when agent is busy but no new message yet */}
          {sessionStatus === "busy" &&
            messages.length > 0 &&
            messages[messages.length - 1].role === "user" && (
              <div className="flex gap-3 px-4 py-3 border-b border-border/40">
                <Bot className="h-4 w-4 text-muted-foreground mt-0.5" />
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span>Thinking…</span>
                </div>
              </div>
            )}

          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {/* Status bar */}
      <div className="px-4 py-1.5 border-t border-border/40 flex items-center gap-2">
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            sessionStatus === "busy"
              ? "bg-green-500 animate-pulse"
              : status === "connected"
              ? "bg-zinc-500"
              : "bg-amber-500"
          }`}
        />
        <span className="text-[10px] text-muted-foreground">
          {sessionStatus === "busy"
            ? "Agent working…"
            : status === "connected"
            ? "Idle"
            : status === "connecting"
            ? "Connecting…"
            : "Disconnected"}
        </span>
        {messages.length > 0 && (
          <Badge
            variant="outline"
            className="ml-auto text-[10px] px-1.5 py-0"
          >
            {messages.length} message{messages.length !== 1 ? "s" : ""}
          </Badge>
        )}
      </div>
    </div>
  );
}
