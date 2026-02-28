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
