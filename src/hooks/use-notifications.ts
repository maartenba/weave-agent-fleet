"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { DbNotification } from "@/lib/server/db-repository";

export type { DbNotification };

export interface UseNotificationsResult {
  unreadCount: number;
  notifications: DbNotification[];
  isLoading: boolean;
  fetchNotifications: (limit?: number) => Promise<void>;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  clearAll: () => Promise<void>;
}

const DEFAULT_POLL_INTERVAL_MS = 10_000;
const SSE_RECONNECT_DELAY_MS = 5_000;

export function useNotifications(
  pollIntervalMs: number = DEFAULT_POLL_INTERVAL_MS
): UseNotificationsResult {
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<DbNotification[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const isMounted = useRef(true);
  const eventSourceRef = useRef<EventSource | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchUnreadCount = useCallback(async () => {
    try {
      const response = await fetch("/api/notifications/unread-count");
      if (!response.ok) return;
      const data = (await response.json()) as { count: number };
      if (isMounted.current) setUnreadCount(data.count);
    } catch {
      // Non-fatal — badge stays at last known value
    }
  }, []);

  const fetchNotifications = useCallback(async (limit: number = 10) => {
    if (isMounted.current) setIsLoading(true);
    try {
      const response = await fetch(`/api/notifications?limit=${limit}`);
      if (!response.ok) return;
      const data = (await response.json()) as DbNotification[];
      if (isMounted.current) {
        setNotifications(data);
        // Update unread count from the fetched list
        setUnreadCount(data.filter((n) => n.read === 0).length);
      }
    } catch {
      // Non-fatal
    } finally {
      if (isMounted.current) setIsLoading(false);
    }
  }, []);

  const markAsRead = useCallback(async (id: string) => {
    try {
      await fetch(`/api/notifications/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ read: true }),
      });
      if (isMounted.current) {
        setNotifications((prev) =>
          prev.map((n) => (n.id === id ? { ...n, read: 1 } : n))
        );
        setUnreadCount((prev) => Math.max(0, prev - 1));
      }
    } catch {
      // Non-fatal
    }
  }, []);

  const markAllAsRead = useCallback(async () => {
    try {
      await fetch("/api/notifications/all", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ read: true }),
      });
      if (isMounted.current) {
        setNotifications((prev) => prev.map((n) => ({ ...n, read: 1 })));
        setUnreadCount(0);
      }
    } catch {
      // Non-fatal
    }
  }, []);

  const clearAll = useCallback(async () => {
    try {
      await fetch("/api/notifications", { method: "DELETE" });
      if (isMounted.current) {
        setNotifications([]);
        setUnreadCount(0);
      }
    } catch {
      // Non-fatal
    }
  }, []);

  const startPolling = useCallback(() => {
    if (pollIntervalRef.current) return;
    pollIntervalRef.current = setInterval(fetchUnreadCount, pollIntervalMs);
  }, [fetchUnreadCount, pollIntervalMs]);

  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  const connectSSE = useCallback(() => {
    if (eventSourceRef.current) return;
    const es = new EventSource("/api/notifications/stream");
    eventSourceRef.current = es;

    es.onopen = () => {
      stopPolling(); // SSE connected — stop polling
    };

    es.onmessage = (e: MessageEvent<string>) => {
      if (!isMounted.current) return;
      try {
        const data = JSON.parse(e.data) as {
          type: string;
          notification: DbNotification;
        };
        if (data.type === "notification" && data.notification) {
          setUnreadCount((prev) => prev + 1);
          setNotifications((prev) =>
            [data.notification, ...prev].slice(0, 50)
          );
        }
      } catch {
        /* ignore parse errors */
      }
    };

    es.onerror = () => {
      if (!isMounted.current) return;
      es.close();
      eventSourceRef.current = null;
      // Fallback to polling
      fetchUnreadCount();
      startPolling();
      // Attempt SSE reconnect after delay
      setTimeout(() => {
        if (isMounted.current && !eventSourceRef.current) connectSSE();
      }, SSE_RECONNECT_DELAY_MS);
    };
  }, [stopPolling, startPolling, fetchUnreadCount]);

  useEffect(() => {
    isMounted.current = true;
    fetchUnreadCount(); // Initial fetch
    connectSSE(); // Try SSE first
    startPolling(); // Start polling as initial fallback (SSE onopen will stop it)
    return () => {
      isMounted.current = false;
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      stopPolling();
    };
  }, [fetchUnreadCount, connectSSE, startPolling, stopPolling]);

  return {
    unreadCount,
    notifications,
    isLoading,
    fetchNotifications,
    markAsRead,
    markAllAsRead,
    clearAll,
  };
}
