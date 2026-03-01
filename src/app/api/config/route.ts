import { NextRequest, NextResponse } from "next/server";
import {
  getUserConfig,
  updateUserConfig,
  listInstalledSkills,
  getConfigPaths,
} from "@/lib/server/config-manager";

// GET /api/config — returns user-level config and installed skills
export async function GET(): Promise<NextResponse> {
  try {
    const userConfig = getUserConfig();
    const installedSkills = listInstalledSkills();
    const paths = getConfigPaths();

    return NextResponse.json(
      {
        userConfig: userConfig ?? { agents: {} },
        installedSkills,
        paths,
      },
      { status: 200 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PUT /api/config — updates user-level config
export async function PUT(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();

    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "Invalid request body" },
        { status: 400 }
      );
    }

    // Accept the full config object or just the agents section
    const config = body.agents ? { agents: body.agents } : body;
    updateUserConfig(config);

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
