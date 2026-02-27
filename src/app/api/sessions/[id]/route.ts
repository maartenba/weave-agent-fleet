import { NextRequest, NextResponse } from "next/server";
import { getClientForInstance } from "@/lib/server/opencode-client";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET /api/sessions/[id]?instanceId=xxx — get session detail with messages
export async function GET(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  const { id: sessionId } = await context.params;
  const instanceId = request.nextUrl.searchParams.get("instanceId");

  if (!instanceId) {
    return NextResponse.json(
      { error: "instanceId query parameter is required" },
      { status: 400 }
    );
  }

  let client;
  try {
    client = getClientForInstance(instanceId);
  } catch {
    return NextResponse.json(
      { error: "Instance not found or unavailable" },
      { status: 404 }
    );
  }

  try {
    const [sessionResult, messagesResult] = await Promise.all([
      client.session.get({ path: { id: sessionId } }),
      client.session.messages({ path: { id: sessionId } }),
    ]);

    const session = sessionResult.data;
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    return NextResponse.json(
      { session, messages: messagesResult.data ?? [] },
      { status: 200 }
    );
  } catch (err) {
    console.error(`[GET /api/sessions/${sessionId}] Error:`, err);
    return NextResponse.json(
      { error: "Failed to retrieve session" },
      { status: 500 }
    );
  }
}
