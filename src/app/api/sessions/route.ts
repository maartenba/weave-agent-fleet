import { NextRequest, NextResponse } from "next/server";
import { spawnInstance, listInstances, validateDirectory } from "@/lib/server/process-manager";
import type {
  CreateSessionRequest,
  CreateSessionResponse,
  SessionListItem,
} from "@/lib/api-types";

// POST /api/sessions — spawn an OpenCode instance (or reuse) and create a session
export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: CreateSessionRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { directory, title } = body;

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
    const instance = await spawnInstance(resolvedDir);
    const result = await instance.client.session.create({
      body: { title: title ?? "New Session" },
    });

    const session = result.data;
    if (!session) {
      return NextResponse.json(
        { error: "Failed to create session — SDK returned no data" },
        { status: 500 }
      );
    }

    const response: CreateSessionResponse = {
      instanceId: instance.id,
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

// GET /api/sessions — list all sessions across all managed instances
export async function GET(): Promise<NextResponse> {
  const instances = listInstances();

  const items: SessionListItem[] = [];

  await Promise.allSettled(
    instances.map(async (instance) => {
      try {
        const result = await instance.client.session.list();
        const sessions = result.data ?? [];
        for (const session of sessions) {
          items.push({
            instanceId: instance.id,
            session,
            instanceStatus: instance.status,
          });
        }
      } catch {
        // If an instance fails to list, skip it — don't crash the whole response
      }
    })
  );

  return NextResponse.json(items, { status: 200 });
}
