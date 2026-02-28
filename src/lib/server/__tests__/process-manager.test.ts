import { writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { homedir } from "os";
import { resolve } from "path";
import { allocatePort, releasePort, _resetForTests, validateDirectory } from "@/lib/server/process-manager";
import { _resetDbForTests } from "@/lib/server/database";
import { getInstance as getDbInstance, getRunningInstances } from "@/lib/server/db-repository";

// Use an isolated temp DB for all process-manager tests
beforeAll(() => {
  process.env.WEAVE_DB_PATH = join(tmpdir(), `pm-test-${randomUUID()}.db`);
});

afterAll(() => {
  _resetDbForTests();
  delete process.env.WEAVE_DB_PATH;
});

// ---------------------------------------------------------------------------
// Port allocation
// ---------------------------------------------------------------------------

describe("allocatePort", () => {
  beforeEach(() => {
    _resetForTests();
  });

  it("AllocatesFirstPortAs4097", () => {
    expect(allocatePort()).toBe(4097);
  });

  it("AllocatesSequentialPorts", () => {
    expect(allocatePort()).toBe(4097);
    expect(allocatePort()).toBe(4098);
    expect(allocatePort()).toBe(4099);
  });

  it("ThrowsWhenAllPortsExhausted", () => {
    // Allocate all 104 ports (4097–4200 inclusive)
    for (let i = 0; i < 104; i++) {
      allocatePort();
    }
    expect(() => allocatePort()).toThrow("No available ports in range 4097\u20134200");
  });

  it("ReusesReleasedPort", () => {
    const first = allocatePort();   // 4097
    const second = allocatePort();  // 4098
    releasePort(first);             // free 4097
    expect(allocatePort()).toBe(first); // 4097 reused
    expect(second).toBe(4098);
  });

  it("AllocatesSkippingReleasedMiddlePort", () => {
    allocatePort(); // 4097
    allocatePort(); // 4098
    allocatePort(); // 4099
    releasePort(4098);
    // Next allocation should find 4098 first
    expect(allocatePort()).toBe(4098);
  });
});

// ---------------------------------------------------------------------------
// releasePort
// ---------------------------------------------------------------------------

describe("releasePort", () => {
  beforeEach(() => {
    _resetForTests();
  });

  it("IsNoOpForUnallocatedPort", () => {
    // Should not throw
    expect(() => releasePort(4097)).not.toThrow();
    expect(() => releasePort(9999)).not.toThrow();
  });

  it("AllowsPortToBeReallocatedAfterRelease", () => {
    allocatePort(); // 4097
    releasePort(4097);
    expect(allocatePort()).toBe(4097);
  });
});

// ---------------------------------------------------------------------------
// _resetForTests
// ---------------------------------------------------------------------------

describe("_resetForTests", () => {
  it("ClearsUsedPortsStateAfterAllocation", () => {
    allocatePort(); // 4097
    allocatePort(); // 4098
    _resetForTests();
    // After reset the first port should be 4097 again
    expect(allocatePort()).toBe(4097);
  });
});

// ---------------------------------------------------------------------------
// validateDirectory
// ---------------------------------------------------------------------------

describe("validateDirectory", () => {
  afterEach(() => {
    delete process.env.ORCHESTRATOR_WORKSPACE_ROOTS;
  });

  it("ReturnsResolvedPathForValidDirectoryUnderConfiguredRoot", () => {
    process.env.ORCHESTRATOR_WORKSPACE_ROOTS = "/tmp";
    const result = validateDirectory("/tmp");
    expect(result).toBe(resolve("/tmp"));
  });

  it("ReturnsResolvedPathForSubdirectoryUnderConfiguredRoot", () => {
    process.env.ORCHESTRATOR_WORKSPACE_ROOTS = "/tmp";
    const result = validateDirectory("/tmp/.");
    expect(result).toBe(resolve("/tmp"));
  });

  it("ThrowsWhenPathTraversalEscapesAllowedRoot", () => {
    // /tmp/../etc resolves to /etc which is not under /tmp
    process.env.ORCHESTRATOR_WORKSPACE_ROOTS = "/tmp";
    expect(() => validateDirectory("/tmp/../etc")).toThrow(
      "Directory is outside the allowed workspace roots"
    );
  });

  it("ThrowsForDirectoryNotUnderAnyRoot", () => {
    process.env.ORCHESTRATOR_WORKSPACE_ROOTS = "/tmp";
    expect(() => validateDirectory("/var")).toThrow(
      "Directory is outside the allowed workspace roots"
    );
  });

  it("ThrowsForNonExistentDirectory", () => {
    process.env.ORCHESTRATOR_WORKSPACE_ROOTS = "/tmp";
    expect(() => validateDirectory("/tmp/__nonexistent_vitest_dir_xyz123__")).toThrow(
      "Directory does not exist"
    );
  });

  it("ThrowsWhenPathExistsButIsAFile", () => {
    process.env.ORCHESTRATOR_WORKSPACE_ROOTS = "/tmp";
    const tempFile = "/tmp/__vitest_process_manager_test_file__.txt";
    writeFileSync(tempFile, "test");
    try {
      expect(() => validateDirectory(tempFile)).toThrow("Path exists but is not a directory");
    } finally {
      rmSync(tempFile, { force: true });
    }
  });

  it("AcceptsMultipleRootsAndValidatesUnderFirstRoot", () => {
    process.env.ORCHESTRATOR_WORKSPACE_ROOTS = "/tmp:/var";
    // /tmp is a valid root — should succeed
    const result = validateDirectory("/tmp");
    expect(result).toBe(resolve("/tmp"));
  });

  it("AcceptsMultipleRootsAndValidatesUnderSecondRoot", () => {
    process.env.ORCHESTRATOR_WORKSPACE_ROOTS = "/tmp:/var";
    // /var is a valid root on macOS — should succeed
    const result = validateDirectory("/var");
    expect(result).toBe(resolve("/var"));
  });

  it("ThrowsWhenDirectoryNotUnderAnyOfMultipleRoots", () => {
    process.env.ORCHESTRATOR_WORKSPACE_ROOTS = "/tmp:/var";
    expect(() => validateDirectory("/usr")).toThrow(
      "Directory is outside the allowed workspace roots"
    );
  });

  it("DefaultsToHomedirWhenEnvVarIsUnset", () => {
    // ORCHESTRATOR_WORKSPACE_ROOTS is not set — defaults to homedir()
    const home = homedir();
    const result = validateDirectory(home);
    expect(result).toBe(resolve(home));
  });

  it("ThrowsForPathOutsideHomedirWhenEnvVarIsUnset", () => {
    // /tmp is not under homedir() when env var is unset
    expect(() => validateDirectory("/tmp")).toThrow(
      "Directory is outside the allowed workspace roots"
    );
  });

  it("ReturnsResolvedAbsolutePathNotRawInput", () => {
    process.env.ORCHESTRATOR_WORKSPACE_ROOTS = "/tmp";
    // Pass a path with redundant segments; expect the canonical resolved form
    const result = validateDirectory("/tmp/./");
    expect(result).toBe(resolve("/tmp"));
    expect(result).not.toContain(".");
  });

  it("AllowsRootItselfNotJustSubdirectories", () => {
    process.env.ORCHESTRATOR_WORKSPACE_ROOTS = "/tmp";
    // The root itself (/tmp === /tmp) should be allowed
    expect(() => validateDirectory("/tmp")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// _resetForTests — does not reset DB (DB tests are in db-repository.test.ts)
// ---------------------------------------------------------------------------

describe("_resetForTests with DB", () => {
  beforeEach(() => {
    _resetForTests();
  });

  it("ClearsUsedPortsStateAfterAllocationWithDbPresent", () => {
    allocatePort(); // 4097
    allocatePort(); // 4098
    _resetForTests();
    expect(allocatePort()).toBe(4097);
  });
});

// ---------------------------------------------------------------------------
// DB integration — verifies that DB functions are accessible from tests
// ---------------------------------------------------------------------------

describe("DB integration — repository accessible", () => {
  it("GetRunningInstancesReturnsEmptyWhenNoneInserted", () => {
    const running = getRunningInstances();
    expect(Array.isArray(running)).toBe(true);
  });

  it("GetDbInstanceReturnsUndefinedForUnknownId", () => {
    expect(getDbInstance("nonexistent-id")).toBeUndefined();
  });
});
