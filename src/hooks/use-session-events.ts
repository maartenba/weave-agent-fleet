"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import type {
  AccumulatedMessage,
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

  const connect = useCallback(() => {
    if (!isMounted.current) return;

    const url = `/api/sessions/${encodeURIComponent(sessionId)}/events?instanceId=${encodeURIComponent(instanceId)}`;
    const es = new EventSource(url);
    eventSourceRef.current = es;
    setStatus("connecting");

    es.onopen = () => {
      if (!isMounted.current) return;
      reconnectDelay.current = BASE_RECONNECT_DELAY_MS;
      setStatus("connected");
      setError(undefined);
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
  }, [sessionId, instanceId]);

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
