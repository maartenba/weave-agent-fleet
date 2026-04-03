import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "os";
import { mkdtemp, rm, symlink, mkdir } from "fs/promises";
import { join } from "path";

// ─── Import under test ────────────────────────────────────────────────────────

import {
  validatePathWithinRoot,
  validatePathWithinRootSync,
  PathTraversalError,
} from "@/lib/server/path-security";

// ─── Helpers ──────────────────────────────────────────────────────────────────

let tmpRoot: string;
let outsideDir: string;

beforeEach(async () => {
  // Create a real temp directory for each test so realpath works
  tmpRoot = await mkdtemp(join(tmpdir(), "path-sec-root-"));
  outsideDir = await mkdtemp(join(tmpdir(), "path-sec-outside-"));
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
  await rm(outsideDir, { recursive: true, force: true });
});

// ─── validatePathWithinRoot (async) ──────────────────────────────────────────

describe("validatePathWithinRoot (async)", () => {
  it("ReturnsResolvedPathForNormalRelativePath", async () => {
    const result = await validatePathWithinRoot(tmpRoot, "src/index.ts");
    expect(result).toBe(join(tmpRoot, "src/index.ts"));
  });

  it("ReturnsResolvedPathForNestedRelativePath", async () => {
    const result = await validatePathWithinRoot(tmpRoot, "a/b/c/deep.txt");
    expect(result).toBe(join(tmpRoot, "a/b/c/deep.txt"));
  });

  it("ReturnsResolvedPathForFileInRootDirectory", async () => {
    const result = await validatePathWithinRoot(tmpRoot, "README.md");
    expect(result).toBe(join(tmpRoot, "README.md"));
  });

  it("ThrowsForDotDotTraversalEscapingRoot", async () => {
    await expect(
      validatePathWithinRoot(tmpRoot, "../../etc/passwd")
    ).rejects.toBeInstanceOf(PathTraversalError);
  });

  it("ThrowsForSingleDotDotTraversal", async () => {
    await expect(
      validatePathWithinRoot(tmpRoot, "../sibling-file")
    ).rejects.toBeInstanceOf(PathTraversalError);
  });

  it("ThrowsForNullByteInjection", async () => {
    await expect(
      validatePathWithinRoot(tmpRoot, "src/index.ts\0malicious")
    ).rejects.toBeInstanceOf(PathTraversalError);
  });

  it("ThrowsForAbsolutePathInjection", async () => {
    await expect(
      validatePathWithinRoot(tmpRoot, "/etc/passwd")
    ).rejects.toBeInstanceOf(PathTraversalError);
  });

  it("ThrowsForWindowsStyleAbsolutePathInjection", async () => {
    await expect(
      validatePathWithinRoot(tmpRoot, "C:\\Windows\\System32")
    ).rejects.toBeInstanceOf(PathTraversalError);
  });

  it("ThrowsForSymlinkEscapeOutsideRoot", async () => {
    // Create a symlink inside root that points outside
    const linkPath = join(tmpRoot, "escape-link");
    await symlink(outsideDir, linkPath);

    // Create a real file inside outsideDir so realpath succeeds (file exists)
    const { writeFile } = await import("fs/promises");
    await writeFile(join(outsideDir, "secret.txt"), "secret");

    // Path through the symlink resolves to a real path outside root → should throw
    await expect(
      validatePathWithinRoot(tmpRoot, "escape-link/secret.txt")
    ).rejects.toBeInstanceOf(PathTraversalError);
  });

  it("AllowsDeepValidPathInsideRoot", async () => {
    const relativePath = "a/b/c/d/e/f/g/h/deep.json";
    const result = await validatePathWithinRoot(tmpRoot, relativePath);
    expect(result).toBe(join(tmpRoot, relativePath));
  });

  it("ReturnsResolvedPathEvenWhenFileDoesNotExist", async () => {
    // File doesn't need to exist for write operations
    const result = await validatePathWithinRoot(tmpRoot, "new-dir/new-file.ts");
    expect(result).toBe(join(tmpRoot, "new-dir/new-file.ts"));
  });

  it("ResolvesRealPathForExistingFile", async () => {
    // Create a real file
    const { writeFile } = await import("fs/promises");
    await mkdir(join(tmpRoot, "sub"), { recursive: true });
    await writeFile(join(tmpRoot, "sub", "real.ts"), "content");

    const result = await validatePathWithinRoot(tmpRoot, "sub/real.ts");
    // Real path should be returned (tmpdir on macOS may resolve through /private)
    expect(result.endsWith("sub/real.ts")).toBe(true);
  });
});

// ─── validatePathWithinRootSync ───────────────────────────────────────────────

describe("validatePathWithinRootSync", () => {
  it("ReturnsResolvedPathForNormalRelativePath", () => {
    const result = validatePathWithinRootSync(tmpRoot, "src/index.ts");
    expect(result).toBe(join(tmpRoot, "src/index.ts"));
  });

  it("ThrowsForDotDotTraversal", () => {
    expect(() =>
      validatePathWithinRootSync(tmpRoot, "../../etc/passwd")
    ).toThrow(PathTraversalError);
  });

  it("ThrowsForNullByteInjection", () => {
    expect(() =>
      validatePathWithinRootSync(tmpRoot, "file\0name.ts")
    ).toThrow(PathTraversalError);
  });

  it("ThrowsForAbsolutePath", () => {
    expect(() =>
      validatePathWithinRootSync(tmpRoot, "/usr/local/bin/node")
    ).toThrow(PathTraversalError);
  });

  it("AllowsFileAtRootLevel", () => {
    const result = validatePathWithinRootSync(tmpRoot, "package.json");
    expect(result).toBe(join(tmpRoot, "package.json"));
  });
});

// ─── PathTraversalError ───────────────────────────────────────────────────────

describe("PathTraversalError", () => {
  it("IsInstanceOfError", () => {
    const err = new PathTraversalError("test");
    expect(err).toBeInstanceOf(Error);
  });

  it("HasCorrectName", () => {
    const err = new PathTraversalError("test");
    expect(err.name).toBe("PathTraversalError");
  });

  it("PreservesMessage", () => {
    const err = new PathTraversalError("path escapes root");
    expect(err.message).toBe("path escapes root");
  });
});
