import { NextRequest, NextResponse } from "next/server";
import { getClientForInstance } from "@/lib/server/opencode-client";
import type { SendCommandRequest, SendCommandResponse } from "@/lib/api-types";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// POST /api/sessions/[id]/command — execute a slash command via promptAsync
//
// The SDK's `client.session.command()` hits a blocking endpoint that returns
// the complete result in the HTTP response body (200) rather than streaming
// via SSE.  Using it with fire-and-forget discards the response, so the user
// never sees the command output.
//
// Instead, we reconstruct the slash command text (e.g. "/compact args") and
// send it through `promptAsync`, which is truly async — it returns 204
// immediately and streams results via the SSE event pipeline that the
// frontend already consumes.
export async function POST(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  const { id: sessionId } = await context.params;

  let body: SendCommandRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { instanceId, command, args } = body;

  if (!instanceId || typeof instanceId !== "string") {
    return NextResponse.json(
      { error: "instanceId is required" },
      { status: 400 }
    );
  }

  if (!command || typeof command !== "string" || !command.trim()) {
    return NextResponse.json(
      { error: "command is required and must be non-empty" },
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
    // Reconstruct the slash command text and send via promptAsync so the
    // OpenCode server processes it asynchronously with full SSE streaming.
    const commandText = args
      ? `/${command.trim()} ${args}`
      : `/${command.trim()}`;

    await client.session.promptAsync({
      sessionID: sessionId,
      parts: [{ type: "text", text: commandText }],
    });

    const responseBody: SendCommandResponse = { success: true, sessionId };
    return NextResponse.json(responseBody, { status: 200 });
  } catch (err) {
    console.error(`[POST /api/sessions/${sessionId}/command] Error:`, err);
    return NextResponse.json(
      { error: "Failed to execute command" },
      { status: 500 }
    );
  }
}
