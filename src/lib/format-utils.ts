/**
 * Format utilities — display helpers extracted from mock-data.ts.
 * These are pure functions with no mock data dependencies.
 */

export function formatTokens(tokens: number): string {
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return tokens.toString();
}

export function formatCost(cost: number): string {
  return `$${cost.toFixed(2)}`;
}

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

const timeOnlyFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

/**
 * Format a unix-ms timestamp for message display.
 * - Same calendar day as now → "2:34 PM" (time only)
 * - Different day → "Mar 1, 2:34 PM" (short month + day + time)
 * - Falsy / NaN → "" (graceful fallback)
 */
export function formatTimestamp(timestamp: number | undefined | null): string {
  if (!timestamp || isNaN(timestamp)) return "";

  const date = new Date(timestamp);
  const now = new Date();

  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  return sameDay ? timeOnlyFormatter.format(date) : dateTimeFormatter.format(date);
}

export function getStatusColor(status: string): string {
  switch (status) {
    case "active":
    case "running":
      return "text-green-500";
    case "idle":
    case "paused":
      return "text-zinc-400";
    case "waiting_input":
      return "text-amber-500";
    case "completed":
    case "drained":
      return "text-blue-500";
    case "error":
    case "failed":
      return "text-red-500";
    case "pending":
    case "queued":
      return "text-zinc-500";
    case "draft":
      return "text-zinc-400";
    default:
      return "text-zinc-500";
  }
}

export function getStatusDot(status: string): string {
  switch (status) {
    case "active":
    case "running":
      return "bg-green-500";
    case "idle":
    case "paused":
      return "bg-zinc-400";
    case "waiting_input":
      return "bg-amber-500";
    case "completed":
    case "drained":
      return "bg-blue-500";
    case "error":
    case "failed":
      return "bg-red-500";
    case "pending":
    case "queued":
      return "bg-zinc-500";
    default:
      return "bg-zinc-500";
  }
}
