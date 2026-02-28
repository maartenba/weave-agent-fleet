"use client";

import { useState, useMemo } from "react";
import ReactDiffViewer from "react-diff-viewer-continued";
import type { ReactDiffViewerStylesOverride } from "react-diff-viewer-continued";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChevronRight, Loader2 } from "lucide-react";
import type { FileDiffItem } from "@/lib/api-types";

interface DiffViewerProps {
  diffs: FileDiffItem[];
  isLoading: boolean;
  error?: string;
}

const STATUS_BADGE_MAP: Record<
  FileDiffItem["status"],
  { label: string; className: string }
> = {
  added: {
    label: "Added",
    className: "bg-green-500/20 text-green-400 border-green-500/30",
  },
  modified: {
    label: "Modified",
    className: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  },
  deleted: {
    label: "Deleted",
    className: "bg-red-500/20 text-red-400 border-red-500/30",
  },
};

const diffStyleOverride: ReactDiffViewerStylesOverride = {
  variables: {
    dark: {
      diffViewerBackground: "#1E293B",
      diffViewerColor: "#F8FAFC",
      addedBackground: "rgba(34, 197, 94, 0.1)",
      addedColor: "#F8FAFC",
      removedBackground: "rgba(239, 68, 68, 0.1)",
      removedColor: "#F8FAFC",
      addedGutterBackground: "rgba(34, 197, 94, 0.2)",
      removedGutterBackground: "rgba(239, 68, 68, 0.2)",
      gutterBackground: "#1E293B",
      gutterBackgroundDark: "#1E293B",
      gutterColor: "#94A3B8",
      addedGutterColor: "#94A3B8",
      removedGutterColor: "#94A3B8",
      codeFoldGutterBackground: "#1E293B",
      codeFoldBackground: "#1E293B",
      codeFoldContentColor: "#94A3B8",
      emptyLineBackground: "#1E293B",
      wordAddedBackground: "rgba(34, 197, 94, 0.25)",
      wordRemovedBackground: "rgba(239, 68, 68, 0.25)",
    },
  },
};

function FileDiffSection({
  diff,
  defaultOpen,
}: {
  diff: FileDiffItem;
  defaultOpen: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const badge = STATUS_BADGE_MAP[diff.status];

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-4 py-2.5 hover:bg-white/5 transition-colors cursor-pointer border-b border-white/5">
        <ChevronRight
          className={`h-3.5 w-3.5 text-muted-foreground transition-transform flex-shrink-0 ${
            isOpen ? "rotate-90" : ""
          }`}
        />
        <span className="flex-1 text-xs font-mono text-foreground truncate text-left">
          {diff.file}
        </span>
        <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${badge.className}`}>
          {badge.label}
        </Badge>
        <span className="text-xs font-mono flex-shrink-0">
          {diff.additions > 0 && (
            <span className="text-green-500">+{diff.additions}</span>
          )}
          {diff.additions > 0 && diff.deletions > 0 && " "}
          {diff.deletions > 0 && (
            <span className="text-red-500">-{diff.deletions}</span>
          )}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="border-b border-white/5 overflow-auto text-xs">
          <ReactDiffViewer
            oldValue={diff.before}
            newValue={diff.after}
            splitView={false}
            useDarkTheme={true}
            styles={diffStyleOverride}
            hideLineNumbers={false}
          />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function DiffViewer({ diffs, isLoading, error }: DiffViewerProps) {
  const { totalAdditions, totalDeletions } = useMemo(() => {
    let additions = 0;
    let deletions = 0;
    for (const d of diffs) {
      additions += d.additions;
      deletions += d.deletions;
    }
    return { totalAdditions: additions, totalDeletions: deletions };
  }, [diffs]);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        <p className="text-sm">Loading diffs…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-red-400">{error}</p>
      </div>
    );
  }

  if (diffs.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-muted-foreground">No changes detected</p>
      </div>
    );
  }

  const defaultOpen = diffs.length <= 3;

  return (
    <ScrollArea className="h-full">
      {/* Summary header */}
      <div className="px-4 py-3 border-b border-white/10 flex items-center gap-3 text-xs">
        <span className="text-muted-foreground">
          {diffs.length} file{diffs.length !== 1 ? "s" : ""} changed
        </span>
        <span className="text-green-500 font-mono">+{totalAdditions}</span>
        <span className="text-red-500 font-mono">-{totalDeletions}</span>
      </div>

      {/* File diff sections */}
      <div>
        {diffs.map((diff) => (
          <FileDiffSection
            key={diff.file}
            diff={diff}
            defaultOpen={defaultOpen}
          />
        ))}
      </div>
    </ScrollArea>
  );
}
