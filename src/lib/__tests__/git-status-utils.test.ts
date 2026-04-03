import { describe, it, expect } from "vitest";
import { buildGitStatusMap } from "@/lib/git-status-utils";
import type { FileDiffItem } from "@/lib/api-types";

function makeDiff(
  file: string,
  status: "added" | "modified" | "deleted"
): FileDiffItem {
  return {
    file,
    before: status === "added" ? "" : "old",
    after: status === "deleted" ? "" : "new",
    additions: status === "deleted" ? 0 : 1,
    deletions: status === "added" ? 0 : 1,
    status,
  };
}

describe("buildGitStatusMap", () => {
  it("returns empty map for empty diffs", () => {
    const map = buildGitStatusMap([]);
    expect(map.size).toBe(0);
  });

  it("maps a single added file", () => {
    const map = buildGitStatusMap([makeDiff("src/new.ts", "added")]);
    expect(map.get("src/new.ts")).toBe("added");
    expect(map.get("src")).toBe("added");
  });

  it("maps a single modified file", () => {
    const map = buildGitStatusMap([makeDiff("src/index.ts", "modified")]);
    expect(map.get("src/index.ts")).toBe("modified");
    expect(map.get("src")).toBe("modified");
  });

  it("maps a single deleted file", () => {
    const map = buildGitStatusMap([makeDiff("src/old.ts", "deleted")]);
    expect(map.get("src/old.ts")).toBe("deleted");
    expect(map.get("src")).toBe("deleted");
  });

  it("maps a root-level file (no directory)", () => {
    const map = buildGitStatusMap([makeDiff("README.md", "modified")]);
    expect(map.get("README.md")).toBe("modified");
    // No directory entries
    expect(map.size).toBe(1);
  });

  it("propagates 'added' to directory when all children are added", () => {
    const map = buildGitStatusMap([
      makeDiff("src/a.ts", "added"),
      makeDiff("src/b.ts", "added"),
    ]);
    expect(map.get("src")).toBe("added");
  });

  it("propagates 'modified' when children have mixed statuses", () => {
    const map = buildGitStatusMap([
      makeDiff("src/a.ts", "added"),
      makeDiff("src/b.ts", "modified"),
    ]);
    expect(map.get("src")).toBe("modified");
  });

  it("propagates 'deleted' when any child is deleted", () => {
    const map = buildGitStatusMap([
      makeDiff("src/a.ts", "added"),
      makeDiff("src/b.ts", "deleted"),
    ]);
    expect(map.get("src")).toBe("deleted");
  });

  it("handles nested directories", () => {
    const map = buildGitStatusMap([
      makeDiff("src/components/deep/file.ts", "added"),
    ]);
    expect(map.get("src/components/deep/file.ts")).toBe("added");
    expect(map.get("src/components/deep")).toBe("added");
    expect(map.get("src/components")).toBe("added");
    expect(map.get("src")).toBe("added");
  });

  it("handles nested directories with mixed statuses", () => {
    const map = buildGitStatusMap([
      makeDiff("src/components/A.tsx", "added"),
      makeDiff("src/hooks/useB.ts", "modified"),
    ]);
    expect(map.get("src/components")).toBe("added");
    expect(map.get("src/hooks")).toBe("modified");
    // Parent "src" has both added and modified children → modified
    expect(map.get("src")).toBe("modified");
  });

  it("handles multiple files in same directory with one deleted", () => {
    const map = buildGitStatusMap([
      makeDiff("lib/a.ts", "modified"),
      makeDiff("lib/b.ts", "deleted"),
      makeDiff("lib/c.ts", "added"),
    ]);
    expect(map.get("lib")).toBe("deleted");
  });
});
