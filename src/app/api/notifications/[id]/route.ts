import { NextRequest, NextResponse } from "next/server";
import { markNotificationRead, markAllNotificationsRead } from "@/lib/server/db-repository";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// PATCH /api/notifications/[id] — mark a notification as read
// If id is "all", marks all notifications as read.
export async function PATCH(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  const { id } = await context.params;

  try {
    if (id === "all") {
      markAllNotificationsRead();
    } else {
      markNotificationRead(id);
    }
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    console.error(`[PATCH /api/notifications/${id}] Error:`, err);
    return NextResponse.json(
      { error: "Failed to mark notification as read" },
      { status: 500 }
    );
  }
}
