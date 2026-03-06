"use client";

import { useState, useCallback } from "react";
import { isSlashCommand, parseSlashCommand } from "@/lib/slash-command-utils";

export interface UseSendPromptResult {
  sendPrompt: (
    sessionId: string,
    instanceId: string,
    text: string,
    agent?: string
  ) => Promise<void>;
  isSending: boolean;
  error?: string;
}

export function useSendPrompt(): UseSendPromptResult {
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const sendPrompt = useCallback(
    async (sessionId: string, instanceId: string, text: string, agent?: string): Promise<void> => {
      setIsSending(true);
      setError(undefined);
      try {
        if (isSlashCommand(text)) {
          const parsed = parseSlashCommand(text);
          if (parsed) {
            const response = await fetch(
              `/api/sessions/${encodeURIComponent(sessionId)}/command`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  instanceId,
                  command: parsed.command,
                  ...(parsed.args ? { args: parsed.args } : {}),
                }),
              }
            );

            if (!response.ok) {
              const data = await response.json().catch(() => ({}));
              const message = (data as { error?: string }).error ?? `HTTP ${response.status}`;
              setError(message);
              throw new Error(message);
            }
            return;
          }
        }

        const response = await fetch(
          `/api/sessions/${encodeURIComponent(sessionId)}/prompt`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ instanceId, text, agent }),
          }
        );

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          const message = (data as { error?: string }).error ?? `HTTP ${response.status}`;
          setError(message);
          throw new Error(message);
        }
      } finally {
        setIsSending(false);
      }
    },
    []
  );

  return { sendPrompt, isSending, error };
}
