"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { validateFileName } from "@/lib/file-name-validation";
import {
  createFile,
  createFolder,
  renameFile,
  deleteFile,
} from "@/lib/file-operations";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Folder } from "lucide-react";
import type { FileTreeNode } from "@/hooks/use-file-tree";

// ─── Discriminated union for dialog state ────────────────────────────────────

export type DialogState =
  | { type: "idle" }
  | { type: "create-file"; parentPath: string }
  | { type: "create-folder"; parentPath: string }
  | { type: "rename"; node: FileTreeNode }
  | { type: "delete"; node: FileTreeNode }
  | { type: "move"; node: FileTreeNode };

// ─── Props ───────────────────────────────────────────────────────────────────

export interface FileOperationDialogsProps {
  dialogState: DialogState;
  onClose: () => void;
  /**
   * Called after a successful operation.
   * @param action  One of: "create-file" | "create-folder" | "rename" | "delete" | "move"
   * @param path    The primary path affected (new path for create/rename, deleted path for delete)
   * @param newPath Only set for rename/move — the new path of the item
   */
  onSuccess: (action: string, path: string, newPath?: string) => void;
  sessionId: string;
  instanceId: string;
  /** Full file tree — used by MoveDialog for directory selection */
  tree?: FileTreeNode[];
}

// ─── Create dialog (file or folder) ─────────────────────────────────────────

function CreateDialog({
  dialogState,
  onClose,
  onSuccess,
  sessionId,
  instanceId,
}: FileOperationDialogsProps & {
  dialogState: { type: "create-file" | "create-folder"; parentPath: string };
}) {
  const isFile = dialogState.type === "create-file";
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | undefined>();
  const [isLoading, setIsLoading] = useState(false);
  const [apiError, setApiError] = useState<string | undefined>();

  // Reset state when dialog opens
  useEffect(() => {
    setName("");
    setNameError(undefined);
    setApiError(undefined);
    setIsLoading(false);
  }, [dialogState.type, dialogState.parentPath]);

  function handleNameChange(value: string) {
    setName(value);
    const result = validateFileName(value);
    setNameError(result.valid ? undefined : result.error);
  }

  async function handleSubmit() {
    const result = validateFileName(name);
    if (!result.valid) {
      setNameError(result.error);
      return;
    }

    const fullPath = dialogState.parentPath
      ? `${dialogState.parentPath}/${name}`
      : name;

    setIsLoading(true);
    setApiError(undefined);
    try {
      if (isFile) {
        await createFile(sessionId, instanceId, fullPath);
        onSuccess("create-file", fullPath);
      } else {
        await createFolder(sessionId, instanceId, fullPath);
        onSuccess("create-folder", fullPath);
      }
      onClose();
    } catch (err) {
      setApiError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isFile ? "New File" : "New Folder"}</DialogTitle>
          <DialogDescription>
            {dialogState.parentPath
              ? `Create inside "${dialogState.parentPath}"`
              : "Create in workspace root"}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2 py-2">
          <Input
            autoFocus
            placeholder={isFile ? "filename.ts" : "folder-name"}
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSubmit();
              if (e.key === "Escape") onClose();
            }}
          />
          {nameError && (
            <p className="text-destructive text-xs">{nameError}</p>
          )}
          {apiError && (
            <p className="text-destructive text-xs">{apiError}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isLoading || !name || !!nameError}
          >
            {isLoading ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Rename dialog ───────────────────────────────────────────────────────────

function RenameDialog({
  dialogState,
  onClose,
  onSuccess,
  sessionId,
  instanceId,
}: FileOperationDialogsProps & {
  dialogState: { type: "rename"; node: FileTreeNode };
}) {
  const { node } = dialogState;
  const [name, setName] = useState(node.name);
  const [nameError, setNameError] = useState<string | undefined>();
  const [isLoading, setIsLoading] = useState(false);
  const [apiError, setApiError] = useState<string | undefined>();

  // Reset when target node changes
  useEffect(() => {
    setName(node.name);
    setNameError(undefined);
    setApiError(undefined);
    setIsLoading(false);
  }, [node.path, node.name]);

  function handleNameChange(value: string) {
    setName(value);
    const result = validateFileName(value);
    setNameError(result.valid ? undefined : result.error);
  }

  async function handleSubmit() {
    const result = validateFileName(name);
    if (!result.valid) {
      setNameError(result.error);
      return;
    }

    // Replace last path segment with the new name
    const parts = node.path.split("/");
    parts[parts.length - 1] = name;
    const newPath = parts.join("/");

    if (newPath === node.path) {
      onClose();
      return;
    }

    setIsLoading(true);
    setApiError(undefined);
    try {
      await renameFile(sessionId, instanceId, node.path, newPath);
      onSuccess("rename", node.path, newPath);
      onClose();
    } catch (err) {
      setApiError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename</DialogTitle>
          <DialogDescription>
            Rename &quot;{node.name}&quot;
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2 py-2">
          <Input
            autoFocus
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSubmit();
              if (e.key === "Escape") onClose();
            }}
          />
          {nameError && (
            <p className="text-destructive text-xs">{nameError}</p>
          )}
          {apiError && (
            <p className="text-destructive text-xs">{apiError}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isLoading || !name || !!nameError || name === node.name}
          >
            {isLoading ? "Renaming…" : "Rename"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Delete dialog ───────────────────────────────────────────────────────────

function DeleteDialog({
  dialogState,
  onClose,
  onSuccess,
  sessionId,
  instanceId,
}: FileOperationDialogsProps & {
  dialogState: { type: "delete"; node: FileTreeNode };
}) {
  const { node } = dialogState;
  const [isLoading, setIsLoading] = useState(false);
  const [apiError, setApiError] = useState<string | undefined>();

  useEffect(() => {
    setApiError(undefined);
    setIsLoading(false);
  }, [node.path]);

  async function handleDelete() {
    setIsLoading(true);
    setApiError(undefined);
    try {
      await deleteFile(sessionId, instanceId, node.path);
      onSuccess("delete", node.path);
      onClose();
    } catch (err) {
      setApiError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {node.type === "directory" ? "Folder" : "File"}</DialogTitle>
          <DialogDescription>
            {node.type === "directory" ? (
              <>
                This will permanently delete the folder{" "}
                <strong>{node.name}</strong> and all its contents. This action
                cannot be undone.
              </>
            ) : (
              <>
                This will permanently delete <strong>{node.name}</strong>. This
                action cannot be undone.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {apiError && (
          <p className="text-destructive text-xs px-1">{apiError}</p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={isLoading}
          >
            {isLoading ? "Deleting…" : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Move dialog ─────────────────────────────────────────────────────────────

/** Recursively collect all directory paths from a tree. */
function collectDirectories(nodes: FileTreeNode[]): string[] {
  const dirs: string[] = [];
  for (const node of nodes) {
    if (node.type === "directory") {
      dirs.push(node.path);
      if (node.children) {
        dirs.push(...collectDirectories(node.children));
      }
    }
  }
  return dirs;
}

function MoveDialog({
  dialogState,
  onClose,
  onSuccess,
  sessionId,
  instanceId,
  tree,
}: FileOperationDialogsProps & {
  dialogState: { type: "move"; node: FileTreeNode };
}) {
  const { node } = dialogState;
  const [selectedDir, setSelectedDir] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [apiError, setApiError] = useState<string | undefined>();

  // Current parent directory of the node
  const currentParent = node.path.includes("/")
    ? node.path.substring(0, node.path.lastIndexOf("/"))
    : "";

  // Build list of target directories, including root
  const directories = ["", ...collectDirectories(tree ?? [])];

  // Filter out: the node itself (if directory), and any descendants of the node
  const validDirectories = directories.filter((dir) => {
    if (node.type === "directory") {
      // Can't move a directory into itself or its children
      if (dir === node.path || dir.startsWith(node.path + "/")) return false;
    }
    return true;
  });

  useEffect(() => {
    setSelectedDir(null);
    setApiError(undefined);
    setIsLoading(false);
  }, [node.path]);

  const isSameLocation = selectedDir === currentParent;
  const canMove = selectedDir !== null && !isSameLocation;

  async function handleMove() {
    if (selectedDir === null) return;

    const newPath = selectedDir ? `${selectedDir}/${node.name}` : node.name;

    if (newPath === node.path) {
      onClose();
      return;
    }

    setIsLoading(true);
    setApiError(undefined);
    try {
      await renameFile(sessionId, instanceId, node.path, newPath);
      onSuccess("move", node.path, newPath);
      onClose();
    } catch (err) {
      setApiError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move {node.name}</DialogTitle>
          <DialogDescription>
            Select a destination directory
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-64 rounded border border-border">
          <div className="flex flex-col py-1">
            {validDirectories.map((dir) => {
              const isSelected = selectedDir === dir;
              const isCurrent = dir === currentParent;
              const label = dir || "/ (root)";

              return (
                <button
                  key={dir}
                  type="button"
                  className={`flex items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
                    isSelected
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-accent/50"
                  } ${isCurrent ? "text-muted-foreground" : ""}`}
                  onClick={() => setSelectedDir(dir)}
                >
                  <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate font-mono">{label}</span>
                  {isCurrent && (
                    <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                      (current)
                    </span>
                  )}
                </button>
              );
            })}
            {validDirectories.length === 0 && (
              <p className="px-3 py-2 text-xs text-muted-foreground">
                No valid destinations
              </p>
            )}
          </div>
        </ScrollArea>

        {apiError && (
          <p className="text-destructive text-xs">{apiError}</p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button onClick={handleMove} disabled={isLoading || !canMove}>
            {isLoading ? "Moving…" : "Move"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Composed orchestrator ───────────────────────────────────────────────────

/**
 * Renders the appropriate dialog (create / rename / delete) based on
 * `dialogState`. Pass `{ type: "idle" }` to render nothing.
 */
export function FileOperationDialogs(props: FileOperationDialogsProps) {
  const { dialogState } = props;

  if (dialogState.type === "idle") return null;

  if (
    dialogState.type === "create-file" ||
    dialogState.type === "create-folder"
  ) {
    return (
      <CreateDialog
        {...props}
        dialogState={dialogState}
      />
    );
  }

  if (dialogState.type === "rename") {
    return <RenameDialog {...props} dialogState={dialogState} />;
  }

  if (dialogState.type === "delete") {
    return <DeleteDialog {...props} dialogState={dialogState} />;
  }

  if (dialogState.type === "move") {
    return <MoveDialog {...props} dialogState={dialogState} />;
  }

  return null;
}
