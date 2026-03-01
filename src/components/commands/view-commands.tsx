"use client";

import { useEffect, useCallback } from "react";
import { PanelLeftClose } from "lucide-react";
import { useCommandRegistry } from "@/contexts/command-registry-context";
import { useSidebar } from "@/contexts/sidebar-context";
import { useKeybindings } from "@/contexts/keybindings-context";

export function ViewCommands() {
  const { registerCommand, unregisterCommand } = useCommandRegistry();
  const { toggleSidebar } = useSidebar();
  const { bindings } = useKeybindings();

  const toggle = useCallback(() => toggleSidebar(), [toggleSidebar]);

  useEffect(() => {
    registerCommand({
      id: "toggle-sidebar",
      label: "Toggle Sidebar",
      icon: PanelLeftClose,
      category: "View",
      paletteHotkey: bindings["toggle-sidebar"]?.paletteHotkey ?? undefined,
      globalShortcut: bindings["toggle-sidebar"]?.globalShortcut ?? undefined,
      keywords: ["panel", "menu", "collapse", "expand"],
      action: toggle,
    });

    return () => {
      unregisterCommand("toggle-sidebar");
    };
  }, [registerCommand, unregisterCommand, bindings, toggle]);

  return null;
}
