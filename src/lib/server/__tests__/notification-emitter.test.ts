import type { DbNotification } from "@/lib/server/db-repository";
import { emitNotification, onNotification } from "@/lib/server/notification-emitter";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeNotification(overrides?: Partial<DbNotification>): DbNotification {
  return {
    id: "notif-1",
    type: "session_completed",
    message: "Test session finished",
    session_id: "sess-1",
    instance_id: "inst-1",
    pipeline_id: null,
    read: 0,
    created_at: "2025-01-01 00:00:00",
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("notification emitter", () => {
  it("SubscriberReceivesEmittedNotification", () => {
    const received: DbNotification[] = [];
    const unsubscribe = onNotification((n) => received.push(n));

    const notification = makeNotification();
    emitNotification(notification);

    expect(received).toHaveLength(1);
    expect(received[0]).toBe(notification);
    unsubscribe();
  });

  it("MultipleSubscribersAllReceiveNotification", () => {
    const received1: DbNotification[] = [];
    const received2: DbNotification[] = [];
    const unsub1 = onNotification((n) => received1.push(n));
    const unsub2 = onNotification((n) => received2.push(n));

    emitNotification(makeNotification());

    expect(received1).toHaveLength(1);
    expect(received2).toHaveLength(1);
    unsub1();
    unsub2();
  });

  it("UnsubscribeStopsDelivery", () => {
    const received: DbNotification[] = [];
    const unsubscribe = onNotification((n) => received.push(n));

    emitNotification(makeNotification({ id: "first" }));
    unsubscribe();
    emitNotification(makeNotification({ id: "second" }));

    expect(received).toHaveLength(1);
    expect(received[0].id).toBe("first");
  });

  it("NoSubscribersDoesNotThrow", () => {
    expect(() => emitNotification(makeNotification())).not.toThrow();
  });

  it("NotificationDataIsPassedThrough", () => {
    const received: DbNotification[] = [];
    const unsubscribe = onNotification((n) => received.push(n));

    const notification = makeNotification({
      id: "custom-id",
      type: "session_error",
      message: "Something broke",
      session_id: "sess-99",
      instance_id: "inst-77",
      read: 0,
    });
    emitNotification(notification);

    expect(received[0].id).toBe("custom-id");
    expect(received[0].type).toBe("session_error");
    expect(received[0].message).toBe("Something broke");
    expect(received[0].session_id).toBe("sess-99");
    expect(received[0].instance_id).toBe("inst-77");
    unsubscribe();
  });

  it("MultipleEmissionsDeliverInOrder", () => {
    const received: DbNotification[] = [];
    const unsubscribe = onNotification((n) => received.push(n));

    emitNotification(makeNotification({ id: "a" }));
    emitNotification(makeNotification({ id: "b" }));
    emitNotification(makeNotification({ id: "c" }));

    expect(received).toHaveLength(3);
    expect(received.map((n) => n.id)).toEqual(["a", "b", "c"]);
    unsubscribe();
  });
});
