import { NextRequest, NextResponse } from "next/server";
import { getClientForInstance } from "@/lib/server/opencode-client";
import type { SendCommandRequest, SendCommandResponse } from "@/lib/api-types";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// POST /api/sessions/[id]/command — execute a slash command via session.promptAsync()
//
// Sends the command as a text prompt prefixed with "/" (e.g. "/compact args").
// Uses promptAsync so the call is awaited and errors are surfaced as 500 responses.
// The frontend receives live updates via the opencode SSE event bus regardless.
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

  const trimmedCommand = command.trim();
  const text = args ? `/${trimmedCommand} ${args}` : `/${trimmedCommand}`;

  try {
    await client.session.promptAsync({
      sessionID: sessionId,
      parts: [{ type: "text", text }],
    });
  } catch (err) {
    console.error(`[POST /api/sessions/${sessionId}/command] Error:`, err);
    return NextResponse.json(
      { error: "Failed to execute command" },
      { status: 500 }
    );
  }

  const responseBody: SendCommandResponse = { success: true, sessionId };
  return NextResponse.json(responseBody, { status: 200 });
}
