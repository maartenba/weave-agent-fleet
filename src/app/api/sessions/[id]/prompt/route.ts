import { NextRequest, NextResponse } from "next/server";
import { getClientForInstance } from "@/lib/server/opencode-client";
import type { SendPromptRequest } from "@/lib/api-types";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// POST /api/sessions/[id]/prompt — send a prompt (fire-and-forget, results come via SSE)
export async function POST(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  const { id: sessionId } = await context.params;

  let body: SendPromptRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { instanceId, text } = body;

  if (!instanceId || typeof instanceId !== "string") {
    return NextResponse.json(
      { error: "instanceId is required" },
      { status: 400 }
    );
  }

  if (!text || typeof text !== "string" || !text.trim()) {
    return NextResponse.json(
      { error: "text is required and must be non-empty" },
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
    await client.session.promptAsync({
      path: { id: sessionId },
      body: {
        parts: [{ type: "text", text: text.trim() }],
      },
    });
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error(`[POST /api/sessions/${sessionId}/prompt] Error:`, err);
    return NextResponse.json(
      { error: "Failed to send prompt" },
      { status: 500 }
    );
  }
}
