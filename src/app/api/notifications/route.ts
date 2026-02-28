import { NextRequest, NextResponse } from "next/server";
import { _recoveryComplete } from "@/lib/server/process-manager";
import { listNotifications } from "@/lib/server/db-repository";

// GET /api/notifications — list notifications
// Query params:
//   ?unread=true  — filter to unread only
//   ?limit=N      — limit results (default 50)
export async function GET(request: NextRequest): Promise<NextResponse> {
  await _recoveryComplete;

  const unreadOnly = request.nextUrl.searchParams.get("unread") === "true";
  const limitParam = request.nextUrl.searchParams.get("limit");
  const parsed = limitParam ? parseInt(limitParam, 10) : 50;
  const limit = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 500) : 50;

  try {
    const notifications = listNotifications({ unreadOnly, limit });
    return NextResponse.json(notifications, { status: 200 });
  } catch (err) {
    console.error("[GET /api/notifications] Error:", err);
    return NextResponse.json(
      { error: "Failed to fetch notifications" },
      { status: 500 }
    );
  }
}
