"use client";

import { useEffect, useRef } from "react";
import {
  useNotifications,
  type UseNotificationsResult,
} from "./use-notifications";
import { useBrowserNotifications } from "./use-browser-notifications";
import { useNotificationPreferences } from "./use-notification-preferences";

export function useNotificationsWithBrowser(): UseNotificationsResult {
  const result = useNotifications();
  const { showNotification } = useBrowserNotifications();
  const { isTypeEnabled, preferences } = useNotificationPreferences();
  const prevCountRef = useRef(result.unreadCount);

  useEffect(() => {
    // When unreadCount increases AND there are new notifications, show browser notification
    if (
      result.unreadCount > prevCountRef.current &&
      result.notifications.length > 0
    ) {
      const latest = result.notifications[0];
      if (
        latest &&
        preferences.browserEnabled &&
        isTypeEnabled(latest.type)
      ) {
        showNotification(latest);
      }
    }
    prevCountRef.current = result.unreadCount;
  }, [
    result.unreadCount,
    result.notifications,
    showNotification,
    isTypeEnabled,
    preferences.browserEnabled,
  ]);

  return result;
}
