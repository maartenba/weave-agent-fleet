/**
 * Client-side API functions for file tree operations.
 *
 * Each function calls the corresponding API endpoint and throws on non-ok
 * responses with an error message extracted from the response body.
 */

import { apiFetch } from "@/lib/api-client";

/** Encode a relative file path for use in a URL, preserving slashes. */
function encodePath(filePath: string): string {
  return filePath
    .split("/")
    .map(encodeURIComponent)
    .join("/");
}

/** Extract an error message from a failed response body. */
async function extractError(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json();
    return body?.error ?? fallback;
  } catch {
    return fallback;
  }
}

// ── Delete ───────────────────────────────────────────────────────────────────

/**
 * Delete a file or directory (recursive).
 * @throws Error with message from API on failure
 */
export async function deleteFile(
  sessionId: string,
  instanceId: string,
  filePath: string
): Promise<{ success: boolean }> {
  const response = await apiFetch(
    `/api/sessions/${sessionId}/files/${encodePath(filePath)}?instanceId=${encodeURIComponent(instanceId)}`,
    { method: "DELETE" }
  );

  if (!response.ok) {
    throw new Error(await extractError(response, "Failed to delete"));
  }

  return response.json();
}

// ── Rename / Move ────────────────────────────────────────────────────────────

/**
 * Rename or move a file or directory.
 * @throws Error with message from API on failure
 */
export async function renameFile(
  sessionId: string,
  instanceId: string,
  oldPath: string,
  newPath: string
): Promise<{ success: boolean; oldPath: string; newPath: string }> {
  const response = await apiFetch(
    `/api/sessions/${sessionId}/files/${encodePath(oldPath)}?instanceId=${encodeURIComponent(instanceId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newPath }),
    }
  );

  if (!response.ok) {
    throw new Error(await extractError(response, "Failed to rename"));
  }

  return response.json();
}

// ── Create File ──────────────────────────────────────────────────────────────

/**
 * Create an empty file (or overwrite) at the given path.
 * @throws Error with message from API on failure
 */
export async function createFile(
  sessionId: string,
  instanceId: string,
  filePath: string
): Promise<{ success: boolean }> {
  const response = await apiFetch(
    `/api/sessions/${sessionId}/files/${encodePath(filePath)}?instanceId=${encodeURIComponent(instanceId)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "" }),
    }
  );

  if (!response.ok) {
    throw new Error(await extractError(response, "Failed to create file"));
  }

  return response.json();
}

// ── Create Folder ────────────────────────────────────────────────────────────

/**
 * Create a directory (and all ancestors) at the given path.
 * @throws Error with message from API on failure
 */
export async function createFolder(
  sessionId: string,
  instanceId: string,
  folderPath: string
): Promise<{ success: boolean }> {
  const response = await apiFetch(
    `/api/sessions/${sessionId}/files/${encodePath(folderPath)}?instanceId=${encodeURIComponent(instanceId)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "directory" }),
    }
  );

  if (!response.ok) {
    throw new Error(await extractError(response, "Failed to create folder"));
  }

  return response.json();
}
