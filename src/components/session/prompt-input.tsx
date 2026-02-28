"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Send, Loader2, AlertCircle } from "lucide-react";

interface PromptInputProps {
  onSend?: (text: string) => Promise<void>;
  disabled?: boolean;
  sendError?: string;
}

export function PromptInput({ onSend, disabled, sendError }: PromptInputProps) {
  const [value, setValue] = useState("");
  const [isSending, setIsSending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const isDisabled = disabled || isSending;

  // Re-focus whenever the input becomes enabled (e.g. agent finishes responding)
  useEffect(() => {
    if (!isDisabled) {
      inputRef.current?.focus();
    }
  }, [isDisabled]);

  const canSend = !!value.trim() && !isDisabled;

  return (
    <div className="border-t p-3 space-y-2">
      {sendError && (
        <div className="flex items-center gap-2 rounded-md bg-red-500/10 border border-red-500/20 px-3 py-1.5 text-xs text-red-400">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span>{sendError}</span>
        </div>
      )}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!canSend) return;
          const text = value.trim();
          setValue("");
          setIsSending(true);
          try {
            await onSend?.(text);
          } finally {
            setIsSending(false);
            inputRef.current?.focus();
          }
        }}
        className="flex items-center gap-2"
      >
        <Input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Send a message to this session..."
          className="text-sm"
          disabled={isDisabled}
        />
        <Button type="submit" size="icon" variant="default" disabled={!canSend}>
          {isSending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </form>
    </div>
  );
}
