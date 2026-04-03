/**
 * Path Security Utility
 *
 * Validates that a resolved file path is within a given root directory.
 * Prevents path traversal attacks (e.g., "../../../etc/passwd", symlink escapes,
 * null-byte injection, absolute path injection).
 *
 * Used by all file API routes that read/write workspace files.
 */

import { resolve, sep } from "path";
import { realpath } from "fs/promises";

/**
 * Returns true if the given relative path refers to (or is within) a `.git`
 * directory — at ANY level of the path hierarchy, case-insensitively.
 *
 * Examples that return true:
 *   ".git"                    → top-level .git dir
 *   ".git/config"             → file inside top-level .git
 *   "subdir/.git"             → nested .git dir
 *   "subdir/.Git/hooks"       → case variant
 *   "a/b/.git/hooks/pre-push" → deeply nested
 */
export function isGitPath(relativePath: string): boolean {
  // Normalize backslashes to forward slashes so that Windows-style paths
  // (e.g. ".git\\config") cannot bypass the check.
  const normalized = relativePath.toLowerCase().replace(/\\/g, "/");
  return (
    normalized === ".git" ||
    normalized.startsWith(".git/") ||
    normalized.includes("/.git/") ||
    normalized.endsWith("/.git")
  );
}

/**
 * Validates that a relative path, when resolved against `root`, stays within
 * the `root` directory. Returns the resolved absolute path on success.
 *
 * @throws {PathTraversalError} if the resolved path escapes the root
 */
export async function validatePathWithinRoot(
  root: string,
  relativePath: string
): Promise<string> {
  // Reject null bytes — classic injection vector
  if (relativePath.includes("\0")) {
    throw new PathTraversalError("Path contains null bytes");
  }

  // Reject absolute paths passed as relative
  if (relativePath.startsWith("/") || /^[A-Za-z]:/.test(relativePath)) {
    throw new PathTraversalError("Absolute paths are not allowed");
  }

  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(resolvedRoot, relativePath);

  // Check before realpath (symlinks not yet resolved)
  if (!isWithinRoot(resolvedRoot, resolvedPath)) {
    throw new PathTraversalError(
      `Path escapes workspace root: ${relativePath}`
    );
  }

  // Try to resolve symlinks and re-check (prevents symlink escape attacks)
  // If the file doesn't exist yet (e.g. for writes), skip realpath
  try {
    const realResolvedPath = await realpath(resolvedPath);
    const realRoot = await realpath(resolvedRoot);
    if (!isWithinRoot(realRoot, realResolvedPath)) {
      throw new PathTraversalError(
        `Path escapes workspace root via symlink: ${relativePath}`
      );
    }
    return realResolvedPath;
  } catch (err) {
    if (err instanceof PathTraversalError) throw err;
    // ENOENT: file doesn't exist yet (valid for write operations)
    // Return the pre-realpath resolved path which already passed the first check
    return resolvedPath;
  }
}

/**
 * Synchronous version for cases where async is not available.
 * Does NOT resolve symlinks — use validatePathWithinRoot (async) when possible.
 */
export function validatePathWithinRootSync(
  root: string,
  relativePath: string
): string {
  if (relativePath.includes("\0")) {
    throw new PathTraversalError("Path contains null bytes");
  }

  if (relativePath.startsWith("/") || /^[A-Za-z]:/.test(relativePath)) {
    throw new PathTraversalError("Absolute paths are not allowed");
  }

  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(resolvedRoot, relativePath);

  if (!isWithinRoot(resolvedRoot, resolvedPath)) {
    throw new PathTraversalError(
      `Path escapes workspace root: ${relativePath}`
    );
  }

  return resolvedPath;
}

export function isWithinRoot(root: string, target: string): boolean {
  // Ensure root ends with separator to avoid prefix matching false positives
  // e.g. root=/foo/bar should NOT match /foo/barbaz
  const rootWithSep = root.endsWith(sep) ? root : root + sep;
  return target === root || target.startsWith(rootWithSep);
}

export class PathTraversalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathTraversalError";
  }
}
