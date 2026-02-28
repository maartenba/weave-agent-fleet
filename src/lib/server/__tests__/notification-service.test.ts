import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { _resetDbForTests } from "@/lib/server/database";
import { listNotifications, countUnreadNotifications } from "@/lib/server/db-repository";
import {
  createSessionCompletedNotification,
  createSessionErrorNotification,
  createSessionDisconnectedNotification,
} from "@/lib/server/notification-service";

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  process.env.WEAVE_DB_PATH = join(tmpdir(), `fleet-notif-svc-test-${randomUUID()}.db`);
  _resetDbForTests();
});

afterEach(() => {
  _resetDbForTests();
  delete process.env.WEAVE_DB_PATH;
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("notification service", () => {
  it("CreateSessionCompletedNotificationInsertsCorrectRecord", () => {
    const sessionId = `sess-${randomUUID()}`;
    const instanceId = `inst-${randomUUID()}`;
    createSessionCompletedNotification(sessionId, instanceId, "My Session");
    const notifications = listNotifications();
    expect(notifications).toHaveLength(1);
    expect(notifications[0].type).toBe("session_completed");
    expect(notifications[0].message).toBe("My Session finished");
    expect(notifications[0].session_id).toBe(sessionId);
    expect(notifications[0].instance_id).toBe(instanceId);
    expect(notifications[0].read).toBe(0);
  });

  it("CreateSessionErrorNotificationInsertsCorrectRecord", () => {
    const sessionId = `sess-${randomUUID()}`;
    const instanceId = `inst-${randomUUID()}`;
    createSessionErrorNotification(sessionId, instanceId, "Broken Session");
    const notifications = listNotifications();
    expect(notifications).toHaveLength(1);
    expect(notifications[0].type).toBe("session_error");
    expect(notifications[0].message).toBe("Broken Session encountered an error");
    expect(notifications[0].session_id).toBe(sessionId);
    expect(notifications[0].instance_id).toBe(instanceId);
  });

  it("CreateSessionDisconnectedNotificationInsertsCorrectRecord", () => {
    const sessionId = `sess-${randomUUID()}`;
    const instanceId = `inst-${randomUUID()}`;
    createSessionDisconnectedNotification(sessionId, instanceId, "Dead Session");
    const notifications = listNotifications();
    expect(notifications).toHaveLength(1);
    expect(notifications[0].type).toBe("session_disconnected");
    expect(notifications[0].message).toBe("Dead Session lost connection");
    expect(notifications[0].session_id).toBe(sessionId);
    expect(notifications[0].instance_id).toBe(instanceId);
  });

  it("DeduplicationPreventsSecondNotificationWithin60s", () => {
    const sessionId = `sess-${randomUUID()}`;
    const instanceId = `inst-${randomUUID()}`;
    createSessionCompletedNotification(sessionId, instanceId, "My Session");
    createSessionCompletedNotification(sessionId, instanceId, "My Session");
    expect(countUnreadNotifications()).toBe(1);
  });

  it("DeduplicationAllowsDifferentSessionsToCreateSeparateNotifications", () => {
    const sessionId1 = `sess-${randomUUID()}`;
    const sessionId2 = `sess-${randomUUID()}`;
    const instanceId = `inst-${randomUUID()}`;
    createSessionCompletedNotification(sessionId1, instanceId, "Session A");
    createSessionCompletedNotification(sessionId2, instanceId, "Session B");
    expect(countUnreadNotifications()).toBe(2);
  });

  it("DeduplicationAllowsDifferentTypesForSameSession", () => {
    const sessionId = `sess-${randomUUID()}`;
    const instanceId = `inst-${randomUUID()}`;
    createSessionCompletedNotification(sessionId, instanceId, "My Session");
    createSessionErrorNotification(sessionId, instanceId, "My Session");
    expect(countUnreadNotifications()).toBe(2);
  });
});
