import {
  formatTokens,
  formatCost,
  formatDuration,
  formatTimestamp,
  getStatusColor,
  getStatusDot,
} from "@/lib/format-utils";

// ─── formatTokens ────────────────────────────────────────────────────────────

describe("formatTokens", () => {
  it("returns '0' for 0", () => {
    expect(formatTokens(0)).toBe("0");
  });

  it("returns '1' for 1", () => {
    expect(formatTokens(1)).toBe("1");
  });

  it("returns '999' for 999", () => {
    expect(formatTokens(999)).toBe("999");
  });

  it("returns '1.0k' for 1000", () => {
    expect(formatTokens(1000)).toBe("1.0k");
  });

  it("returns '1.5k' for 1500", () => {
    expect(formatTokens(1500)).toBe("1.5k");
  });

  it("returns '10.0k' for 10000", () => {
    expect(formatTokens(10000)).toBe("10.0k");
  });

  it("returns '1000.0k' for 999999 (rounds to 1 decimal at the k scale)", () => {
    expect(formatTokens(999999)).toBe("1000.0k");
  });
});

// ─── formatCost ──────────────────────────────────────────────────────────────

describe("formatCost", () => {
  it("returns '$0.00' for 0", () => {
    expect(formatCost(0)).toBe("$0.00");
  });

  it("returns '$0.10' for 0.1", () => {
    expect(formatCost(0.1)).toBe("$0.10");
  });

  it("returns '$0.01' for 0.005 (toFixed rounding)", () => {
    expect(formatCost(0.005)).toBe("$0.01");
  });

  it("returns '$1.50' for 1.5", () => {
    expect(formatCost(1.5)).toBe("$1.50");
  });

  it("returns '$100.00' for 99.999", () => {
    expect(formatCost(99.999)).toBe("$100.00");
  });
});

// ─── formatDuration ──────────────────────────────────────────────────────────

describe("formatDuration", () => {
  it("returns '0s' for 0 seconds", () => {
    expect(formatDuration(0)).toBe("0s");
  });

  it("returns '1s' for 1 second", () => {
    expect(formatDuration(1)).toBe("1s");
  });

  it("returns '30s' for 30 seconds", () => {
    expect(formatDuration(30)).toBe("30s");
  });

  it("returns '59s' for 59 seconds", () => {
    expect(formatDuration(59)).toBe("59s");
  });

  it("returns '1m 0s' for exactly 60 seconds", () => {
    expect(formatDuration(60)).toBe("1m 0s");
  });

  it("returns '1m 30s' for 90 seconds", () => {
    expect(formatDuration(90)).toBe("1m 30s");
  });

  it("returns '60m 0s' for 3600 seconds", () => {
    expect(formatDuration(3600)).toBe("60m 0s");
  });
});

// ─── getStatusColor ──────────────────────────────────────────────────────────

describe("getStatusColor", () => {
  it("returns 'text-green-500' for 'active'", () => {
    expect(getStatusColor("active")).toBe("text-green-500");
  });

  it("returns 'text-green-500' for 'running'", () => {
    expect(getStatusColor("running")).toBe("text-green-500");
  });

  it("returns 'text-zinc-400' for 'idle'", () => {
    expect(getStatusColor("idle")).toBe("text-zinc-400");
  });

  it("returns 'text-zinc-400' for 'paused'", () => {
    expect(getStatusColor("paused")).toBe("text-zinc-400");
  });

  it("returns 'text-amber-500' for 'waiting_input'", () => {
    expect(getStatusColor("waiting_input")).toBe("text-amber-500");
  });

  it("returns 'text-blue-500' for 'completed'", () => {
    expect(getStatusColor("completed")).toBe("text-blue-500");
  });

  it("returns 'text-blue-500' for 'drained'", () => {
    expect(getStatusColor("drained")).toBe("text-blue-500");
  });

  it("returns 'text-red-500' for 'error'", () => {
    expect(getStatusColor("error")).toBe("text-red-500");
  });

  it("returns 'text-red-500' for 'failed'", () => {
    expect(getStatusColor("failed")).toBe("text-red-500");
  });

  it("returns 'text-zinc-500' for 'pending'", () => {
    expect(getStatusColor("pending")).toBe("text-zinc-500");
  });

  it("returns 'text-zinc-500' for 'queued'", () => {
    expect(getStatusColor("queued")).toBe("text-zinc-500");
  });

  it("returns 'text-zinc-400' for 'draft'", () => {
    expect(getStatusColor("draft")).toBe("text-zinc-400");
  });

  it("returns 'text-zinc-500' for an unknown status string", () => {
    expect(getStatusColor("unknown-status")).toBe("text-zinc-500");
  });

  it("returns 'text-zinc-500' for an empty string", () => {
    expect(getStatusColor("")).toBe("text-zinc-500");
  });
});

// ─── getStatusDot ────────────────────────────────────────────────────────────

describe("getStatusDot", () => {
  it("returns 'bg-green-500' for 'active'", () => {
    expect(getStatusDot("active")).toBe("bg-green-500");
  });

  it("returns 'bg-green-500' for 'running'", () => {
    expect(getStatusDot("running")).toBe("bg-green-500");
  });

  it("returns 'bg-zinc-400' for 'idle'", () => {
    expect(getStatusDot("idle")).toBe("bg-zinc-400");
  });

  it("returns 'bg-zinc-400' for 'paused'", () => {
    expect(getStatusDot("paused")).toBe("bg-zinc-400");
  });

  it("returns 'bg-amber-500' for 'waiting_input'", () => {
    expect(getStatusDot("waiting_input")).toBe("bg-amber-500");
  });

  it("returns 'bg-blue-500' for 'completed'", () => {
    expect(getStatusDot("completed")).toBe("bg-blue-500");
  });

  it("returns 'bg-blue-500' for 'drained'", () => {
    expect(getStatusDot("drained")).toBe("bg-blue-500");
  });

  it("returns 'bg-red-500' for 'error'", () => {
    expect(getStatusDot("error")).toBe("bg-red-500");
  });

  it("returns 'bg-red-500' for 'failed'", () => {
    expect(getStatusDot("failed")).toBe("bg-red-500");
  });

  it("returns 'bg-zinc-500' for 'pending'", () => {
    expect(getStatusDot("pending")).toBe("bg-zinc-500");
  });

  it("returns 'bg-zinc-500' for 'queued'", () => {
    expect(getStatusDot("queued")).toBe("bg-zinc-500");
  });

  it("returns 'bg-zinc-500' for an unknown status string", () => {
    expect(getStatusDot("unknown-status")).toBe("bg-zinc-500");
  });

  it("returns 'bg-zinc-500' for an empty string", () => {
    expect(getStatusDot("")).toBe("bg-zinc-500");
  });
});

// ─── formatTimestamp ─────────────────────────────────────────────────────────

describe("formatTimestamp", () => {
  it("returns time-only string for a timestamp from today", () => {
    // Create a timestamp for today at 14:34 local time
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 14, 34, 0);
    const result = formatTimestamp(today.getTime());
    // Should produce time-only like "2:34 PM"
    expect(result).toBe("2:34 PM");
  });

  it("returns date+time string for a timestamp from a different day", () => {
    // Jan 15, 2024 at 09:05 local time
    const past = new Date(2024, 0, 15, 9, 5, 0);
    const result = formatTimestamp(past.getTime());
    // Should include month + day + time like "Jan 15, 9:05 AM"
    expect(result).toMatch(/Jan 15.+9:05 AM/);
  });

  it("returns empty string for undefined", () => {
    expect(formatTimestamp(undefined)).toBe("");
  });

  it("returns empty string for NaN", () => {
    expect(formatTimestamp(NaN)).toBe("");
  });

  it("returns empty string for 0", () => {
    expect(formatTimestamp(0)).toBe("");
  });

  it("returns empty string for null", () => {
    expect(formatTimestamp(null)).toBe("");
  });
});
