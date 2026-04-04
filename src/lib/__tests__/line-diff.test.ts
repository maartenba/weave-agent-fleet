import { describe, it, expect } from "vitest";
import { computeLineChanges, computeHunks, applyHunkRevert } from "@/lib/line-diff";

describe("computeLineChanges", () => {
  it("returns empty array for identical content", () => {
    expect(computeLineChanges("hello\nworld", "hello\nworld")).toEqual([]);
  });

  it("returns empty array for both empty", () => {
    expect(computeLineChanges("", "")).toEqual([]);
  });

  it("returns all added when before is empty", () => {
    const changes = computeLineChanges("", "line1\nline2\nline3");
    expect(changes).toEqual([
      { type: "added", startLine: 1, endLine: 3 },
    ]);
  });

  it("returns deleted marker when after is empty", () => {
    const changes = computeLineChanges("line1\nline2", "");
    expect(changes).toEqual([
      { type: "deleted", startLine: 1, endLine: 1 },
    ]);
  });

  it("detects a single line addition in the middle", () => {
    const before = "a\nc";
    const after = "a\nb\nc";
    const changes = computeLineChanges(before, after);
    expect(changes).toEqual([
      { type: "added", startLine: 2, endLine: 2 },
    ]);
  });

  it("detects a single line addition at the end", () => {
    const before = "a\nb";
    const after = "a\nb\nc";
    const changes = computeLineChanges(before, after);
    expect(changes).toEqual([
      { type: "added", startLine: 3, endLine: 3 },
    ]);
  });

  it("detects a single line deletion", () => {
    const before = "a\nb\nc";
    const after = "a\nc";
    const changes = computeLineChanges(before, after);
    // Deletion of "b" — marker placed at the position in after
    expect(changes.length).toBe(1);
    expect(changes[0].type).toBe("deleted");
  });

  it("detects a single line modification", () => {
    const before = "a\nb\nc";
    const after = "a\nB\nc";
    const changes = computeLineChanges(before, after);
    expect(changes).toEqual([
      { type: "modified", startLine: 2, endLine: 2 },
    ]);
  });

  it("detects multiple contiguous additions", () => {
    const before = "a\nd";
    const after = "a\nb\nc\nd";
    const changes = computeLineChanges(before, after);
    expect(changes).toEqual([
      { type: "added", startLine: 2, endLine: 3 },
    ]);
  });

  it("detects multiple contiguous modifications", () => {
    const before = "a\nb\nc\nd";
    const after = "a\nB\nC\nd";
    const changes = computeLineChanges(before, after);
    expect(changes).toEqual([
      { type: "modified", startLine: 2, endLine: 3 },
    ]);
  });

  it("handles mixed changes", () => {
    const before = "line1\nline2\nline3\nline4\nline5";
    const after = "line1\nLINE2\nnewline\nline4\nline5";
    const changes = computeLineChanges(before, after);
    // line2 → LINE2 (modified), line3 → newline (modified)
    // Both are delete+insert pairs so they should show as modified
    expect(changes.length).toBeGreaterThanOrEqual(1);
    // At minimum, lines 2-3 should be marked as changed
    const changedLines = new Set<number>();
    for (const c of changes) {
      for (let l = c.startLine; l <= c.endLine; l++) {
        changedLines.add(l);
      }
    }
    expect(changedLines.has(2)).toBe(true);
    expect(changedLines.has(3)).toBe(true);
    expect(changedLines.has(1)).toBe(false);
    expect(changedLines.has(4)).toBe(false);
  });

  it("handles completely different content", () => {
    const before = "aaa\nbbb\nccc";
    const after = "xxx\nyyy\nzzz";
    const changes = computeLineChanges(before, after);
    // All lines modified
    expect(changes.length).toBeGreaterThanOrEqual(1);
    const changedLines = new Set<number>();
    for (const c of changes) {
      for (let l = c.startLine; l <= c.endLine; l++) {
        changedLines.add(l);
      }
    }
    expect(changedLines.has(1)).toBe(true);
    expect(changedLines.has(2)).toBe(true);
    expect(changedLines.has(3)).toBe(true);
  });

  it("performs adequately on ~1000 lines", () => {
    const beforeLines = Array.from({ length: 1000 }, (_, i) => `line ${i}`);
    const afterLines = [...beforeLines];
    // Modify a few lines
    afterLines[100] = "CHANGED 100";
    afterLines[500] = "CHANGED 500";
    afterLines[999] = "CHANGED 999";

    const start = performance.now();
    const changes = computeLineChanges(
      beforeLines.join("\n"),
      afterLines.join("\n")
    );
    const elapsed = performance.now() - start;

    expect(changes.length).toBeGreaterThanOrEqual(3);
    // Should complete in reasonable time (generous limit for CI)
    expect(elapsed).toBeLessThan(5000);
  });
});

describe("computeHunks", () => {
  it("returns empty array for identical content", () => {
    expect(computeHunks("hello\nworld", "hello\nworld")).toEqual([]);
  });

  it("returns empty array for both empty strings", () => {
    expect(computeHunks("", "")).toEqual([]);
  });

  it("returns single added hunk when before is empty", () => {
    const hunks = computeHunks("", "line1\nline2\nline3");
    expect(hunks).toHaveLength(1);
    expect(hunks[0].type).toBe("added");
    expect(hunks[0].afterStartLine).toBe(1);
    expect(hunks[0].afterEndLine).toBe(3);
    expect(hunks[0].oldLines).toEqual([]);
    expect(hunks[0].newLines).toEqual(["line1", "line2", "line3"]);
  });

  it("returns single deleted hunk when after is empty", () => {
    const hunks = computeHunks("line1\nline2", "");
    expect(hunks).toHaveLength(1);
    expect(hunks[0].type).toBe("deleted");
    expect(hunks[0].oldLines).toEqual(["line1", "line2"]);
    expect(hunks[0].newLines).toEqual([]);
  });

  it("detects a single added line with correct content", () => {
    const hunks = computeHunks("a\nc", "a\nb\nc");
    expect(hunks).toHaveLength(1);
    expect(hunks[0].type).toBe("added");
    expect(hunks[0].afterStartLine).toBe(2);
    expect(hunks[0].afterEndLine).toBe(2);
    expect(hunks[0].newLines).toEqual(["b"]);
    expect(hunks[0].oldLines).toEqual([]);
  });

  it("detects a single deleted line with correct content", () => {
    const hunks = computeHunks("a\nb\nc", "a\nc");
    expect(hunks).toHaveLength(1);
    expect(hunks[0].type).toBe("deleted");
    expect(hunks[0].oldLines).toEqual(["b"]);
    expect(hunks[0].newLines).toEqual([]);
  });

  it("detects a single modified line with correct old and new content", () => {
    const hunks = computeHunks("a\nb\nc", "a\nB\nc");
    expect(hunks).toHaveLength(1);
    expect(hunks[0].type).toBe("modified");
    expect(hunks[0].afterStartLine).toBe(2);
    expect(hunks[0].afterEndLine).toBe(2);
    expect(hunks[0].oldLines).toEqual(["b"]);
    expect(hunks[0].newLines).toEqual(["B"]);
  });

  it("returns multiple separate hunks for non-contiguous changes", () => {
    // line 2 modified, line 7 added — far apart so they form separate hunks
    const before = "a\nb\nc\nd\ne\nf\ng";
    const after =  "a\nB\nc\nd\ne\nf\ng\nh";
    const hunks = computeHunks(before, after);
    expect(hunks.length).toBeGreaterThanOrEqual(2);
    const types = hunks.map((h) => h.type);
    expect(types).toContain("modified");
    expect(types).toContain("added");
  });

  it("groups contiguous changes into a single hunk", () => {
    const before = "a\nb\nc\nd";
    const after =  "a\nB\nC\nd";
    const hunks = computeHunks(before, after);
    expect(hunks).toHaveLength(1);
    expect(hunks[0].type).toBe("modified");
    expect(hunks[0].oldLines).toEqual(["b", "c"]);
    expect(hunks[0].newLines).toEqual(["B", "C"]);
  });

  it("carries correct oldLines for a modified hunk", () => {
    const hunks = computeHunks("x\ny\nz", "x\nY\nz");
    expect(hunks[0].oldLines).toEqual(["y"]);
    expect(hunks[0].newLines).toEqual(["Y"]);
  });
});

describe("applyHunkRevert", () => {
  it("reverts an added hunk by removing the added lines", () => {
    const before = "a\nc";
    const after  = "a\nb\nc";
    const [hunk] = computeHunks(before, after);
    expect(hunk.type).toBe("added");
    expect(applyHunkRevert(after, hunk)).toBe(before);
  });

  it("reverts a deleted hunk by re-inserting the deleted lines", () => {
    const before = "a\nb\nc";
    const after  = "a\nc";
    const [hunk] = computeHunks(before, after);
    expect(hunk.type).toBe("deleted");
    expect(applyHunkRevert(after, hunk)).toBe(before);
  });

  it("reverts a modified hunk by restoring old lines", () => {
    const before = "a\nb\nc";
    const after  = "a\nB\nc";
    const [hunk] = computeHunks(before, after);
    expect(hunk.type).toBe("modified");
    expect(applyHunkRevert(after, hunk)).toBe(before);
  });

  it("reverts a single-line modification at line 1", () => {
    const before = "hello\nworld";
    const after  = "HELLO\nworld";
    const [hunk] = computeHunks(before, after);
    expect(applyHunkRevert(after, hunk)).toBe(before);
  });

  it("reverts a single-line modification at the last line", () => {
    const before = "hello\nworld";
    const after  = "hello\nWORLD";
    const [hunk] = computeHunks(before, after);
    expect(applyHunkRevert(after, hunk)).toBe(before);
  });

  it("reverts an addition at the end of the file", () => {
    const before = "a\nb";
    const after  = "a\nb\nc";
    const [hunk] = computeHunks(before, after);
    expect(hunk.type).toBe("added");
    expect(applyHunkRevert(after, hunk)).toBe(before);
  });

  it("round-trip: reverting the only hunk produces the original content", () => {
    const before = "line1\nline2\nline3";
    const after  = "line1\nLINE2\nline3";
    const hunks = computeHunks(before, after);
    expect(hunks).toHaveLength(1);
    const reverted = applyHunkRevert(after, hunks[0]);
    expect(reverted).toBe(before);
  });
});
