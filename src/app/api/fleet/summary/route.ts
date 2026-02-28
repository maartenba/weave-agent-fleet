import { NextResponse } from "next/server";
import { _recoveryComplete } from "@/lib/server/process-manager";
import { listSessions } from "@/lib/server/db-repository";

export interface FleetSummaryResponse {
  activeSessions: number;
  idleSessions: number;
  completedSessions: number;
  errorSessions: number;
  totalTokens: number;
  totalCost: number;
  runningPipelines: number;
  queuedTasks: number;
}

// GET /api/fleet/summary — compute real aggregate stats from the database
export async function GET(): Promise<NextResponse> {
  await _recoveryComplete;

  try {
    const sessions = listSessions();

    const activeSessions = sessions.filter((s) => s.status === "active").length;
    const completedSessions = sessions.filter((s) => s.status === "stopped").length;
    const errorSessions = sessions.filter((s) => s.status === "disconnected").length;

    const summary: FleetSummaryResponse = {
      activeSessions,
      idleSessions: 0,
      completedSessions,
      errorSessions,
      // Tokens/cost not yet tracked per-session in DB — default to 0
      totalTokens: 0,
      totalCost: 0,
      // Pipelines and queue not implemented in V2
      runningPipelines: 0,
      queuedTasks: 0,
    };

    return NextResponse.json(summary, { status: 200 });
  } catch (err) {
    console.error("[GET /api/fleet/summary] Error:", err);
    return NextResponse.json(
      { error: "Failed to compute fleet summary" },
      { status: 500 }
    );
  }
}
