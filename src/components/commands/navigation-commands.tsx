"use client";

import { useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { LayoutGrid, Settings, Bell, History } from "lucide-react";
import { useCommandRegistry } from "@/contexts/command-registry-context";
import { useKeybindings } from "@/contexts/keybindings-context";

export function NavigationCommands() {
  const { registerCommand, unregisterCommand } = useCommandRegistry();
  const { bindings } = useKeybindings();
  const router = useRouter();

  const goToFleet = useCallback(() => router.push("/"), [router]);
  const goToSettings = useCallback(() => router.push("/settings"), [router]);
  const goToAlerts = useCallback(() => router.push("/alerts"), [router]);
  const goToHistory = useCallback(() => router.push("/history"), [router]);

  useEffect(() => {
    registerCommand({
      id: "nav-fleet",
      label: "Go to Fleet",
      icon: LayoutGrid,
      category: "Navigation",
      paletteHotkey: bindings["nav-fleet"]?.paletteHotkey ?? undefined,
      keywords: ["home", "dashboard", "sessions"],
      action: goToFleet,
    });
    registerCommand({
      id: "nav-settings",
      label: "Go to Settings",
      icon: Settings,
      category: "Navigation",
      paletteHotkey: bindings["nav-settings"]?.paletteHotkey ?? undefined,
      keywords: ["preferences", "config"],
      action: goToSettings,
    });
    registerCommand({
      id: "nav-alerts",
      label: "Go to Alerts",
      icon: Bell,
      category: "Navigation",
      paletteHotkey: bindings["nav-alerts"]?.paletteHotkey ?? undefined,
      keywords: ["notifications"],
      action: goToAlerts,
    });
    registerCommand({
      id: "nav-history",
      label: "Go to History",
      icon: History,
      category: "Navigation",
      paletteHotkey: bindings["nav-history"]?.paletteHotkey ?? undefined,
      keywords: ["past", "log"],
      action: goToHistory,
    });

    return () => {
      unregisterCommand("nav-fleet");
      unregisterCommand("nav-settings");
      unregisterCommand("nav-alerts");
      unregisterCommand("nav-history");
    };
  }, [
    registerCommand,
    unregisterCommand,
    bindings,
    goToFleet,
    goToSettings,
    goToAlerts,
    goToHistory,
  ]);

  return null;
}
