import { NextRequest, NextResponse } from "next/server";
import { readdirSync, existsSync, statSync, realpathSync, mkdirSync } from "fs";
import { resolve, dirname, join, sep } from "path";
import { validateFileName } from "@/lib/file-name-validation";
import {
  getAllowedRoots,
  validateDirectory,
} from "@/lib/server/process-manager";
import type { DirectoryEntry, DirectoryListResponse } from "@/lib/api-types";

/**
 * Directories that are skipped when listing — noise that clutters the picker.
 */
const NOISE_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  ".next",
  ".cache",
  "__pycache__",
  ".venv",
  "dist",
  "build",
  ".DS_Store",
  ".turbo",
  ".vercel",
  ".output",
  // Windows system directories
  "System Volume Information",
  "Recovery",
  "PerfLogs",
  "msdownld.tmp",
]);

/** Maximum entries returned per listing to prevent massive payloads. */
const MAX_ENTRIES = 100;

/**
 * Check if a resolved real path is under one of the allowed roots.
 * Used to prevent symlink-based escapes — even if the textual path
 * passes validateDirectory, the real (symlink-resolved) path must
 * also be under an allowed root.
 */
function isUnderAllowedRoot(realPath: string, roots: string[]): boolean {
  return roots.some(
    (root) =>
      realPath === root ||
      realPath.startsWith(root.endsWith(sep) ? root : root + sep)
  );
}

// GET /api/directories — list browsable subdirectories
// Query params:
//   ?path=/abs/path  — directory to list (omit for allowed roots)
//   ?search=term     — case-insensitive substring filter on directory names
export async function GET(request: NextRequest): Promise<NextResponse> {
  const pathParam = request.nextUrl.searchParams.get("path");
  const search = request.nextUrl.searchParams.get("search")?.toLowerCase();
  const roots = getAllowedRoots();

  // ── No path → return allowed roots as entries ──────────────────────────
  if (!pathParam) {
    const entries: DirectoryEntry[] = roots
      .filter((root) => {
        try {
          return existsSync(root) && statSync(root).isDirectory();
        } catch {
          return false;
        }
      })
      .map((root) => ({
        name: root.split(sep).filter(Boolean).pop() ?? root,
        path: root,
        isGitRepo: existsSync(join(root, ".git")),
      }));

    const filtered = search
      ? entries.filter((e) => e.name.toLowerCase().includes(search))
      : entries;

    const response: DirectoryListResponse = {
      entries: filtered.slice(0, MAX_ENTRIES),
      currentPath: null,
      parentPath: null,
      roots,
    };
    return NextResponse.json(response, { status: 200 });
  }

  // ── Validate the requested path ────────────────────────────────────────
  // Security: ensure path is under an allowed root (textual check first)
  try {
    validateDirectory(pathParam);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Invalid directory path";

    if (message === "Directory does not exist") {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    if (message === "Path exists but is not a directory") {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    // "Directory is outside the allowed workspace roots" or other
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const resolved = resolve(pathParam);

  // Security: resolve symlinks and re-validate the real path to prevent
  // symlink-based escapes (e.g. /allowed/root/symlink -> /etc)
  let realPath: string;
  try {
    realPath = realpathSync(resolved);
  } catch {
    return NextResponse.json(
      { error: "Directory does not exist" },
      { status: 404 }
    );
  }
  if (!isUnderAllowedRoot(realPath, roots)) {
    return NextResponse.json(
      { error: "Directory is outside the allowed workspace roots" },
      { status: 400 }
    );
  }

  // ── List subdirectories ────────────────────────────────────────────────
  try {
    const dirents = readdirSync(realPath, { withFileTypes: true });

    const entries: DirectoryEntry[] = [];
    for (const dirent of dirents) {
      // Skip noise directories
      if (NOISE_DIRECTORIES.has(dirent.name)) continue;
      // Skip hidden directories (starting with .)
      if (dirent.name.startsWith(".")) continue;
      // Skip Windows system directories (starting with $)
      if (dirent.name.startsWith("$")) continue;

      const entryPath = join(resolved, dirent.name);

      // Check if it's a directory (handle symlink errors gracefully)
      let isDir = false;
      try {
        isDir = dirent.isDirectory();
        if (!isDir && dirent.isSymbolicLink()) {
          // Resolve symlink target and check it's a directory
          const target = realpathSync(join(realPath, dirent.name));
          isDir = statSync(target).isDirectory();
          // Security: validate the symlink target is under an allowed root
          if (isDir && !isUnderAllowedRoot(target, roots)) {
            continue; // Skip symlinks that point outside allowed roots
          }
        }
      } catch {
        // Broken symlink or permission issue — skip
        continue;
      }

      if (!isDir) continue;

      // Apply search filter
      if (search && !dirent.name.toLowerCase().includes(search)) continue;

      entries.push({
        name: dirent.name,
        path: entryPath,
        isGitRepo: existsSync(join(entryPath, ".git")),
      });

      if (entries.length >= MAX_ENTRIES) break;
    }

    // Sort alphabetically by name
    entries.sort((a, b) => a.name.localeCompare(b.name));

    // Compute parentPath: null if at an allowed root, otherwise dirname
    const isRoot = roots.some((root) => resolved === root);
    const parentPath = isRoot ? null : dirname(resolved);

    const response: DirectoryListResponse = {
      entries,
      currentPath: resolved,
      parentPath,
      roots,
    };
    return NextResponse.json(response, { status: 200 });
  } catch (err) {
    // Handle permission denied
    if (
      err instanceof Error &&
      "code" in err &&
      (err as NodeJS.ErrnoException).code === "EACCES"
    ) {
      return NextResponse.json(
        { error: "Permission denied" },
        { status: 403 }
      );
    }

    console.error("[GET /api/directories] Error:", err);
    return NextResponse.json(
      { error: "Failed to list directories" },
      { status: 500 }
    );
  }
}

// POST /api/directories — create a new subdirectory
// Body: { parentPath: string; name: string }
export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: { parentPath?: string; name?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const { parentPath: parentParam, name } = body;

  if (!parentParam || typeof parentParam !== "string") {
    return NextResponse.json(
      { error: "parentPath is required" },
      { status: 400 }
    );
  }
  if (!name || typeof name !== "string") {
    return NextResponse.json(
      { error: "name is required" },
      { status: 400 }
    );
  }

  // Validate directory name
  const nameValidation = validateFileName(name);
  if (!nameValidation.valid) {
    return NextResponse.json(
      { error: nameValidation.error },
      { status: 400 }
    );
  }

  // Validate parent directory exists and is under allowed roots
  try {
    validateDirectory(parentParam);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Invalid parent directory";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const resolvedParent = resolve(parentParam);
  const roots = getAllowedRoots();

  // Security: resolve symlinks on parent and re-validate
  let realParent: string;
  try {
    realParent = realpathSync(resolvedParent);
  } catch {
    return NextResponse.json(
      { error: "Parent directory does not exist" },
      { status: 404 }
    );
  }
  if (!isUnderAllowedRoot(realParent, roots)) {
    return NextResponse.json(
      { error: "Parent directory is outside the allowed workspace roots" },
      { status: 400 }
    );
  }

  const newDirPath = join(resolvedParent, name);

  // CodeQL flags existsSync/mkdirSync below as js/path-injection (CWE-22)
  // because `newDirPath` derives from user input. This is intentional —
  // the API must create directories at user-specified locations. The path
  // is safe because:
  //   1. `name` is sanitised by validateFileName (rejects path separators,
  //      ".." traversals, and OS-reserved names).
  //   2. `parentParam` is validated by validateDirectory (must be under an
  //      allowed workspace root).
  //   3. `resolvedParent` is further checked via realpathSync +
  //      isUnderAllowedRoot to prevent symlink escapes.

  // Check if it already exists
  if (existsSync(newDirPath)) {
    return NextResponse.json(
      { error: `"${name}" already exists in this directory` },
      { status: 409 }
    );
  }

  // Create the directory
  try {
    mkdirSync(newDirPath, { recursive: false });
  } catch (err) {
    if (
      err instanceof Error &&
      "code" in err &&
      (err as NodeJS.ErrnoException).code === "EACCES"
    ) {
      return NextResponse.json(
        { error: "Permission denied" },
        { status: 403 }
      );
    }

    console.error("[POST /api/directories] Error:", err);
    return NextResponse.json(
      { error: "Failed to create directory" },
      { status: 500 }
    );
  }

  return NextResponse.json(
    {
      name,
      path: newDirPath,
      isGitRepo: false,
    } satisfies DirectoryEntry,
    { status: 201 }
  );
}
