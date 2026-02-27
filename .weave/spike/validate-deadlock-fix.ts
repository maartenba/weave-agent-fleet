/**
 * Validate the Weave plugin deadlock fix.
 * 
 * This script does NOT use XDG_CONFIG_HOME isolation.
 * The global config at ~/.config/opencode/opencode.json references
 * the local Weave plugin at /Users/pgermishuys/source/weave, which
 * now has a 3-second timeout on the /skill fetch call.
 * 
 * If the fix works: server spawns, session creates, prompt streams.
 * If the deadlock persists: script hangs on server spawn.
 * 
 * Run: node --experimental-strip-types spike/validate-deadlock-fix.ts
 */

import { createOpencodeServer, createOpencodeClient } from "@opencode-ai/sdk";

const PORT = 4098;
const TEST_DIR = process.cwd();

async function main() {
  console.log("=== Deadlock Fix Validation (NO XDG isolation) ===\n");

  // Hard timeout — if anything deadlocks, bail after 45s
  const bail = setTimeout(() => {
    console.error("\n❌ DEADLOCK — script hung for 45s. Fix did not work.");
    process.exit(1);
  }, 45000);

  // Step 1: Spawn server WITHOUT XDG isolation
  console.log("[1/4] Spawning server (plugin loads from global config)...");
  const t0 = Date.now();
  const server = await createOpencodeServer({
    port: PORT,
    timeout: 30000,
    config: {
      permission: { edit: "allow", bash: "allow" },
    },
  });
  console.log(`  ✅ Server spawned in ${Date.now() - t0}ms at ${server.url}\n`);

  // Step 2: List sessions (proves the server is responsive)
  console.log("[2/4] Listing sessions...");
  const client = createOpencodeClient({ baseUrl: server.url });
  const sessions = await client.session.list();
  console.log(`  ✅ Sessions: ${(sessions.data ?? []).length} existing\n`);

  // Step 3: Create session
  console.log("[3/4] Creating session...");
  const result = await client.session.create({
    body: { title: "deadlock-fix-test" },
  });
  const sessionId = result.data?.id ?? (result as any)?.id;
  console.log(`  ✅ Session: ${sessionId}\n`);

  // Step 4: Send prompt and listen for events
  console.log("[4/4] Sending prompt + listening for events...");
  const sub = await client.event.subscribe({ query: { directory: TEST_DIR } });
  const stream = "stream" in sub ? (sub as any).stream : sub;

  await client.session.promptAsync({
    path: { id: sessionId! },
    body: {
      parts: [{ type: "text", text: "Say exactly: Hello! Nothing else." }],
    },
  });
  console.log("  ✅ Prompt sent\n");

  console.log("--- Events (20s max) ---\n");
  const stop = setTimeout(() => {
    console.log("\n⏰ 20s elapsed. Stopping.\n");
    clearTimeout(bail);
    server.close();
    process.exit(0);
  }, 20000);

  let count = 0;
  for await (const event of stream) {
    count++;
    const type = event?.type ?? "?";
    if (type === "message.part.delta") {
      process.stdout.write(event?.properties?.delta ?? "");
    } else {
      console.log(`  [${type}]`);
    }
    if (count > 80) break;
  }

  clearTimeout(stop);
  clearTimeout(bail);
  console.log(`\n\n=== SUCCESS: ${count} events, no deadlock ===`);
  server.close();
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
