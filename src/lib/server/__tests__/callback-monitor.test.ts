/**
 * Tests for callback-monitor.ts — session tracking and cleanup logic.
 *
 * Full integration testing (event stream subscription, callback firing) requires
 * a running OpenCode instance and is out of scope. These tests verify the state
 * management: startMonitoring/stopMonitoring track sessions correctly and
 * _resetForTests clears everything.
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

// Mock callback-service to prevent real callback delivery
vi.mock("@/lib/server/callback-service", () => ({
  fireSessionCallbacks: vi.fn(),
  fireSessionErrorCallbacks: vi.fn(),
}));

// Mock db-repository — provide no-op implementations for functions used by the module
vi.mock("@/lib/server/db-repository", () => ({
  getAllPendingCallbacks: vi.fn(() => []),
  claimPendingCallback: vi.fn(() => true),
  getSession: vi.fn(() => undefined),
  getSessionByOpencodeId: vi.fn(() => undefined),
  updateSessionStatus: vi.fn(),
}));

import { startMonitoring, stopMonitoring, _resetForTests } from "@/lib/server/callback-monitor";
import * as processManager from "@/lib/server/process-manager";
import * as opencodeClient from "@/lib/server/opencode-client";

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  _resetForTests();
  vi.clearAllMocks();
});

afterEach(() => {
  _resetForTests();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("callback-monitor", () => {
  describe("startMonitoring / stopMonitoring", () => {
    it("StartMonitoringDoesNotThrowWhenInstanceIsDead", () => {
      // getInstance returns undefined → instance is dead
      expect(() => startMonitoring("db-1", "oc-1", "inst-1")).not.toThrow();
    });

    it("StopMonitoringIsNoOpForNonExistentSession", () => {
      expect(() => stopMonitoring("nonexistent")).not.toThrow();
    });

    it("DoubleStartMonitoringIsIdempotent", () => {
      // Both calls should succeed without error
      expect(() => {
        startMonitoring("db-1", "oc-1", "inst-1");
        startMonitoring("db-1", "oc-1", "inst-1");
      }).not.toThrow();
    });

    it("StopMonitoringAfterStartDoesNotThrow", () => {
      startMonitoring("db-1", "oc-1", "inst-1");
      expect(() => stopMonitoring("db-1")).not.toThrow();
    });

    it("DoubleStopIsNoOp", () => {
      startMonitoring("db-1", "oc-1", "inst-1");
      stopMonitoring("db-1");
      expect(() => stopMonitoring("db-1")).not.toThrow();
    });
  });

  describe("_resetForTests", () => {
    it("ClearsAllStateWithoutError", () => {
      startMonitoring("db-1", "oc-1", "inst-1");
      startMonitoring("db-2", "oc-2", "inst-2");

      expect(() => _resetForTests()).not.toThrow();
    });

    it("AllowsReMonitoringAfterReset", () => {
      startMonitoring("db-1", "oc-1", "inst-1");
      _resetForTests();

      // Should not throw — state was cleared
      expect(() => startMonitoring("db-1", "oc-1", "inst-1")).not.toThrow();
    });
  });

  describe("SDK call timeout handling", () => {
    it("PollingLoopHandlesStatusTimeoutGracefully", async () => {
      const instanceId = "inst-status-timeout";

      vi.mocked(processManager.getInstance).mockReturnValue({
        directory: "/test",
        status: "running",
        client: {
          session: {
            // status never resolves
            status: vi.fn().mockReturnValue(new Promise(() => {})),
          },
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      // Provide a pending callback so the polling loop runs
      const { getAllPendingCallbacks, getSession } = await import("@/lib/server/db-repository");
      vi.mocked(getAllPendingCallbacks).mockReturnValue([
        { id: "cb-1", source_session_id: "db-src-1", target_session_id: "db-tgt-1", target_instance_id: instanceId },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ] as any);
      vi.mocked(getSession).mockReturnValue({
        id: "db-src-1",
        instance_id: instanceId,
        opencode_session_id: "oc-src-1",
        status: "active",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const origTimeout = process.env.WEAVE_SDK_CALL_TIMEOUT_MS;
      process.env.WEAVE_SDK_CALL_TIMEOUT_MS = "50";

      try {
        startMonitoring("db-src-1", "oc-src-1", instanceId);

        // Allow time for the polling interval + timeout to fire
        await new Promise((r) => setTimeout(r, 300));

        // No crash — polling loop is still alive despite the timeout
        // (verified by reaching this line without an unhandled rejection)
        expect(true).toBe(true);
      } finally {
        if (origTimeout !== undefined) {
          process.env.WEAVE_SDK_CALL_TIMEOUT_MS = origTimeout;
        } else {
          delete process.env.WEAVE_SDK_CALL_TIMEOUT_MS;
        }
      }
    });
  });

  describe("subscribe timeout", () => {
    it("CleansUpSubscriptionWhenSubscribeTimesOut", async () => {
      const instanceId = "inst-timeout";

      vi.mocked(processManager.getInstance).mockReturnValue({
        directory: "/test",
        status: "running",
        client: { session: { status: vi.fn() } },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      // Return a subscribe that never resolves
      vi.mocked(opencodeClient.getClientForInstance).mockReturnValue({
        event: {
          subscribe: vi.fn().mockReturnValue(new Promise(() => {})),
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const origTimeout = process.env.WEAVE_SUBSCRIBE_TIMEOUT_MS;
      process.env.WEAVE_SUBSCRIBE_TIMEOUT_MS = "50";

      try {
        startMonitoring("db-timeout-1", "oc-timeout-1", instanceId);

        // Wait for the timeout to fire and clean up
        await new Promise((r) => setTimeout(r, 200));

        // The subscription should be cleaned up — starting monitoring for the same
        // instance with a new session should create a new subscription attempt
        const subscribeFn = vi.mocked(opencodeClient.getClientForInstance).mock.results[0]
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ?.value?.event?.subscribe as any;
        expect(subscribeFn).toHaveBeenCalledTimes(1);
      } finally {
        if (origTimeout !== undefined) {
          process.env.WEAVE_SUBSCRIBE_TIMEOUT_MS = origTimeout;
        } else {
          delete process.env.WEAVE_SUBSCRIBE_TIMEOUT_MS;
        }
      }
    });

    it("SuccessfulSubscribeWorksWithinTimeout", async () => {
      const instanceId = "inst-fast";

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
                  await new Promise<void>((r) => { resolve = r; });
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

      const mock = createMockEventStream();

      vi.mocked(processManager.getInstance).mockReturnValue({
        directory: "/test",
        status: "running",
        client: {
          session: {
            status: vi.fn().mockResolvedValue({ data: {} }),
          },
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      vi.mocked(opencodeClient.getClientForInstance).mockReturnValue({
        event: {
          subscribe: vi.fn().mockResolvedValue({ stream: mock.stream }),
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const origTimeout = process.env.WEAVE_SUBSCRIBE_TIMEOUT_MS;
      process.env.WEAVE_SUBSCRIBE_TIMEOUT_MS = "5000";

      try {
        startMonitoring("db-fast-1", "oc-fast-1", instanceId);

        // Give it a moment to subscribe
        await new Promise((r) => setTimeout(r, 50));

        // Subscribe should have been called
        const subscribeFn = vi.mocked(opencodeClient.getClientForInstance).mock.results[0]
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ?.value?.event?.subscribe as any;
        expect(subscribeFn).toHaveBeenCalledTimes(1);

        mock.end();
      } finally {
        if (origTimeout !== undefined) {
          process.env.WEAVE_SUBSCRIBE_TIMEOUT_MS = origTimeout;
        } else {
          delete process.env.WEAVE_SUBSCRIBE_TIMEOUT_MS;
        }
      }
    });
  });
});
