import type { LucideIcon } from "lucide-react";

export type CommandCategory = "Session" | "Navigation" | "View";

export interface GlobalShortcut {
  key: string;
  platformModifier?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
}

export interface Command {
  id: string;
  label: string;
  description?: string;
  icon?: LucideIcon;
  category: CommandCategory;
  paletteHotkey?: string;
  globalShortcut?: GlobalShortcut;
  action: () => void;
  keywords?: string[];
  disabled?: boolean;
}

export interface CommandRegistryValue {
  commands: Command[];
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  registerCommand: (command: Command) => void;
  unregisterCommand: (id: string) => void;
}
