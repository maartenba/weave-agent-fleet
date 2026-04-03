"use client";

import { useState, useCallback, useRef } from "react";
import { apiFetch } from "@/lib/api-client";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface FileTreeNode {
  name: string;
  /** Path relative to workspace root, e.g. "src/index.ts" */
  path: string;
  type: "file" | "directory";
  size?: number;
  children?: FileTreeNode[];
  isExpanded?: boolean;
}

/** @internal — exported for unit testing only */
export interface FlatFileEntry {
  path: string;
  type: "file" | "directory";
  size?: number;
}

export interface UseFileTreeResult {
  /** Root-level nodes of the file tree. */
  tree: FileTreeNode[];
  isLoading: boolean;
  error?: string;
  /** Fetch (or re-fetch) the file tree from the server. Returns a promise that resolves when the tree state is updated. */
  fetchTree: () => Promise<void>;
  /** Toggle a directory's expanded state. */
  toggleExpand: (path: string) => void;
  /**
   * Expand all ancestor directories of the given path so a newly created or
   * renamed file is visible in the tree.
   * e.g. expandTo("src/components/deep/file.ts") expands "src", "src/components",
   * and "src/components/deep".
   */
  expandTo: (path: string) => void;
}

// ─── Flat → Tree transformation ─────────────────────────────────────────────

/** @internal — exported for unit testing only */
export function buildTree(entries: FlatFileEntry[]): FileTreeNode[] {
  const root: FileTreeNode[] = [];
  const nodeMap = new Map<string, FileTreeNode>();

  // Sort: directories first, then files; alphabetically within each group
  const sorted = [...entries].sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.path.localeCompare(b.path);
  });

  for (const entry of sorted) {
    const parts = entry.path.split("/");
    const name = parts[parts.length - 1];

    const node: FileTreeNode = {
      name,
      path: entry.path,
      type: entry.type,
      size: entry.size,
      isExpanded: parts.length <= 2, // Auto-expand first 2 levels
      children: entry.type === "directory" ? [] : undefined,
    };

    nodeMap.set(entry.path, node);

    if (parts.length === 1) {
      root.push(node);
    } else {
      // Find parent directory
      const parentPath = parts.slice(0, -1).join("/");
      const parent = nodeMap.get(parentPath);
      if (parent?.children) {
        parent.children.push(node);
      } else {
        // Parent directory wasn't in the list (shouldn't happen, but handle gracefully)
        root.push(node);
      }
    }
  }

  return root;
}

// ─── Hook ───────────────────────────────────────────────────────────────────

/**
 * Fetches and caches the file tree for a session's workspace.
 * Call `fetchTree()` when the Files tab is activated.
 * Flat file list from the API is transformed into a nested tree on the client.
 */
export function useFileTree(
  sessionId: string,
  instanceId: string
): UseFileTreeResult {
  const [tree, setTree] = useState<FileTreeNode[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const isMounted = useRef(true);

  const fetchTree = useCallback(async () => {
    if (!sessionId || !instanceId) return;
    setIsLoading(true);
    setError(undefined);

    try {
      const url = `/api/sessions/${encodeURIComponent(sessionId)}/files?instanceId=${encodeURIComponent(instanceId)}`;
      const response = await apiFetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = (await response.json()) as {
        root: string;
        files: FlatFileEntry[];
      };

      if (isMounted.current) {
        setTree(buildTree(data.files));
        setError(undefined);
      }
    } catch (err) {
      if (isMounted.current) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (isMounted.current) {
        setIsLoading(false);
      }
    }
  }, [sessionId, instanceId]);

  const toggleExpand = useCallback((path: string) => {
    setTree((prev) => {
      // Deep-clone and toggle the matching node
      function toggle(nodes: FileTreeNode[]): FileTreeNode[] {
        return nodes.map((node) => {
          if (node.path === path) {
            return { ...node, isExpanded: !node.isExpanded };
          }
          if (node.children) {
            return { ...node, children: toggle(node.children) };
          }
          return node;
        });
      }
      return toggle(prev);
    });
  }, []);

  const expandTo = useCallback((path: string) => {
    // Compute all ancestor paths for the given path
    const parts = path.split("/");
    const ancestorPaths = new Set<string>();
    for (let i = 1; i < parts.length; i++) {
      ancestorPaths.add(parts.slice(0, i).join("/"));
    }

    setTree((prev) => {
      function expandNodes(nodes: FileTreeNode[]): FileTreeNode[] {
        return nodes.map((node) => {
          if (ancestorPaths.has(node.path)) {
            const updated = { ...node, isExpanded: true };
            if (updated.children) {
              updated.children = expandNodes(updated.children);
            }
            return updated;
          }
          if (node.children) {
            return { ...node, children: expandNodes(node.children) };
          }
          return node;
        });
      }
      return expandNodes(prev);
    });
  }, []);

  return { tree, isLoading, error, fetchTree, toggleExpand, expandTo };
}
