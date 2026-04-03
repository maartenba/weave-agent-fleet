/**
 * Simple line-level diff utility using a Myers-like greedy algorithm.
 * Compares "before" and "after" text and returns line-level change ranges
 * for the "after" side, suitable for Monaco editor gutter decorations.
 *
 * No external dependencies.
 */

export type LineChangeType = "added" | "modified" | "deleted";

export interface LineChange {
  type: LineChangeType;
  /** 1-based start line number in the "after" content */
  startLine: number;
  /** 1-based end line number (inclusive) in the "after" content */
  endLine: number;
}

/**
 * Compute the LCS (Longest Common Subsequence) table for two line arrays.
 * Returns a 2D array where lcs[i][j] = length of LCS of a[0..i-1] and b[0..j-1].
 */
function lcsTable(a: string[], b: string[]): number[][] {
  const m = a.length;
  const n = b.length;
  // Use typed arrays for performance on large files
  const table: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0)
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        table[i][j] = table[i - 1][j - 1] + 1;
      } else {
        table[i][j] = Math.max(table[i - 1][j], table[i][j - 1]);
      }
    }
  }
  return table;
}

/**
 * Backtrack through the LCS table to produce edit operations.
 * Returns an array of { type, beforeIdx, afterIdx } where:
 * - "equal": lines match (beforeIdx and afterIdx are both set)
 * - "delete": line removed from before (beforeIdx set, afterIdx = -1)
 * - "insert": line added in after (afterIdx set, beforeIdx = -1)
 */
interface EditOp {
  type: "equal" | "delete" | "insert";
  beforeIdx: number; // 0-based index in before[], or -1
  afterIdx: number;  // 0-based index in after[], or -1
}

function backtrack(
  table: number[][],
  a: string[],
  b: string[]
): EditOp[] {
  const ops: EditOp[] = [];
  let i = a.length;
  let j = b.length;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      ops.push({ type: "equal", beforeIdx: i - 1, afterIdx: j - 1 });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || table[i][j - 1] >= table[i - 1][j])) {
      ops.push({ type: "insert", beforeIdx: -1, afterIdx: j - 1 });
      j--;
    } else {
      ops.push({ type: "delete", beforeIdx: i - 1, afterIdx: -1 });
      i--;
    }
  }

  ops.reverse();
  return ops;
}

/**
 * Convert edit operations into LineChange ranges for the "after" side.
 *
 * Consecutive inserts → "added" range.
 * Consecutive deletes adjacent to consecutive inserts → "modified" range
 * (the inserts are treated as modifications of the deleted lines).
 * Standalone deletes → "deleted" marker at the nearest after-line position.
 */
function opsToChanges(ops: EditOp[], afterLength: number): LineChange[] {
  const changes: LineChange[] = [];

  let i = 0;
  while (i < ops.length) {
    const op = ops[i];

    if (op.type === "equal") {
      i++;
      continue;
    }

    // Collect consecutive deletes
    const deleteStart = i;
    while (i < ops.length && ops[i].type === "delete") {
      i++;
    }
    const deleteCount = i - deleteStart;

    // Collect consecutive inserts immediately following
    const insertStart = i;
    while (i < ops.length && ops[i].type === "insert") {
      i++;
    }
    const insertCount = i - insertStart;

    if (deleteCount > 0 && insertCount > 0) {
      // Paired delete+insert → "modified" range (on the after side)
      const firstAfterLine = ops[insertStart].afterIdx + 1; // 1-based
      const lastAfterLine = ops[i - 1].afterIdx + 1;
      changes.push({
        type: "modified",
        startLine: firstAfterLine,
        endLine: lastAfterLine,
      });
    } else if (insertCount > 0) {
      // Pure inserts → "added" range
      const firstAfterLine = ops[insertStart].afterIdx + 1;
      const lastAfterLine = ops[i - 1].afterIdx + 1;
      changes.push({
        type: "added",
        startLine: firstAfterLine,
        endLine: lastAfterLine,
      });
    } else if (deleteCount > 0) {
      // Pure deletes → "deleted" marker
      // Place the marker at the after-line just after the last equal before these deletes,
      // or line 1 if at the very beginning.
      let markerLine = 1;
      // Look backward for the nearest after-index
      for (let k = deleteStart - 1; k >= 0; k--) {
        if (ops[k].afterIdx >= 0) {
          markerLine = ops[k].afterIdx + 1; // 1-based, same line as last match
          break;
        }
      }
      // If there's a following line in after, place at that line instead
      for (let k = i; k < ops.length; k++) {
        if (ops[k].afterIdx >= 0) {
          markerLine = ops[k].afterIdx + 1;
          break;
        }
      }
      // Clamp to valid range
      if (afterLength === 0) {
        markerLine = 1;
      } else if (markerLine > afterLength) {
        markerLine = afterLength;
      }
      changes.push({
        type: "deleted",
        startLine: markerLine,
        endLine: markerLine,
      });
    }
  }

  return changes;
}

/**
 * Compute line-level changes between two strings.
 *
 * Returns an array of `LineChange` objects describing added, modified,
 * and deleted line ranges in the "after" content. Line numbers are 1-based.
 *
 * - Identical content → empty array
 * - Before empty, after non-empty → single "added" range covering all lines
 * - After empty, before non-empty → single "deleted" marker at line 1
 */
export function computeLineChanges(before: string, after: string): LineChange[] {
  if (before === after) return [];

  const beforeLines = before.length === 0 ? [] : before.split("\n");
  const afterLines = after.length === 0 ? [] : after.split("\n");

  // Fast path: before is empty → all added
  if (beforeLines.length === 0 && afterLines.length > 0) {
    return [{ type: "added", startLine: 1, endLine: afterLines.length }];
  }

  // Fast path: after is empty → deleted marker
  if (afterLines.length === 0 && beforeLines.length > 0) {
    return [{ type: "deleted", startLine: 1, endLine: 1 }];
  }

  const table = lcsTable(beforeLines, afterLines);
  const ops = backtrack(table, beforeLines, afterLines);
  return opsToChanges(ops, afterLines.length);
}
