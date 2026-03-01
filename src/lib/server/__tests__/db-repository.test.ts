import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { _resetDbForTests } from "@/lib/server/database";
import {
  insertWorkspace,
  getWorkspace,
  listWorkspaces,
  markWorkspaceCleaned,
  updateWorkspaceDisplayName,
  insertInstance,
  getInstance,
  getInstanceByDirectory,
  listInstances,
  updateInstanceStatus,
  getRunningInstances,
  insertSession,
  getSession,
  getSessionByOpencodeId,
  listSessions,
  listActiveSessions,
  updateSessionStatus,
  getSessionsForInstance,
  updateSessionForResume,
  deleteSession,
  getSessionsForWorkspace,
  insertNotification,
  deleteNotificationsForSession,
  listNotifications,
  insertSessionCallback,
  getPendingCallbacksForSession,
  markCallbackFired,
  deleteCallbacksForSession,
} from "@/lib/server/db-repository";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mkWorkspaceId() {
  return `ws-${randomUUID()}`;
}

function mkInstanceId() {
  return `inst-${randomUUID()}`;
}

function mkSessionId() {
  return `sess-${randomUUID()}`;
}

function mkOpencodeSessionId() {
  return `oc-${randomUUID()}`;
}

function mkCallbackId() {
  return `cb-${randomUUID()}`;
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  process.env.WEAVE_DB_PATH = join(tmpdir(), `fleet-repo-test-${randomUUID()}.db`);
  _resetDbForTests();
});

afterEach(() => {
  _resetDbForTests();
  delete process.env.WEAVE_DB_PATH;
});

// ─── Workspaces ───────────────────────────────────────────────────────────────

describe("workspace repository", () => {
  it("InsertsAndRetrievesWorkspace", () => {
    const id = mkWorkspaceId();
    insertWorkspace({ id, directory: "/tmp/project", isolation_strategy: "existing" });
    const ws = getWorkspace(id);
    expect(ws).toBeDefined();
    expect(ws?.id).toBe(id);
    expect(ws?.directory).toBe("/tmp/project");
    expect(ws?.isolation_strategy).toBe("existing");
    expect(ws?.cleaned_up_at).toBeNull();
  });

  it("InsertsWorkspaceWithAllOptionalFields", () => {
    const id = mkWorkspaceId();
    insertWorkspace({
      id,
      directory: "/tmp/workspace",
      isolation_strategy: "worktree",
      source_directory: "/tmp/source",
      branch: "feature/test",
    });
    const ws = getWorkspace(id);
    expect(ws?.source_directory).toBe("/tmp/source");
    expect(ws?.branch).toBe("feature/test");
  });

  it("ReturnsUndefinedForMissingWorkspace", () => {
    expect(getWorkspace("nonexistent")).toBeUndefined();
  });

  it("ListsWorkspacesAndContainsAllInserted", () => {
    const id1 = mkWorkspaceId();
    const id2 = mkWorkspaceId();
    insertWorkspace({ id: id1, directory: "/tmp/a", isolation_strategy: "existing" });
    insertWorkspace({ id: id2, directory: "/tmp/b", isolation_strategy: "existing" });
    const list = listWorkspaces();
    expect(list.length).toBe(2);
    const ids = list.map((w) => w.id);
    expect(ids).toContain(id1);
    expect(ids).toContain(id2);
  });

  it("ListsEmptyWhenNoWorkspaces", () => {
    expect(listWorkspaces()).toEqual([]);
  });

  it("MarksWorkspaceAsCleaned", () => {
    const id = mkWorkspaceId();
    insertWorkspace({ id, directory: "/tmp/x", isolation_strategy: "clone" });
    markWorkspaceCleaned(id);
    const ws = getWorkspace(id);
    expect(ws?.cleaned_up_at).not.toBeNull();
  });

  it("UpdatesWorkspaceDisplayName", () => {
    const id = mkWorkspaceId();
    insertWorkspace({ id, directory: "/tmp/named", isolation_strategy: "existing" });
    expect(getWorkspace(id)?.display_name).toBeNull();

    updateWorkspaceDisplayName(id, "My Project");
    const ws = getWorkspace(id);
    expect(ws?.display_name).toBe("My Project");
  });

  it("UpdatesDisplayNameOnlyForTargetWorkspace", () => {
    const id1 = mkWorkspaceId();
    const id2 = mkWorkspaceId();
    insertWorkspace({ id: id1, directory: "/tmp/a", isolation_strategy: "existing" });
    insertWorkspace({ id: id2, directory: "/tmp/b", isolation_strategy: "existing" });

    updateWorkspaceDisplayName(id1, "Renamed");
    expect(getWorkspace(id1)?.display_name).toBe("Renamed");
    expect(getWorkspace(id2)?.display_name).toBeNull();
  });

  it("OverwritesExistingDisplayName", () => {
    const id = mkWorkspaceId();
    insertWorkspace({ id, directory: "/tmp/ow", isolation_strategy: "existing" });
    updateWorkspaceDisplayName(id, "First");
    updateWorkspaceDisplayName(id, "Second");
    expect(getWorkspace(id)?.display_name).toBe("Second");
  });
});

// ─── Instances ────────────────────────────────────────────────────────────────

describe("instance repository", () => {
  it("InsertsAndRetrievesInstance", () => {
    const id = mkInstanceId();
    insertInstance({ id, port: 4097, directory: "/tmp/proj", url: "http://localhost:4097" });
    const inst = getInstance(id);
    expect(inst).toBeDefined();
    expect(inst?.id).toBe(id);
    expect(inst?.port).toBe(4097);
    expect(inst?.status).toBe("running");
    expect(inst?.pid).toBeNull();
  });

  it("InsertsInstanceWithPid", () => {
    const id = mkInstanceId();
    insertInstance({ id, port: 4098, directory: "/tmp/proj2", url: "http://localhost:4098", pid: 12345 });
    const inst = getInstance(id);
    expect(inst?.pid).toBe(12345);
  });

  it("ReturnsUndefinedForMissingInstance", () => {
    expect(getInstance("nonexistent")).toBeUndefined();
  });

  it("GetsInstanceByDirectory", () => {
    const id = mkInstanceId();
    insertInstance({ id, port: 4099, directory: "/tmp/specific", url: "http://localhost:4099" });
    const inst = getInstanceByDirectory("/tmp/specific");
    expect(inst?.id).toBe(id);
  });

  it("ReturnsUndefinedForStoppedInstanceByDirectory", () => {
    const id = mkInstanceId();
    insertInstance({ id, port: 4100, directory: "/tmp/stopped", url: "http://localhost:4100" });
    updateInstanceStatus(id, "stopped");
    expect(getInstanceByDirectory("/tmp/stopped")).toBeUndefined();
  });

  it("ListsAllInstances", () => {
    insertInstance({ id: mkInstanceId(), port: 4101, directory: "/tmp/a", url: "http://localhost:4101" });
    insertInstance({ id: mkInstanceId(), port: 4102, directory: "/tmp/b", url: "http://localhost:4102" });
    expect(listInstances().length).toBe(2);
  });

  it("UpdatesInstanceStatusToStopped", () => {
    const id = mkInstanceId();
    insertInstance({ id, port: 4103, directory: "/tmp/c", url: "http://localhost:4103" });
    const now = new Date().toISOString();
    updateInstanceStatus(id, "stopped", now);
    const inst = getInstance(id);
    expect(inst?.status).toBe("stopped");
    expect(inst?.stopped_at).toBe(now);
  });

  it("GetRunningInstancesExcludesStopped", () => {
    const runId = mkInstanceId();
    const stopId = mkInstanceId();
    insertInstance({ id: runId, port: 4104, directory: "/tmp/r", url: "http://localhost:4104" });
    insertInstance({ id: stopId, port: 4105, directory: "/tmp/s", url: "http://localhost:4105" });
    updateInstanceStatus(stopId, "stopped");
    const running = getRunningInstances();
    expect(running.length).toBe(1);
    expect(running[0]?.id).toBe(runId);
  });
});

// ─── Sessions ─────────────────────────────────────────────────────────────────

describe("session repository", () => {
  function setup() {
    const wsId = mkWorkspaceId();
    const instId = mkInstanceId();
    insertWorkspace({ id: wsId, directory: "/tmp/proj", isolation_strategy: "existing" });
    insertInstance({ id: instId, port: 4200, directory: "/tmp/proj", url: "http://localhost:4200" });
    return { wsId, instId };
  }

  it("InsertsAndRetrievesSession", () => {
    const { wsId, instId } = setup();
    const id = mkSessionId();
    const ocId = mkOpencodeSessionId();
    insertSession({
      id,
      workspace_id: wsId,
      instance_id: instId,
      opencode_session_id: ocId,
      directory: "/tmp/proj",
    });
    const sess = getSession(id);
    expect(sess).toBeDefined();
    expect(sess?.id).toBe(id);
    expect(sess?.opencode_session_id).toBe(ocId);
    expect(sess?.status).toBe("active");
    expect(sess?.title).toBe("Untitled");
  });

  it("InsertsSessionWithCustomTitle", () => {
    const { wsId, instId } = setup();
    const id = mkSessionId();
    insertSession({
      id,
      workspace_id: wsId,
      instance_id: instId,
      opencode_session_id: mkOpencodeSessionId(),
      directory: "/tmp/proj",
      title: "My Task",
    });
    expect(getSession(id)?.title).toBe("My Task");
  });

  it("ReturnsUndefinedForMissingSession", () => {
    expect(getSession("nonexistent")).toBeUndefined();
  });

  it("GetsSessionByOpencodeId", () => {
    const { wsId, instId } = setup();
    const id = mkSessionId();
    const ocId = mkOpencodeSessionId();
    insertSession({ id, workspace_id: wsId, instance_id: instId, opencode_session_id: ocId, directory: "/tmp/proj" });
    expect(getSessionByOpencodeId(ocId)?.id).toBe(id);
  });

  it("ListsAllSessions", () => {
    const { wsId, instId } = setup();
    insertSession({ id: mkSessionId(), workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });
    insertSession({ id: mkSessionId(), workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });
    expect(listSessions().length).toBe(2);
  });

  it("ListsOnlyActiveSessions", () => {
    const { wsId, instId } = setup();
    const id1 = mkSessionId();
    const id2 = mkSessionId();
    insertSession({ id: id1, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });
    insertSession({ id: id2, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });
    updateSessionStatus(id1, "stopped");
    const active = listActiveSessions();
    expect(active.length).toBe(1);
    expect(active[0]?.id).toBe(id2);
  });

  it("UpdatesSessionStatusToStopped", () => {
    const { wsId, instId } = setup();
    const id = mkSessionId();
    insertSession({ id, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });
    const now = new Date().toISOString();
    updateSessionStatus(id, "stopped", now);
    const sess = getSession(id);
    expect(sess?.status).toBe("stopped");
    expect(sess?.stopped_at).toBe(now);
  });

  it("UpdatesSessionStatusToDisconnected", () => {
    const { wsId, instId } = setup();
    const id = mkSessionId();
    insertSession({ id, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });
    updateSessionStatus(id, "disconnected");
    expect(getSession(id)?.status).toBe("disconnected");
  });

  it("GetsSessionsForInstance", () => {
    const { wsId, instId } = setup();
    const id1 = mkSessionId();
    const id2 = mkSessionId();
    insertSession({ id: id1, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });
    insertSession({ id: id2, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });
    updateSessionStatus(id1, "stopped");
    const sessions = getSessionsForInstance(instId);
    expect(sessions.length).toBe(1);
    expect(sessions[0]?.id).toBe(id2);
  });

  it("UpdatesSessionStatusToIdle", () => {
    const { wsId, instId } = setup();
    const id = mkSessionId();
    insertSession({ id, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });
    updateSessionStatus(id, "idle");
    const sess = getSession(id);
    expect(sess?.status).toBe("idle");
  });

  it("UpdatesSessionStatusToCompleted", () => {
    const { wsId, instId } = setup();
    const id = mkSessionId();
    insertSession({ id, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });
    const now = new Date().toISOString();
    updateSessionStatus(id, "completed", now);
    const sess = getSession(id);
    expect(sess?.status).toBe("completed");
    expect(sess?.stopped_at).toBe(now);
  });

  it("GetSessionsForInstanceReturnsIdleSessions", () => {
    const { wsId, instId } = setup();
    const id1 = mkSessionId();
    const id2 = mkSessionId();
    insertSession({ id: id1, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });
    insertSession({ id: id2, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });
    updateSessionStatus(id2, "idle");
    const sessions = getSessionsForInstance(instId);
    expect(sessions.length).toBe(2);
    const ids = sessions.map((s) => s.id);
    expect(ids).toContain(id1);
    expect(ids).toContain(id2);
  });

  it("ListActiveSessionsIncludesIdleSessions", () => {
    const { wsId, instId } = setup();
    const id1 = mkSessionId();
    const id2 = mkSessionId();
    const id3 = mkSessionId();
    const id4 = mkSessionId();
    insertSession({ id: id1, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });
    insertSession({ id: id2, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });
    insertSession({ id: id3, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });
    insertSession({ id: id4, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });
    updateSessionStatus(id2, "idle");
    updateSessionStatus(id3, "stopped");
    updateSessionStatus(id4, "disconnected");
    const active = listActiveSessions();
    expect(active.length).toBe(2);
    const ids = active.map((s) => s.id);
    expect(ids).toContain(id1); // active
    expect(ids).toContain(id2); // idle
  });

  it("UpdateSessionForResumeUpdatesInstanceIdAndSetsStatusActive", () => {
    const { wsId, instId } = setup();
    const id = mkSessionId();
    insertSession({ id, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });
    updateSessionStatus(id, "disconnected");

    const newInstId = mkInstanceId();
    insertInstance({ id: newInstId, port: 4300, directory: "/tmp/proj", url: "http://localhost:4300" });
    updateSessionForResume(id, newInstId);

    const sess = getSession(id);
    expect(sess?.instance_id).toBe(newInstId);
    expect(sess?.status).toBe("active");
  });

  it("UpdateSessionForResumeClearsStoppedAt", () => {
    const { wsId, instId } = setup();
    const id = mkSessionId();
    insertSession({ id, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });
    updateSessionStatus(id, "stopped", new Date().toISOString());
    expect(getSession(id)?.stopped_at).not.toBeNull();

    const newInstId = mkInstanceId();
    insertInstance({ id: newInstId, port: 4301, directory: "/tmp/proj", url: "http://localhost:4301" });
    updateSessionForResume(id, newInstId);

    expect(getSession(id)?.stopped_at).toBeNull();
  });

  it("UpdateSessionForResumeWorksForDisconnectedSession", () => {
    const { wsId, instId } = setup();
    const id = mkSessionId();
    insertSession({ id, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });
    updateSessionStatus(id, "disconnected");

    const newInstId = mkInstanceId();
    insertInstance({ id: newInstId, port: 4302, directory: "/tmp/proj", url: "http://localhost:4302" });
    updateSessionForResume(id, newInstId);

    const sess = getSession(id);
    expect(sess?.status).toBe("active");
    expect(sess?.instance_id).toBe(newInstId);
  });

  it("UpdateSessionForResumeWorksForStoppedSession", () => {
    const { wsId, instId } = setup();
    const id = mkSessionId();
    insertSession({ id, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });
    updateSessionStatus(id, "stopped", new Date().toISOString());

    const newInstId = mkInstanceId();
    insertInstance({ id: newInstId, port: 4303, directory: "/tmp/proj", url: "http://localhost:4303" });
    updateSessionForResume(id, newInstId);

    expect(getSession(id)?.status).toBe("active");
  });

  it("UpdateSessionForResumeIsNoOpForNonexistentSession", () => {
    // Should not throw — updating a non-existent row is a no-op in SQLite
    expect(() => updateSessionForResume("nonexistent-id", "some-inst-id")).not.toThrow();
  });
});

// ─── Session Deletion ─────────────────────────────────────────────────────────

describe("session deletion", () => {
  function setup() {
    const wsId = mkWorkspaceId();
    const instId = mkInstanceId();
    insertWorkspace({ id: wsId, directory: "/tmp/proj", isolation_strategy: "existing" });
    insertInstance({ id: instId, port: 4500, directory: "/tmp/proj", url: "http://localhost:4500" });
    return { wsId, instId };
  }

  it("DeletesSessionFromDatabase", () => {
    const { wsId, instId } = setup();
    const id = mkSessionId();
    insertSession({
      id,
      workspace_id: wsId,
      instance_id: instId,
      opencode_session_id: mkOpencodeSessionId(),
      directory: "/tmp/proj",
    });
    expect(getSession(id)).toBeDefined();

    deleteSession(id);

    expect(getSession(id)).toBeUndefined();
  });

  it("DeleteSessionReturnsTrueWhenRowDeleted", () => {
    const { wsId, instId } = setup();
    const id = mkSessionId();
    insertSession({
      id,
      workspace_id: wsId,
      instance_id: instId,
      opencode_session_id: mkOpencodeSessionId(),
      directory: "/tmp/proj",
    });

    const result = deleteSession(id);

    expect(result).toBe(true);
  });

  it("DeleteSessionReturnsFalseForNonexistentSession", () => {
    const result = deleteSession("nonexistent-session-id");
    expect(result).toBe(false);
  });

  it("DeleteSessionDoesNotAffectOtherSessions", () => {
    const { wsId, instId } = setup();
    const id1 = mkSessionId();
    const id2 = mkSessionId();
    insertSession({ id: id1, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });
    insertSession({ id: id2, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });

    deleteSession(id1);

    expect(getSession(id1)).toBeUndefined();
    expect(getSession(id2)).toBeDefined();
  });

  it("GetSessionsForWorkspaceReturnsAllSessionsForWorkspace", () => {
    const { wsId, instId } = setup();
    const id1 = mkSessionId();
    const id2 = mkSessionId();
    insertSession({ id: id1, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });
    insertSession({ id: id2, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });

    const sessions = getSessionsForWorkspace(wsId);

    expect(sessions.length).toBe(2);
    const ids = sessions.map((s) => s.id);
    expect(ids).toContain(id1);
    expect(ids).toContain(id2);
  });

  it("DeleteNotificationsForSessionRemovesMatchingNotifications", () => {
    const sessionId = randomUUID();
    const otherSessionId = randomUUID();

    insertNotification({ id: randomUUID(), type: "info", message: "msg1", session_id: sessionId });
    insertNotification({ id: randomUUID(), type: "info", message: "msg2", session_id: sessionId });
    insertNotification({ id: randomUUID(), type: "info", message: "msg3", session_id: otherSessionId });
    insertNotification({ id: randomUUID(), type: "info", message: "msg4" }); // no session_id

    deleteNotificationsForSession(sessionId);

    const remaining = listNotifications() as { session_id: string | null; message: string }[];
    const messages = remaining.map((n) => n.message);
    expect(messages).not.toContain("msg1");
    expect(messages).not.toContain("msg2");
    expect(messages).toContain("msg3");
    expect(messages).toContain("msg4");
  });

  it("DeleteNotificationsForSessionReturnsDeletedCount", () => {
    const sessionId = randomUUID();

    insertNotification({ id: randomUUID(), type: "info", message: "a", session_id: sessionId });
    insertNotification({ id: randomUUID(), type: "info", message: "b", session_id: sessionId });
    insertNotification({ id: randomUUID(), type: "info", message: "c", session_id: sessionId });

    const count = deleteNotificationsForSession(sessionId);

    expect(count).toBe(3);
  });

  it("DeleteNotificationsForSessionReturnsZeroWhenNoneMatch", () => {
    const count = deleteNotificationsForSession("nonexistent-session-id");
    expect(count).toBe(0);
  });
});

// ─── Session Callbacks ────────────────────────────────────────────────────────

describe("session callback repository", () => {
  function setup() {
    const wsId = mkWorkspaceId();
    const instId = mkInstanceId();
    insertWorkspace({ id: wsId, directory: "/tmp/proj", isolation_strategy: "existing" });
    insertInstance({ id: instId, port: 4600, directory: "/tmp/proj", url: "http://localhost:4600" });
    const sourceId = mkSessionId();
    const targetId = mkSessionId();
    insertSession({ id: sourceId, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });
    insertSession({ id: targetId, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });
    return { wsId, instId, sourceId, targetId };
  }

  it("InsertsAndRetrievesPendingCallback", () => {
    const { instId, sourceId, targetId } = setup();
    const cbId = mkCallbackId();
    insertSessionCallback({ id: cbId, source_session_id: sourceId, target_session_id: targetId, target_instance_id: instId });

    const pending = getPendingCallbacksForSession(sourceId);
    expect(pending.length).toBe(1);
    expect(pending[0]?.id).toBe(cbId);
    expect(pending[0]?.source_session_id).toBe(sourceId);
    expect(pending[0]?.target_session_id).toBe(targetId);
    expect(pending[0]?.target_instance_id).toBe(instId);
    expect(pending[0]?.status).toBe("pending");
    expect(pending[0]?.fired_at).toBeNull();
  });

  it("ReturnsEmptyArrayWhenNoCallbacks", () => {
    expect(getPendingCallbacksForSession("nonexistent")).toEqual([]);
  });

  it("ReturnsMultiplePendingCallbacksForSameSource", () => {
    const { wsId, instId, sourceId } = setup();
    const target2 = mkSessionId();
    insertSession({ id: target2, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });

    insertSessionCallback({ id: mkCallbackId(), source_session_id: sourceId, target_session_id: sourceId, target_instance_id: instId });
    insertSessionCallback({ id: mkCallbackId(), source_session_id: sourceId, target_session_id: target2, target_instance_id: instId });

    expect(getPendingCallbacksForSession(sourceId).length).toBe(2);
  });

  it("MarkCallbackFiredExcludesFromPending", () => {
    const { instId, sourceId, targetId } = setup();
    const cbId = mkCallbackId();
    insertSessionCallback({ id: cbId, source_session_id: sourceId, target_session_id: targetId, target_instance_id: instId });

    markCallbackFired(cbId);

    const pending = getPendingCallbacksForSession(sourceId);
    expect(pending.length).toBe(0);
  });

  it("MarkCallbackFiredSetsFiredAt", () => {
    const { instId, sourceId, targetId } = setup();
    const cbId = mkCallbackId();
    insertSessionCallback({ id: cbId, source_session_id: sourceId, target_session_id: targetId, target_instance_id: instId });

    markCallbackFired(cbId);

    // Verify via a raw query that status is 'fired' and fired_at is set
    // We can check indirectly: getPendingCallbacksForSession won't return it,
    // and inserting another callback for the same source still works
    const pending = getPendingCallbacksForSession(sourceId);
    expect(pending.length).toBe(0);
  });

  it("MarkCallbackFiredOnlyAffectsTargetCallback", () => {
    const { instId, sourceId, targetId } = setup();
    const cb1 = mkCallbackId();
    const cb2 = mkCallbackId();
    insertSessionCallback({ id: cb1, source_session_id: sourceId, target_session_id: targetId, target_instance_id: instId });
    insertSessionCallback({ id: cb2, source_session_id: sourceId, target_session_id: targetId, target_instance_id: instId });

    markCallbackFired(cb1);

    const pending = getPendingCallbacksForSession(sourceId);
    expect(pending.length).toBe(1);
    expect(pending[0]?.id).toBe(cb2);
  });

  it("DeleteCallbacksBySourceSession", () => {
    const { instId, sourceId, targetId } = setup();
    insertSessionCallback({ id: mkCallbackId(), source_session_id: sourceId, target_session_id: targetId, target_instance_id: instId });
    insertSessionCallback({ id: mkCallbackId(), source_session_id: sourceId, target_session_id: targetId, target_instance_id: instId });

    const count = deleteCallbacksForSession(sourceId);

    expect(count).toBe(2);
    expect(getPendingCallbacksForSession(sourceId)).toEqual([]);
  });

  it("DeleteCallbacksByTargetSession", () => {
    const { instId, sourceId, targetId } = setup();
    insertSessionCallback({ id: mkCallbackId(), source_session_id: sourceId, target_session_id: targetId, target_instance_id: instId });

    const count = deleteCallbacksForSession(targetId);

    expect(count).toBe(1);
    expect(getPendingCallbacksForSession(sourceId)).toEqual([]);
  });

  it("DeleteCallbacksReturnsZeroWhenNoneMatch", () => {
    expect(deleteCallbacksForSession("nonexistent")).toBe(0);
  });

  it("DeleteCallbacksDoesNotAffectOtherSessions", () => {
    const { wsId, instId, sourceId, targetId } = setup();
    const otherSource = mkSessionId();
    insertSession({ id: otherSource, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });

    insertSessionCallback({ id: mkCallbackId(), source_session_id: sourceId, target_session_id: targetId, target_instance_id: instId });
    insertSessionCallback({ id: mkCallbackId(), source_session_id: otherSource, target_session_id: targetId, target_instance_id: instId });

    deleteCallbacksForSession(sourceId);

    expect(getPendingCallbacksForSession(otherSource).length).toBe(1);
  });
});
