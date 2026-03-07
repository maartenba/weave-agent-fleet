import { nestSessions, sessionsChanged, type NestedSession } from "@/lib/session-utils";
import type { SessionListItem } from "@/lib/api-types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

let counter = 0;

function makeItem(overrides: Partial<SessionListItem> & { sessionId?: string } = {}): SessionListItem {
  const id = overrides.sessionId ?? `sess-${++counter}`;
  return {
    instanceId: "inst-1",
    workspaceId: "ws-1",
    workspaceDirectory: "/tmp/proj",
    workspaceDisplayName: null,
    isolationStrategy: "existing",
    sourceDirectory: null,
    sessionStatus: "active",
    instanceStatus: "running",
    session: { id, title: "Test Session", messageCount: 0, ...overrides.session } as SessionListItem["session"],
    dbId: undefined,
    parentSessionId: undefined,
    activityStatus: "busy",
    lifecycleStatus: "running",
    typedInstanceStatus: "running",
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("nestSessions", () => {
  beforeEach(() => {
    counter = 0;
  });

  it("ReturnsEmptyArrayForEmptyInput", () => {
    expect(nestSessions([])).toEqual([]);
  });

  it("PassesThroughSessionsWithNoParentOrDbId", () => {
    const items = [makeItem(), makeItem(), makeItem()];
    const result = nestSessions(items);

    expect(result.length).toBe(3);
    result.forEach((n: NestedSession) => {
      expect(n.children).toEqual([]);
    });
  });

  it("GroupsChildUnderParent", () => {
    const parent = makeItem({ sessionId: "parent", dbId: "db-parent" });
    const child = makeItem({ sessionId: "child", parentSessionId: "db-parent" });
    const result = nestSessions([parent, child]);

    expect(result.length).toBe(1);
    expect(result[0]!.item.session.id).toBe("parent");
    expect(result[0]!.children.length).toBe(1);
    expect(result[0]!.children[0]!.session.id).toBe("child");
  });

  it("GroupsMultipleChildrenUnderOneParent", () => {
    const parent = makeItem({ sessionId: "p", dbId: "db-p" });
    const c1 = makeItem({ sessionId: "c1", parentSessionId: "db-p" });
    const c2 = makeItem({ sessionId: "c2", parentSessionId: "db-p" });
    const c3 = makeItem({ sessionId: "c3", parentSessionId: "db-p" });
    const result = nestSessions([parent, c1, c2, c3]);

    expect(result.length).toBe(1);
    expect(result[0]!.children.length).toBe(3);
    const childIds = result[0]!.children.map((c) => c.session.id);
    expect(childIds).toContain("c1");
    expect(childIds).toContain("c2");
    expect(childIds).toContain("c3");
  });

  it("OrphanedChildRemainsTopLevel", () => {
    const orphan = makeItem({ sessionId: "orphan", parentSessionId: "db-nonexistent" });
    const standalone = makeItem({ sessionId: "standalone" });
    const result = nestSessions([orphan, standalone]);

    expect(result.length).toBe(2);
    const ids = result.map((n) => n.item.session.id);
    expect(ids).toContain("orphan");
    expect(ids).toContain("standalone");
    result.forEach((n: NestedSession) => {
      expect(n.children).toEqual([]);
    });
  });

  it("MultipleParentsWithChildren", () => {
    const p1 = makeItem({ sessionId: "p1", dbId: "db-p1" });
    const p2 = makeItem({ sessionId: "p2", dbId: "db-p2" });
    const c1a = makeItem({ sessionId: "c1a", parentSessionId: "db-p1" });
    const c1b = makeItem({ sessionId: "c1b", parentSessionId: "db-p1" });
    const c2a = makeItem({ sessionId: "c2a", parentSessionId: "db-p2" });
    const standalone = makeItem({ sessionId: "s1" });

    const result = nestSessions([p1, p2, c1a, c1b, c2a, standalone]);

    expect(result.length).toBe(3); // p1, p2, standalone
    const p1Result = result.find((n) => n.item.session.id === "p1");
    const p2Result = result.find((n) => n.item.session.id === "p2");
    const sResult = result.find((n) => n.item.session.id === "s1");

    expect(p1Result!.children.length).toBe(2);
    expect(p2Result!.children.length).toBe(1);
    expect(sResult!.children.length).toBe(0);
  });

  it("SessionWithoutDbIdCannotBeParent", () => {
    // parent has no dbId, so child with parentSessionId cannot link to it
    const notParent = makeItem({ sessionId: "np" }); // no dbId
    const wouldBeChild = makeItem({ sessionId: "wbc", parentSessionId: "np" });
    const result = nestSessions([notParent, wouldBeChild]);

    expect(result.length).toBe(2);
    result.forEach((n: NestedSession) => {
      expect(n.children).toEqual([]);
    });
  });

  it("OrderPreservesInputOrderForTopLevel", () => {
    const a = makeItem({ sessionId: "a", dbId: "db-a" });
    const b = makeItem({ sessionId: "b" });
    const c = makeItem({ sessionId: "c", dbId: "db-c" });
    const childOfA = makeItem({ sessionId: "ca", parentSessionId: "db-a" });

    const result = nestSessions([a, b, c, childOfA]);

    expect(result.length).toBe(3);
    expect(result[0]!.item.session.id).toBe("a");
    expect(result[1]!.item.session.id).toBe("b");
    expect(result[2]!.item.session.id).toBe("c");
  });

  it("ParentWithDbIdButNoChildrenHasEmptyArray", () => {
    const parent = makeItem({ sessionId: "lonely", dbId: "db-lonely" });
    const result = nestSessions([parent]);

    expect(result.length).toBe(1);
    expect(result[0]!.children).toEqual([]);
  });
});

// ─── sessionsChanged Tests ────────────────────────────────────────────────────

describe("sessionsChanged", () => {
  beforeEach(() => {
    counter = 0;
  });

  it("returns false when arrays are identical (same data)", () => {
    const a = [makeItem({ sessionId: "s1" }), makeItem({ sessionId: "s2" })];
    const b = [makeItem({ sessionId: "s1" }), makeItem({ sessionId: "s2" })];
    expect(sessionsChanged(a, b)).toBe(false);
  });

  it("returns true when a session's activityStatus changes", () => {
    const a = [makeItem({ sessionId: "s1", activityStatus: "busy" })];
    const b = [makeItem({ sessionId: "s1", activityStatus: "idle" })];
    expect(sessionsChanged(a, b)).toBe(true);
  });

  it("returns true when array lengths differ", () => {
    const a = [makeItem({ sessionId: "s1" })];
    const b = [makeItem({ sessionId: "s1" }), makeItem({ sessionId: "s2" })];
    expect(sessionsChanged(a, b)).toBe(true);
  });

  it("returns true when session order changes (different session.id at same index)", () => {
    const a = [makeItem({ sessionId: "s1" }), makeItem({ sessionId: "s2" })];
    const b = [makeItem({ sessionId: "s2" }), makeItem({ sessionId: "s1" })];
    expect(sessionsChanged(a, b)).toBe(true);
  });

  it("returns false for empty arrays", () => {
    expect(sessionsChanged([], [])).toBe(false);
  });

  it("returns true when sessionStatus changes", () => {
    const a = [makeItem({ sessionId: "s1", sessionStatus: "active" })];
    const b = [makeItem({ sessionId: "s1", sessionStatus: "idle" })];
    expect(sessionsChanged(a, b)).toBe(true);
  });

  it("returns true when lifecycleStatus changes", () => {
    const a = [makeItem({ sessionId: "s1", lifecycleStatus: "running" })];
    const b = [makeItem({ sessionId: "s1", lifecycleStatus: "completed" })];
    expect(sessionsChanged(a, b)).toBe(true);
  });

  it("returns true when instanceStatus changes", () => {
    const a = [makeItem({ sessionId: "s1", instanceStatus: "running" })];
    const b = [makeItem({ sessionId: "s1", instanceStatus: "dead" })];
    expect(sessionsChanged(a, b)).toBe(true);
  });

  it("returns true when session title changes", () => {
    const a = [makeItem({ sessionId: "s1", session: { id: "s1", title: "Old", messageCount: 0 } as SessionListItem["session"] })];
    const b = [makeItem({ sessionId: "s1", session: { id: "s1", title: "New", messageCount: 0 } as SessionListItem["session"] })];
    expect(sessionsChanged(a, b)).toBe(true);
  });

  it("returns true when session messageCount changes", () => {
    const a = [makeItem({ sessionId: "s1", session: { id: "s1", title: "T", messageCount: 5 } as SessionListItem["session"] })];
    const b = [makeItem({ sessionId: "s1", session: { id: "s1", title: "T", messageCount: 6 } as SessionListItem["session"] })];
    expect(sessionsChanged(a, b)).toBe(true);
  });
});
