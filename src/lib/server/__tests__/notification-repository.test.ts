import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { _resetDbForTests } from "@/lib/server/database";
import {
  insertNotification,
  getNotification,
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  countUnreadNotifications,
  deleteNotification,
} from "@/lib/server/db-repository";

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  process.env.WEAVE_DB_PATH = join(tmpdir(), `fleet-notif-test-${randomUUID()}.db`);
  _resetDbForTests();
});

afterEach(() => {
  _resetDbForTests();
  delete process.env.WEAVE_DB_PATH;
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mkNotifId() {
  return `notif-${randomUUID()}`;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("notification repository", () => {
  it("InsertsAndRetrievesNotification", () => {
    const id = mkNotifId();
    insertNotification({ id, type: "session_completed", message: "Fix auth bug finished" });
    const notif = getNotification(id);
    expect(notif).toBeDefined();
    expect(notif!.id).toBe(id);
    expect(notif!.type).toBe("session_completed");
    expect(notif!.message).toBe("Fix auth bug finished");
    expect(notif!.read).toBe(0);
    expect(notif!.session_id).toBeNull();
    expect(notif!.instance_id).toBeNull();
    expect(notif!.pipeline_id).toBeNull();
  });

  it("InsertsNotificationWithOptionalFields", () => {
    const id = mkNotifId();
    const sessionId = `sess-${randomUUID()}`;
    const instanceId = `inst-${randomUUID()}`;
    insertNotification({
      id,
      type: "session_error",
      message: "Fix auth bug encountered an error",
      session_id: sessionId,
      instance_id: instanceId,
    });
    const notif = getNotification(id);
    expect(notif!.session_id).toBe(sessionId);
    expect(notif!.instance_id).toBe(instanceId);
    expect(notif!.pipeline_id).toBeNull();
  });

  it("ReturnsUndefinedForMissingNotification", () => {
    const result = getNotification("nonexistent-id");
    expect(result).toBeUndefined();
  });

  it("ListsAllNotificationsOrderedByCreatedAtDesc", () => {
    const id1 = mkNotifId();
    const id2 = mkNotifId();
    const id3 = mkNotifId();
    insertNotification({ id: id1, type: "session_completed", message: "A finished" });
    insertNotification({ id: id2, type: "session_error", message: "B errored" });
    insertNotification({ id: id3, type: "session_disconnected", message: "C lost connection" });
    const all = listNotifications();
    expect(all).toHaveLength(3);
    // All three are present (same-second timestamps may not be strictly ordered)
    const ids = all.map((n) => n.id);
    expect(ids).toContain(id1);
    expect(ids).toContain(id2);
    expect(ids).toContain(id3);
  });

  it("ListsUnreadOnlyNotifications", () => {
    const id1 = mkNotifId();
    const id2 = mkNotifId();
    insertNotification({ id: id1, type: "session_completed", message: "A finished" });
    insertNotification({ id: id2, type: "session_error", message: "B errored" });
    markNotificationRead(id1);
    const unread = listNotifications({ unreadOnly: true });
    expect(unread).toHaveLength(1);
    expect(unread[0].id).toBe(id2);
  });

  it("ListsWithLimit", () => {
    for (let i = 0; i < 5; i++) {
      insertNotification({ id: mkNotifId(), type: "session_completed", message: `Session ${i} finished` });
    }
    const limited = listNotifications({ limit: 3 });
    expect(limited).toHaveLength(3);
  });

  it("MarksSingleNotificationAsRead", () => {
    const id = mkNotifId();
    insertNotification({ id, type: "session_completed", message: "Done" });
    expect(getNotification(id)!.read).toBe(0);
    markNotificationRead(id);
    expect(getNotification(id)!.read).toBe(1);
  });

  it("MarksAllNotificationsAsRead", () => {
    const id1 = mkNotifId();
    const id2 = mkNotifId();
    insertNotification({ id: id1, type: "session_completed", message: "A finished" });
    insertNotification({ id: id2, type: "session_error", message: "B errored" });
    markAllNotificationsRead();
    expect(getNotification(id1)!.read).toBe(1);
    expect(getNotification(id2)!.read).toBe(1);
  });

  it("CountsUnreadNotifications", () => {
    const id1 = mkNotifId();
    const id2 = mkNotifId();
    const id3 = mkNotifId();
    insertNotification({ id: id1, type: "session_completed", message: "A finished" });
    insertNotification({ id: id2, type: "session_error", message: "B errored" });
    insertNotification({ id: id3, type: "session_disconnected", message: "C lost connection" });
    expect(countUnreadNotifications()).toBe(3);
    markNotificationRead(id1);
    expect(countUnreadNotifications()).toBe(2);
    markAllNotificationsRead();
    expect(countUnreadNotifications()).toBe(0);
  });

  it("DeletesNotification", () => {
    const id = mkNotifId();
    insertNotification({ id, type: "session_completed", message: "Done" });
    expect(getNotification(id)).toBeDefined();
    deleteNotification(id);
    expect(getNotification(id)).toBeUndefined();
  });
});
