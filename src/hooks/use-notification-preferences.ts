"use client";

import { usePersistedState } from "./use-persisted-state";
import type { NotificationType } from "@/lib/types";

export interface NotificationPreferences {
  browserEnabled: boolean;
  soundEnabled: boolean;
  typeEnabled: Record<NotificationType, boolean>;
}

const DEFAULT_PREFERENCES: NotificationPreferences = {
  browserEnabled: false,
  soundEnabled: false,
  typeEnabled: {
    input_required: true,
    session_completed: true,
    session_error: true,
    session_disconnected: true,
    cost_threshold: true,
    pipeline_stage_complete: true,
  },
};

export function useNotificationPreferences() {
  const [preferences, setPreferences] =
    usePersistedState<NotificationPreferences>(
      "weave:notifications:preferences",
      DEFAULT_PREFERENCES
    );

  function setBrowserEnabled(enabled: boolean) {
    setPreferences((prev) => ({ ...prev, browserEnabled: enabled }));
  }

  function setSoundEnabled(enabled: boolean) {
    setPreferences((prev) => ({ ...prev, soundEnabled: enabled }));
  }

  function setTypeEnabled(type: NotificationType, enabled: boolean) {
    setPreferences((prev) => ({
      ...prev,
      typeEnabled: { ...prev.typeEnabled, [type]: enabled },
    }));
  }

  function isTypeEnabled(type: string): boolean {
    return preferences.typeEnabled[type as NotificationType] ?? true;
  }

  return {
    preferences,
    setBrowserEnabled,
    setSoundEnabled,
    setTypeEnabled,
    isTypeEnabled,
  };
}
