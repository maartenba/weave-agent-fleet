"use client";

import { useEffect, useState } from "react";
import { useCommandRegistry } from "@/contexts/command-registry-context";
import type { Command, CommandCategory } from "@/lib/command-registry";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";

function formatGlobalShortcut(gs: NonNullable<Command["globalShortcut"]>): string {
  const isMac =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);

  let modifier = "";
  if (gs.platformModifier) {
    modifier = isMac ? "⌘" : "Ctrl+";
  } else if (gs.metaKey) {
    modifier = "⌘";
  } else if (gs.ctrlKey) {
    modifier = "Ctrl+";
  }

  const key = gs.key.toUpperCase();
  return `${modifier}${key}`;
}

const CATEGORY_ORDER: CommandCategory[] = ["Session", "Navigation", "View"];

export function CommandPalette() {
  const { commands, paletteOpen, setPaletteOpen } = useCommandRegistry();
  const [search, setSearch] = useState("");

  // Reset search when palette closes
  useEffect(() => {
    if (!paletteOpen) {
      setSearch("");
    }
  }, [paletteOpen]);

  // Group commands by category
  const grouped = CATEGORY_ORDER.map((category) => ({
    category,
    items: commands.filter((c) => c.category === category),
  })).filter((g) => g.items.length > 0);

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const isMac =
      typeof navigator !== "undefined" &&
      /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);

    // Cmd+K / Ctrl+K closes the palette when inside the input
    if (e.key === "k" && (isMac ? e.metaKey : e.ctrlKey)) {
      e.preventDefault();
      setPaletteOpen(false);
      return;
    }

    // Only intercept single-char palette hotkeys when search is empty and no modifiers
    if (search === "" && !e.metaKey && !e.ctrlKey && !e.altKey && e.key.length === 1) {
      for (const command of commands) {
        if (
          command.paletteHotkey === e.key &&
          !command.disabled
        ) {
          e.preventDefault();
          command.action();
          setPaletteOpen(false);
          return;
        }
      }
    }
  };

  return (
    <CommandDialog
      open={paletteOpen}
      onOpenChange={setPaletteOpen}
      title="Command Palette"
      description="Search for a command to run..."
      showCloseButton={false}
    >
      <CommandInput
        value={search}
        onValueChange={setSearch}
        placeholder="Type a command or search..."
        onKeyDown={handleInputKeyDown}
      />
      <CommandList>
        <CommandEmpty>No commands found.</CommandEmpty>
        {grouped.map(({ category, items }) => (
          <CommandGroup key={category} heading={category}>
            {items.map((command) => {
              const Icon = command.icon;
              return (
                <CommandItem
                  key={command.id}
                  value={[command.label, ...(command.keywords ?? [])].join(" ")}
                  disabled={command.disabled}
                  data-disabled={command.disabled ? "true" : undefined}
                  onSelect={() => {
                    if (command.disabled) return;
                    command.action();
                    setPaletteOpen(false);
                  }}
                >
                  {Icon && <Icon />}
                  <span>{command.label}</span>
                  {(command.globalShortcut || command.paletteHotkey) && (
                    <CommandShortcut>
                      {command.globalShortcut ? (
                        <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground opacity-100">
                          {formatGlobalShortcut(command.globalShortcut)}
                        </kbd>
                      ) : command.paletteHotkey ? (
                        <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground opacity-100">
                          {command.paletteHotkey}
                        </kbd>
                      ) : null}
                    </CommandShortcut>
                  )}
                </CommandItem>
              );
            })}
          </CommandGroup>
        ))}
      </CommandList>
      {/* Footer with keyboard hints */}
      <div className="flex items-center justify-between border-t px-3 py-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-3">
          <span>
            <kbd className="font-mono">↑↓</kbd> Navigate
          </span>
          <span>
            <kbd className="font-mono">↵</kbd> Select
          </span>
          <span>
            <kbd className="font-mono">Esc</kbd> Close
          </span>
        </div>
        <span className="opacity-50">
          <kbd className="font-mono">⌘K</kbd> toggle
        </span>
      </div>
    </CommandDialog>
  );
}
