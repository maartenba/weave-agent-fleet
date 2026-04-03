"use client";

import { X, Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OpenFile } from "@/hooks/use-file-content";

interface FileTabBarProps {
  openFiles: Map<string, OpenFile>;
  activeFilePath: string | null;
  onActivate: (path: string) => void;
  onClose: (path: string) => void;
}

function getFileName(filePath: string): string {
  return filePath.split("/").pop() ?? filePath;
}

export function FileTabBar({
  openFiles,
  activeFilePath,
  onActivate,
  onClose,
}: FileTabBarProps) {
  const files = Array.from(openFiles.values());

  if (files.length === 0) {
    return null;
  }

  return (
    <div className="flex min-h-[32px] items-center overflow-x-auto border-b border-border/50 no-scrollbar">
      {files.map((file) => {
        const isActive = file.path === activeFilePath;
        const fileName = getFileName(file.path);

        return (
          <div
            key={file.path}
            title={file.path}
            className={cn(
              "group flex h-8 min-w-0 max-w-[180px] shrink-0 cursor-pointer items-center gap-1.5 border-r border-border/50 px-3 text-xs transition-colors",
              isActive
                ? "border-b-2 border-b-primary bg-background text-foreground"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
            )}
            onClick={() => onActivate(file.path)}
          >
            {/* Dirty indicator OR close button */}
            {file.isDirty ? (
              <button
                type="button"
                className="flex h-3.5 w-3.5 shrink-0 items-center justify-center"
                title="Unsaved changes — click to close anyway"
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(file.path);
                }}
              >
                <Circle className="h-2 w-2 fill-primary text-primary" />
              </button>
            ) : (
              <button
                type="button"
                className={cn(
                  "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded",
                  "opacity-0 transition-opacity group-hover:opacity-100",
                  isActive && "opacity-100"
                )}
                title="Close"
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(file.path);
                }}
              >
                <X className="h-3 w-3" />
              </button>
            )}
            <span className="truncate font-mono">{fileName}</span>
          </div>
        );
      })}
    </div>
  );
}
