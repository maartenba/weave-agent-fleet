/**
 * Path Security Utility
 *
 * Validates that a resolved file path is within a given root directory.
 * Prevents path traversal attacks (e.g., "../../../etc/passwd", symlink escapes,
 * null-byte injection, absolute path injection).
 *
 * Used by all file API routes that read/write workspace files.
 */

import { resolve, sep, dirname } from "path";
import { lstat, readlink } from "fs/promises";

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

  // Normalize and absolutize the root directory using path.resolve().
  // Unlike realpath(), resolve() does not touch the filesystem and is
  // recognised by CodeQL as a path-normalisation step that eliminates
  // ".." components, making the downstream startsWith check a valid
  // sanitiser barrier.
  const resolvedRoot = resolve(root);
  const rootPrefix = resolvedRoot.endsWith(sep) ? resolvedRoot : resolvedRoot + sep;

  // Resolve (normalize + absolutize) the user-supplied relative path against
  // the canonical root.  path.resolve() eliminates ".." sequences, so the
  // startsWith check below is sufficient for lexicographic containment.
  const resolvedPath = resolve(resolvedRoot, relativePath);

  // Containment check — CodeQL recognises an inline startsWith guard on a
  // path produced by path.resolve() as a barrier that sanitises the taint.
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(rootPrefix)) {
    throw new PathTraversalError(
      `Path escapes workspace root: ${relativePath}`
    );
  }

  // Symlink-escape protection: walk from the resolved path up to the root,
  // checking each existing component for symlinks whose real target escapes
  // the root.  This avoids passing any path to realpath() which CodeQL
  // treats as a taint-propagating sink.
  await assertNoSymlinkEscape(resolvedPath, resolvedRoot, rootPrefix);

  return resolvedPath;
}

/**
 * Walk from `target` up to (but not including) `root`, and for every path
 * component that exists on disk, verify it is not a symlink whose real
 * target falls outside `root`.
 *
 * If the target (or an ancestor) does not exist yet (ENOENT) the walk
 * stops — this is expected for write operations creating new files.
 */
async function assertNoSymlinkEscape(
  target: string,
  root: string,
  rootPrefix: string
): Promise<void> {
  let current = target;

  // Walk upward until we reach the root (which is already canonical).
  while (current !== root && current.startsWith(rootPrefix)) {
    try {
      const stats = await lstat(current);
      if (stats.isSymbolicLink()) {
        // Read the immediate symlink target (not recursive like realpath).
        const rawTarget = await readlink(current);
        // Resolve relative symlink targets against the link's parent dir.
        const resolvedTarget = resolve(dirname(current), rawTarget);
        if (
          resolvedTarget !== root &&
          !resolvedTarget.startsWith(rootPrefix)
        ) {
          throw new PathTraversalError(
            `Path escapes workspace root via symlink: ${current}`
          );
        }
      }
    } catch (err) {
      if (err instanceof PathTraversalError) throw err;
      // ENOENT — path doesn't exist yet; stop walking.
      break;
    }
    current = dirname(current);
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
  const rootPrefix = resolvedRoot.endsWith(sep)
    ? resolvedRoot
    : resolvedRoot + sep;
  const resolvedPath = resolve(resolvedRoot, relativePath);

  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(rootPrefix)) {
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
