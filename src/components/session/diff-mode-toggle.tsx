"use client";

import { Button } from "@/components/ui/button";

export type DiffMode = "session" | "uncommitted";

interface DiffModeToggleProps {
  mode: DiffMode;
  onModeChange: (mode: DiffMode) => void;
  disabled?: boolean;
}

/**
 * Two-button toggle for switching between "Session changes" (cumulative diff
 * from the first user message) and "Uncommitted" (current HEAD diff).
 */
export function DiffModeToggle({ mode, onModeChange, disabled }: DiffModeToggleProps) {
  return (
    <div className="flex items-center gap-0.5">
      <Button
        variant="ghost"
        size="sm"
        className={`h-6 px-2 text-xs ${
          mode === "session"
            ? "bg-accent text-foreground"
            : "text-muted-foreground hover:text-foreground"
        }`}
        onClick={() => onModeChange("session")}
        disabled={disabled}
        title="Show all changes from this session (cumulative)"
      >
        Session
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className={`h-6 px-2 text-xs ${
          mode === "uncommitted"
            ? "bg-accent text-foreground"
            : "text-muted-foreground hover:text-foreground"
        }`}
        onClick={() => onModeChange("uncommitted")}
        disabled={disabled}
        title="Show only uncommitted changes"
      >
        Uncommitted
      </Button>
    </div>
  );
}
