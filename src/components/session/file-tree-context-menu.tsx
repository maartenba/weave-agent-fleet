"use client";

import { FilePlus, FolderPlus, FolderInput, Pencil, Trash2 } from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { FileTreeNode } from "@/hooks/use-file-tree";

export interface FileTreeContextMenuProps {
  /** The tree node being right-clicked. `null` means the empty root area. */
  node: FileTreeNode | null;
  onNewFile: (parentPath: string) => void;
  onNewFolder: (parentPath: string) => void;
  onRename: (node: FileTreeNode) => void;
  onDelete: (node: FileTreeNode) => void;
  onMove?: (node: FileTreeNode) => void;
  children: React.ReactNode;
}

/**
 * Wraps a tree node (or the root area) with a Radix ContextMenu.
 *
 * Menu items shown per node type:
 * - null (root area): New File, New Folder
 * - directory: New File, New Folder, ─, Rename, ─, Delete
 * - file: Rename, ─, Delete
 */
export function FileTreeContextMenu({
  node,
  onNewFile,
  onNewFolder,
  onRename,
  onDelete,
  onMove,
  children,
}: FileTreeContextMenuProps) {
  /** Parent path for "new file/folder" actions — empty string = workspace root. */
  const parentPath =
    node === null
      ? ""
      : node.type === "directory"
        ? node.path
        : node.path.includes("/")
          ? node.path.substring(0, node.path.lastIndexOf("/"))
          : "";

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        {/* New File / New Folder — shown for root and directories */}
        {(node === null || node.type === "directory") && (
          <>
            <ContextMenuItem onSelect={() => onNewFile(parentPath)}>
              <FilePlus />
              New File
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => onNewFolder(parentPath)}>
              <FolderPlus />
              New Folder
            </ContextMenuItem>
          </>
        )}

        {/* Rename / Delete — shown for existing nodes */}
        {node !== null && (
          <>
            {node.type === "directory" && <ContextMenuSeparator />}
            <ContextMenuItem onSelect={() => onRename(node)}>
              <Pencil />
              Rename
              <ContextMenuShortcut>F2</ContextMenuShortcut>
            </ContextMenuItem>
            {onMove && (
              <ContextMenuItem onSelect={() => onMove(node)}>
                <FolderInput />
                Move to…
              </ContextMenuItem>
            )}
            <ContextMenuSeparator />
            <ContextMenuItem
              variant="destructive"
              onSelect={() => onDelete(node)}
            >
              <Trash2 />
              Delete
              <ContextMenuShortcut>Del</ContextMenuShortcut>
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
