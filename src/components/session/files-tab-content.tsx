"use client";

import { useEffect, useRef, useCallback, useState, useMemo } from "react";
import { Loader2, FolderOpen, AlertCircle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFileTree } from "@/hooks/use-file-tree";
import { useFileContent } from "@/hooks/use-file-content";
import { FileTree } from "./file-tree";
import { FileTabBar } from "./file-tab-bar";
import { MonacoEditorWrapper } from "./monaco-editor-wrapper";
import { MarkdownPreview } from "./markdown-preview";
import { ImagePreview } from "./image-preview";
import { Button } from "@/components/ui/button";
import {
  FileOperationDialogs,
  type DialogState,
} from "./file-operation-dialogs";
import type { AccumulatedPart, FileDiffItem } from "@/lib/api-types";
import type { FileTreeNode } from "@/hooks/use-file-tree";
import { buildGitStatusMap } from "@/lib/git-status-utils";

// ─── Types ───────────────────────────────────────────────────────────────────

interface FilesTabContentProps {
  sessionId: string;
  instanceId: string;
  /** Called after a file is saved so the Changes tab diffs can refresh */
  fetchDiffs: () => void;
  /** Git diff items for status coloring and inline diff decorations */
  diffs?: FileDiffItem[];
  /** Recent session messages/parts for SSE-driven tree refresh */
  recentParts?: AccumulatedPart[];
  className?: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

const TREE_MIN_WIDTH = 160;
const TREE_DEFAULT_WIDTH = 240;
const TREE_MAX_WIDTH = 480;

export function FilesTabContent({
  sessionId,
  instanceId,
  fetchDiffs,
  diffs,
  recentParts,
  className,
}: FilesTabContentProps) {
  const { tree, isLoading: treeLoading, error: treeError, fetchTree, toggleExpand, expandTo } =
    useFileTree(sessionId, instanceId);

  const fileContent = useFileContent(sessionId, instanceId);
  const {
    openFiles,
    activeFilePath,
    openFile,
    closeFile,
    setActiveFilePath,
    updateContent,
    saveFile,
    isSaving,
    saveError,
    renameOpenFile,
    closeFilesUnderPath,
  } = fileContent;

  // Dialog state for file operations
  const [dialogState, setDialogState] = useState<DialogState>({ type: "idle" });

  // Markdown preview toggle per file
  const [markdownPreviewPaths, setMarkdownPreviewPaths] = useState<Set<string>>(new Set());

  // Tree panel resizing
  const [treeWidth, setTreeWidth] = useState(TREE_DEFAULT_WIDTH);
  const isDraggingRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragStartWidthRef = useRef(TREE_DEFAULT_WIDTH);

  // Fetch tree on mount
  const isMountedRef = useRef(false);
  useEffect(() => {
    if (!isMountedRef.current) {
      isMountedRef.current = true;
      fetchTree();
    }
  }, [fetchTree]);

  // Save handler — writes to disk, then refreshes diffs
  const handleSave = useCallback(
    async (filePath: string) => {
      await saveFile(filePath);
      fetchDiffs();
      fetchTree(); // in case new files were created
    },
    [saveFile, fetchDiffs, fetchTree]
  );

  // ── Context menu callbacks ─────────────────────────────────────────────────
  const handleNewFile = useCallback((parentPath: string) => {
    setDialogState({ type: "create-file", parentPath });
  }, []);

  const handleNewFolder = useCallback((parentPath: string) => {
    setDialogState({ type: "create-folder", parentPath });
  }, []);

  const handleRename = useCallback((node: FileTreeNode) => {
    setDialogState({ type: "rename", node });
  }, []);

  const handleDelete = useCallback((node: FileTreeNode) => {
    setDialogState({ type: "delete", node });
  }, []);

  const handleMove = useCallback((node: FileTreeNode) => {
    setDialogState({ type: "move", node });
  }, []);

  // ── Post-mutation success handler ──────────────────────────────────────────
  const handleDialogSuccess = useCallback(
    async (action: string, path: string, newPath?: string) => {
      // Wait for tree to fully refresh before expanding / opening
      await fetchTree();
      fetchDiffs();

      if (action === "create-file") {
        expandTo(path);
        openFile(path);
      } else if (action === "create-folder") {
        expandTo(path);
      } else if (action === "rename" && newPath) {
        renameOpenFile(path, newPath);
        expandTo(newPath);
      } else if (action === "move" && newPath) {
        renameOpenFile(path, newPath);
        expandTo(newPath);
      } else if (action === "delete") {
        closeFilesUnderPath(path);
      }
    },
    [fetchTree, fetchDiffs, expandTo, openFile, renameOpenFile, closeFilesUnderPath]
  );

  // SSE-driven file tree refresh (debounced)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevPartsLengthRef = useRef(0);

  useEffect(() => {
    if (!recentParts || recentParts.length === prevPartsLengthRef.current) return;
    prevPartsLengthRef.current = recentParts.length;

    // Check if any new completed tool parts appeared that could affect files or git state
    const hasFileWrite = recentParts.some(
      (part) =>
        part.type === "tool" &&
        (part.tool === "write" || part.tool === "edit") &&
        (part.state as { status?: string })?.status === "completed"
    );

    const hasBash = recentParts.some(
      (part) =>
        part.type === "tool" &&
        part.tool === "bash" &&
        (part.state as { status?: string })?.status === "completed"
    );

    if (hasFileWrite || hasBash) {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => {
        fetchTree();
        fetchDiffs();

        const reloadFn = (fileContent as unknown as { reloadFile?: (p: string) => void }).reloadFile;

        // Reload open clean files that were explicitly written/edited
        if (hasFileWrite) {
          recentParts.forEach((part) => {
            if (
              part.type === "tool" &&
              (part.tool === "write" || part.tool === "edit") &&
              (part.state as { status?: string })?.status === "completed"
            ) {
              const input = (part.state as { input?: { filePath?: string } })?.input;
              const changedPath = input?.filePath;
              if (changedPath && openFiles.has(changedPath)) {
                const openFile_ = openFiles.get(changedPath);
                if (openFile_ && !openFile_.isDirty) {
                  reloadFn?.(changedPath);
                }
              }
            }
          });
        }

        // Bash commands can modify any file (rm, mv, sed, git checkout, etc.)
        // so reload all open non-dirty files to pick up external changes
        if (hasBash && reloadFn) {
          openFiles.forEach((file, path) => {
            if (!file.isDirty) {
              reloadFn(path);
            }
          });
        }
      }, 2000);
    }
  }, [recentParts, fetchTree, fetchDiffs, openFiles, fileContent]);

  // Drag-to-resize tree panel
  const handleDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    dragStartXRef.current = e.clientX;
    dragStartWidthRef.current = treeWidth;

    const onMouseMove = (ev: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const delta = ev.clientX - dragStartXRef.current;
      const newWidth = Math.min(
        TREE_MAX_WIDTH,
        Math.max(TREE_MIN_WIDTH, dragStartWidthRef.current + delta)
      );
      setTreeWidth(newWidth);
    };

    const onMouseUp = () => {
      isDraggingRef.current = false;
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, [treeWidth]);

  // Markdown preview toggle
  const toggleMarkdownPreview = useCallback((filePath: string) => {
    setMarkdownPreviewPaths((prev) => {
      const next = new Set(prev);
      if (next.has(filePath)) next.delete(filePath);
      else next.add(filePath);
      return next;
    });
  }, []);

  // Compute dirty file paths for the tree indicators
  const dirtyFilePaths = useMemo(() => {
    const set = new Set<string>();
    openFiles.forEach((f) => { if (f.isDirty) set.add(f.path); });
    return set;
  }, [openFiles]);

  // Compute git status map from diffs for file tree coloring
  const gitStatusMap = useMemo(
    () => buildGitStatusMap(diffs ?? []),
    [diffs]
  );

  // Find the git "before" content for the active file (for inline diff decorations).
  // Skip entirely-new files (status "added") — highlighting every line green is just noise.
  const gitBeforeContent = useMemo(() => {
    if (!activeFilePath || !diffs) return undefined;
    const diff = diffs.find((d) => d.file === activeFilePath);
    if (!diff || diff.status === "added") return undefined;
    return diff.before;
  }, [activeFilePath, diffs]);

  const activeFile = activeFilePath ? openFiles.get(activeFilePath) : null;

  const isMarkdown = (path: string) =>
    path.endsWith(".md") || path.endsWith(".mdx");

  const showMarkdownPreview =
    activeFilePath !== null &&
    isMarkdown(activeFilePath) &&
    markdownPreviewPaths.has(activeFilePath);

  return (
    <div className={cn("flex h-full overflow-hidden", className)}>
      {/* ── File Tree Panel ─────────────────────────────────────────────── */}
      <div
        className="flex flex-col border-r border-border/50"
        style={{ width: `${treeWidth}px`, minWidth: `${treeWidth}px` }}
      >
        {/* Tree header */}
        <div className="flex h-8 items-center justify-between border-b border-border/50 px-2">
          <span className="text-xs font-medium text-muted-foreground">Files</span>
          <button
            type="button"
            className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title="Refresh file tree"
            onClick={fetchTree}
          >
            <RefreshCw className={cn("h-3 w-3", treeLoading && "animate-spin")} />
          </button>
        </div>

        {/* Tree content */}
        {treeLoading && tree.length === 0 ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : treeError ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center">
            <AlertCircle className="h-6 w-6 text-destructive" />
            <p className="text-xs text-muted-foreground">Failed to load files</p>
            <Button size="sm" variant="outline" onClick={fetchTree}>
              Retry
            </Button>
          </div>
        ) : (
          <FileTree
            tree={tree}
            activeFilePath={activeFilePath}
            dirtyFilePaths={dirtyFilePaths}
            gitStatusMap={gitStatusMap}
            onFileSelect={openFile}
            onToggleExpand={toggleExpand}
            className="flex-1"
            onNewFile={handleNewFile}
            onNewFolder={handleNewFolder}
            onRename={handleRename}
            onDelete={handleDelete}
            onMove={handleMove}
          />
        )}
      </div>

      {/* ── Resize Divider ───────────────────────────────────────────────── */}
      <div
        className="group relative w-px cursor-col-resize bg-border/50 transition-colors hover:bg-primary/50 active:bg-primary"
        onMouseDown={handleDividerMouseDown}
        style={{ userSelect: "none" }}
      />

      {/* ── Editor Panel ────────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* File tab bar */}
        <FileTabBar
          openFiles={openFiles}
          activeFilePath={activeFilePath}
          onActivate={setActiveFilePath}
          onClose={closeFile}
        />

        {/* Editor toolbar */}
        {activeFile && !activeFile.isBinary && (
          <div className="flex h-7 items-center justify-between border-b border-border/50 px-2">
            <span className="text-xs text-muted-foreground truncate">
              {activeFile.path}
            </span>
            <div className="flex items-center gap-1">
              {isMarkdown(activeFile.path) && (
                <button
                  type="button"
                  className={cn(
                    "rounded px-2 py-0.5 text-xs transition-colors",
                    markdownPreviewPaths.has(activeFile.path)
                      ? "bg-primary/20 text-primary"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  )}
                  onClick={() => toggleMarkdownPreview(activeFile.path)}
                >
                  {markdownPreviewPaths.has(activeFile.path) ? "Edit" : "Preview"}
                </button>
              )}
              {activeFile.isDirty && (
                <button
                  type="button"
                  disabled={isSaving}
                  className={cn(
                    "flex items-center gap-1 rounded px-2 py-0.5 text-xs transition-colors",
                    "bg-primary/20 text-primary hover:bg-primary/30"
                  )}
                  onClick={() => handleSave(activeFile.path)}
                >
                  {isSaving ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : null}
                  Save
                  <span className="text-[10px] opacity-60">⌘S</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* Save error banner */}
        {saveError && (
          <div className="flex items-center gap-2 border-b border-destructive/50 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
            <AlertCircle className="h-3 w-3 shrink-0" />
            {saveError}
          </div>
        )}

        {/* Content area */}
        <div className="flex flex-1 overflow-hidden">
          {!activeFile ? (
            /* Empty state */
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
              <FolderOpen className="h-10 w-10 text-muted-foreground/30" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Select a file to view
                </p>
                <p className="text-xs text-muted-foreground/60">
                  Click a file in the tree to open it
                </p>
              </div>
            </div>
          ) : activeFile.isLoading ? (
            <div className="flex flex-1 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : activeFile.error ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
              <AlertCircle className="h-8 w-8 text-destructive" />
              <p className="text-sm text-muted-foreground">{activeFile.error}</p>
            </div>
          ) : activeFile.isImage ? (
            <ImagePreview
              path={activeFile.path}
              content={activeFile.content}
              isBinary={activeFile.isBinary}
              isSvg={activeFile.isSvg}
              mime={activeFile.mime}
            />
          ) : activeFile.isBinary ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
              <p className="text-sm text-muted-foreground">Binary file</p>
              <p className="text-xs text-muted-foreground/60">
                Cannot display binary files in the editor
              </p>
            </div>
          ) : showMarkdownPreview ? (
            <MarkdownPreview content={activeFile.content} className="flex-1" />
          ) : (
            <MonacoEditorWrapper
              content={activeFile.content}
              language={activeFile.language}
              filePath={activeFile.path}
              readOnly={activeFile.isLoading}
              onChange={(value) => updateContent(activeFile.path, value)}
              onSave={() => handleSave(activeFile.path)}
              gitBeforeContent={gitBeforeContent}
            />
          )}
        </div>
      </div>

      {/* ── File Operation Dialogs ───────────────────────────────────────── */}
      <FileOperationDialogs
        dialogState={dialogState}
        onClose={() => setDialogState({ type: "idle" })}
        onSuccess={handleDialogSuccess}
        sessionId={sessionId}
        instanceId={instanceId}
        tree={tree}
      />
    </div>
  );
}
