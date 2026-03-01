import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { _resetDbForTests, getDb } from "@/lib/server/database";
import { listNotifications } from "@/lib/server/db-repository";
import {
  startNotificationCleanup,
  _resetForTests,
} from "@/lib/server/notification-cleanup";

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  process.env.WEAVE_DB_PATH = join(
    tmpdir(),
    `fleet-cleanup-test-${randomUUID()}.db`
  );
  _resetDbForTests();
  _resetForTests();
});

afterEach(() => {
  _resetForTests();
  _resetDbForTests();
  delete process.env.WEAVE_DB_PATH;
  delete process.env.WEAVE_NOTIFICATION_TTL_DAYS;
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function insertWithAge(daysAgo: number): void {
  const date = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  const createdAt = date
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d+Z$/, "");
  // Insert via raw SQL to set created_at to an arbitrary past date
  getDb()
    .prepare(
      `INSERT INTO notifications (id, type, session_id, instance_id, pipeline_id, message, created_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?)`
    )
    .run(
      randomUUID(),
      "session_completed",
      `sess-${randomUUID()}`,
      `inst-${randomUUID()}`,
      `Notification from ${daysAgo} days ago`,
      createdAt
    );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("notification cleanup", () => {
  it("DeletesNotificationsOlderThanDefaultTtl", () => {
    insertWithAge(10); // 10 days ago — should be deleted (default TTL = 7)
    insertWithAge(3); // 3 days ago — should remain

    startNotificationCleanup();

    const remaining = listNotifications();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].message).toContain("3 days ago");
  });

  it("RespectsCustomTtlFromEnv", () => {
    process.env.WEAVE_NOTIFICATION_TTL_DAYS = "2";

    insertWithAge(5); // 5 days ago — should be deleted (TTL = 2)
    insertWithAge(1); // 1 day ago — should remain

    startNotificationCleanup();

    const remaining = listNotifications();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].message).toContain("1 days ago");
  });

  it("KeepsAllNotificationsWhenNoneAreExpired", () => {
    insertWithAge(1);
    insertWithAge(2);
    insertWithAge(3);

    startNotificationCleanup();

    expect(listNotifications()).toHaveLength(3);
  });

  it("IsIdempotentWhenCalledMultipleTimes", () => {
    insertWithAge(10);
    insertWithAge(1);

    startNotificationCleanup();
    // Second call should be a no-op (guard prevents re-scheduling)
    startNotificationCleanup();

    expect(listNotifications()).toHaveLength(1);
  });

  it("HandlesEmptyTableGracefully", () => {
    expect(listNotifications()).toHaveLength(0);
    // Should not throw
    startNotificationCleanup();
    expect(listNotifications()).toHaveLength(0);
  });

  it("ResetForTestsClearsIntervalState", () => {
    startNotificationCleanup();
    _resetForTests();
    // After reset, startNotificationCleanup should re-run cleanup
    insertWithAge(10);
    startNotificationCleanup();
    expect(listNotifications()).toHaveLength(0);
  });
});
