"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import type {
  AccumulatedMessage,
  AccumulatedPart,
  SSEEvent,
} from "@/lib/api-types";
import {
  ensureMessage,
  applyPartUpdate,
  applyTextDelta,
} from "@/lib/event-state";

export type SessionConnectionStatus =
  | "connecting"
  | "connected"
  | "recovering"
  | "disconnected"
  | "error";

export interface UseSessionEventsResult {
  messages: AccumulatedMessage[];
  status: SessionConnectionStatus;
  sessionStatus: "idle" | "busy";
  error?: string;
}

const MAX_RECONNECT_DELAY_MS = 30_000;
const BASE_RECONNECT_DELAY_MS = 1_000;

export function useSessionEvents(
  sessionId: string,
  instanceId: string
): UseSessionEventsResult {
  const [messages, setMessages] = useState<AccumulatedMessage[]>([]);
  const [status, setStatus] = useState<SessionConnectionStatus>("connecting");
  const [sessionStatus, setSessionStatus] = useState<"idle" | "busy">("idle");
  const [error, setError] = useState<string | undefined>();

  const reconnectDelay = useRef(BASE_RECONNECT_DELAY_MS);
  const isMounted = useRef(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track whether we've ever successfully connected — if so, do state recovery on reconnect
  const hasConnectedOnce = useRef(false);

  /**
   * Fetch existing messages from the API and convert to AccumulatedMessage[].
   * Used on initial connect (to show history) and on reconnect (to fill gaps).
   */
  const loadMessages = useCallback(async (): Promise<void> => {
    if (!sessionId || !instanceId) return;
    try {
      const url = `/api/sessions/${encodeURIComponent(sessionId)}?instanceId=${encodeURIComponent(instanceId)}`;
      const response = await fetch(url);
      if (!response.ok) return;
      const data = await response.json() as {
        messages?: Array<{
          info: { id: string; sessionID: string; role: string; time?: { created?: number }; cost?: number; tokens?: { input: number; output: number; reasoning: number } };
          parts: Array<{ id: string; messageID: string; sessionID: string; type: string; text?: string; tool?: string; callID?: string; state?: unknown; cost?: number; tokens?: { input: number; output: number; reasoning: number } }>;
        }>;
      };
      if (!data.messages?.length) return;

      const accumulated: AccumulatedMessage[] = data.messages.map((msg) => {
        const parts: AccumulatedPart[] = [];
        let cost = 0;
        let tokensInput = 0;
        let tokensOutput = 0;
        let tokensReasoning = 0;

        for (const part of msg.parts) {
          if (part.type === "text") {
            parts.push({ partId: part.id, type: "text", text: part.text ?? "" });
          } else if (part.type === "tool") {
            parts.push({ partId: part.id, type: "tool", tool: part.tool ?? "", callId: part.callID ?? "", state: part.state });
          } else if (part.type === "step-finish") {
            cost += part.cost ?? 0;
            tokensInput += part.tokens?.input ?? 0;
            tokensOutput += part.tokens?.output ?? 0;
            tokensReasoning += part.tokens?.reasoning ?? 0;
          }
        }

        return {
          messageId: msg.info.id,
          sessionId: msg.info.sessionID,
          role: msg.info.role === "user" ? "user" as const : "assistant" as const,
          parts,
          createdAt: msg.info.time?.created,
          cost: cost || (msg.info.cost ?? 0),
          tokens: (tokensInput || tokensOutput || tokensReasoning)
            ? { input: tokensInput, output: tokensOutput, reasoning: tokensReasoning }
            : msg.info.tokens
              ? { input: msg.info.tokens.input, output: msg.info.tokens.output, reasoning: msg.info.tokens.reasoning }
              : undefined,
        };
      });

      setMessages(accumulated);
    } catch {
      // Best-effort — if loading fails, we still have the live stream
    }
  }, [sessionId, instanceId]);

  const connect = useCallback(() => {
    if (!isMounted.current) return;

    const url = `/api/sessions/${encodeURIComponent(sessionId)}/events?instanceId=${encodeURIComponent(instanceId)}`;
    const es = new EventSource(url);
    eventSourceRef.current = es;
    setStatus("connecting");

    es.onopen = () => {
      if (!isMounted.current) return;
      reconnectDelay.current = BASE_RECONNECT_DELAY_MS;

      if (hasConnectedOnce.current) {
        // Reconnect after a drop — recover state to fill gaps
        setStatus("recovering");
        loadMessages().then(() => {
          if (isMounted.current) {
            setStatus("connected");
            setError(undefined);
          }
        });
      } else {
        // First connect — load existing message history
        hasConnectedOnce.current = true;
        setStatus("connected");
        setError(undefined);
        loadMessages();
      }
    };

    es.onmessage = (e: MessageEvent<string>) => {
      if (!isMounted.current) return;
      let event: SSEEvent;
      try {
        event = JSON.parse(e.data) as SSEEvent;
      } catch {
        return;
      }
      handleEvent(event, sessionId, setMessages, setStatus, setSessionStatus, setError);
    };

    es.onerror = () => {
      if (!isMounted.current) return;
      es.close();
      eventSourceRef.current = null;
      setStatus("disconnected");

      const delay = reconnectDelay.current;
      reconnectDelay.current = Math.min(delay * 2, MAX_RECONNECT_DELAY_MS);
      reconnectTimerRef.current = setTimeout(() => {
        if (isMounted.current) connect();
      }, delay);
    };
  }, [sessionId, instanceId, loadMessages]);

  useEffect(() => {
    isMounted.current = true;
    connect();
    return () => {
      isMounted.current = false;
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
  }, [connect]);

  return { messages, status, sessionStatus, error };
}

// ─── Event handler (pure — receives setters to avoid stale closures) ──────

type SetMessages = React.Dispatch<React.SetStateAction<AccumulatedMessage[]>>;
type SetStatus = React.Dispatch<React.SetStateAction<SessionConnectionStatus>>;
type SetSessionStatus = React.Dispatch<React.SetStateAction<"idle" | "busy">>;
type SetError = React.Dispatch<React.SetStateAction<string | undefined>>;

function handleEvent(
  event: SSEEvent,
  sessionId: string,
  setMessages: SetMessages,
  setStatus: SetStatus,
  setSessionStatus: SetSessionStatus,
  setError: SetError,
): void {
  const { type, properties } = event;

  if (type === "server.connected") {
    setStatus("connected");
    return;
  }

  if (type === "error") {
    setError(properties?.message ?? "Unknown error");
    setStatus("error");
    return;
  }

  if (type === "session.status") {
    const statusType = properties?.status?.type;
    if (statusType === "idle") setSessionStatus("idle");
    else if (statusType === "busy") setSessionStatus("busy");
    return;
  }

  if (type === "session.idle") {
    setSessionStatus("idle");
    return;
  }

  if (type === "message.updated") {
    const info = properties?.info;
    if (!info?.id) return;
    setMessages((prev) => ensureMessage(prev, info));
    return;
  }

  if (type === "message.part.updated") {
    const part = properties?.part;
    if (!part?.messageID || !part?.sessionID) return;
    setMessages((prev) => applyPartUpdate(prev, part));
    return;
  }

  // message.part.delta — real-time text delta (not in SDK types but emitted during streaming)
  if (type === "message.part.delta") {
    const { sessionID, messageID, partID, field, delta } = properties ?? {};
    if (sessionID !== sessionId) return;
    if (field !== "text" || !messageID || !partID) return;
    setMessages((prev) =>
      applyTextDelta(prev, messageID, partID, sessionID, delta ?? "")
    );
    return;
  }
}
