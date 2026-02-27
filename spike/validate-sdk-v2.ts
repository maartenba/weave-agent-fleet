/**
 * Spike v2: Step-by-step with timeouts and raw HTTP fallback
 */

import { createOpencodeServer, createOpencodeClient } from "@opencode-ai/sdk";

const PORT = 4097;
const TEST_DIR = "/Users/pgermishuys/source/opencode-orchestrator";

async function main() {
  console.log("=== V1 Technical Spike v2 ===\n");

  // Step 1: Spawn server
  console.log(`[1] Spawning server on port ${PORT}...`);
  const server = await createOpencodeServer({ port: PORT, timeout: 15000 });
  console.log(`  ✅ Server at ${server.url}\n`);

  // Step 2: Raw HTTP health check
  console.log(`[2] Raw HTTP test...`);
  try {
    const resp = await fetch(`${server.url}/session`, {
      headers: { "x-opencode-directory": encodeURIComponent(TEST_DIR) }
    });
    console.log(`  GET /session → ${resp.status} ${resp.statusText}`);
    const body = await resp.text();
    console.log(`  Body (first 500 chars): ${body.slice(0, 500)}\n`);
  } catch (err: any) {
    console.error(`  ❌ ${err.message}\n`);
  }

  // Step 3: Try session create via raw HTTP
  console.log(`[3] Raw POST /session (create)...`);
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    
    const resp = await fetch(`${server.url}/session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-opencode-directory": encodeURIComponent(TEST_DIR),
      },
      body: JSON.stringify({ title: "spike-test" }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    console.log(`  POST /session → ${resp.status} ${resp.statusText}`);
    const body = await resp.text();
    console.log(`  Body (first 1000 chars): ${body.slice(0, 1000)}\n`);
  } catch (err: any) {
    console.error(`  ❌ ${err.message}\n`);
  }

  // Step 4: List available routes (try a few)
  console.log(`[4] Probing API routes...`);
  const routes = ["/", "/health", "/session", "/event", "/config"];
  for (const route of routes) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const resp = await fetch(`${server.url}${route}`, {
        headers: { "x-opencode-directory": encodeURIComponent(TEST_DIR) },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const body = await resp.text();
      console.log(`  GET ${route} → ${resp.status} (${body.length} bytes): ${body.slice(0, 200)}`);
    } catch (err: any) {
      console.log(`  GET ${route} → ❌ ${err.message}`);
    }
  }

  console.log("\n=== Done ===");
  server.close();
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
