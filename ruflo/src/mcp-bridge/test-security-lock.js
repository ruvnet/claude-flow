#!/usr/bin/env node
/**
 * ADR-166 §6 acceptance #9 — anti-regression lock for the MCP-bridge
 * security surface. Runs on the source of BOTH bridge files (the ruvocal
 * variant that ships in docker-compose, and the sibling REST bridge).
 *
 * Fails if any of the following load-bearing controls silently disappears:
 *   1. `MCP_BIND_HOST` default is `127.0.0.1` (loopback default — Phase 1a)
 *   2. Public bind without `MCP_AUTH_TOKEN` calls `process.exit(1)` at boot (Phase 1b)
 *   3. `requireAuth` middleware exists and is mounted with `app.use(requireAuth)` (Phase 1c)
 *   4. `requireAuth` uses `timingSafeEqual` (constant-time compare)
 *   5. `executeTool` denies terminal_execute unless `MCP_ENABLE_TERMINAL === "true"` (Phase 1d + 2a)
 *   6. CORS respects `MCP_CORS_ORIGIN` allowlist (Phase 3b)
 *
 * Runs offline (no server, no deps). CI-safe.
 *
 *   node test-security-lock.js       # → exit 0 on green, exit 1 on regression
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BRIDGES = [
  path.join(HERE, "index.js"),                           // ruflo/src/mcp-bridge/index.js
  path.join(HERE, "..", "ruvocal", "mcp-bridge", "index.js"), // ruvocal variant (deployed)
];

const CHECKS = [
  {
    id: "1. bind-loopback-default",
    rx: /BIND_HOST\s*=\s*process\.env\.MCP_BIND_HOST\s*\|\|\s*["']127\.0\.0\.1["']/,
    hint: "MCP_BIND_HOST must default to 127.0.0.1 (ADR-166 §6 Phase 1a)",
  },
  {
    id: "2. fail-closed-public-bind",
    rx: /isPublic\s*&&\s*!process\.env\.MCP_AUTH_TOKEN[\s\S]*?process\.exit\(\s*1\s*\)/,
    hint: "public bind without MCP_AUTH_TOKEN must process.exit(1) at boot (Phase 1b)",
  },
  {
    id: "3. auth-middleware-mounted",
    rx: /app\.use\(\s*requireAuth\s*\)/,
    hint: "requireAuth middleware must be mounted via app.use() (Phase 1c)",
  },
  {
    id: "4. constant-time-token-compare",
    rx: /timingSafeEqual\s*\(/,
    hint: "auth compare must use timingSafeEqual (Phase 1c)",
  },
  {
    id: "5. terminal-gate-server-side",
    rx: /MCP_ENABLE_TERMINAL[\s\S]*?executeTool[\s\S]*?TOOL_DISABLED|executeTool[\s\S]*?MCP_ENABLE_TERMINAL[\s\S]*?TOOL_DISABLED/,
    hint: "terminal_execute must be denied at executeTool unless MCP_ENABLE_TERMINAL=true (Phase 1d + 2a)",
  },
  {
    id: "6. cors-allowlist-respected",
    rx: /MCP_CORS_ORIGIN[\s\S]*?CORS_ALLOWLIST/,
    hint: "CORS must respect MCP_CORS_ORIGIN allowlist (Phase 3b)",
  },
];

let hardFail = false;
for (const bridge of BRIDGES) {
  if (!fs.existsSync(bridge)) {
    console.error(`FAIL: bridge missing: ${bridge}`);
    hardFail = true;
    continue;
  }
  const src = fs.readFileSync(bridge, "utf-8");
  const rel = path.relative(path.join(HERE, "..", ".."), bridge);
  console.log(`\n# ${rel}`);
  for (const check of CHECKS) {
    if (check.rx.test(src)) {
      console.log(`  ✓ ${check.id}`);
    } else {
      console.log(`  ✗ ${check.id}`);
      console.log(`    hint: ${check.hint}`);
      hardFail = true;
    }
  }
}

if (hardFail) {
  console.error("\nADR-166 security lock FAILED — a load-bearing control was removed or drifted.");
  process.exit(1);
}
console.log("\nADR-166 security lock: OK");
