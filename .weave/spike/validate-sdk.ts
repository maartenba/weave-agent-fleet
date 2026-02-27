/**
 * Technical spike: Validate the critical path for V1
 * 
 * Tests:
 * 1. Can we spawn an OpenCode server via SDK?
 * 2. Can we create a session?
 * 3. Can we send a prompt?
 * 4. Can we receive SSE events?
 * 
 * Run: node --experimental-strip-types spike/validate-sdk.ts
 */

import { createOpencodeServer, createOpencodeClient } from "@opencode-ai/sdk";

const PORT = 4097;
const TEST_DIR = process.cwd();

async function main() {
  console.log("=== V1 Technical Spike ===\n");

  // Step 1: Spawn server
  console.log(`[1/5] Spawning OpenCode server on port ${PORT} for dir: ${TEST_DIR}`);
  let server: Awaited<ReturnType<typeof createOpencodeServer>>;
  try {
    server = await createOpencodeServer({ port: PORT, timeout: 15000 });
    console.log(`  ✅ Server spawned at ${server.url}`);
  } catch (err: any) {
    console.error(`  ❌ Server spawn failed: ${err.message}`);
    process.exit(1);
  }

  // Step 2: Create client
  console.log(`\n[2/5] Creating SDK client`);
  let client: ReturnType<typeof createOpencodeClient>;
  try {
    client = createOpencodeClient({ baseUrl: server.url });
    console.log(`  ✅ Client created`);
  } catch (err: any) {
    console.error(`  ❌ Client creation failed: ${err.message}`);
    server.close();
    process.exit(1);
  }

  // Step 3: Create session
  console.log(`\n[3/5] Creating session`);
  let sessionId: string;
  try {
    const result = await client.session.create({ body: { title: "spike-test" } });
    console.log(`  ✅ Session created`);
    console.log(`  Session data:`, JSON.stringify(result, null, 2));
    // Try to extract session ID from result
    sessionId = (result as any)?.data?.id ?? (result as any)?.id ?? "unknown";
    console.log(`  Session ID: ${sessionId}`);
  } catch (err: any) {
    console.error(`  ❌ Session creation failed: ${err.message}`);
    console.error(`  Full error:`, err);
    server.close();
    process.exit(1);
  }

  // Step 4: Subscribe to events BEFORE sending prompt
  console.log(`\n[4/5] Subscribing to SSE events`);
  let eventStream: any;
  try {
    const subscribeResult = await client.event.subscribe({ query: { directory: TEST_DIR } });
    console.log(`  ✅ Subscribed to events`);
    console.log(`  Subscribe result type: ${typeof subscribeResult}`);
    console.log(`  Subscribe result keys: ${Object.keys(subscribeResult)}`);
    
    // Check if it has .stream property
    if ('stream' in subscribeResult) {
      console.log(`  ✅ Has .stream property (AsyncGenerator)`);
      eventStream = (subscribeResult as any).stream;
    } else {
      console.log(`  ⚠️ No .stream property. Result:`, subscribeResult);
      eventStream = subscribeResult;
    }
  } catch (err: any) {
    console.error(`  ❌ Event subscription failed: ${err.message}`);
    console.error(`  Full error:`, err);
    server.close();
    process.exit(1);
  }

  // Step 5: Send prompt
  console.log(`\n[5/5] Sending prompt to session ${sessionId}`);
  try {
    const promptResult = await client.session.promptAsync({
      path: { id: sessionId },
      body: { parts: [{ type: "text", text: "Say hello in exactly 3 words. Nothing else." }] }
    });
    console.log(`  ✅ Prompt sent`);
    console.log(`  Prompt result status:`, (promptResult as any)?.response?.status ?? "unknown");
    console.log(`  Prompt result:`, JSON.stringify(promptResult, null, 2).slice(0, 500));
  } catch (err: any) {
    console.error(`  ❌ Prompt send failed: ${err.message}`);
    console.error(`  Full error:`, err);
    server.close();
    process.exit(1);
  }

  // Collect events for 30 seconds max
  console.log(`\n--- Listening for events (30s max) ---\n`);
  const timeout = setTimeout(() => {
    console.log("\n⏰ Timeout reached (30s). Stopping.");
    server.close();
    process.exit(0);
  }, 30000);

  let eventCount = 0;
  try {
    for await (const event of eventStream) {
      eventCount++;
      const type = event?.type ?? "unknown";
      const props = event?.properties ?? event;
      
      // Log event type and a summary
      console.log(`  📨 Event #${eventCount}: type=${type}`);
      
      // Show relevant details based on type
      if (type === "message.part.updated") {
        const part = props?.part;
        console.log(`     part.type=${part?.type}, sessionID=${part?.sessionID}`);
        if (part?.type === "text") {
          console.log(`     text content: "${part?.content?.slice(0, 200)}"`);
        }
      } else if (type === "message.updated") {
        const info = props?.info;
        console.log(`     role=${info?.role}, sessionID=${info?.sessionID}`);
      } else if (type === "session.updated") {
        console.log(`     session status: ${props?.info?.status ?? JSON.stringify(props).slice(0, 200)}`);
      } else {
        console.log(`     props keys: ${Object.keys(props || {})}`);
        console.log(`     data: ${JSON.stringify(props).slice(0, 300)}`);
      }

      // Stop after we see a reasonable amount of events or session goes idle
      if (eventCount > 50) {
        console.log("\n📊 Collected 50+ events. Stopping.");
        break;
      }
    }
  } catch (err: any) {
    console.error(`\n❌ Event stream error: ${err.message}`);
  }

  clearTimeout(timeout);
  console.log(`\n=== Spike Complete: ${eventCount} events received ===`);
  
  // Cleanup
  server.close();
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
