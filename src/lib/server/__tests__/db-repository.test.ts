import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { _resetDbForTests } from "@/lib/server/database";
import {
  insertWorkspace,
  getWorkspace,
  listWorkspaces,
  markWorkspaceCleaned,
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
});
