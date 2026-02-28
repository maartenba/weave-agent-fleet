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

type IsolationStrategy = "existing" | "worktree" | "clone";

const STRATEGY_LABELS: Record<IsolationStrategy, string> = {
  existing: "Existing Directory",
  worktree: "Git Worktree",
  clone: "Git Clone",
};

const DIRECTORY_LABELS: Record<IsolationStrategy, string> = {
  existing: "Project Directory",
  worktree: "Source Repository",
  clone: "Source Repository",
};

const DIRECTORY_PLACEHOLDERS: Record<IsolationStrategy, string> = {
  existing: "/path/to/project",
  worktree: "/path/to/git/repo",
  clone: "/path/to/git/repo or git URL",
};

const STRATEGY_DESCRIPTIONS: Record<IsolationStrategy, string> = {
  existing: "Use the directory as-is. Simple, no copy or clone.",
  worktree: "Creates a git worktree — ideal for parallel work on the same repo.",
  clone: "Shallow-clones the repo — fully isolated ephemeral workspace.",
};

interface NewSessionDialogProps {
  trigger: React.ReactNode;
}

export function NewSessionDialog({ trigger }: NewSessionDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [directory, setDirectory] = useState("");
  const [title, setTitle] = useState("");
  const [isolationStrategy, setIsolationStrategy] = useState<IsolationStrategy>("existing");
  const [branch, setBranch] = useState("");
  const { createSession, isLoading, error } = useCreateSession();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!directory.trim() || isLoading) return;

    try {
      const { instanceId, session } = await createSession(directory.trim(), {
        title: title.trim() || undefined,
        isolationStrategy,
        branch: isolationStrategy === "worktree" && branch.trim() ? branch.trim() : undefined,
      });
      setOpen(false);
      setDirectory("");
      setTitle("");
      setIsolationStrategy("existing");
      setBranch("");
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
          {/* Isolation Strategy */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="isolation-strategy">
              Isolation Strategy
            </label>
            <select
              id="isolation-strategy"
              value={isolationStrategy}
              onChange={(e) => setIsolationStrategy(e.target.value as IsolationStrategy)}
              disabled={isLoading}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {(Object.keys(STRATEGY_LABELS) as IsolationStrategy[]).map((s) => (
                <option key={s} value={s}>
                  {STRATEGY_LABELS[s]}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              {STRATEGY_DESCRIPTIONS[isolationStrategy]}
            </p>
          </div>

          {/* Directory / Source Repo */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="directory">
              {DIRECTORY_LABELS[isolationStrategy]}
            </label>
            <Input
              id="directory"
              value={directory}
              onChange={(e) => setDirectory(e.target.value)}
              placeholder={DIRECTORY_PLACEHOLDERS[isolationStrategy]}
              disabled={isLoading}
              required
            />
          </div>

          {/* Branch name — only for worktree */}
          {isolationStrategy === "worktree" && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="branch">
                Branch{" "}
                <span className="text-muted-foreground font-normal">(optional)</span>
              </label>
              <Input
                id="branch"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                placeholder="feature/my-branch"
                disabled={isLoading}
              />
              <p className="text-xs text-muted-foreground">
                A unique branch name will be generated if left blank.
              </p>
            </div>
          )}

          {/* Title */}
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
