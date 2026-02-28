import { FleetSummary } from "@/lib/types";
import { formatTokens, formatCost } from "@/lib/format-utils";
import {
  Zap,
  Pause,
  CheckCircle2,
  AlertCircle,
  Coins,
  Hash,
  GitBranch,
  ListTodo,
} from "lucide-react";

interface SummaryBarProps {
  summary: FleetSummary;
}

export function SummaryBar({ summary }: SummaryBarProps) {
  const items = [
    {
      label: "Active",
      value: summary.activeSessions,
      icon: Zap,
      color: "text-green-500",
    },
    {
      label: "Idle",
      value: summary.idleSessions,
      icon: Pause,
      color: "text-zinc-400",
    },
    {
      label: "Completed",
      value: summary.completedSessions,
      icon: CheckCircle2,
      color: "text-blue-500",
    },
    {
      label: "Errors",
      value: summary.errorSessions,
      icon: AlertCircle,
      color: "text-red-500",
    },
    {
      label: "Cost",
      value: formatCost(summary.totalCost),
      icon: Coins,
      color: "text-amber-500",
    },
    {
      label: "Tokens",
      value: formatTokens(summary.totalTokens),
      icon: Hash,
      color: "text-purple-500",
    },
    {
      label: "Pipelines",
      value: summary.runningPipelines,
      icon: GitBranch,
      color: "text-cyan-500",
    },
    {
      label: "Queued",
      value: summary.queuedTasks,
      icon: ListTodo,
      color: "text-orange-500",
    },
  ];

  return (
    <div className="grid grid-cols-4 gap-3 sm:grid-cols-8">
      {items.map((item) => (
        <div
          key={item.label}
          className="flex flex-col items-center rounded-lg border bg-card p-3 text-center"
        >
          <item.icon className={`h-4 w-4 ${item.color}`} />
          <span className="mt-1 text-lg font-semibold">{item.value}</span>
          <span className="text-xs text-muted-foreground">{item.label}</span>
        </div>
      ))}
    </div>
  );
}
