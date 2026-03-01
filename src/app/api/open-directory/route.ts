import { NextRequest, NextResponse } from "next/server";
import { validateDirectory } from "@/lib/server/process-manager";
import { spawn } from "child_process";

const ALLOWED_TOOLS = ["vscode", "cursor", "terminal", "explorer"] as const;
type OpenTool = (typeof ALLOWED_TOOLS)[number];

interface OpenDirectoryRequest {
  directory: string;
  tool: OpenTool;
}

// POST /api/open-directory — open a workspace directory in an editor, terminal, or file explorer
export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: OpenDirectoryRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const { directory, tool } = body;

  // Validate required fields
  if (!directory || typeof directory !== "string") {
    return NextResponse.json(
      { error: "Missing or invalid 'directory' field" },
      { status: 400 }
    );
  }

  if (!tool || typeof tool !== "string") {
    return NextResponse.json(
      { error: "Missing or invalid 'tool' field" },
      { status: 400 }
    );
  }

  // SECURITY GATE: strict allowlist check for tool — prevents command injection
  if (!ALLOWED_TOOLS.includes(tool as OpenTool)) {
    return NextResponse.json(
      { error: `Invalid tool '${tool}'. Allowed: ${ALLOWED_TOOLS.join(", ")}` },
      { status: 400 }
    );
  }

  // Validate directory is within allowed workspace roots and exists
  let resolvedDirectory: string;
  try {
    resolvedDirectory = validateDirectory(directory);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid directory";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // Determine spawn command based on tool + platform
  try {
    spawnTool(tool, resolvedDirectory);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to open directory";
    console.error(`[POST /api/open-directory] Failed to spawn ${tool}:`, err);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

function spawnTool(tool: OpenTool, directory: string): void {
  const platform = process.platform;
  const isWindows = platform === "win32";
  const isMac = platform === "darwin";

  let command: string;
  let args: string[];
  const options: { detached: boolean; stdio: "ignore"; cwd?: string; shell?: boolean; windowsHide?: boolean } = {
    detached: true,
    stdio: "ignore",
  };

  switch (tool) {
    case "vscode":
      if (isMac) {
        command = "open";
        args = ["-a", "Visual Studio Code", directory];
      } else if (isWindows) {
        command = "code";
        args = [directory];
        options.shell = true;
        options.windowsHide = true;
      } else {
        command = "code";
        args = [directory];
      }
      break;

    case "cursor":
      if (isMac) {
        command = "open";
        args = ["-a", "Cursor", directory];
      } else if (isWindows) {
        command = "cursor";
        args = [directory];
        options.shell = true;
        options.windowsHide = true;
      } else {
        command = "cursor";
        args = [directory];
      }
      break;

    case "terminal":
      if (isMac) {
        command = "open";
        args = ["-a", "Terminal", "."];
        options.cwd = directory;
      } else if (isWindows) {
        command = "cmd";
        args = ["/c", "start", "cmd", "/K"];
        options.shell = true;
        options.cwd = directory;
      } else {
        // Linux
        command = "x-terminal-emulator";
        args = [];
        options.cwd = directory;
      }
      break;

    case "explorer":
      if (isMac) {
        command = "open";
        args = [directory];
      } else if (isWindows) {
        command = "explorer";
        args = [directory];
      } else {
        // Linux
        command = "xdg-open";
        args = [directory];
      }
      break;
  }

  const child = spawn(command, args, options);
  child.unref();
}
