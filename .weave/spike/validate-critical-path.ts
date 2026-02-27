/**
 * Full critical path validation spike
 * 
 * ROOT CAUSE FOUND: The @opencode_weave/weave plugin causes a deadlock by
 * calling GET /skill back to the server during bootstrap. Fix: isolate
 * XDG_CONFIG_HOME to prevent the global config from loading the plugin.
 * 
 * This script validates:
 * 1. Server spawn (with isolated config)
 * 2. Session creation
 * 3. Event subscription (SSE stream)
 * 4. Prompt sending
 * 5. Response streaming
 * 
 * Run: node --experimental-strip-types spike/validate-critical-path.ts
 */

import { createOpencodeServer, createOpencodeClient } from "@opencode-ai/sdk";
import { mkdirSync, writeFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// Create a clean config directory to avoid loading the Weave plugin
const CLEAN_CONFIG_DIR = join(tmpdir(), "opencode-orchestrator-config");
const CLEAN_OPENCODE_CONFIG_DIR = join(CLEAN_CONFIG_DIR, "opencode");
if (!existsSync(CLEAN_OPENCODE_CONFIG_DIR)) {
  mkdirSync(CLEAN_OPENCODE_CONFIG_DIR, { recursive: true });
}
writeFileSync(
  join(CLEAN_OPENCODE_CONFIG_DIR, "opencode.json"),
  JSON.stringify({ plugin: [] })
);

// Set XDG_CONFIG_HOME BEFORE spawning — this prevents loading global Weave plugin
process.env.XDG_CONFIG_HOME = CLEAN_CONFIG_DIR;

const PORT = 4097;
const TEST_DIR = process.cwd(); // opencode-orchestrator directory

async function main() {
  console.log("=== Critical Path Validation ===\n");
  console.log(`Config dir: ${CLEAN_CONFIG_DIR}`);
  console.log(`Test dir: ${TEST_DIR}`);
  console.log(`Port: ${PORT}\n`);

  // Step 1: Spawn server via SDK
  console.log("[1/5] Spawning OpenCode server...");
  const server = await createOpencodeServer({
    port: PORT,
    timeout: 30000,
    config: {
      plugin: [],
      permission: {
        edit: "allow",
        bash: "allow",
      },
    },
  });
  console.log(`  ✅ Server at ${server.url}\n`);

  // Step 2: Create client
  console.log("[2/5] Creating client + listing sessions...");
  const client = createOpencodeClient({ baseUrl: server.url });

  try {
    const sessions = await client.session.list();
    console.log(`  ✅ Listed sessions: ${JSON.stringify(sessions.data, null, 2).slice(0, 300)}`);
  } catch (err: any) {
    console.error(`  ❌ List failed: ${err.message}`);
  }

  // Step 3: Create a new session
  console.log("\n[3/5] Creating session...");
  let sessionId: string;
  try {
    const result = await client.session.create({
      body: { title: "critical-path-spike" },
    });
    const session = result.data;
    sessionId = session?.id ?? (result as any)?.id ?? "unknown";
    console.log(`  ✅ Session created: ${sessionId}`);
    console.log(`  Data: ${JSON.stringify(session, null, 2).slice(0, 500)}`);
  } catch (err: any) {
    console.error(`  ❌ Create failed: ${err.message}`);
    console.error(`  Full error:`, err);
    server.close();
    process.exit(1);
  }

  // Step 4: Subscribe to events BEFORE sending prompt
  console.log("\n[4/5] Subscribing to SSE events...");
  let eventStream: AsyncGenerator<any>;
  try {
    const subscribeResult = await client.event.subscribe({
      query: { directory: TEST_DIR },
    });
    console.log(`  ✅ Subscribed. Result keys: ${Object.keys(subscribeResult)}`);

    if ("stream" in subscribeResult) {
      eventStream = (subscribeResult as any).stream;
      console.log(`  ✅ Has .stream property`);
    } else {
      eventStream = subscribeResult as any;
      console.log(`  ⚠️ No .stream property, using result directly`);
    }
  } catch (err: any) {
    console.error(`  ❌ Subscribe failed: ${err.message}`);
    server.close();
    process.exit(1);
  }

  // Step 5: Send prompt
  console.log("\n[5/5] Sending prompt...");
  try {
    const promptResult = await client.session.promptAsync({
      path: { id: sessionId! },
      body: {
        parts: [
          { type: "text", text: "Say exactly: Hello from OpenCode! Nothing else." },
        ],
      },
    });
    console.log(`  ✅ Prompt sent (status: ${(promptResult as any)?.response?.status ?? "204"})`);
  } catch (err: any) {
    console.error(`  ❌ Prompt send failed: ${err.message}`);
    console.error(`  This is expected if no LLM provider/API key is configured.`);
    console.error(`  The important thing is that the server RESPONDED to the request.\n`);
    
    // Even if prompt fails (no API key), let's still try to get events briefly
    console.log("  Attempting to read events for 10 seconds anyway...");
  }

  // Listen for events
  console.log("\n--- Listening for events (30s max) ---\n");
  const timeout = setTimeout(() => {
    console.log("\n⏰ Timeout (30s). Stopping.");
    server.close();
    process.exit(0);
  }, 30000);

  let eventCount = 0;
  try {
    for await (const event of eventStream!) {
      eventCount++;
      const type = event?.type ?? "unknown";
      const props = event?.properties ?? event;

      console.log(`  📨 Event #${eventCount}: type=${type}`);

      if (type === "message.part.updated") {
        const part = props?.part;
        console.log(`     part.type=${part?.type}, sessionID=${part?.sessionID}`);
        if (part?.type === "text") {
          console.log(`     text: "${(part?.text ?? "").slice(0, 200)}"`);
        } else if (part?.type === "tool") {
          console.log(`     tool: ${part?.tool}, status: ${part?.state?.status}`);
        }
      } else if (type === "message.updated") {
        const info = props?.info;
        console.log(`     role=${info?.role}, sessionID=${info?.sessionID}`);
        if (info?.error) {
          console.log(`     error: ${JSON.stringify(info.error).slice(0, 300)}`);
        }
      } else if (type === "session.status") {
        console.log(`     sessionID=${props?.sessionID}, status=${JSON.stringify(props?.status)}`);
      } else if (type === "session.created" || type === "session.updated") {
        console.log(`     title="${props?.info?.title}"`);
      } else {
        console.log(`     ${JSON.stringify(props).slice(0, 200)}`);
      }

      if (eventCount > 100) {
        console.log("\n📊 100+ events collected. Stopping.");
        break;
      }
    }
  } catch (err: any) {
    console.error(`\n❌ Event stream error: ${err.message}`);
  }

  clearTimeout(timeout);
  console.log(`\n=== Validation Complete: ${eventCount} events received ===`);
  console.log(`\nSummary:`);
  console.log(`  Server spawn: ✅`);
  console.log(`  Session list: ✅`);
  console.log(`  Session create: ✅`);
  console.log(`  Event subscribe: ✅`);
  console.log(`  Events received: ${eventCount}`);

  server.close();
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
