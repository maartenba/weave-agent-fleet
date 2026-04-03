/**
 * Utility for computing a git status map from diff items.
 * Maps file paths (and their ancestor directories) to a git status.
 */

import type { FileDiffItem } from "@/lib/api-types";

export type GitStatus = "added" | "modified" | "deleted";
export type GitStatusMap = Map<string, GitStatus>;

/**
 * Aggregate directory status from the statuses of its descendant files.
 * - All children "added" → "added"
 * - Any child "deleted" → "deleted"
 * - Otherwise → "modified"
 */
function aggregateStatus(statuses: GitStatus[]): GitStatus {
  if (statuses.length === 0) return "modified";
  const allAdded = statuses.every((s) => s === "added");
  if (allAdded) return "added";
  const anyDeleted = statuses.some((s) => s === "deleted");
  if (anyDeleted) return "deleted";
  return "modified";
}

/**
 * Build a map from file path → git status, including ancestor directories.
 *
 * Directory status is aggregated from all descendant files:
 * - All descendants "added" → directory is "added"
 * - Any descendant "deleted" → directory is "deleted"
 * - Mixed → directory is "modified"
 */
export function buildGitStatusMap(diffs: FileDiffItem[]): GitStatusMap {
  if (diffs.length === 0) return new Map();

  const map: GitStatusMap = new Map();

  // Collect statuses per directory
  const dirStatuses = new Map<string, GitStatus[]>();

  for (const diff of diffs) {
    // Map the file itself
    map.set(diff.file, diff.status);

    // Collect ancestor directories
    const parts = diff.file.split("/");
    for (let i = 1; i < parts.length; i++) {
      const dirPath = parts.slice(0, i).join("/");
      if (!dirStatuses.has(dirPath)) {
        dirStatuses.set(dirPath, []);
      }
      dirStatuses.get(dirPath)!.push(diff.status);
    }
  }

  // Aggregate directory statuses
  for (const [dirPath, statuses] of dirStatuses) {
    map.set(dirPath, aggregateStatus(statuses));
  }

  return map;
}
