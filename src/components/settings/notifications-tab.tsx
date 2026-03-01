"use client";

import { useCallback, useState } from "react";
import { Bell, BellOff, Volume2, VolumeOff } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useBrowserNotifications } from "@/hooks/use-browser-notifications";
import {
  useNotificationPreferences,
  type NotificationPreferences,
} from "@/hooks/use-notification-preferences";
import type { NotificationType } from "@/lib/types";

/** Notification types that are wired up and should be shown in preferences. */
const CONFIGURABLE_TYPES: {
  type: NotificationType;
  label: string;
  description: string;
}[] = [
  {
    type: "input_required",
    label: "Input Required",
    description: "When a session needs user input",
  },
  {
    type: "session_completed",
    label: "Session Completed",
    description: "When a session finishes work",
  },
  {
    type: "session_error",
    label: "Session Error",
    description: "When a session encounters an error",
  },
  {
    type: "session_disconnected",
    label: "Session Disconnected",
    description: "When a session loses connection",
  },
];

export function NotificationsTab() {
  const { permission, isEnabled, requestPermission } =
    useBrowserNotifications();
  const { preferences, setBrowserEnabled, setSoundEnabled, setTypeEnabled } =
    useNotificationPreferences();
  const [permissionState, setPermissionState] = useState(permission);

  const handleBrowserToggle = useCallback(
    async (checked: boolean) => {
      if (checked) {
        // Request permission when enabling
        const result = await requestPermission();
        setPermissionState(result);
        if (result === "granted") {
          setBrowserEnabled(true);
        }
        // If denied, don't enable — show guidance instead
      } else {
        setBrowserEnabled(false);
      }
    },
    [requestPermission, setBrowserEnabled]
  );

  return (
    <div className="space-y-6 max-w-xl">
      {/* Browser Notifications */}
      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {isEnabled ? (
                <Bell className="h-4 w-4 text-muted-foreground" />
              ) : (
                <BellOff className="h-4 w-4 text-muted-foreground" />
              )}
              <h4 className="text-sm font-semibold">Browser Notifications</h4>
            </div>
            <div className="flex items-center gap-2">
              {permissionState === "granted" && (
                <Badge
                  variant="secondary"
                  className="text-[10px] bg-green-500/10 text-green-500"
                >
                  Granted
                </Badge>
              )}
              {permissionState === "denied" && (
                <Badge
                  variant="secondary"
                  className="text-[10px] bg-red-500/10 text-red-500"
                >
                  Blocked
                </Badge>
              )}
              <Switch
                checked={isEnabled && permissionState === "granted"}
                onCheckedChange={handleBrowserToggle}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Show browser notifications when the tab is not focused. Requires
            browser permission.
          </p>
          {permissionState === "denied" && (
            <p className="text-xs text-amber-500">
              Notifications are blocked by your browser. To enable them, click
              the lock icon in your browser&apos;s address bar and allow
              notifications for this site.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Notification Types */}
      <Card>
        <CardContent className="p-4 space-y-4">
          <h4 className="text-sm font-semibold">Notification Types</h4>
          <p className="text-xs text-muted-foreground">
            Choose which notification types appear in your browser and alerts.
          </p>
          <div className="space-y-3">
            {CONFIGURABLE_TYPES.map(({ type, label, description }) => (
              <div
                key={type}
                className="flex items-center justify-between py-1"
              >
                <div>
                  <p className="text-sm">{label}</p>
                  <p className="text-xs text-muted-foreground">{description}</p>
                </div>
                <Switch
                  checked={
                    preferences.typeEnabled[
                      type as keyof NotificationPreferences["typeEnabled"]
                    ] ?? true
                  }
                  onCheckedChange={(checked) => setTypeEnabled(type, checked)}
                />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Sound */}
      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {preferences.soundEnabled ? (
                <Volume2 className="h-4 w-4 text-muted-foreground" />
              ) : (
                <VolumeOff className="h-4 w-4 text-muted-foreground" />
              )}
              <h4 className="text-sm font-semibold">Notification Sounds</h4>
            </div>
            <Switch
              checked={preferences.soundEnabled}
              onCheckedChange={setSoundEnabled}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Play a sound when notifications arrive.{" "}
            <span className="italic">Coming soon</span>
          </p>
        </CardContent>
      </Card>

      {/* Test notification button */}
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            if (permissionState !== "granted") {
              const result = await requestPermission();
              setPermissionState(result);
              if (result !== "granted") return;
            }
            try {
              new Notification("Weave Fleet", {
                body: "This is a test notification",
                icon: "/favicon.ico",
              });
            } catch {
              /* ignore */
            }
          }}
        >
          Send test notification
        </Button>
      </div>
    </div>
  );
}
