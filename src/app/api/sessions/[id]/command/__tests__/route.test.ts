import { vi } from "vitest";
import { NextRequest } from "next/server";

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("@/lib/server/process-manager", () => ({
  _recoveryComplete: Promise.resolve(),
}));

vi.mock("@/lib/server/opencode-client", () => ({
  getClientForInstance: vi.fn(),
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { POST } from "@/app/api/sessions/[id]/command/route";
import * as openCodeClient from "@/lib/server/opencode-client";

const mockGetClientForInstance = vi.mocked(openCodeClient.getClientForInstance);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeContext(id = "sess-1") {
  return { params: Promise.resolve({ id }) };
}

function makeRequest(body: unknown) {
  return new NextRequest("http://localhost/api/sessions/sess-1/command", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeInvalidJsonRequest() {
  return new NextRequest("http://localhost/api/sessions/sess-1/command", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "not-json{{{",
  });
}

function makeMockClient(commandResult?: { catch: ReturnType<typeof vi.fn> }) {
  const commandPromise = commandResult ?? {
    catch: vi.fn().mockReturnThis(),
  };
  return {
    session: {
      command: vi.fn().mockReturnValue(commandPromise),
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("POST /api/sessions/[id]/command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 for invalid JSON body", async () => {
    const req = makeInvalidJsonRequest();
    const res = await POST(req, makeContext());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/invalid json/i);
  });

  it("returns 400 when instanceId is missing", async () => {
    const req = makeRequest({ command: "compact" });
    const res = await POST(req, makeContext());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/instanceId/i);
  });

  it("returns 400 when instanceId is not a string", async () => {
    const req = makeRequest({ instanceId: 123, command: "compact" });
    const res = await POST(req, makeContext());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/instanceId/i);
  });

  it("returns 400 when command is missing", async () => {
    const req = makeRequest({ instanceId: "inst-1" });
    const res = await POST(req, makeContext());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/command/i);
  });

  it("returns 400 when command is empty string", async () => {
    const req = makeRequest({ instanceId: "inst-1", command: "" });
    const res = await POST(req, makeContext());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/command/i);
  });

  it("returns 400 when command is whitespace only", async () => {
    const req = makeRequest({ instanceId: "inst-1", command: "   " });
    const res = await POST(req, makeContext());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/command/i);
  });

  it("returns 404 when instance not found", async () => {
    mockGetClientForInstance.mockImplementation(() => {
      throw new Error("Instance not found");
    });

    const req = makeRequest({ instanceId: "bad-inst", command: "compact" });
    const res = await POST(req, makeContext());
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toMatch(/instance not found/i);
  });

  it("returns 200 with success response on valid command", async () => {
    const client = makeMockClient();
    mockGetClientForInstance.mockReturnValue(client as never);

    const req = makeRequest({ instanceId: "inst-1", command: "compact" });
    const res = await POST(req, makeContext());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.sessionId).toBe("sess-1");
  });

  it("calls client.session.command with correct parameters", async () => {
    const client = makeMockClient();
    mockGetClientForInstance.mockReturnValue(client as never);

    const req = makeRequest({ instanceId: "inst-1", command: "compact" });
    await POST(req, makeContext());

    expect(client.session.command).toHaveBeenCalledWith({
      sessionID: "sess-1",
      command: "compact",
    });
  });

  it("passes arguments through when provided", async () => {
    const client = makeMockClient();
    mockGetClientForInstance.mockReturnValue(client as never);

    const req = makeRequest({
      instanceId: "inst-1",
      command: "plan",
      args: "build a widget",
    });
    await POST(req, makeContext());

    expect(client.session.command).toHaveBeenCalledWith({
      sessionID: "sess-1",
      command: "plan",
      arguments: "build a widget",
    });
  });

  it("omits arguments when not provided", async () => {
    const client = makeMockClient();
    mockGetClientForInstance.mockReturnValue(client as never);

    const req = makeRequest({ instanceId: "inst-1", command: "compact" });
    await POST(req, makeContext());

    const callArgs = client.session.command.mock.calls[0][0];
    expect(callArgs).not.toHaveProperty("arguments");
  });

  it("trims command whitespace", async () => {
    const client = makeMockClient();
    mockGetClientForInstance.mockReturnValue(client as never);

    const req = makeRequest({ instanceId: "inst-1", command: "  compact  " });
    await POST(req, makeContext());

    expect(client.session.command).toHaveBeenCalledWith(
      expect.objectContaining({ command: "compact" }),
    );
  });

  it("returns 500 when client.session.command throws synchronously", async () => {
    const client = {
      session: {
        command: vi.fn().mockImplementation(() => {
          throw new Error("Unexpected sync error");
        }),
      },
    };
    mockGetClientForInstance.mockReturnValue(client as never);

    const req = makeRequest({ instanceId: "inst-1", command: "compact" });
    const res = await POST(req, makeContext());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toMatch(/failed to execute command/i);
  });

  it("attaches .catch to fire-and-forget promise for async errors", async () => {
    const catchFn = vi.fn().mockReturnThis();
    const commandPromise = { catch: catchFn };
    const client = {
      session: {
        command: vi.fn().mockReturnValue(commandPromise),
      },
    };
    mockGetClientForInstance.mockReturnValue(client as never);

    const req = makeRequest({ instanceId: "inst-1", command: "compact" });
    const res = await POST(req, makeContext());

    expect(res.status).toBe(200);
    expect(catchFn).toHaveBeenCalledWith(expect.any(Function));
  });

  it("uses session ID from route params, not request body", async () => {
    const client = makeMockClient();
    mockGetClientForInstance.mockReturnValue(client as never);

    const req = makeRequest({ instanceId: "inst-1", command: "compact" });
    await POST(req, makeContext("custom-session-id"));

    expect(client.session.command).toHaveBeenCalledWith(
      expect.objectContaining({ sessionID: "custom-session-id" }),
    );
  });
});
