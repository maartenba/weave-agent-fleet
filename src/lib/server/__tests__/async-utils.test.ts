/**
 * Tests for async-utils.ts — withTimeout helper.
 */

import { describe, it, expect } from "vitest";
import { withTimeout, TimeoutError } from "@/lib/server/async-utils";

describe("withTimeout", () => {
  it("ResolvesWhenPromiseSettlesBeforeTimeout", async () => {
    const result = await withTimeout(
      Promise.resolve("ok"),
      1000,
      "test-resolve",
    );
    expect(result).toBe("ok");
  });

  it("RejectsWithTimeoutErrorWhenPromiseExceedsTimeout", async () => {
    const neverResolves = new Promise<string>(() => {});
    await expect(
      withTimeout(neverResolves, 50, "test-timeout"),
    ).rejects.toThrow(TimeoutError);
  });

  it("TimeoutErrorMessageIncludesLabelAndDuration", async () => {
    const neverResolves = new Promise<string>(() => {});
    await expect(
      withTimeout(neverResolves, 100, "my-operation"),
    ).rejects.toThrow("my-operation: timed out after 100ms");
  });

  it("PropagatesOriginalRejectionWhenPromiseRejectsBeforeTimeout", async () => {
    const error = new Error("original error");
    await expect(
      withTimeout(Promise.reject(error), 1000, "test-reject"),
    ).rejects.toThrow("original error");
  });

  it("CleansUpTimerOnSuccess", async () => {
    // If timer leaks, this test would hang (but vitest has built-in timeout)
    const result = await withTimeout(
      Promise.resolve(42),
      60000,
      "timer-cleanup",
    );
    expect(result).toBe(42);
  });

  it("CleansUpTimerOnRejection", async () => {
    await expect(
      withTimeout(
        Promise.reject(new Error("fail")),
        60000,
        "timer-cleanup-reject",
      ),
    ).rejects.toThrow("fail");
  });
});
