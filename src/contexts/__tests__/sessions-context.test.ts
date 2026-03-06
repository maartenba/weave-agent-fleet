import { describe, it, expect } from "vitest";
import { patchActivityStatus, activityToSessionStatus } from "@/contexts/sessions-context";
import type { SessionListItem } from "@/lib/api-types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSession(id: string, overrides: Partial<SessionListItem> = {}): SessionListItem {
  return {
    instanceId: "inst-1",
    workspaceId: "ws-1",
    workspaceDirectory: "/tmp/proj",
    workspaceDisplayName: null,
    isolationStrategy: "existing",
    sessionStatus: "idle",
    instanceStatus: "running",
    session: { id } as SessionListItem["session"],
    activityStatus: "idle",
    lifecycleStatus: "running",
    typedInstanceStatus: "running",
    ...overrides,
  };
}

// ─── activityToSessionStatus ──────────────────────────────────────────────────

describe("activityToSessionStatus", () => {
  it("MapsBusyToActive", () => {
    expect(activityToSessionStatus("busy")).toBe("active");
  });

  it("MapsIdleToIdle", () => {
    expect(activityToSessionStatus("idle")).toBe("idle");
  });

  it("MapsWaitingInputToWaitingInput", () => {
    expect(activityToSessionStatus("waiting_input")).toBe("waiting_input");
  });
});

// ─── patchActivityStatus ──────────────────────────────────────────────────────

describe("patchActivityStatus", () => {
  it("PatchesMatchingSession", () => {
    const sessions = [makeSession("sess-1", { activityStatus: "idle", sessionStatus: "idle" })];
    const result = patchActivityStatus(sessions, "sess-1", "busy");

    expect(result).not.toBe(sessions);
    expect(result[0]!.activityStatus).toBe("busy");
    expect(result[0]!.sessionStatus).toBe("active");
  });

  it("ReturnsSameArrayWhenSessionNotFound", () => {
    const sessions = [makeSession("sess-1"), makeSession("sess-2")];
    const result = patchActivityStatus(sessions, "sess-nonexistent", "busy");

    expect(result).toBe(sessions);
  });

  it("ReturnsSameArrayWhenStatusUnchanged", () => {
    const sessions = [makeSession("sess-1", { activityStatus: "busy" })];
    const result = patchActivityStatus(sessions, "sess-1", "busy");

    expect(result).toBe(sessions);
  });

  it("DoesNotMutateOriginalArray", () => {
    const original = makeSession("sess-1", { activityStatus: "idle" });
    const sessions = [original];
    const result = patchActivityStatus(sessions, "sess-1", "busy");

    expect(result).not.toBe(sessions);
    // Original session object is unchanged
    expect(sessions[0]!.activityStatus).toBe("idle");
    expect(original.activityStatus).toBe("idle");
  });

  it("PatchesCorrectSessionAmongMultiple", () => {
    const sessions = [
      makeSession("sess-1", { activityStatus: "idle", sessionStatus: "idle" }),
      makeSession("sess-2", { activityStatus: "idle", sessionStatus: "idle" }),
      makeSession("sess-3", { activityStatus: "idle", sessionStatus: "idle" }),
    ];
    const result = patchActivityStatus(sessions, "sess-2", "waiting_input");

    expect(result).not.toBe(sessions);
    expect(result[0]!.activityStatus).toBe("idle");
    expect(result[0]!.sessionStatus).toBe("idle");
    expect(result[1]!.activityStatus).toBe("waiting_input");
    expect(result[1]!.sessionStatus).toBe("waiting_input");
    expect(result[2]!.activityStatus).toBe("idle");
    expect(result[2]!.sessionStatus).toBe("idle");
    // Unchanged sessions retain same object references
    expect(result[0]).toBe(sessions[0]);
    expect(result[2]).toBe(sessions[2]);
  });
});
