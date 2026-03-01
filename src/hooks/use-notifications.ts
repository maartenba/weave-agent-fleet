// Re-export from context — this file is kept as a barrel to avoid import churn.
export { useNotifications, type NotificationsContextValue as UseNotificationsResult } from "@/contexts/notifications-context";
export type { DbNotification } from "@/lib/server/db-repository";
