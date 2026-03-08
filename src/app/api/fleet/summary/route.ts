import { NextResponse } from "next/server";
import { _recoveryComplete } from "@/lib/server/process-manager";
import { getSessionStatusCounts } from "@/lib/server/db-repository";
import type { FleetSummaryResponse } from "@/lib/api-types";

export type { FleetSummaryResponse };

// GET /api/fleet/summary — compute real aggregate stats from the database
export async function GET(): Promise<NextResponse> {
  await _recoveryComplete;

  try {
    const counts = getSessionStatusCounts();

    const activeSessions = counts.active;
    const idleSessions = counts.idle;

    const summary: FleetSummaryResponse = {
      activeSessions,
      idleSessions,
      // Tokens/cost not yet tracked per-session in DB — default to 0
      totalTokens: 0,
      totalCost: 0,
      // Queue not implemented in V2
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
