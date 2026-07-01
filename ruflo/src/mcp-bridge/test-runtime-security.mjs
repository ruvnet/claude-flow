#!/usr/bin/env node
/**
 * ADR-166 runtime verification — spawn each bridge with a test env and
 * assert the load-bearing behaviors observed OVER THE WIRE. Complements
 * test-security-lock.js (which is static-source only).
 *
 * Behaviors verified:
 *   R1. bridge starts on 127.0.0.1 by default
 *   R2. with MCP_AUTH_TOKEN set: unauthenticated POST /mcp → 401
 *   R3. with MCP_AUTH_TOKEN set: authenticated POST /mcp → 200 (or ≠401)
 *   R4. terminal_execute call → TOOL_DISABLED error unless MCP_ENABLE_TERMINAL=true
 *   R5. public bind without MCP_AUTH_TOKEN → process exits ≠0 within 3s
 *
 *   node test-runtime-security.mjs
 */

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BRIDGES = [
  { label: "src/mcp-bridge",          entry: path.join(HERE, "index.js") },
  { label: "src/ruvocal/mcp-bridge",  entry: path.join(HERE, "..", "ruvocal", "mcp-bridge", "index.js") },
];

const TOKEN = "test-token-" + Math.random().toString(36).slice(2);
let passed = 0, failed = 0;
const failures = [];

function assert(cond, label) {
  if (cond) { console.log(`    ✓ ${label}`); passed++; }
  else      { console.log(`    ✗ ${label}`); failures.push(label); failed++; }
}

async function pickPort() {
  // Pick a random port in the ephemeral range and hope for the best;
  // if the bridge fails to bind, the fetch will time out and we fail.
  return 20000 + Math.floor(Math.random() * 10000);
}

async function startBridge(entry, env, { waitMs = 1500 } = {}) {
  const child = spawn("node", [entry], {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "", stderr = "";
  child.stdout.on("data", (d) => { stdout += d.toString(); });
  child.stderr.on("data", (d) => { stderr += d.toString(); });
  const exitPromise = new Promise((resolve) => {
    child.on("exit", (code) => resolve({ exited: true, code }));
  });
  const ready = Promise.race([
    exitPromise,
    sleep(waitMs).then(() => ({ exited: false, code: null })),
  ]);
  return { child, stdout: () => stdout, stderr: () => stderr, ready };
}

async function killAndWait(child) {
  if (child.exitCode !== null) return;
  try { child.kill("SIGTERM"); } catch { /* ignore */ }
  await sleep(100);
  if (child.exitCode === null) try { child.kill("SIGKILL"); } catch { /* ignore */ }
}

async function testBridge(label, entry) {
  console.log(`\n# ${label}`);

  // R1 + R2 + R3 + R4 — bridge starts with token, auth behavior + terminal gate
  {
    const port = await pickPort();
    const b = await startBridge(entry, {
      PORT: String(port),
      MCP_BIND_HOST: "127.0.0.1",
      MCP_AUTH_TOKEN: TOKEN,
      MCP_ENABLE_TERMINAL: "false",
      MCP_GROUP_DEVTOOLS: "false",
      MCP_GROUP_INTELLIGENCE: "false",
      MCP_GROUP_AGENTS: "false",
      MCP_GROUP_MEMORY: "false",
    });
    const state = await b.ready;
    if (state.exited) {
      assert(false, `R1. bridge starts on 127.0.0.1 (exited early, code=${state.code}; stderr=${b.stderr().slice(0, 200)})`);
    } else {
      assert(true, "R1. bridge starts on 127.0.0.1 (didn't exit within 1.5s)");

      // R2 — unauthenticated POST /mcp → 401
      try {
        const r = await fetch(`http://127.0.0.1:${port}/mcp`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
        });
        assert(r.status === 401, `R2. unauthenticated POST /mcp → 401 (got ${r.status})`);
      } catch (e) {
        assert(false, `R2. unauthenticated POST /mcp threw: ${e.message}`);
      }

      // R3 — authenticated POST /mcp → not 401
      try {
        const r = await fetch(`http://127.0.0.1:${port}/mcp`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${TOKEN}`,
          },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
        });
        assert(r.status !== 401, `R3. authenticated POST /mcp → ≠401 (got ${r.status})`);
      } catch (e) {
        assert(false, `R3. authenticated POST /mcp threw: ${e.message}`);
      }

      // R4 — terminal_execute → TOOL_DISABLED (denied at executeTool, not just autopilot)
      try {
        const r = await fetch(`http://127.0.0.1:${port}/mcp`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${TOKEN}`,
          },
          body: JSON.stringify({
            jsonrpc: "2.0", id: 1, method: "tools/call",
            params: { name: "terminal_execute", arguments: { command: "id" } },
          }),
        });
        const body = await r.json();
        // The response wraps the executeTool result in `result.content[0].text` as JSON string.
        const text = JSON.stringify(body);
        assert(text.includes("TOOL_DISABLED") || text.includes("disabled by default"),
          "R4. terminal_execute denied server-side (TOOL_DISABLED)");
      } catch (e) {
        assert(false, `R4. terminal_execute threw: ${e.message}`);
      }
    }
    await killAndWait(b.child);
  }

  // R5 — public bind without token → process exits ≠0 within 3s
  {
    const port = await pickPort();
    const b = await startBridge(entry, {
      PORT: String(port),
      MCP_BIND_HOST: "0.0.0.0",
      MCP_AUTH_TOKEN: "",
      MCP_GROUP_DEVTOOLS: "false",
      MCP_GROUP_INTELLIGENCE: "false",
      MCP_GROUP_AGENTS: "false",
      MCP_GROUP_MEMORY: "false",
    }, { waitMs: 3000 });
    const state = await b.ready;
    assert(state.exited && state.code !== 0,
      `R5. public bind without token exits ≠0 (exited=${state.exited}, code=${state.code})`);
    if (b.stderr().includes("FATAL")) {
      assert(true, "R5b. FATAL message logged to stderr");
    } else {
      assert(false, "R5b. FATAL message expected in stderr");
    }
    await killAndWait(b.child);
  }
}

(async () => {
  for (const { label, entry } of BRIDGES) {
    await testBridge(label, entry);
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log("ADR-166 runtime verification: OK");
})();
