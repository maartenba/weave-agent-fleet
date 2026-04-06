"use client";

import { memo } from "react";
import type { LucideIcon } from "lucide-react";
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  FileText,
  FileCode,
  FileImage,
  FileType,
  FileKey,
  FileLock,
  FileCog,
  Hash,
  Terminal,
  Database,
  Globe,
  Braces,
  Gem,
  Flame,
  Cog,
  BookOpen,
  Lock,
  Shield,
  Package,
  Box,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { FileTreeNode } from "@/hooks/use-file-tree";
import type { GitStatusMap } from "@/lib/git-status-utils";
import { cn } from "@/lib/utils";
import { FileTreeContextMenu } from "@/components/session/file-tree-context-menu";

// ─── File icon mapping ───────────────────────────────────────────────────────

type FileIconDef = { icon: LucideIcon; className: string };

const ICON_BASE = "h-3.5 w-3.5 shrink-0";

/** Extension → icon + color mapping for specific file types */
const EXTENSION_ICON_MAP: Record<string, FileIconDef> = {
  // TypeScript
  ts:   { icon: FileCode, className: `${ICON_BASE} text-blue-500` },
  tsx:  { icon: FileCode, className: `${ICON_BASE} text-blue-500` },
  // JavaScript
  js:   { icon: FileCode, className: `${ICON_BASE} text-yellow-500` },
  jsx:  { icon: FileCode, className: `${ICON_BASE} text-yellow-500` },
  mjs:  { icon: FileCode, className: `${ICON_BASE} text-yellow-500` },
  cjs:  { icon: FileCode, className: `${ICON_BASE} text-yellow-500` },
  // Python
  py:   { icon: FileCode, className: `${ICON_BASE} text-green-500` },
  pyw:  { icon: FileCode, className: `${ICON_BASE} text-green-500` },
  pyi:  { icon: FileCode, className: `${ICON_BASE} text-green-500` },
  // Ruby
  rb:   { icon: Gem, className: `${ICON_BASE} text-red-500` },
  // Rust
  rs:   { icon: Cog, className: `${ICON_BASE} text-orange-500` },
  // Go
  go:   { icon: FileCode, className: `${ICON_BASE} text-cyan-500` },
  // Java / Kotlin
  java: { icon: FileCode, className: `${ICON_BASE} text-orange-600` },
  kt:   { icon: FileCode, className: `${ICON_BASE} text-purple-500` },
  kts:  { icon: FileCode, className: `${ICON_BASE} text-purple-500` },
  // C#
  cs:   { icon: FileCode, className: `${ICON_BASE} text-green-600` },
  csx:  { icon: FileCode, className: `${ICON_BASE} text-green-600` },
  // F#
  fs:   { icon: FileCode, className: `${ICON_BASE} text-blue-400` },
  fsx:  { icon: FileCode, className: `${ICON_BASE} text-blue-400` },
  // C / C++
  c:    { icon: FileCode, className: `${ICON_BASE} text-blue-600` },
  h:    { icon: FileCode, className: `${ICON_BASE} text-blue-600` },
  cpp:  { icon: FileCode, className: `${ICON_BASE} text-blue-700` },
  cc:   { icon: FileCode, className: `${ICON_BASE} text-blue-700` },
  hpp:  { icon: FileCode, className: `${ICON_BASE} text-blue-700` },
  // Swift
  swift: { icon: FileCode, className: `${ICON_BASE} text-orange-500` },
  // PHP
  php:  { icon: FileCode, className: `${ICON_BASE} text-indigo-400` },
  // Lua
  lua:  { icon: FileCode, className: `${ICON_BASE} text-blue-500` },
  // Scala
  scala: { icon: FileCode, className: `${ICON_BASE} text-red-600` },
  // Zig
  zig:  { icon: FileCode, className: `${ICON_BASE} text-amber-500` },
  // Shell
  sh:   { icon: Terminal, className: `${ICON_BASE} text-green-400` },
  bash: { icon: Terminal, className: `${ICON_BASE} text-green-400` },
  zsh:  { icon: Terminal, className: `${ICON_BASE} text-green-400` },
  fish: { icon: Terminal, className: `${ICON_BASE} text-green-400` },
  ps1:  { icon: Terminal, className: `${ICON_BASE} text-blue-400` },
  // CSS / Styling
  css:  { icon: Hash, className: `${ICON_BASE} text-blue-500` },
  scss: { icon: Hash, className: `${ICON_BASE} text-pink-500` },
  less: { icon: Hash, className: `${ICON_BASE} text-indigo-500` },
  // HTML
  html: { icon: Globe, className: `${ICON_BASE} text-orange-500` },
  htm:  { icon: Globe, className: `${ICON_BASE} text-orange-500` },
  // XML / SVG
  xml:  { icon: FileCode, className: `${ICON_BASE} text-orange-400` },
  svg:  { icon: FileImage, className: `${ICON_BASE} text-yellow-500` },
  // SQL / GraphQL
  sql:  { icon: Database, className: `${ICON_BASE} text-yellow-600` },
  graphql: { icon: Braces, className: `${ICON_BASE} text-pink-500` },
  gql:  { icon: Braces, className: `${ICON_BASE} text-pink-500` },
  // JSON
  json:  { icon: Braces, className: `${ICON_BASE} text-yellow-500` },
  jsonc: { icon: Braces, className: `${ICON_BASE} text-yellow-500` },
  json5: { icon: Braces, className: `${ICON_BASE} text-yellow-500` },
  // YAML / TOML / Config
  yaml: { icon: FileCog, className: `${ICON_BASE} text-purple-400` },
  yml:  { icon: FileCog, className: `${ICON_BASE} text-purple-400` },
  toml: { icon: FileCog, className: `${ICON_BASE} text-gray-400` },
  ini:  { icon: FileCog, className: `${ICON_BASE} text-gray-400` },
  cfg:  { icon: FileCog, className: `${ICON_BASE} text-gray-400` },
  conf: { icon: FileCog, className: `${ICON_BASE} text-gray-400` },
  // Markdown / Docs
  md:       { icon: BookOpen, className: `${ICON_BASE} text-blue-400` },
  mdx:      { icon: BookOpen, className: `${ICON_BASE} text-blue-400` },
  txt:      { icon: FileText, className: `${ICON_BASE} text-muted-foreground` },
  rst:      { icon: FileText, className: `${ICON_BASE} text-muted-foreground` },
  // Images
  png:  { icon: FileImage, className: `${ICON_BASE} text-purple-400` },
  jpg:  { icon: FileImage, className: `${ICON_BASE} text-purple-400` },
  jpeg: { icon: FileImage, className: `${ICON_BASE} text-purple-400` },
  gif:  { icon: FileImage, className: `${ICON_BASE} text-purple-400` },
  webp: { icon: FileImage, className: `${ICON_BASE} text-purple-400` },
  bmp:  { icon: FileImage, className: `${ICON_BASE} text-purple-400` },
  ico:  { icon: FileImage, className: `${ICON_BASE} text-purple-400` },
  // Infrastructure
  dockerfile: { icon: Box, className: `${ICON_BASE} text-blue-400` },
  makefile:   { icon: Cog, className: `${ICON_BASE} text-orange-400` },
  cmake:      { icon: Cog, className: `${ICON_BASE} text-orange-400` },
  tf:   { icon: FileCog, className: `${ICON_BASE} text-purple-500` },
  hcl:  { icon: FileCog, className: `${ICON_BASE} text-purple-500` },
  // Lock files
  lock: { icon: FileLock, className: `${ICON_BASE} text-yellow-600` },
  // Env / secrets
  env:  { icon: FileKey, className: `${ICON_BASE} text-yellow-500` },
  // Certificates / keys
  pem:  { icon: Shield, className: `${ICON_BASE} text-green-500` },
  crt:  { icon: Shield, className: `${ICON_BASE} text-green-500` },
  key:  { icon: Lock, className: `${ICON_BASE} text-red-400` },
  // Fonts
  woff:  { icon: FileType, className: `${ICON_BASE} text-muted-foreground` },
  woff2: { icon: FileType, className: `${ICON_BASE} text-muted-foreground` },
  ttf:   { icon: FileType, className: `${ICON_BASE} text-muted-foreground` },
  otf:   { icon: FileType, className: `${ICON_BASE} text-muted-foreground` },
  // Archives
  zip:  { icon: Package, className: `${ICON_BASE} text-amber-600` },
  tar:  { icon: Package, className: `${ICON_BASE} text-amber-600` },
  gz:   { icon: Package, className: `${ICON_BASE} text-amber-600` },
  tgz:  { icon: Package, className: `${ICON_BASE} text-amber-600` },
  // Log files
  log:  { icon: FileText, className: `${ICON_BASE} text-gray-400` },
};

/** Filename → icon mapping for special config/dotfiles */
const FILENAME_ICON_MAP: Record<string, FileIconDef> = {
  "dockerfile":       { icon: Box, className: `${ICON_BASE} text-blue-400` },
  "docker-compose.yml": { icon: Box, className: `${ICON_BASE} text-blue-400` },
  "docker-compose.yaml": { icon: Box, className: `${ICON_BASE} text-blue-400` },
  "makefile":         { icon: Cog, className: `${ICON_BASE} text-orange-400` },
  "cmakelists.txt":   { icon: Cog, className: `${ICON_BASE} text-orange-400` },
  ".gitignore":       { icon: FileCog, className: `${ICON_BASE} text-gray-500` },
  ".gitmodules":      { icon: FileCog, className: `${ICON_BASE} text-gray-500` },
  ".gitattributes":   { icon: FileCog, className: `${ICON_BASE} text-gray-500` },
  ".editorconfig":    { icon: FileCog, className: `${ICON_BASE} text-gray-500` },
  ".prettierrc":      { icon: FileCog, className: `${ICON_BASE} text-purple-400` },
  ".prettierignore":  { icon: FileCog, className: `${ICON_BASE} text-purple-400` },
  ".eslintrc":        { icon: FileCog, className: `${ICON_BASE} text-purple-500` },
  ".eslintignore":    { icon: FileCog, className: `${ICON_BASE} text-purple-500` },
  ".npmrc":           { icon: FileCog, className: `${ICON_BASE} text-red-400` },
  ".nvmrc":           { icon: FileCog, className: `${ICON_BASE} text-green-500` },
  ".env":             { icon: FileKey, className: `${ICON_BASE} text-yellow-500` },
  ".env.local":       { icon: FileKey, className: `${ICON_BASE} text-yellow-500` },
  ".env.development": { icon: FileKey, className: `${ICON_BASE} text-yellow-500` },
  ".env.production":  { icon: FileKey, className: `${ICON_BASE} text-yellow-500` },
  "package.json":     { icon: Package, className: `${ICON_BASE} text-green-500` },
  "package-lock.json": { icon: FileLock, className: `${ICON_BASE} text-yellow-600` },
  "yarn.lock":        { icon: FileLock, className: `${ICON_BASE} text-blue-400` },
  "pnpm-lock.yaml":   { icon: FileLock, className: `${ICON_BASE} text-yellow-600` },
  "bun.lockb":        { icon: FileLock, className: `${ICON_BASE} text-amber-400` },
  "cargo.toml":       { icon: Package, className: `${ICON_BASE} text-orange-500` },
  "cargo.lock":       { icon: FileLock, className: `${ICON_BASE} text-orange-400` },
  "gemfile":          { icon: Gem, className: `${ICON_BASE} text-red-500` },
  "gemfile.lock":     { icon: FileLock, className: `${ICON_BASE} text-red-400` },
  "go.mod":           { icon: Package, className: `${ICON_BASE} text-cyan-500` },
  "go.sum":           { icon: FileLock, className: `${ICON_BASE} text-cyan-400` },
  "tsconfig.json":    { icon: FileCog, className: `${ICON_BASE} text-blue-500` },
  "tailwind.config.ts":  { icon: FileCog, className: `${ICON_BASE} text-cyan-400` },
  "tailwind.config.js":  { icon: FileCog, className: `${ICON_BASE} text-cyan-400` },
  "next.config.ts":   { icon: FileCog, className: `${ICON_BASE} text-muted-foreground` },
  "next.config.js":   { icon: FileCog, className: `${ICON_BASE} text-muted-foreground` },
  "next.config.mjs":  { icon: FileCog, className: `${ICON_BASE} text-muted-foreground` },
  "vite.config.ts":   { icon: Flame, className: `${ICON_BASE} text-yellow-500` },
  "vite.config.js":   { icon: Flame, className: `${ICON_BASE} text-yellow-500` },
  "vitest.config.ts": { icon: Flame, className: `${ICON_BASE} text-yellow-500` },
  "vitest.config.js": { icon: Flame, className: `${ICON_BASE} text-yellow-500` },
  "license":          { icon: BookOpen, className: `${ICON_BASE} text-yellow-500` },
  "license.md":       { icon: BookOpen, className: `${ICON_BASE} text-yellow-500` },
  "readme.md":        { icon: BookOpen, className: `${ICON_BASE} text-blue-400` },
  "changelog.md":     { icon: BookOpen, className: `${ICON_BASE} text-green-400` },
};

const DEFAULT_ICON: FileIconDef = { icon: FileText, className: `${ICON_BASE} text-muted-foreground` };

function getFileIcon(fileName: string): React.ReactNode {
  const lowerName = fileName.toLowerCase();

  // 1. Exact filename match first (highest specificity)
  const filenameMatch = FILENAME_ICON_MAP[lowerName];
  if (filenameMatch) {
    const Icon = filenameMatch.icon;
    return <Icon className={filenameMatch.className} />;
  }

  // 2. Handle compound extensions like .env.local, .d.ts etc.
  //    and dotfiles like .gitignore → check if full name (without leading dot) matches
  if (lowerName.startsWith(".env")) {
    const envDef = EXTENSION_ICON_MAP["env"];
    if (envDef) {
      const Icon = envDef.icon;
      return <Icon className={envDef.className} />;
    }
  }

  // 3. Extension-based lookup
  const ext = lowerName.split(".").pop() ?? "";
  const extMatch = EXTENSION_ICON_MAP[ext];
  if (extMatch) {
    const Icon = extMatch.icon;
    return <Icon className={extMatch.className} />;
  }

  // 4. Fallback
  const Icon = DEFAULT_ICON.icon;
  return <Icon className={DEFAULT_ICON.className} />;
}

// ─── Git status color helper ─────────────────────────────────────────────────

function gitStatusColorClass(status: "added" | "modified" | "deleted" | undefined): string {
  switch (status) {
    case "added": return "text-green-500 dark:text-green-400";
    case "modified": return "text-amber-500 dark:text-amber-400";
    case "deleted": return "text-red-500 dark:text-red-400";
    default: return "";
  }
}

// ─── TreeNode component ──────────────────────────────────────────────────────

interface TreeNodeProps {
  node: FileTreeNode;
  depth: number;
  activeFilePath: string | null;
  dirtyFilePaths: Set<string>;
  gitStatusMap?: GitStatusMap;
  onFileSelect: (path: string) => void;
  onToggleExpand: (path: string) => void;
  onNewFile?: (parentPath: string) => void;
  onNewFolder?: (parentPath: string) => void;
  onRename?: (node: FileTreeNode) => void;
  onDelete?: (node: FileTreeNode) => void;
  onMove?: (node: FileTreeNode) => void;
}

const TreeNode = memo(function TreeNode({
  node,
  depth,
  activeFilePath,
  dirtyFilePaths,
  gitStatusMap,
  onFileSelect,
  onToggleExpand,
  onNewFile,
  onNewFolder,
  onRename,
  onDelete,
  onMove,
}: TreeNodeProps) {
  const isActive = node.path === activeFilePath;
  const isDirty = dirtyFilePaths.has(node.path);
  const isHidden = node.name.startsWith(".");
  const indent = depth * 12; // 12px per level

  // Provide no-op defaults so FileTreeContextMenu callbacks are always functions
  const handleNewFile = onNewFile ?? (() => {});
  const handleNewFolder = onNewFolder ?? (() => {});
  const handleRename = onRename ?? (() => {});
  const handleDelete = onDelete ?? (() => {});
  const handleMove = onMove ?? (() => {});

  if (node.type === "directory") {
    return (
      <div>
        <FileTreeContextMenu
          node={node}
          onNewFile={handleNewFile}
          onNewFolder={handleNewFolder}
          onRename={handleRename}
          onDelete={handleDelete}
          onMove={handleMove}
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
            <span className={cn("truncate font-medium", isHidden && "opacity-60", gitStatusColorClass(gitStatusMap?.get(node.path)))}>{node.name}</span>
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
                gitStatusMap={gitStatusMap}
                onFileSelect={onFileSelect}
                onToggleExpand={onToggleExpand}
                onNewFile={onNewFile}
                onNewFolder={onNewFolder}
                onRename={onRename}
                onDelete={onDelete}
                onMove={onMove}
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
      onMove={handleMove}
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
        <span className={cn("flex-1 truncate font-mono", isHidden && "opacity-60", gitStatusColorClass(gitStatusMap?.get(node.path)))}>{node.name}</span>
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
  gitStatusMap?: GitStatusMap;
  onFileSelect: (path: string) => void;
  onToggleExpand: (path: string) => void;
  className?: string;
  onNewFile?: (parentPath: string) => void;
  onNewFolder?: (parentPath: string) => void;
  onRename?: (node: FileTreeNode) => void;
  onDelete?: (node: FileTreeNode) => void;
  onMove?: (node: FileTreeNode) => void;
}

export function FileTree({
  tree,
  activeFilePath,
  dirtyFilePaths,
  gitStatusMap,
  onFileSelect,
  onToggleExpand,
  className,
  onNewFile,
  onNewFolder,
  onRename,
  onDelete,
  onMove,
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
  const handleMove = onMove ?? (() => {});

  return (
    <FileTreeContextMenu
      node={null}
      onNewFile={handleNewFile}
      onNewFolder={handleNewFolder}
      onRename={handleRename}
      onDelete={handleDelete}
      onMove={handleMove}
    >
      <ScrollArea className={cn("flex-1 overflow-hidden", className)}>
        <div className="py-1 pr-1">
          {tree.map((node) => (
            <TreeNode
              key={node.path}
              node={node}
              depth={0}
              activeFilePath={activeFilePath}
              dirtyFilePaths={dirtyFilePaths}
              gitStatusMap={gitStatusMap}
              onFileSelect={onFileSelect}
              onToggleExpand={onToggleExpand}
              onNewFile={onNewFile}
              onNewFolder={onNewFolder}
              onRename={onRename}
              onDelete={onDelete}
              onMove={onMove}
            />
          ))}
        </div>
      </ScrollArea>
    </FileTreeContextMenu>
  );
}
