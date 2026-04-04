"use client";

import { useState, useCallback, useRef } from "react";
import { apiFetch } from "@/lib/api-client";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface OpenFile {
  path: string;
  content: string;
  /** Original content at load time — used for dirty detection */
  originalContent: string;
  language: string;
  isBinary: boolean;
  isImage: boolean;
  isSvg: boolean;
  /** Base64 data URI for raster images */
  mime?: string;
  isLoading: boolean;
  error?: string;
  isDirty: boolean;
}

export interface UseFileContentResult {
  openFiles: Map<string, OpenFile>;
  activeFilePath: string | null;
  openFile: (path: string) => Promise<void>;
  closeFile: (path: string) => void;
  setActiveFilePath: (path: string) => void;
  updateContent: (path: string, content: string) => void;
  saveFile: (path: string) => Promise<void>;
  /** Resets content to originalContent (unsaved edits only — no API call) */
  discardChanges: (path: string) => void;
  isSaving: boolean;
  saveError?: string;
  /**
   * Update the path key for an open file after a rename operation.
   * Updates open order and active file path if needed.
   */
  renameOpenFile: (oldPath: string, newPath: string) => void;
  /**
   * Close all open files whose path starts with `pathPrefix/` or equals
   * `pathPrefix`. Used when deleting a directory.
   */
  closeFilesUnderPath: (pathPrefix: string) => void;
}

const MAX_OPEN_FILES = 10;

// ─── Hook ───────────────────────────────────────────────────────────────────

/**
 * Manages multi-file editor state: open files, active file, dirty tracking, and save.
 *
 * Call `openFile(path)` when the user clicks a file in the tree.
 * Call `updateContent(path, content)` from the editor's onChange handler.
 * Call `saveFile(path)` to write changes to disk.
 */
export function useFileContent(
  sessionId: string,
  instanceId: string
): UseFileContentResult {
  // Use a ref to avoid stale closures in callbacks, state for re-render
  const [openFiles, setOpenFiles] = useState<Map<string, OpenFile>>(
    new Map()
  );
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>();
  const openOrderRef = useRef<string[]>([]); // track insertion order for eviction

  const openFile = useCallback(
    async (filePath: string) => {
      // If already open, just activate
      setOpenFiles((prev) => {
        if (prev.has(filePath)) return prev;

        // Create a placeholder entry while loading
        const next = new Map(prev);
        // Evict oldest if at limit
        if (next.size >= MAX_OPEN_FILES) {
          const oldest = openOrderRef.current.shift();
          if (oldest) next.delete(oldest);
        }
        next.set(filePath, {
          path: filePath,
          content: "",
          originalContent: "",
          language: "plaintext",
          isBinary: false,
          isImage: false,
          isSvg: false,
          isLoading: true,
          isDirty: false,
        });
        return next;
      });

      setActiveFilePath(filePath);
      openOrderRef.current.push(filePath);

      try {
        const encodedPath = filePath.split("/").map(encodeURIComponent).join("/");
        const url = `/api/sessions/${encodeURIComponent(sessionId)}/files/${encodedPath}?instanceId=${encodeURIComponent(instanceId)}`;
        const response = await apiFetch(url);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const data = (await response.json()) as {
          path: string;
          content: string | null;
          language: string | null;
          isBinary: boolean;
          isImage: boolean;
          isSvg: boolean;
          mime?: string;
          error?: string;
        };

        setOpenFiles((prev) => {
          const next = new Map(prev);
          next.set(filePath, {
            path: filePath,
            content: data.content ?? "",
            originalContent: data.content ?? "",
            language: data.language ?? "plaintext",
            isBinary: data.isBinary,
            isImage: data.isImage ?? false,
            isSvg: data.isSvg ?? false,
            mime: data.mime,
            isLoading: false,
            isDirty: false,
          });
          return next;
        });
      } catch (err) {
        setOpenFiles((prev) => {
          const next = new Map(prev);
          const existing = next.get(filePath);
          if (existing) {
            next.set(filePath, {
              ...existing,
              isLoading: false,
              error: err instanceof Error ? err.message : String(err),
            });
          }
          return next;
        });
      }
    },
    [sessionId, instanceId]
  );

  const closeFile = useCallback((filePath: string) => {
    openOrderRef.current = openOrderRef.current.filter((p) => p !== filePath);
    setOpenFiles((prev) => {
      const next = new Map(prev);
      next.delete(filePath);
      return next;
    });
    setActiveFilePath((prev) => {
      if (prev !== filePath) return prev;
      // Activate the previous file in order, or null
      const remaining = openOrderRef.current;
      return remaining.length > 0 ? remaining[remaining.length - 1] : null;
    });
  }, []);

  const updateContent = useCallback((filePath: string, content: string) => {
    setOpenFiles((prev) => {
      const file = prev.get(filePath);
      if (!file) return prev;
      const next = new Map(prev);
      next.set(filePath, {
        ...file,
        content,
        isDirty: content !== file.originalContent,
      });
      return next;
    });
  }, []);

  const saveFile = useCallback(
    async (filePath: string) => {
      const file = openFiles.get(filePath);
      if (!file || file.isBinary || file.isLoading) return;

      setIsSaving(true);
      setSaveError(undefined);

      try {
        const encodedPath = filePath.split("/").map(encodeURIComponent).join("/");
        const url = `/api/sessions/${encodeURIComponent(sessionId)}/files/${encodedPath}?instanceId=${encodeURIComponent(instanceId)}`;
        const response = await apiFetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: file.content }),
        });

        if (!response.ok) {
          const body = (await response.json()) as { error?: string };
          throw new Error(body.error ?? `HTTP ${response.status}`);
        }

        // Mark as clean
        setOpenFiles((prev) => {
          const f = prev.get(filePath);
          if (!f) return prev;
          const next = new Map(prev);
          next.set(filePath, {
            ...f,
            originalContent: f.content,
            isDirty: false,
          });
          return next;
        });
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsSaving(false);
      }
    },
    [sessionId, instanceId, openFiles]
  );

  const renameOpenFile = useCallback((oldPath: string, newPath: string) => {
    openOrderRef.current = openOrderRef.current.map((p) =>
      p === oldPath ? newPath : p
    );
    setOpenFiles((prev) => {
      const existing = prev.get(oldPath);
      if (!existing) return prev;
      const next = new Map(prev);
      next.delete(oldPath);
      next.set(newPath, { ...existing, path: newPath });
      return next;
    });
    setActiveFilePath((prev) => (prev === oldPath ? newPath : prev));
  }, []);

  /** Reset content to originalContent — pure local state, no API call. */
  const discardChanges = useCallback((filePath: string) => {
    setOpenFiles((prev) => {
      const file = prev.get(filePath);
      if (!file) return prev;
      const next = new Map(prev);
      next.set(filePath, {
        ...file,
        content: file.originalContent,
        isDirty: false,
      });
      return next;
    });
  }, []);

  const closeFilesUnderPath = useCallback(
    (pathPrefix: string) => {
      const prefix = pathPrefix.endsWith("/") ? pathPrefix : pathPrefix + "/";
      setOpenFiles((prev) => {
        const toClose = [...prev.keys()].filter(
          (p) => p === pathPrefix || p.startsWith(prefix)
        );
        if (toClose.length === 0) return prev;
        openOrderRef.current = openOrderRef.current.filter(
          (p) => !toClose.includes(p)
        );
        const next = new Map(prev);
        for (const p of toClose) next.delete(p);
        return next;
      });
      setActiveFilePath((prev) => {
        if (!prev) return prev;
        if (prev === pathPrefix || prev.startsWith(prefix)) {
          const remaining = openOrderRef.current;
          return remaining.length > 0 ? remaining[remaining.length - 1] : null;
        }
        return prev;
      });
    },
    []
  );

  /** Re-load a file from disk (used when SSE signals the agent wrote it). */
  const reloadFile = useCallback(
    async (filePath: string) => {
      const file = openFiles.get(filePath);
      if (!file || file.isDirty) return; // Don't overwrite user edits

      setOpenFiles((prev) => {
        const f = prev.get(filePath);
        if (!f) return prev;
        const next = new Map(prev);
        next.set(filePath, { ...f, isLoading: true });
        return next;
      });

      try {
        const encodedPath = filePath.split("/").map(encodeURIComponent).join("/");
        const url = `/api/sessions/${encodeURIComponent(sessionId)}/files/${encodedPath}?instanceId=${encodeURIComponent(instanceId)}`;
        const response = await apiFetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = (await response.json()) as { content: string | null };

        setOpenFiles((prev) => {
          const f = prev.get(filePath);
          if (!f) return prev;
          const next = new Map(prev);
          next.set(filePath, {
            ...f,
            content: data.content ?? "",
            originalContent: data.content ?? "",
            isLoading: false,
            isDirty: false,
          });
          return next;
        });
      } catch {
        setOpenFiles((prev) => {
          const f = prev.get(filePath);
          if (!f) return prev;
          const next = new Map(prev);
          next.set(filePath, { ...f, isLoading: false });
          return next;
        });
      }
    },
    [sessionId, instanceId, openFiles]
  );

  // Expose reloadFile through the map for SSE use
  // We attach it to the returned object so FilesTabContent can call it
  const result: UseFileContentResult & { reloadFile: (path: string) => void } =
    {
      openFiles,
      activeFilePath,
      openFile,
      closeFile,
      setActiveFilePath,
      updateContent,
      discardChanges,
      saveFile,
      isSaving,
      saveError,
      reloadFile,
      renameOpenFile,
      closeFilesUnderPath,
    };

  return result;
}
