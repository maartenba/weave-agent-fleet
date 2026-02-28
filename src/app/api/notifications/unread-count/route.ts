import { NextResponse } from "next/server";
import { _recoveryComplete } from "@/lib/server/process-manager";
import { countUnreadNotifications } from "@/lib/server/db-repository";

// GET /api/notifications/unread-count — lightweight unread badge count
export async function GET(): Promise<NextResponse> {
  await _recoveryComplete;

  try {
    const count = countUnreadNotifications();
    return NextResponse.json({ count }, { status: 200 });
  } catch (err) {
    console.error("[GET /api/notifications/unread-count] Error:", err);
    return NextResponse.json({ count: 0 }, { status: 200 });
  }
}
