import { NextRequest, NextResponse } from "next/server";
import { spawnInstance, listInstances, validateDirectory, _recoveryComplete } from "@/lib/server/process-manager";
import { createWorkspace } from "@/lib/server/workspace-manager";
import { insertSession, listSessions, getWorkspace, getInstance, updateSessionStatus } from "@/lib/server/db-repository";
import { randomUUID } from "crypto";
import type {
  CreateSessionRequest,
  CreateSessionResponse,
  SessionListItem,
} from "@/lib/api-types";

// POST /api/sessions — spawn an OpenCode instance (or reuse) and create a session
export async function POST(request: NextRequest): Promise<NextResponse> {
  // Wait for startup recovery before serving
  await _recoveryComplete;

  let body: CreateSessionRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { directory, title, isolationStrategy = "existing", branch } = body;

  if (!directory || typeof directory !== "string") {
    return NextResponse.json(
      { error: "directory is required" },
      { status: 400 }
    );
  }

  let resolvedDir: string;
  try {
    resolvedDir = validateDirectory(directory);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid directory";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    // Step 1: Create workspace record (isolation strategy applied here)
    const workspace = await createWorkspace({
      sourceDirectory: resolvedDir,
      strategy: isolationStrategy,
      branch,
    });

    // Step 2: Spawn (or reuse) the OpenCode instance for the workspace directory
    const instance = await spawnInstance(workspace.directory);

    // Step 3: Create the session in OpenCode
    const result = await instance.client.session.create({
      title: title ?? "New Session",
    });

    const session = result.data;
    if (!session) {
      return NextResponse.json(
        { error: "Failed to create session — SDK returned no data" },
        { status: 500 }
      );
    }

    // Step 4: Persist session to DB
    const sessionDbId = randomUUID();
    try {
      insertSession({
        id: sessionDbId,
        workspace_id: workspace.id,
        instance_id: instance.id,
        opencode_session_id: session.id,
        title: session.title ?? title ?? "New Session",
        directory: workspace.directory,
      });
    } catch {
      // DB write failure is non-fatal — session still works in-memory
      console.warn(`[POST /api/sessions] Failed to persist session to DB`);
    }

    const response: CreateSessionResponse = {
      instanceId: instance.id,
      workspaceId: workspace.id,
      session,
    };
    return NextResponse.json(response, { status: 200 });
  } catch (err) {
    console.error("[POST /api/sessions] Failed to create session:", err);
    return NextResponse.json(
      { error: "Failed to create session" },
      { status: 500 }
    );
  }
}

// GET /api/sessions — list all sessions (DB + live state merged)
export async function GET(): Promise<NextResponse> {
  // Wait for startup recovery before serving
  await _recoveryComplete;

  const liveInstances = listInstances();
  const liveInstanceMap = new Map(liveInstances.map((i) => [i.id, i]));

  // Load all sessions from DB
  let dbSessions: ReturnType<typeof listSessions>;
  try {
    dbSessions = listSessions();
  } catch {
    // If DB is unavailable, fall back to live-only listing (V1 behavior)
    const items: SessionListItem[] = [];
    await Promise.allSettled(
      liveInstances.map(async (instance) => {
        try {
          const result = await instance.client.session.list();
          const sessions = result.data ?? [];
          for (const session of sessions) {
            items.push({
              instanceId: instance.id,
              workspaceId: "",
              workspaceDirectory: instance.directory,
              workspaceDisplayName: null,
              isolationStrategy: "existing",
              sessionStatus: instance.status === "running" ? "active" : "stopped",
              session,
              instanceStatus: instance.status,
            });
          }
        } catch {
          // skip
        }
      })
    );
    return NextResponse.json(items, { status: 200 });
  }

  const items: SessionListItem[] = [];

  // Batch-fetch session statuses from each live instance to detect idle sessions
  // that may not have an SSE observer. This adds at most N network calls where
  // N = number of live instances.
  type SessionStatusMap = Record<string, { type: string }>;
  const instanceStatusMaps = new Map<string, SessionStatusMap>();
  await Promise.allSettled(
    liveInstances
      .filter((i) => i.status === "running")
      .map(async (instance) => {
        try {
          const result = await instance.client.session.status({
            directory: instance.directory,
          });
          if (result.data) {
            instanceStatusMaps.set(instance.id, result.data as SessionStatusMap);
          }
        } catch {
          // session.status() failure is non-fatal — fall through to DB-only behavior
        }
      })
  );

  for (const dbSession of dbSessions) {
    // Determine the live instance state
    const liveInstance = liveInstanceMap.get(dbSession.instance_id);

    let instanceStatus: "running" | "dead" = "dead";
    let sessionStatus: SessionListItem["sessionStatus"];

    if (liveInstance) {
      instanceStatus = liveInstance.status;
      if (liveInstance.status === "running") {
        // Check live session status from the SDK polling (catches idle transitions
        // that happened without an SSE observer)
        const statusMap = instanceStatusMaps.get(dbSession.instance_id);
        const liveStatus = statusMap?.[dbSession.opencode_session_id];
        if (liveStatus?.type === "idle" && dbSession.status === "active") {
          // Session went idle without SSE observer — persist correction
          try {
            updateSessionStatus(dbSession.id, "idle");
          } catch {
            // Non-fatal
          }
          sessionStatus = "idle";
        } else if (liveStatus?.type === "busy" && dbSession.status === "idle") {
          // Session became busy again — correct stale idle state
          try {
            updateSessionStatus(dbSession.id, "active");
          } catch {
            // Non-fatal
          }
          sessionStatus = "active";
        } else {
          // Respect persisted idle status from the SSE stream
          sessionStatus = dbSession.status === "idle" ? "idle" : "active";
        }
      } else {
        sessionStatus = "stopped";
      }
    } else {
      // Not in live map — check DB instance status
      let dbInst: ReturnType<typeof getInstance>;
      try {
        dbInst = getInstance(dbSession.instance_id);
      } catch {
        dbInst = undefined;
      }
      if (dbInst?.status === "running") {
        // DB says running but not in live Map → orphan / disconnected
        sessionStatus = "disconnected";
      } else {
        // Instance is dead — map DB status to appropriate session status
        if (dbSession.status === "completed") {
          sessionStatus = "completed";
        } else if (dbSession.status === "idle") {
          // Was idle when instance died → naturally completed
          sessionStatus = "completed";
        } else if (dbSession.status === "stopped") {
          sessionStatus = "stopped";
        } else if (dbSession.status === "disconnected") {
          sessionStatus = "disconnected";
        } else {
          // active session with dead instance → disconnected
          sessionStatus = "disconnected";
        }
      }
    }

    // Get workspace info
    let workspaceDirectory = dbSession.directory;
    let isolationStrategy: string = "existing";
    let workspaceDisplayName: string | null = null;
    try {
      const ws = getWorkspace(dbSession.workspace_id);
      if (ws) {
        workspaceDirectory = ws.directory;
        isolationStrategy = ws.isolation_strategy;
        workspaceDisplayName = ws.display_name;
      }
    } catch {
      // Non-fatal
    }

    // Fetch the OpenCode session details from the live instance if available
    if (liveInstance && instanceStatus === "running") {
      try {
        const result = await liveInstance.client.session.get({
          sessionID: dbSession.opencode_session_id,
        });
        if (result.data) {
          items.push({
            instanceId: dbSession.instance_id,
            workspaceId: dbSession.workspace_id,
            workspaceDirectory,
            workspaceDisplayName,
            isolationStrategy,
            sessionStatus,
            session: result.data,
            instanceStatus,
          });
          continue;
        }
      } catch {
        // Fall through to stub
      }
    }

    // For disconnected/stopped sessions, synthesize a stub session object
    items.push({
      instanceId: dbSession.instance_id,
      workspaceId: dbSession.workspace_id,
      workspaceDirectory,
      workspaceDisplayName,
      isolationStrategy,
      sessionStatus,
      session: {
        id: dbSession.opencode_session_id,
        title: dbSession.title,
        directory: dbSession.directory,
        projectID: "",
        version: "0",
        time: {
          created: new Date(dbSession.created_at).getTime(),
          updated: new Date(dbSession.stopped_at ?? dbSession.created_at).getTime(),
        },
      } as Parameters<typeof items.push>[0]["session"],
      instanceStatus,
    });
  }

  return NextResponse.json(items, { status: 200 });
}
