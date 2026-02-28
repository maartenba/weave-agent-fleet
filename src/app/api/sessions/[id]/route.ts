import { NextRequest, NextResponse } from "next/server";
import { getClientForInstance } from "@/lib/server/opencode-client";
import { destroyInstance } from "@/lib/server/process-manager";
import { getSession, getSessionByOpencodeId, getWorkspace, updateSessionStatus, getSessionsForInstance } from "@/lib/server/db-repository";
import { cleanupWorkspace } from "@/lib/server/workspace-manager";

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
      client.session.get({ sessionID: sessionId }),
      client.session.messages({ sessionID: sessionId }),
    ]);

    const session = sessionResult.data;
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // Enrich with DB metadata if available
    let workspaceId: string | null = null;
    let workspaceDirectory: string | null = null;
    let isolationStrategy: string | null = null;

    try {
      const dbSession = getSession(sessionId) ?? getSessionByOpencodeId(sessionId);
      if (dbSession) {
        workspaceId = dbSession.workspace_id;
        const ws = getWorkspace(dbSession.workspace_id);
        if (ws) {
          workspaceDirectory = ws.directory;
          isolationStrategy = ws.isolation_strategy;
        }
      }
    } catch {
      // DB metadata enrichment is best-effort
    }

    return NextResponse.json(
      {
        session,
        messages: messagesResult.data ?? [],
        workspaceId,
        workspaceDirectory,
        isolationStrategy,
      },
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

// DELETE /api/sessions/[id]?instanceId=xxx&cleanupWorkspace=true — terminate a session
export async function DELETE(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  const { id: sessionId } = await context.params;
  const instanceId = request.nextUrl.searchParams.get("instanceId");
  const shouldCleanupWorkspace =
    request.nextUrl.searchParams.get("cleanupWorkspace") === "true";

  if (!instanceId) {
    return NextResponse.json(
      { error: "instanceId query parameter is required" },
      { status: 400 }
    );
  }

  // Look up session in DB to get workspace ID and resolved DB id
  let workspaceId: string | null = null;
  let resolvedDbId: string | null = null;
  try {
    const dbSession = getSession(sessionId) ?? getSessionByOpencodeId(sessionId);
    if (dbSession) {
      workspaceId = dbSession.workspace_id;
      resolvedDbId = dbSession.id;
    }
  } catch {
    // DB lookup failure — proceed with process kill only
  }

  // Step 1: Check if other sessions are still using this instance before killing
  let otherActiveSessions = 0;
  try {
    const activeSessions = getSessionsForInstance(instanceId);
    // Filter out this session
    const others = activeSessions.filter(
      (s) => s.id !== sessionId && s.opencode_session_id !== sessionId
    );
    otherActiveSessions = others.length;
  } catch {
    // Non-fatal
  }

  // Step 2: Gracefully abort the session before killing, then destroy instance if safe
  try {
    const sessionClient = getClientForInstance(instanceId);
    await sessionClient.session.abort({ sessionID: sessionId });
  } catch {
    // Abort is best-effort — instance may already be dead or session may not be running
  }

  if (otherActiveSessions === 0) {
    try {
      destroyInstance(instanceId);
    } catch {
      // Instance may already be dead — that's fine
    }
  }
  // If other sessions exist, keep the instance running — don't touch it

  // Step 3: Update session status in DB using the resolved DB id
  if (resolvedDbId) {
    try {
      const now = new Date().toISOString();
      updateSessionStatus(resolvedDbId, "stopped", now);
    } catch {
      // DB update failure is non-fatal
    }
  }

  // Step 4: Optionally clean up workspace (worktree/clone only)
  if (shouldCleanupWorkspace && workspaceId) {
    try {
      await cleanupWorkspace(workspaceId);
    } catch (err) {
      console.warn(`[DELETE /api/sessions/${sessionId}] Workspace cleanup failed:`, err);
    }
  }

  return NextResponse.json(
    { message: "Session terminated", sessionId, instanceId },
    { status: 200 }
  );
}
