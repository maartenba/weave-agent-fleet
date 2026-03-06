import { NextRequest, NextResponse } from "next/server";
import { spawnInstance, listInstances, validateDirectory, _recoveryComplete } from "@/lib/server/process-manager";
import { createWorkspace } from "@/lib/server/workspace-manager";
import { insertSession, listSessions, getWorkspace, getInstance, updateSessionStatus, getSessionByOpencodeId, insertSessionCallback } from "@/lib/server/db-repository";
import { startMonitoring } from "@/lib/server/callback-monitor";
import { randomUUID } from "crypto";
import { log } from "@/lib/server/logger";
import type {
  CreateSessionRequest,
  CreateSessionResponse,
  SessionListItem,
  SessionActivityStatus,
  SessionLifecycleStatus,
  InstanceStatus,
} from "@/lib/api-types";

// POST /api/sessions — spawn an OpenCode instance (or reuse) and create a session
export async function POST(request: NextRequest): Promise<NextResponse> {
  // Wait for startup recovery before serving
  await _recoveryComplete;

  let body: CreateSessionRequest;
  try {
    body = await request.json();
  } catch (err) {
    log.warn("sessions-route", "Invalid JSON body in POST request", { err });
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

    // Resolve parent session ID if onComplete is provided
    let parentDbSessionId: string | null = null;
    if (body.onComplete?.notifySessionId && body.onComplete?.notifyInstanceId) {
      try {
        const targetDbSession = getSessionByOpencodeId(body.onComplete.notifySessionId);
        if (targetDbSession) {
          parentDbSessionId = targetDbSession.id;
        } else {
          log.warn("sessions-route", "Callback target session not found", { notifySessionId: body.onComplete.notifySessionId });
        }
      } catch (err) {
        log.warn("sessions-route", "Failed to resolve parent session for callback", { notifySessionId: body.onComplete?.notifySessionId, err });
      }
    }

    try {
      insertSession({
        id: sessionDbId,
        workspace_id: workspace.id,
        instance_id: instance.id,
        opencode_session_id: session.id,
        title: session.title ?? title ?? "New Session",
        directory: workspace.directory,
        parent_session_id: parentDbSessionId,
      });
    } catch (err) {
      log.warn("sessions-route", "Failed to persist session to DB — running in-memory only", { sessionId: sessionDbId, err });
    }

    // Step 5: Register completion callback if requested
    if (parentDbSessionId && body.onComplete?.notifyInstanceId) {
      try {
        insertSessionCallback({
          id: randomUUID(),
          source_session_id: sessionDbId,
          target_session_id: parentDbSessionId,
          target_instance_id: body.onComplete.notifyInstanceId,
        });
      } catch (err) {
        log.warn("sessions-route", "Failed to register session completion callback", { sessionId: sessionDbId, err });
      }

      // Start server-side monitoring so callback fires without browser SSE
      try {
        startMonitoring(sessionDbId, session.id, instance.id);
      } catch (err) {
        log.warn("sessions-route", "Failed to start callback monitoring for child session", { sessionId: sessionDbId, err });
      }
    }

    const response: CreateSessionResponse = {
      instanceId: instance.id,
      workspaceId: workspace.id,
      session,
    };
    return NextResponse.json(response, { status: 200 });
  } catch (err) {
    log.error("sessions-route", "Failed to create session", { err });
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
  } catch (err) {
    log.warn("sessions-route", "DB unavailable — falling back to live-only session listing", { err });
    const items: SessionListItem[] = [];
    await Promise.allSettled(
      liveInstances.map(async (instance) => {
        try {
          const result = await instance.client.session.list();
          const sessions = result.data ?? [];
          const isRunning = instance.status === "running";
          for (const session of sessions) {
            const legacyStatus = isRunning ? "active" : "stopped";
            items.push({
              instanceId: instance.id,
              workspaceId: "",
              workspaceDirectory: instance.directory,
              workspaceDisplayName: null,
              isolationStrategy: "existing",
              sourceDirectory: null,
              sessionStatus: legacyStatus,
              session,
              instanceStatus: instance.status,
              activityStatus: deriveActivityStatus(legacyStatus),
              lifecycleStatus: deriveLifecycleStatus(legacyStatus),
              typedInstanceStatus: isRunning ? "running" : "stopped",
            });
          }
        } catch (err) {
          log.warn("sessions-route", "Failed to list sessions from live instance during DB-unavailable fallback", { instanceId: instance.id, err });
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
        } catch (err) {
          log.warn("sessions-route", "Failed to fetch session statuses from live instance", { instanceId: instance.id, err });
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
          } catch (err) {
            log.warn("sessions-route", "Failed to persist idle status correction in DB", { sessionId: dbSession.id, err });
          }
          sessionStatus = "idle";
        } else if (liveStatus?.type === "busy" && dbSession.status === "idle") {
          // Session became busy again — correct stale idle state
          try {
            updateSessionStatus(dbSession.id, "active");
          } catch (err) {
            log.warn("sessions-route", "Failed to correct stale idle status to active in DB", { sessionId: dbSession.id, err });
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
      } catch (err) {
        log.warn("sessions-route", "Failed to look up DB instance for session", { instanceId: dbSession.instance_id, err });
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
        } else if (dbSession.status === "error") {
          sessionStatus = "error";
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
    let sourceDirectory: string | null = null;
    try {
      const ws = getWorkspace(dbSession.workspace_id);
      if (ws) {
        workspaceDirectory = ws.directory;
        isolationStrategy = ws.isolation_strategy;
        workspaceDisplayName = ws.display_name;
        sourceDirectory = ws.source_directory;
      }
    } catch (err) {
      log.warn("sessions-route", "Failed to fetch workspace info from DB", { workspaceId: dbSession.workspace_id, err });
    }

    // Fetch the OpenCode session details from the live instance if available
    if (liveInstance && instanceStatus === "running") {
      try {
        const result = await liveInstance.client.session.get({
          sessionID: dbSession.opencode_session_id,
        });
        if (result.data) {
          // Overlay user-renamed title from Fleet DB
          if (dbSession.title !== "Untitled") {
            result.data.title = dbSession.title;
          }
          items.push({
            instanceId: dbSession.instance_id,
            workspaceId: dbSession.workspace_id,
            workspaceDirectory,
            workspaceDisplayName,
            isolationStrategy,
            sourceDirectory,
            sessionStatus,
            session: result.data,
            instanceStatus,
            dbId: dbSession.id,
            parentSessionId: dbSession.parent_session_id,
            activityStatus: deriveActivityStatus(sessionStatus),
            lifecycleStatus: deriveLifecycleStatus(sessionStatus),
            typedInstanceStatus: instanceStatus === "running" ? "running" : "stopped",
          });
          continue;
        }
      } catch (err) {
        log.warn("sessions-route", "Failed to fetch live session details from SDK — using stub", { sessionId: dbSession.opencode_session_id, err });
      }
    }

    // For disconnected/stopped sessions, synthesize a stub session object
    items.push({
      instanceId: dbSession.instance_id,
      workspaceId: dbSession.workspace_id,
      workspaceDirectory,
      workspaceDisplayName,
      isolationStrategy,
      sourceDirectory,
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
      dbId: dbSession.id,
      parentSessionId: dbSession.parent_session_id,
      activityStatus: deriveActivityStatus(sessionStatus),
      lifecycleStatus: deriveLifecycleStatus(sessionStatus),
      typedInstanceStatus: instanceStatus === "running" ? "running" : "stopped",
    });
  }

  return NextResponse.json(items, { status: 200 });
}

// ─── Status derivation helpers ────────────────────────────────────────────────

function deriveActivityStatus(
  sessionStatus: SessionListItem["sessionStatus"]
): SessionActivityStatus | null {
  switch (sessionStatus) {
    case "active":
      return "busy";
    case "idle":
      return "idle";
    case "waiting_input":
      return "waiting_input";
    default:
      return null;
  }
}

function deriveLifecycleStatus(
  sessionStatus: SessionListItem["sessionStatus"]
): SessionLifecycleStatus {
    switch (sessionStatus) {
    case "active":
    case "idle":
    case "waiting_input":
      return "running";
    case "disconnected":
      return "disconnected";
    case "completed":
      return "completed";
    case "stopped":
      return "stopped";
    case "error":
      return "error";
  }
}
