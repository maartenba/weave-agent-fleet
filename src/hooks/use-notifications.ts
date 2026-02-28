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
}

const DEFAULT_POLL_INTERVAL_MS = 10_000;

export function useNotifications(
  pollIntervalMs: number = DEFAULT_POLL_INTERVAL_MS
): UseNotificationsResult {
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<DbNotification[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const isMounted = useRef(true);

  const fetchUnreadCount = useCallback(async () => {
    try {
      const response = await fetch("/api/notifications/unread-count");
      if (!response.ok) return;
      const data = (await response.json()) as { count: number };
      if (isMounted.current) {
        setUnreadCount(data.count);
      }
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

  useEffect(() => {
    isMounted.current = true;
    fetchUnreadCount();
    const interval = setInterval(fetchUnreadCount, pollIntervalMs);
    return () => {
      isMounted.current = false;
      clearInterval(interval);
    };
  }, [fetchUnreadCount, pollIntervalMs]);

  return {
    unreadCount,
    notifications,
    isLoading,
    fetchNotifications,
    markAsRead,
    markAllAsRead,
  };
}
