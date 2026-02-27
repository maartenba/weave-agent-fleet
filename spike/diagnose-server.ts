/**
 * Diagnostic script: Test OpenCode server responsiveness
 * 
 * Tests hypotheses for why the server hangs:
 * - H3: Plugin interference (most likely — global config loads @opencode_weave/weave)
 * - H1: Initialization blocking (need longer wait)
 * - H6: Stdout buffering (--print-logs might block)
 * - H4: Project directory requirements
 * 
 * Run: node --experimental-strip-types spike/diagnose-server.ts
 */

import { spawn } from "child_process";

const OPENCODE_BIN = "/Users/pgermishuys/.opencode/bin/opencode";
const BASE_PORT = 4097;

interface TestResult {
  name: string;
  success: boolean;
  responseStatus?: number;
  responseBody?: string;
  error?: string;
  duration?: number;
}

async function httpProbe(url: string, timeoutMs: number = 10000): Promise<{ status: number; body: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    const body = await resp.text();
    clearTimeout(timer);
    return { status: resp.status, body: body.slice(0, 500) };
  } finally {
    clearTimeout(timer);
  }
}

function waitForLine(proc: ReturnType<typeof spawn>, pattern: string, timeoutMs: number = 30000): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for "${pattern}" in output`)), timeoutMs);
    let buffer = "";
    
    const onData = (data: Buffer) => {
      const text = data.toString();
      buffer += text;
      process.stdout.write(`  [server] ${text}`);
      if (buffer.includes(pattern)) {
        clearTimeout(timer);
        proc.stdout?.off("data", onData);
        proc.stderr?.off("data", onData);
        resolve(buffer);
      }
    };
    
    proc.stdout?.on("data", onData);
    proc.stderr?.on("data", onData);
    proc.on("error", (err) => { clearTimeout(timer); reject(err); });
    proc.on("exit", (code) => { 
      clearTimeout(timer); 
      reject(new Error(`Process exited with code ${code}. Output: ${buffer}`)); 
    });
  });
}

async function runTest(
  name: string,
  env: Record<string, string>,
  args: string[],
  port: number,
  cwd: string,
  waitBeforeProbeMs: number = 5000,
): Promise<TestResult> {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`TEST: ${name}`);
  console.log(`  Port: ${port}, CWD: ${cwd}`);
  console.log(`  Env: ${JSON.stringify(env)}`);
  console.log(`  Args: opencode ${args.join(" ")}`);
  console.log(`${"=".repeat(60)}`);

  const start = Date.now();
  const proc = spawn(OPENCODE_BIN, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    // Wait for server to report listening
    console.log(`  Waiting for server to start...`);
    await waitForLine(proc, "listening on", 30000);
    const startupTime = Date.now() - start;
    console.log(`  Server started in ${startupTime}ms`);

    // Additional wait before probing
    if (waitBeforeProbeMs > 0) {
      console.log(`  Waiting ${waitBeforeProbeMs}ms before probing...`);
      await new Promise(r => setTimeout(r, waitBeforeProbeMs));
    }

    // Probe routes
    const routes = ["/session", "/config"];
    for (const route of routes) {
      console.log(`  Probing GET ${route}...`);
      try {
        const result = await httpProbe(`http://127.0.0.1:${port}${route}`, 10000);
        console.log(`  ✅ ${route} → ${result.status} (${result.body.length} bytes)`);
        console.log(`     Body: ${result.body.slice(0, 200)}`);
        
        proc.kill("SIGTERM");
        return {
          name,
          success: true,
          responseStatus: result.status,
          responseBody: result.body,
          duration: Date.now() - start,
        };
      } catch (err: any) {
        console.log(`  ❌ ${route} → ${err.message}`);
      }
    }

    proc.kill("SIGTERM");
    return {
      name,
      success: false,
      error: "All routes timed out",
      duration: Date.now() - start,
    };
  } catch (err: any) {
    proc.kill("SIGTERM");
    return {
      name,
      success: false,
      error: err.message,
      duration: Date.now() - start,
    };
  }
}

async function main() {
  console.log("=== OpenCode Server Diagnostic ===\n");
  console.log(`Binary: ${OPENCODE_BIN}`);
  console.log(`Time: ${new Date().toISOString()}\n`);

  // Ensure /tmp/opencode-spike-test exists as a git repo
  const { execSync } = await import("child_process");
  try {
    execSync("mkdir -p /tmp/opencode-spike-test && cd /tmp/opencode-spike-test && git init 2>/dev/null", { stdio: "pipe" });
  } catch {}

  const results: TestResult[] = [];

  // Test 1: Disable plugins explicitly (MOST LIKELY FIX)
  // The global config loads @opencode_weave/weave@0.6.0 which may hang during init
  results.push(await runTest(
    "H3: Disable plugins (OPENCODE_CONFIG_CONTENT with empty plugin array)",
    { OPENCODE_CONFIG_CONTENT: JSON.stringify({ plugin: [] }) },
    ["serve", "--port", String(BASE_PORT)],
    BASE_PORT,
    "/tmp/opencode-spike-test",
    3000,
  ));

  // If test 1 succeeded, we found the issue — no need to run more
  if (results[0].success) {
    console.log("\n\n🎉 DIAGNOSIS COMPLETE: Plugin interference confirmed!");
    console.log("The global Weave plugin (@opencode_weave/weave@0.6.0) blocks the server.");
    console.log("Fix: Pass OPENCODE_CONFIG_CONTENT with empty plugin array when spawning.\n");
    printSummary(results);
    process.exit(0);
  }

  // Test 2: No plugins + longer wait (30s)
  results.push(await runTest(
    "H1+H3: No plugins + longer wait (30s)",
    { OPENCODE_CONFIG_CONTENT: JSON.stringify({ plugin: [] }) },
    ["serve", "--port", String(BASE_PORT + 1)],
    BASE_PORT + 1,
    "/tmp/opencode-spike-test",
    30000,
  ));

  if (results[1].success) {
    console.log("\n\n🎉 DIAGNOSIS: Server needs long initialization even without plugins.");
    printSummary(results);
    process.exit(0);
  }

  // Test 3: No plugins + from orchestrator project dir
  results.push(await runTest(
    "H4: No plugins + orchestrator project dir as CWD",
    { OPENCODE_CONFIG_CONTENT: JSON.stringify({ plugin: [] }) },
    ["serve", "--port", String(BASE_PORT + 2)],
    BASE_PORT + 2,
    "/Users/pgermishuys/source/opencode-orchestrator",
    5000,
  ));

  // Test 4: Completely empty config (no plugin key at all)
  results.push(await runTest(
    "H3b: Empty config object (no plugin key)",
    { OPENCODE_CONFIG_CONTENT: "{}" },
    ["serve", "--port", String(BASE_PORT + 3)],
    BASE_PORT + 3,
    "/tmp/opencode-spike-test",
    5000,
  ));

  // Test 5: With provider config (in case it needs valid LLM config)
  // Note: we use a dummy key — if this is the issue, it would at least not hang
  results.push(await runTest(
    "H2: With provider config (dummy key)",
    { 
      OPENCODE_CONFIG_CONTENT: JSON.stringify({ 
        plugin: [],
        provider: { anthropic: { api_key: "sk-ant-test-dummy" } }
      })
    },
    ["serve", "--port", String(BASE_PORT + 4)],
    BASE_PORT + 4,
    "/tmp/opencode-spike-test",
    5000,
  ));

  printSummary(results);
}

function printSummary(results: TestResult[]) {
  console.log("\n\n" + "=".repeat(60));
  console.log("SUMMARY");
  console.log("=".repeat(60));
  for (const r of results) {
    const icon = r.success ? "✅" : "❌";
    console.log(`${icon} ${r.name}`);
    if (r.success) {
      console.log(`   Status: ${r.responseStatus}, Duration: ${r.duration}ms`);
      console.log(`   Body: ${r.responseBody?.slice(0, 100)}`);
    } else {
      console.log(`   Error: ${r.error}`);
      console.log(`   Duration: ${r.duration}ms`);
    }
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
