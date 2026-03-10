import { NextRequest, NextResponse } from "next/server";
import { getClientForInstance } from "@/lib/server/opencode-client";
import type { SendCommandRequest, SendCommandResponse } from "@/lib/api-types";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// POST /api/sessions/[id]/command — execute a slash command via session.command()
//
// Uses the SDK's `client.session.command()` which performs template expansion
// and creates SubtaskParts with the command description — producing cleaner
// activity stream entries instead of raw "/{command}" text.
//
// The command() endpoint is blocking (returns the full result in its HTTP
// response), but we fire-and-forget it: we kick off the call without awaiting
// the result and return 200 immediately.  The frontend still receives live
// updates because the opencode server publishes events on its internal SSE bus
// independently of whether the HTTP response is consumed.
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

  // Fire-and-forget: kick off the command without awaiting the blocking
  // response.  SSE events flow independently via the opencode event bus,
  // so the frontend picks up progress in real time.
  client.session
    .command({
      sessionID: sessionId,
      command: command.trim(),
      arguments: args || "",
    })
    .catch((err: unknown) => {
      console.error(
        `[POST /api/sessions/${sessionId}/command] Async error:`,
        err
      );
    });

  const responseBody: SendCommandResponse = { success: true, sessionId };
  return NextResponse.json(responseBody, { status: 200 });
}
