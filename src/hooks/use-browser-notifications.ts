"use client";

import { useCallback, useState } from "react";
import { usePersistedState } from "./use-persisted-state";
import type { DbNotification } from "@/lib/api-types";

export type NotificationPermissionState = "default" | "granted" | "denied";

export interface UseBrowserNotificationsResult {
  permission: NotificationPermissionState;
  isEnabled: boolean;
  setEnabled: (enabled: boolean) => void;
  requestPermission: () => Promise<NotificationPermissionState>;
  showNotification: (notification: DbNotification) => void;
}

function getNotificationTitle(type: string): string {
  switch (type) {
    case "input_required":
      return "Input Required";
    case "session_completed":
      return "Session Completed";
    case "session_error":
      return "Session Error";
    case "session_disconnected":
      return "Session Disconnected";
    default:
      return "Weave Fleet";
  }
}

function getInitialPermission(): NotificationPermissionState {
  if (typeof window !== "undefined" && "Notification" in window) {
    return Notification.permission as NotificationPermissionState;
  }
  return "default";
}

export function useBrowserNotifications(): UseBrowserNotificationsResult {
  const [isEnabled, setEnabled] = usePersistedState(
    "weave:notifications:browser-enabled",
    false
  );
  const [permission, setPermission] =
    useState<NotificationPermissionState>(getInitialPermission);

  const requestPermission =
    useCallback(async (): Promise<NotificationPermissionState> => {
      if (typeof window === "undefined" || !("Notification" in window))
        return "denied";
      const result = await Notification.requestPermission();
      setPermission(result as NotificationPermissionState);
      if (result === "granted") setEnabled(true);
      return result as NotificationPermissionState;
    }, [setEnabled]);

  const showNotification = useCallback(
    (notification: DbNotification) => {
      if (!isEnabled) return;
      if (typeof window === "undefined" || !("Notification" in window)) return;
      if (Notification.permission !== "granted") return;
      if (document.hasFocus()) return; // Only show when tab is not focused

      try {
        new Notification(getNotificationTitle(notification.type), {
          body: notification.message,
          tag: notification.id, // Prevents duplicate OS notifications
          icon: "/favicon.ico",
        });
      } catch {
        // Notification API may fail silently in some contexts
      }
    },
    [isEnabled]
  );

  return {
    permission,
    isEnabled,
    setEnabled,
    requestPermission,
    showNotification,
  };
}
