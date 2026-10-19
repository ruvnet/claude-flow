#!/usr/bin/env node
/**
 * #4226 — with MCP_AUTH_TOKEN unset (local-only mode) the bridge must not
 * serve requests a browser sends for a foreign web page, even on loopback.
 * Spawns the bridge and checks over the wire:
 *   G1. a native client (no Origin, loopback Host) still reaches POST /mcp
 *   G2. POST /mcp with a foreign Origin → 403 (simple request, no preflight)
 *   G3. OPTIONS preflight from a foreign Origin → 403, no ACAO: *
 *   G4. POST /mcp with a non-loopback Host (DNS rebinding) → 403
 *   G5. a loopback Origin (local dev UI) is still accepted
 *   G6. an Origin listed in MCP_CORS_ORIGIN is still accepted
 *   G7. with MCP_AUTH_TOKEN set the guard is off and bearer auth decides
 *
 *   node test-local-browser-guard.mjs
 */
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const ENTRY = path.join(path.dirname(fileURLToPath(import.meta.url)), "index.js");
const QUIET = {
  MCP_GROUP_INTELLIGENCE: "false",
  MCP_GROUP_AGENTS: "false",
  MCP_GROUP_MEMORY: "false",
  MCP_GROUP_DEVTOOLS: "false",
  MCP_GROUP_NEURAL: "false",
};
let failed = 0;
function check(cond, label) {
  console.log(`  ${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failed++;
}

async function withBridge(env, fn) {
  const port = 20000 + Math.floor(Math.random() * 10000);
  const child = spawn("node", [ENTRY], { env: { ...process.env, ...QUIET, PORT: String(port), ...env }, stdio: "ignore" });
  try {
    for (let i = 0; i < 50; i++) {
      const up = await request(port, { method: "GET", path: "/health" }).then(r => r.status > 0, () => false);
      if (up) break;
      await sleep(100);
    }
    await fn(port);
  } finally {
    child.kill();
  }
}

// node:http, not fetch: fetch does not let a caller set Host or Origin.
function request(port, { method = "POST", path: p = "/mcp", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path: p, headers }, (res) => {
      res.resume();
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

const initialize = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
const json = { "Content-Type": "application/json" };

console.log("local-only mode (no MCP_AUTH_TOKEN)");
await withBridge({ MCP_CORS_ORIGIN: "" }, async (port) => {
  check((await request(port, { headers: json, body: initialize })).status === 200, "G1 native client reaches /mcp");
  check((await request(port, { headers: { ...json, Origin: "https://example.com" }, body: initialize })).status === 403, "G2 foreign Origin POST → 403");
  const pre = await request(port, { method: "OPTIONS", headers: { Origin: "https://example.com", "Access-Control-Request-Method": "POST" } });
  check(pre.status === 403 && pre.headers["access-control-allow-origin"] === undefined, "G3 foreign preflight → 403 without ACAO");
  check((await request(port, { headers: { ...json, Host: "evil.example" }, body: initialize })).status === 403, "G4 non-loopback Host → 403");
  check((await request(port, { headers: { ...json, Origin: "http://localhost:5173" }, body: initialize })).status === 200, "G5 loopback Origin accepted");
});
await withBridge({ MCP_CORS_ORIGIN: "https://ui.example" }, async (port) => {
  check((await request(port, { headers: { ...json, Origin: "https://ui.example" }, body: initialize })).status === 200, "G6 allowlisted Origin accepted");
});

console.log("token mode");
await withBridge({ MCP_AUTH_TOKEN: "t0ken" }, async (port) => {
  const res = await request(port, { headers: { ...json, Origin: "https://example.com", Authorization: "Bearer t0ken" }, body: initialize });
  check(res.status === 200, "G7 bearer token decides when set");
});

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
