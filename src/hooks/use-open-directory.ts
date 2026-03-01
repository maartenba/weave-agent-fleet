"use client";

import { useState, useCallback } from "react";
import { usePersistedState } from "./use-persisted-state";

export type OpenTool = "vscode" | "cursor" | "terminal" | "explorer";

export interface UseOpenDirectoryResult {
  openDirectory: (directory: string, tool: OpenTool) => Promise<void>;
  isOpening: boolean;
  error?: string;
}

export function useOpenDirectory(): UseOpenDirectoryResult {
  const [isOpening, setIsOpening] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const openDirectory = useCallback(
    async (directory: string, tool: OpenTool): Promise<void> => {
      setIsOpening(true);
      setError(undefined);

      try {
        const response = await fetch("/api/open-directory", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ directory, tool }),
        });

        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(
            (body as { error?: string }).error ?? `HTTP ${response.status}`
          );
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to open directory";
        setError(message);
        console.error("[useOpenDirectory]", message);
      } finally {
        setIsOpening(false);
      }
    },
    []
  );

  return { openDirectory, isOpening, error };
}

export function usePreferredOpenTool(): [OpenTool, (tool: OpenTool) => void] {
  return usePersistedState<OpenTool>("weave:prefs:open-tool", "vscode");
}
