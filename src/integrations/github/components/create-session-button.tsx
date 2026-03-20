"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { DirectoryPicker } from "@/components/session/directory-picker";
import { Loader2, AlertCircle, Rocket, FolderOpen, GitBranch, Copy } from "lucide-react";
import { useCreateSession } from "@/hooks/use-create-session";
import { usePersistedState } from "@/hooks/use-persisted-state";
import type { ContextSource } from "@/integrations/types";

type IsolationStrategy = "existing" | "worktree" | "clone";

const STRATEGY_LABELS: Record<IsolationStrategy, string> = {
  existing: "Directory",
  worktree: "Worktree",
  clone: "Clone",
};

const STRATEGY_ICONS: Record<IsolationStrategy, typeof FolderOpen> = {
  existing: FolderOpen,
  worktree: GitBranch,
  clone: Copy,
};

const STRATEGY_ORDER: IsolationStrategy[] = ["existing", "worktree", "clone"];

interface CreateSessionButtonProps {
  contextSource: ContextSource;
  directory?: string;
}

export function CreateSessionButton({ contextSource, directory: defaultDir }: CreateSessionButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [directory, setDirectory] = usePersistedState("weave:new-session:lastDirectory", defaultDir ?? "");
  const [titleOverride, setTitleOverride] = useState<string | null>(null);
  const title = titleOverride ?? contextSource.title;
  const [isolationStrategy, setIsolationStrategy] = useState<IsolationStrategy>("existing");
  const { createSession, isLoading, error } = useCreateSession();

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!directory.trim() || isLoading) return;
      try {
        const { instanceId, session } = await createSession(directory.trim(), {
          title: title.trim() || contextSource.title,
          isolationStrategy,
          context: contextSource,
        });
        setOpen(false);
        router.push(
          `/sessions/${encodeURIComponent(session.id)}?instanceId=${encodeURIComponent(instanceId)}`
        );
      } catch {
        // error is set by useCreateSession
      }
    },
    [directory, isLoading, title, isolationStrategy, contextSource, createSession, router]
  );

  const handleOpenChange = useCallback((value: boolean) => {
    if (!value) {
      setTitleOverride(null);
      setIsolationStrategy("existing");
    }
    setOpen(value);
  }, []);

  return (
    <>
      <Button
        size="xs"
        variant="outline"
        className="gap-1"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        <Rocket className="h-3 w-3" />
        Create Session
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md top-[10%] translate-y-0">
          <DialogHeader>
            <DialogTitle>Create Session From Context</DialogTitle>
          </DialogHeader>

          <div className="mb-2">
            <Badge variant="secondary" className="text-xs gap-1">
              {contextSource.type === "github-issue" ? "GitHub Issue" : "GitHub PR"}
            </Badge>
            <p className="text-xs text-muted-foreground mt-1 truncate">
              {contextSource.url}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Isolation Strategy */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium" id="create-strategy-label">
                Isolation Strategy
              </label>
              <div
                className="flex gap-1"
                role="radiogroup"
                aria-labelledby="create-strategy-label"
              >
                {STRATEGY_ORDER.map((s) => {
                  const Icon = STRATEGY_ICONS[s];
                  const isActive = isolationStrategy === s;
                  return (
                    <button
                      key={s}
                      type="button"
                      role="radio"
                      aria-checked={isActive}
                      tabIndex={isActive ? 0 : -1}
                      onClick={() => setIsolationStrategy(s)}
                      disabled={isLoading}
                      className={`flex-1 flex flex-col items-center justify-center rounded-md border px-3 py-2 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                        isActive
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-input bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      <span className="text-xs mt-1">{STRATEGY_LABELS[s]}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Directory */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="ctx-directory">
                Project Directory
              </label>
              <DirectoryPicker
                id="ctx-directory"
                value={directory}
                onChange={setDirectory}
                placeholder="/path/to/project"
                disabled={isLoading}
              />
            </div>

            {/* Title */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="ctx-title">
                Title
              </label>
              <Input
                id="ctx-title"
                value={title}
                onChange={(e) => setTitleOverride(e.target.value)}
                placeholder={contextSource.title}
                disabled={isLoading}
              />
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-md bg-red-500/10 border border-red-500/20 px-3 py-2 text-xs text-red-600 dark:text-red-400">
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
                  Creating…
                </>
              ) : (
                "Create Session"
              )}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
