"use client";

import { memo } from "react";
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  FileText,
  FileCode,
  FileImage,
  FileJson,
  File,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { FileTreeNode } from "@/hooks/use-file-tree";
import { cn } from "@/lib/utils";
import { FileTreeContextMenu } from "@/components/session/file-tree-context-menu";

// ─── File icon mapping ───────────────────────────────────────────────────────

const CODE_EXTENSIONS = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs",
  "py", "rb", "rs", "go", "java", "kt", "cs", "fs",
  "c", "cpp", "cc", "h", "hpp",
  "swift", "php", "lua", "scala", "zig",
  "sh", "bash", "zsh", "fish", "ps1",
  "css", "scss", "less",
  "html", "htm", "xml", "svg",
  "sql", "graphql", "gql",
  "dockerfile", "makefile", "cmake",
  "tf", "hcl",
]);

const IMAGE_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svg",
]);

const JSON_EXTENSIONS = new Set(["json", "jsonc", "json5"]);

function getFileIcon(fileName: string): React.ReactNode {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (IMAGE_EXTENSIONS.has(ext)) {
    return <FileImage className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
  }
  if (JSON_EXTENSIONS.has(ext)) {
    return <FileJson className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
  }
  if (CODE_EXTENSIONS.has(ext)) {
    return <FileCode className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
  }
  return <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
}

// Suppress unused import warning — File is referenced via JSX above in getFileIcon fallback
void File;

// ─── TreeNode component ──────────────────────────────────────────────────────

interface TreeNodeProps {
  node: FileTreeNode;
  depth: number;
  activeFilePath: string | null;
  dirtyFilePaths: Set<string>;
  onFileSelect: (path: string) => void;
  onToggleExpand: (path: string) => void;
  onNewFile?: (parentPath: string) => void;
  onNewFolder?: (parentPath: string) => void;
  onRename?: (node: FileTreeNode) => void;
  onDelete?: (node: FileTreeNode) => void;
}

const TreeNode = memo(function TreeNode({
  node,
  depth,
  activeFilePath,
  dirtyFilePaths,
  onFileSelect,
  onToggleExpand,
  onNewFile,
  onNewFolder,
  onRename,
  onDelete,
}: TreeNodeProps) {
  const isActive = node.path === activeFilePath;
  const isDirty = dirtyFilePaths.has(node.path);
  const indent = depth * 12; // 12px per level

  // Provide no-op defaults so FileTreeContextMenu callbacks are always functions
  const handleNewFile = onNewFile ?? (() => {});
  const handleNewFolder = onNewFolder ?? (() => {});
  const handleRename = onRename ?? (() => {});
  const handleDelete = onDelete ?? (() => {});

  if (node.type === "directory") {
    return (
      <div>
        <FileTreeContextMenu
          node={node}
          onNewFile={handleNewFile}
          onNewFolder={handleNewFolder}
          onRename={handleRename}
          onDelete={handleDelete}
        >
          <button
            type="button"
            className={cn(
              "flex w-full items-center gap-1 rounded px-1.5 py-0.5 text-left",
              "text-xs text-muted-foreground transition-colors",
              "hover:bg-accent hover:text-accent-foreground"
            )}
            style={{ paddingLeft: `${4 + indent}px` }}
            onClick={() => onToggleExpand(node.path)}
          >
            {node.isExpanded ? (
              <ChevronDown className="h-3 w-3 shrink-0" />
            ) : (
              <ChevronRight className="h-3 w-3 shrink-0" />
            )}
            {node.isExpanded ? (
              <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            )}
            <span className="truncate font-medium">{node.name}</span>
          </button>
        </FileTreeContextMenu>
        {node.isExpanded && node.children && (
          <div>
            {node.children.map((child) => (
              <TreeNode
                key={child.path}
                node={child}
                depth={depth + 1}
                activeFilePath={activeFilePath}
                dirtyFilePaths={dirtyFilePaths}
                onFileSelect={onFileSelect}
                onToggleExpand={onToggleExpand}
                onNewFile={onNewFile}
                onNewFolder={onNewFolder}
                onRename={onRename}
                onDelete={onDelete}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // File node
  return (
    <FileTreeContextMenu
      node={node}
      onNewFile={handleNewFile}
      onNewFolder={handleNewFolder}
      onRename={handleRename}
      onDelete={handleDelete}
    >
      <button
        type="button"
        className={cn(
          "flex w-full items-center gap-1.5 rounded px-1.5 py-0.5 text-left",
          "text-xs transition-colors",
          isActive
            ? "bg-accent text-accent-foreground"
            : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground"
        )}
        style={{ paddingLeft: `${4 + indent + 16}px` /* extra for no chevron */ }}
        onClick={() => onFileSelect(node.path)}
      >
        {getFileIcon(node.name)}
        <span className="flex-1 truncate font-mono">{node.name}</span>
        {isDirty && (
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
            title="Unsaved changes"
          />
        )}
      </button>
    </FileTreeContextMenu>
  );
});

// ─── FileTree component ──────────────────────────────────────────────────────

interface FileTreeProps {
  tree: FileTreeNode[];
  activeFilePath: string | null;
  dirtyFilePaths: Set<string>;
  onFileSelect: (path: string) => void;
  onToggleExpand: (path: string) => void;
  className?: string;
  onNewFile?: (parentPath: string) => void;
  onNewFolder?: (parentPath: string) => void;
  onRename?: (node: FileTreeNode) => void;
  onDelete?: (node: FileTreeNode) => void;
}

export function FileTree({
  tree,
  activeFilePath,
  dirtyFilePaths,
  onFileSelect,
  onToggleExpand,
  className,
  onNewFile,
  onNewFolder,
  onRename,
  onDelete,
}: FileTreeProps) {
  if (tree.length === 0) {
    return (
      <div
        className={cn(
          "flex flex-1 items-center justify-center",
          className
        )}
      >
        <div className="flex flex-col items-center gap-2 text-center">
          <Folder className="h-8 w-8 text-muted-foreground/40" />
          <p className="text-xs text-muted-foreground">No files found</p>
        </div>
      </div>
    );
  }

  // Root-level context menu (right-clicking empty area below tree nodes)
  const handleNewFile = onNewFile ?? (() => {});
  const handleNewFolder = onNewFolder ?? (() => {});
  const handleRename = onRename ?? (() => {});
  const handleDelete = onDelete ?? (() => {});

  return (
    <FileTreeContextMenu
      node={null}
      onNewFile={handleNewFile}
      onNewFolder={handleNewFolder}
      onRename={handleRename}
      onDelete={handleDelete}
    >
      <ScrollArea className={cn("flex-1", className)}>
        <div className="py-1 pr-1">
          {tree.map((node) => (
            <TreeNode
              key={node.path}
              node={node}
              depth={0}
              activeFilePath={activeFilePath}
              dirtyFilePaths={dirtyFilePaths}
              onFileSelect={onFileSelect}
              onToggleExpand={onToggleExpand}
              onNewFile={onNewFile}
              onNewFolder={onNewFolder}
              onRename={onRename}
              onDelete={onDelete}
            />
          ))}
        </div>
      </ScrollArea>
    </FileTreeContextMenu>
  );
}
