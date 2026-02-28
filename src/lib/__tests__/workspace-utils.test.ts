import {
  deriveDisplayName,
  groupSessionsByWorkspace,
  filterSessionsByWorkspace,
} from "@/lib/workspace-utils";
import type { SessionListItem } from "@/lib/api-types";
import type { Session } from "@opencode-ai/sdk/v2";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeSDKSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "session-1",
    title: "Test Session",
    directory: "/home/user/project",
    projectID: "proj-1",
    version: "1.0.0",
    time: { created: 1700000000, updated: 1700000001 },
    ...overrides,
  } as Session;
}

function makeSession(overrides: Partial<SessionListItem> = {}): SessionListItem {
  return {
    instanceId: "instance-1",
    workspaceId: "ws-1",
    workspaceDirectory: "/home/user/project",
    workspaceDisplayName: null,
    isolationStrategy: "existing",
    sessionStatus: "active",
    instanceStatus: "running",
    session: makeSDKSession(),
    ...overrides,
  };
}

// ─── deriveDisplayName ────────────────────────────────────────────────────────

describe("deriveDisplayName", () => {
  it("returns workspaceDisplayName when present", () => {
    const item = makeSession({ workspaceDisplayName: "My Project" });
    expect(deriveDisplayName(item)).toBe("My Project");
  });

  it("falls back to last path segment of workspaceDirectory", () => {
    const item = makeSession({
      workspaceDisplayName: null,
      workspaceDirectory: "/home/user/my-repo",
    });
    expect(deriveDisplayName(item)).toBe("my-repo");
  });

  it("handles trailing slash by using the last non-empty segment", () => {
    const item = makeSession({
      workspaceDisplayName: null,
      workspaceDirectory: "/home/user/my-repo/",
    });
    expect(deriveDisplayName(item)).toBe("my-repo");
  });

  it("handles root path edge case by returning the original directory", () => {
    const item = makeSession({
      workspaceDisplayName: null,
      workspaceDirectory: "/",
    });
    expect(deriveDisplayName(item)).toBe("/");
  });
});

// ─── groupSessionsByWorkspace ─────────────────────────────────────────────────

describe("groupSessionsByWorkspace", () => {
  it("returns empty array for empty sessions", () => {
    expect(groupSessionsByWorkspace([])).toEqual([]);
  });

  it("returns single group with correct fields for single session", () => {
    const session = makeSession({
      workspaceId: "ws-1",
      workspaceDirectory: "/home/user/project",
      workspaceDisplayName: "My Project",
      sessionStatus: "active",
      instanceStatus: "running",
    });

    const groups = groupSessionsByWorkspace([session]);

    expect(groups).toHaveLength(1);
    expect(groups[0].workspaceId).toBe("ws-1");
    expect(groups[0].workspaceDirectory).toBe("/home/user/project");
    expect(groups[0].displayName).toBe("My Project");
    expect(groups[0].sessionCount).toBe(1);
    expect(groups[0].hasRunningSession).toBe(true);
    expect(groups[0].sessions).toEqual([session]);
  });

  it("groups sessions by workspaceDirectory, not workspaceId", () => {
    const session1 = makeSession({
      instanceId: "inst-1",
      workspaceId: "ws-1",
      workspaceDirectory: "/home/user/project",
    });
    const session2 = makeSession({
      instanceId: "inst-2",
      workspaceId: "ws-2",
      workspaceDirectory: "/home/user/project",
    });

    const groups = groupSessionsByWorkspace([session1, session2]);

    expect(groups).toHaveLength(1);
    expect(groups[0].sessions).toHaveLength(2);
  });

  it("merges multiple workspace IDs with same directory into a single group", () => {
    const session1 = makeSession({
      instanceId: "inst-1",
      workspaceId: "ws-alpha",
      workspaceDirectory: "/shared/dir",
    });
    const session2 = makeSession({
      instanceId: "inst-2",
      workspaceId: "ws-beta",
      workspaceDirectory: "/shared/dir",
    });
    const session3 = makeSession({
      instanceId: "inst-3",
      workspaceId: "ws-gamma",
      workspaceDirectory: "/shared/dir",
    });

    const groups = groupSessionsByWorkspace([session1, session2, session3]);

    expect(groups).toHaveLength(1);
    expect(groups[0].sessions).toHaveLength(3);
  });

  it("sets sessionCount equal to number of sessions in the group", () => {
    const sessions = [
      makeSession({ instanceId: "inst-1", workspaceDirectory: "/dir/a" }),
      makeSession({ instanceId: "inst-2", workspaceDirectory: "/dir/a" }),
      makeSession({ instanceId: "inst-3", workspaceDirectory: "/dir/a" }),
    ];

    const groups = groupSessionsByWorkspace(sessions);

    expect(groups[0].sessionCount).toBe(3);
  });

  it("sets hasRunningSession true only when sessionStatus=active AND instanceStatus=running", () => {
    const session = makeSession({
      sessionStatus: "active",
      instanceStatus: "running",
    });

    const groups = groupSessionsByWorkspace([session]);

    expect(groups[0].hasRunningSession).toBe(true);
  });

  it("sets hasRunningSession false when active+dead", () => {
    const session = makeSession({
      sessionStatus: "active",
      instanceStatus: "dead",
    });

    const groups = groupSessionsByWorkspace([session]);

    expect(groups[0].hasRunningSession).toBe(false);
  });

  it("sets hasRunningSession false when stopped+running", () => {
    const session = makeSession({
      sessionStatus: "stopped",
      instanceStatus: "running",
    });

    const groups = groupSessionsByWorkspace([session]);

    expect(groups[0].hasRunningSession).toBe(false);
  });

  it("sets hasRunningSession false when disconnected+dead", () => {
    const session = makeSession({
      sessionStatus: "disconnected",
      instanceStatus: "dead",
    });

    const groups = groupSessionsByWorkspace([session]);

    expect(groups[0].hasRunningSession).toBe(false);
  });

  it("sets hasRunningSession true when idle+running", () => {
    const session = makeSession({
      sessionStatus: "idle",
      instanceStatus: "running",
    });

    const groups = groupSessionsByWorkspace([session]);

    expect(groups[0].hasRunningSession).toBe(true);
  });

  it("sets hasRunningSession false when completed+dead", () => {
    const session = makeSession({
      sessionStatus: "completed",
      instanceStatus: "dead",
    });

    const groups = groupSessionsByWorkspace([session]);

    expect(groups[0].hasRunningSession).toBe(false);
  });

  it("sets hasRunningSession true if ANY session in the group is active+running", () => {
    const dead = makeSession({
      instanceId: "inst-dead",
      workspaceDirectory: "/shared/dir",
      sessionStatus: "stopped",
      instanceStatus: "dead",
    });
    const running = makeSession({
      instanceId: "inst-running",
      workspaceDirectory: "/shared/dir",
      sessionStatus: "active",
      instanceStatus: "running",
    });

    const groups = groupSessionsByWorkspace([dead, running]);

    expect(groups[0].hasRunningSession).toBe(true);
  });

  it("uses first session's workspaceId for the group", () => {
    const first = makeSession({
      instanceId: "inst-1",
      workspaceId: "ws-first",
      workspaceDirectory: "/shared/dir",
    });
    const second = makeSession({
      instanceId: "inst-2",
      workspaceId: "ws-second",
      workspaceDirectory: "/shared/dir",
    });

    const groups = groupSessionsByWorkspace([first, second]);

    expect(groups[0].workspaceId).toBe("ws-first");
  });

  it("prefers explicit workspaceDisplayName over derived directory name", () => {
    const session = makeSession({
      workspaceDirectory: "/home/user/my-project",
      workspaceDisplayName: "Explicit Display Name",
    });

    const groups = groupSessionsByWorkspace([session]);

    expect(groups[0].displayName).toBe("Explicit Display Name");
  });

  it("uses derived directory name as displayName when workspaceDisplayName is null", () => {
    const session = makeSession({
      workspaceDirectory: "/home/user/my-project",
      workspaceDisplayName: null,
    });

    const groups = groupSessionsByWorkspace([session]);

    expect(groups[0].displayName).toBe("my-project");
  });

  it("sorts groups with running sessions before non-running sessions", () => {
    const stoppedSession = makeSession({
      instanceId: "inst-stopped",
      workspaceDirectory: "/dir/a-alpha",
      workspaceDisplayName: null,
      sessionStatus: "stopped",
      instanceStatus: "dead",
    });
    const runningSession = makeSession({
      instanceId: "inst-running",
      workspaceDirectory: "/dir/z-zeta",
      workspaceDisplayName: null,
      sessionStatus: "active",
      instanceStatus: "running",
    });

    const groups = groupSessionsByWorkspace([stoppedSession, runningSession]);

    expect(groups[0].workspaceDirectory).toBe("/dir/z-zeta");
    expect(groups[1].workspaceDirectory).toBe("/dir/a-alpha");
  });

  it("sorts non-running groups alphabetically by displayName", () => {
    const charlie = makeSession({
      instanceId: "inst-c",
      workspaceDirectory: "/dir/charlie",
      workspaceDisplayName: null,
      sessionStatus: "stopped",
      instanceStatus: "dead",
    });
    const alpha = makeSession({
      instanceId: "inst-a",
      workspaceDirectory: "/dir/alpha",
      workspaceDisplayName: null,
      sessionStatus: "stopped",
      instanceStatus: "dead",
    });
    const bravo = makeSession({
      instanceId: "inst-b",
      workspaceDirectory: "/dir/bravo",
      workspaceDisplayName: null,
      sessionStatus: "stopped",
      instanceStatus: "dead",
    });

    const groups = groupSessionsByWorkspace([charlie, alpha, bravo]);

    expect(groups[0].displayName).toBe("alpha");
    expect(groups[1].displayName).toBe("bravo");
    expect(groups[2].displayName).toBe("charlie");
  });

  it("creates multiple groups for multiple distinct directories", () => {
    const session1 = makeSession({
      instanceId: "inst-1",
      workspaceId: "ws-1",
      workspaceDirectory: "/dir/project-a",
    });
    const session2 = makeSession({
      instanceId: "inst-2",
      workspaceId: "ws-2",
      workspaceDirectory: "/dir/project-b",
    });
    const session3 = makeSession({
      instanceId: "inst-3",
      workspaceId: "ws-3",
      workspaceDirectory: "/dir/project-c",
    });

    const groups = groupSessionsByWorkspace([session1, session2, session3]);

    expect(groups).toHaveLength(3);
  });
});

// ─── filterSessionsByWorkspace ────────────────────────────────────────────────

describe("filterSessionsByWorkspace", () => {
  it("returns all sessions when filter is null", () => {
    const sessions = [
      makeSession({ instanceId: "inst-1", workspaceId: "ws-1" }),
      makeSession({ instanceId: "inst-2", workspaceId: "ws-2" }),
    ];

    expect(filterSessionsByWorkspace(sessions, null)).toBe(sessions);
  });

  it("returns all sessions when filter is undefined", () => {
    const sessions = [
      makeSession({ instanceId: "inst-1", workspaceId: "ws-1" }),
      makeSession({ instanceId: "inst-2", workspaceId: "ws-2" }),
    ];

    expect(filterSessionsByWorkspace(sessions, undefined)).toBe(sessions);
  });

  it("returns all sessions when filter is empty string (falsy)", () => {
    const sessions = [
      makeSession({ instanceId: "inst-1", workspaceId: "ws-1" }),
      makeSession({ instanceId: "inst-2", workspaceId: "ws-2" }),
    ];

    expect(filterSessionsByWorkspace(sessions, "")).toBe(sessions);
  });

  it("returns all sessions sharing the matched workspace directory", () => {
    const target1 = makeSession({
      instanceId: "inst-1",
      workspaceId: "ws-1",
      workspaceDirectory: "/dir/shared",
    });
    const target2 = makeSession({
      instanceId: "inst-2",
      workspaceId: "ws-2",
      workspaceDirectory: "/dir/shared",
    });
    const other = makeSession({
      instanceId: "inst-3",
      workspaceId: "ws-3",
      workspaceDirectory: "/dir/other",
    });

    const result = filterSessionsByWorkspace([target1, target2, other], "ws-1");

    expect(result).toHaveLength(2);
    expect(result).toContain(target1);
    expect(result).toContain(target2);
    expect(result).not.toContain(other);
  });

  it("returns all sessions in the same directory when filtering by any one workspace ID", () => {
    const session1 = makeSession({
      instanceId: "inst-1",
      workspaceId: "ws-alpha",
      workspaceDirectory: "/dir/shared",
    });
    const session2 = makeSession({
      instanceId: "inst-2",
      workspaceId: "ws-beta",
      workspaceDirectory: "/dir/shared",
    });
    const other = makeSession({
      instanceId: "inst-3",
      workspaceId: "ws-other",
      workspaceDirectory: "/dir/other",
    });

    const resultByAlpha = filterSessionsByWorkspace([session1, session2, other], "ws-alpha");
    const resultByBeta = filterSessionsByWorkspace([session1, session2, other], "ws-beta");

    expect(resultByAlpha).toHaveLength(2);
    expect(resultByBeta).toHaveLength(2);
    expect(resultByAlpha).toContain(session1);
    expect(resultByAlpha).toContain(session2);
    expect(resultByBeta).toContain(session1);
    expect(resultByBeta).toContain(session2);
  });

  it("returns empty array when filter does not match any workspaceId", () => {
    const sessions = [
      makeSession({ instanceId: "inst-1", workspaceId: "ws-1" }),
      makeSession({ instanceId: "inst-2", workspaceId: "ws-2" }),
    ];

    expect(filterSessionsByWorkspace(sessions, "ws-nonexistent")).toEqual([]);
  });

  it("returns empty array for empty sessions regardless of filter", () => {
    expect(filterSessionsByWorkspace([], "ws-1")).toEqual([]);
  });
});
