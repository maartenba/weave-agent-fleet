"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Loader2, AlertCircle } from "lucide-react";
import { useCreateSession } from "@/hooks/use-create-session";

interface NewSessionDialogProps {
  trigger: React.ReactNode;
}

export function NewSessionDialog({ trigger }: NewSessionDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [directory, setDirectory] = useState("");
  const [title, setTitle] = useState("");
  const { createSession, isLoading, error } = useCreateSession();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!directory.trim() || isLoading) return;

    try {
      const { instanceId, session } = await createSession(
        directory.trim(),
        title.trim() || undefined
      );
      setOpen(false);
      setDirectory("");
      setTitle("");
      router.push(
        `/sessions/${encodeURIComponent(session.id)}?instanceId=${encodeURIComponent(instanceId)}`
      );
    } catch {
      // error is already set by useCreateSession
    }
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent side="right" className="w-full max-w-sm">
        <SheetHeader>
          <SheetTitle>New Session</SheetTitle>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-6">
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="directory">
              Workspace Directory
            </label>
            <Input
              id="directory"
              value={directory}
              onChange={(e) => setDirectory(e.target.value)}
              placeholder="/path/to/project"
              disabled={isLoading}
              required
            />
            <p className="text-xs text-muted-foreground">
              The directory OpenCode will work in.
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="session-title">
              Title{" "}
              <span className="text-muted-foreground font-normal">(optional)</span>
            </label>
            <Input
              id="session-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What are you working on?"
              disabled={isLoading}
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-md bg-red-500/10 border border-red-500/20 px-3 py-2 text-xs text-red-400">
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <Button
            type="submit"
            className="w-full weave-gradient-bg hover:opacity-90 border-0"
            disabled={!directory.trim() || isLoading}
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Spawning…
              </>
            ) : (
              "Create Session"
            )}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
