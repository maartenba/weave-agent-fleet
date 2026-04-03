/**
 * Unit tests for the flat-to-tree transformation in `useFileTree`.
 * Tests the `buildTree` function which converts a flat file list to a
 * nested FileTreeNode hierarchy with proper sorting and auto-expansion.
 * Also tests the `expandTo` method via renderHook.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { buildTree, useFileTree } from "@/hooks/use-file-tree";
import type { FlatFileEntry, FileTreeNode } from "@/hooks/use-file-tree";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function file(path: string, size = 100): FlatFileEntry {
  return { path, type: "file", size };
}

function dir(path: string): FlatFileEntry {
  return { path, type: "directory" };
}

function findNode(nodes: FileTreeNode[], name: string): FileTreeNode | undefined {
  for (const node of nodes) {
    if (node.name === name) return node;
    if (node.children) {
      const found = findNode(node.children, name);
      if (found) return found;
    }
  }
  return undefined;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("buildTree", () => {
  it("ReturnsEmptyArrayForEmptyInput", () => {
    expect(buildTree([])).toEqual([]);
  });

  it("ReturnsSingleFileAtRootLevel", () => {
    const result = buildTree([file("README.md")]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      name: "README.md",
      path: "README.md",
      type: "file",
      size: 100,
    });
  });

  it("ReturnsMultipleRootLevelFiles", () => {
    const result = buildTree([file("a.ts"), file("b.ts"), file("c.ts")]);
    expect(result).toHaveLength(3);
  });

  it("PlacesDirectoryAtRootLevel", () => {
    const result = buildTree([dir("src")]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ name: "src", type: "directory" });
    expect(result[0].children).toBeDefined();
  });

  it("NestsFilesInsideDirectory", () => {
    const result = buildTree([dir("src"), file("src/index.ts")]);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("src");
    expect(result[0].children).toHaveLength(1);
    expect(result[0].children![0]).toMatchObject({
      name: "index.ts",
      path: "src/index.ts",
      type: "file",
    });
  });

  it("NestsDeepHierarchy", () => {
    const result = buildTree([
      dir("a"),
      dir("a/b"),
      dir("a/b/c"),
      file("a/b/c/deep.ts"),
    ]);

    expect(result).toHaveLength(1);
    const a = result[0];
    expect(a.name).toBe("a");
    const b = a.children![0];
    expect(b.name).toBe("b");
    const c = b.children![0];
    expect(c.name).toBe("c");
    expect(c.children![0].name).toBe("deep.ts");
  });

  it("SortsDirectoriesBeforeFiles", () => {
    const result = buildTree([
      file("z-file.ts"),
      dir("a-dir"),
      file("a-file.ts"),
      dir("z-dir"),
    ]);

    // Directories should come first
    expect(result[0].type).toBe("directory");
    expect(result[1].type).toBe("directory");
    expect(result[2].type).toBe("file");
    expect(result[3].type).toBe("file");
  });

  it("SortsAlphabeticallyWithinDirectories", () => {
    const result = buildTree([
      dir("zebra"),
      dir("alpha"),
      dir("mango"),
    ]);

    expect(result[0].name).toBe("alpha");
    expect(result[1].name).toBe("mango");
    expect(result[2].name).toBe("zebra");
  });

  it("SortsAlphabeticallyWithinFiles", () => {
    const result = buildTree([
      file("z.ts"),
      file("a.ts"),
      file("m.ts"),
    ]);

    expect(result[0].name).toBe("a.ts");
    expect(result[1].name).toBe("m.ts");
    expect(result[2].name).toBe("z.ts");
  });

  it("AutoExpandsFirstTwoLevels", () => {
    const result = buildTree([
      dir("src"),
      dir("src/components"),
      dir("src/components/deep"),
      file("src/components/deep/file.ts"),
    ]);

    // Level 1 (src) → should be expanded
    const src = result[0];
    expect(src.isExpanded).toBe(true);

    // Level 2 (src/components) → should be expanded
    const components = src.children![0];
    expect(components.isExpanded).toBe(true);

    // Level 3 (src/components/deep) → should NOT be expanded (parts.length > 2)
    const deep = components.children![0];
    expect(deep.isExpanded).toBe(false);
  });

  it("FilesHaveIsExpandedTrueWhenAtFirstTwoLevels", () => {
    // isExpanded is set based on depth (parts.length <= 2), not node type
    // Root-level files (parts.length === 1) are isExpanded: true
    const result = buildTree([file("index.ts")]);
    expect(result[0].isExpanded).toBe(true);
  });

  it("HandlesOrphanedFilesGracefully", () => {
    // File whose parent directory wasn't included in the list
    const result = buildTree([file("src/orphan.ts")]);

    // Should add it to root as a fallback
    const found = findNode(result, "orphan.ts");
    expect(found).toBeDefined();
  });

  it("PreservesFileSizeInOutput", () => {
    const result = buildTree([file("large.ts", 9999)]);
    expect(result[0].size).toBe(9999);
  });

  it("SetsChildrenToUndefinedForFiles", () => {
    const result = buildTree([file("foo.ts")]);
    expect(result[0].children).toBeUndefined();
  });

  it("SetsChildrenToEmptyArrayForEmptyDirectory", () => {
    const result = buildTree([dir("empty-dir")]);
    expect(result[0].children).toEqual([]);
  });

  it("HandlesMultipleTopLevelDirsAndFiles", () => {
    const result = buildTree([
      dir("src"),
      dir("tests"),
      file("src/index.ts"),
      file("tests/index.test.ts"),
      file("README.md"),
      file("package.json"),
    ]);

    // 2 dirs + 2 root files
    expect(result).toHaveLength(4);
    // Dirs sorted first
    expect(result[0].type).toBe("directory");
    expect(result[1].type).toBe("directory");
    // src has 1 child
    const src = result.find((n) => n.name === "src");
    expect(src?.children).toHaveLength(1);
  });
});

// ─── expandTo tests ───────────────────────────────────────────────────────────

// Mock apiFetch so useFileTree can be instantiated without a real server
vi.mock("@/lib/api-client", () => ({
  apiFetch: vi.fn(),
}));

import { apiFetch } from "@/lib/api-client";
const mockApiFetch = vi.mocked(apiFetch);

describe("useFileTree — expandTo", () => {
  beforeEach(() => {
    // Return a minimal tree with nested directories
    mockApiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        root: "/workspace",
        files: [
          { path: "src", type: "directory" },
          { path: "src/components", type: "directory" },
          { path: "src/components/deep", type: "directory" },
          { path: "src/components/deep/file.ts", type: "file", size: 10 },
          { path: "src/utils", type: "directory" },
          { path: "src/utils/helper.ts", type: "file", size: 5 },
        ],
      }),
    } as unknown as Response);
  });

  it("ExpandsAllAncestorDirectories", async () => {
    const { result } = renderHook(() => useFileTree("sess-1", "inst-1"));

    // Fetch the tree first
    await act(async () => {
      result.current.fetchTree();
    });

    // Wait a tick for state to settle
    await act(async () => {});

    // Initially "src/components/deep" should NOT be expanded (level 3)
    const findNode = (nodes: FileTreeNode[], path: string): FileTreeNode | undefined => {
      for (const n of nodes) {
        if (n.path === path) return n;
        if (n.children) {
          const found = findNode(n.children, path);
          if (found) return found;
        }
      }
      return undefined;
    };

    const deepBefore = findNode(result.current.tree, "src/components/deep");
    expect(deepBefore?.isExpanded).toBe(false);

    // Call expandTo on the deep file path
    act(() => {
      result.current.expandTo("src/components/deep/file.ts");
    });

    // All ancestor directories should now be expanded
    const srcAfter = findNode(result.current.tree, "src");
    const componentsAfter = findNode(result.current.tree, "src/components");
    const deepAfter = findNode(result.current.tree, "src/components/deep");

    expect(srcAfter?.isExpanded).toBe(true);
    expect(componentsAfter?.isExpanded).toBe(true);
    expect(deepAfter?.isExpanded).toBe(true);
  });

  it("DoesNotAffectUnrelatedDirectories", async () => {
    const { result } = renderHook(() => useFileTree("sess-1", "inst-1"));

    await act(async () => {
      result.current.fetchTree();
    });
    await act(async () => {});

    const findNode = (nodes: FileTreeNode[], path: string): FileTreeNode | undefined => {
      for (const n of nodes) {
        if (n.path === path) return n;
        if (n.children) {
          const found = findNode(n.children, path);
          if (found) return found;
        }
      }
      return undefined;
    };

    // Snapshot the initial state of src/utils before expandTo
    const utilsBefore = findNode(result.current.tree, "src/utils");
    const utilsInitialExpanded = utilsBefore?.isExpanded;

    // expandTo a completely different subtree
    act(() => {
      result.current.expandTo("src/components/deep/file.ts");
    });

    // src/utils state should be unchanged (expandTo didn't touch it)
    const utilsAfter = findNode(result.current.tree, "src/utils");
    expect(utilsAfter?.isExpanded).toBe(utilsInitialExpanded);
  });

  it("HandlesRootLevelPathGracefully", async () => {
    const { result } = renderHook(() => useFileTree("sess-1", "inst-1"));

    await act(async () => {
      result.current.fetchTree();
    });
    await act(async () => {});

    // expandTo a root-level file should not throw
    expect(() => {
      act(() => {
        result.current.expandTo("README.md");
      });
    }).not.toThrow();
  });
});
