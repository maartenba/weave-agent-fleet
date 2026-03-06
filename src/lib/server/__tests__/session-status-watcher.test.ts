/**
 * Tests for session-status-watcher.ts — state management and event processing.
 *
 * Tests the public API: ensureWatching / stopWatching / _resetForTests.
 * Event processing tests use a controllable mock async iterable to simulate
 * the OpenCode SDK event stream.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// Mock process-manager to prevent real instance lookups and recovery
vi.mock("@/lib/server/process-manager", () => ({
  getInstance: vi.fn(() => undefined),
  _recoveryComplete: Promise.resolve(),
}));

// Mock opencode-client to prevent real SDK calls
vi.mock("@/lib/server/opencode-client", () => ({
  getClientForInstance: vi.fn(() => {
    throw new Error("No instance in test");
  }),
}));

// Mock db-repository
vi.mock("@/lib/server/db-repository", () => ({
  getSessionByOpencodeId: vi.fn(() => undefined),
  updateSessionStatus: vi.fn(),
}));

// Mock notification-emitter
vi.mock("@/lib/server/notification-emitter", () => ({
  emitActivityStatus: vi.fn(),
}));

import { ensureWatching, stopWatching, _resetForTests } from "@/lib/server/session-status-watcher";
import * as processManager from "@/lib/server/process-manager";
import * as opencodeClient from "@/lib/server/opencode-client";
import * as dbRepository from "@/lib/server/db-repository";
import * as notificationEmitter from "@/lib/server/notification-emitter";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createMockEventStream() {
  const events: unknown[] = [];
  let resolve: (() => void) | null = null;
  let done = false;

  const stream: AsyncIterable<unknown> = {
    [Symbol.asyncIterator]() {
      let index = 0;
      return {
        async next() {
          while (index >= events.length && !done) {
            await new Promise<void>((r) => {
              resolve = r;
            });
          }
          if (index >= events.length && done) {
            return { done: true as const, value: undefined };
          }
          return { done: false as const, value: events[index++] };
        },
      };
    },
  };

  return {
    stream,
    push(event: unknown) {
      events.push(event);
      resolve?.();
      resolve = null;
    },
    end() {
      done = true;
      resolve?.();
      resolve = null;
    },
  };
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  _resetForTests();
  vi.clearAllMocks();
});

afterEach(() => {
  _resetForTests();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("session-status-watcher", () => {
  describe("ensureWatching / stopWatching", () => {
    it("EnsureWatchingDoesNotThrowWhenInstanceIsDead", () => {
      // getInstance returns undefined → instance is dead / not found
      vi.mocked(processManager.getInstance).mockReturnValue(undefined);
      expect(() => ensureWatching("inst-1")).not.toThrow();
    });

    it("StopWatchingIsNoOpForNonExistentInstance", () => {
      expect(() => stopWatching("nonexistent")).not.toThrow();
    });

    it("DoubleEnsureWatchingIsIdempotent", () => {
      vi.mocked(processManager.getInstance).mockReturnValue(undefined);
      expect(() => {
        ensureWatching("inst-1");
        ensureWatching("inst-1");
      }).not.toThrow();
    });

    it("StopWatchingAfterEnsureWatchingDoesNotThrow", () => {
      vi.mocked(processManager.getInstance).mockReturnValue(undefined);
      ensureWatching("inst-1");
      expect(() => stopWatching("inst-1")).not.toThrow();
    });

    it("DoubleStopIsNoOp", () => {
      vi.mocked(processManager.getInstance).mockReturnValue(undefined);
      ensureWatching("inst-1");
      stopWatching("inst-1");
      expect(() => stopWatching("inst-1")).not.toThrow();
    });
  });

  describe("_resetForTests", () => {
    it("ClearsAllStateWithoutError", () => {
      vi.mocked(processManager.getInstance).mockReturnValue(undefined);
      ensureWatching("inst-1");
      ensureWatching("inst-2");

      expect(() => _resetForTests()).not.toThrow();
    });

    it("AllowsReWatchingAfterReset", () => {
      vi.mocked(processManager.getInstance).mockReturnValue(undefined);
      ensureWatching("inst-1");
      _resetForTests();

      // Should not throw — state was cleared
      expect(() => ensureWatching("inst-1")).not.toThrow();
    });
  });

  describe("event processing", () => {
    const instanceId = "inst-test";

    function setupWatchingWithStream(mockStream: AsyncIterable<unknown>) {
      vi.mocked(processManager.getInstance).mockReturnValue({
        directory: "/test",
        status: "running",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      vi.mocked(opencodeClient.getClientForInstance).mockReturnValue({
        event: {
          subscribe: vi.fn().mockResolvedValue({ stream: mockStream }),
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      ensureWatching(instanceId);
    }

    it("EmitsActivityStatusOnBusyTransition", async () => {
      const mock = createMockEventStream();
      setupWatchingWithStream(mock.stream);

      vi.mocked(dbRepository.getSessionByOpencodeId).mockReturnValue({
        id: "db-1",
        status: "idle",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      mock.push({
        type: "session.status",
        properties: {
          sessionID: "oc-sess-1",
          status: { type: "busy" },
        },
      });

      await vi.waitFor(() => {
        expect(notificationEmitter.emitActivityStatus).toHaveBeenCalled();
      });

      expect(notificationEmitter.emitActivityStatus).toHaveBeenCalledWith({
        sessionId: "oc-sess-1",
        instanceId,
        activityStatus: "busy",
      });
      expect(dbRepository.updateSessionStatus).toHaveBeenCalledWith("db-1", "active");

      mock.end();
    });

    it("EmitsActivityStatusOnIdleTransition", async () => {
      const mock = createMockEventStream();
      setupWatchingWithStream(mock.stream);

      vi.mocked(dbRepository.getSessionByOpencodeId).mockReturnValue({
        id: "db-2",
        status: "active",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      mock.push({
        type: "session.status",
        properties: {
          sessionID: "oc-sess-2",
          status: { type: "idle" },
        },
      });

      await vi.waitFor(() => {
        expect(notificationEmitter.emitActivityStatus).toHaveBeenCalled();
      });

      expect(notificationEmitter.emitActivityStatus).toHaveBeenCalledWith({
        sessionId: "oc-sess-2",
        instanceId,
        activityStatus: "idle",
      });
      expect(dbRepository.updateSessionStatus).toHaveBeenCalledWith("db-2", "idle");

      mock.end();
    });

    it("EmitsActivityStatusOnSessionIdleEvent", async () => {
      const mock = createMockEventStream();
      setupWatchingWithStream(mock.stream);

      vi.mocked(dbRepository.getSessionByOpencodeId).mockReturnValue({
        id: "db-3",
        status: "active",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      mock.push({
        type: "session.idle",
        properties: {
          sessionID: "oc-sess-3",
        },
      });

      await vi.waitFor(() => {
        expect(notificationEmitter.emitActivityStatus).toHaveBeenCalled();
      });

      expect(notificationEmitter.emitActivityStatus).toHaveBeenCalledWith({
        sessionId: "oc-sess-3",
        instanceId,
        activityStatus: "idle",
      });
      expect(dbRepository.updateSessionStatus).toHaveBeenCalledWith("db-3", "idle");

      mock.end();
    });

    it("EmitsWaitingInputOnPermissionEvent", async () => {
      const mock = createMockEventStream();
      setupWatchingWithStream(mock.stream);

      vi.mocked(dbRepository.getSessionByOpencodeId).mockReturnValue({
        id: "db-4",
        status: "active",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      mock.push({
        type: "permission.request",
        properties: {
          sessionID: "oc-sess-4",
        },
      });

      await vi.waitFor(() => {
        expect(notificationEmitter.emitActivityStatus).toHaveBeenCalled();
      });

      expect(notificationEmitter.emitActivityStatus).toHaveBeenCalledWith({
        sessionId: "oc-sess-4",
        instanceId,
        activityStatus: "waiting_input",
      });
      expect(dbRepository.updateSessionStatus).toHaveBeenCalledWith("db-4", "waiting_input");

      mock.end();
    });

    it("DoesNotEmitWhenStatusUnchanged", async () => {
      const mock = createMockEventStream();
      setupWatchingWithStream(mock.stream);

      // DB already has status "idle" — same as what the event reports
      vi.mocked(dbRepository.getSessionByOpencodeId).mockReturnValue({
        id: "db-5",
        status: "idle",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      mock.push({
        type: "session.status",
        properties: {
          sessionID: "oc-sess-5",
          status: { type: "idle" },
        },
      });

      // Give the async loop a chance to process
      await new Promise((r) => setTimeout(r, 30));

      expect(notificationEmitter.emitActivityStatus).not.toHaveBeenCalled();
      expect(dbRepository.updateSessionStatus).not.toHaveBeenCalled();

      mock.end();
    });

    it("DoesNotEmitForUnknownSession", async () => {
      const mock = createMockEventStream();
      setupWatchingWithStream(mock.stream);

      // DB has no record for this session
      vi.mocked(dbRepository.getSessionByOpencodeId).mockReturnValue(undefined);

      mock.push({
        type: "session.status",
        properties: {
          sessionID: "oc-unknown",
          status: { type: "busy" },
        },
      });

      // Give the async loop a chance to process
      await new Promise((r) => setTimeout(r, 30));

      expect(notificationEmitter.emitActivityStatus).not.toHaveBeenCalled();
      expect(dbRepository.updateSessionStatus).not.toHaveBeenCalled();

      mock.end();
    });
  });
});
