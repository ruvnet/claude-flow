#!/usr/bin/env node
/**
 * Fix-invariants audit — guards against silent regression of the recent
 * critical fixes that don't have a dedicated audit script.
 *
 * Each entry pins one or more substrings/regexes that MUST exist in a
 * specific source file. The substring is the load-bearing line from the
 * fix — if a refactor accidentally removes it, the bug returns silently
 * (no test failure, just wrong runtime behavior).
 *
 * This is intentionally a presence-check (not a behavior test). Behavior
 * is covered by the dedicated audits (audit-vector-dim, audit-hook-
 * handler-prompt) and unit tests; this script is the cheap last-mile
 * guard for fixes whose dedicated test wasn't worth writing alone.
 *
 * Usage:
 *   node scripts/audit-fix-invariants.mjs           # exit 1 on any miss
 *   node scripts/audit-fix-invariants.mjs --json    # machine-readable report
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = process.cwd();
const JSON_OUT = process.argv.includes('--json');

/**
 * Each entry: a fix-issue, the file the invariant lives in, and either a
 * `substring` (must appear verbatim) or a `regex` (must match). Add a
 * short `why` so the failure message tells the next developer what
 * runtime behavior breaks if they remove the line.
 *
 * @typedef {Object} Invariant
 * @property {string} issue        — e.g. '#1945' (for failure messages)
 * @property {string} file         — repo-relative path
 * @property {string} [substring]  — must appear verbatim
 * @property {RegExp} [regex]      — must match somewhere in the file
 * @property {string} why          — what breaks if this line is removed
 */
/** @type {Invariant[]} */
const INVARIANTS = [
  // #1939 — Win32 cwd → Claude Code slug
  {
    issue: '#1939',
    file: 'v3/@claude-flow/cli/src/mcp-tools/memory-tools.ts',
    regex: /\/\^\[A-Za-z\]:\[\\\\\/\]\//,
    why: 'Win32 slug candidate regex (`^[A-Za-z]:[\\/]`) — without it, memory_import_claude({allProjects:false}) returns 0 on Win32 paths like `C:\\Users\\…\\Claude Stuff`.',
  },
  {
    issue: '#1939',
    file: 'v3/@claude-flow/cli/src/mcp-tools/memory-tools.ts',
    substring: "replace(/[:\\\\/]/g, '-')",
    why: 'Win32 slug normalization — drops `:` / `\\` / `/` so `C:\\Users\\…\\Claude Stuff` → `C--Users-…-Claude-Stuff`.',
  },

  // #1941 — provision per-namespace vector_indexes row before entry insert
  {
    issue: '#1941',
    file: 'v3/@claude-flow/cli/src/memory/memory-bridge.ts',
    substring: 'INSERT OR IGNORE INTO vector_indexes (id, name, dimensions)',
    why: 'Per-namespace vector_indexes provisioning in bridgeStoreEntry — without it, memory_search({namespace:"X"}) returns 0 for any non-default namespace.',
  },
  {
    issue: '#1941',
    file: 'v3/@claude-flow/cli/src/memory/memory-initializer.ts',
    substring: 'INSERT OR IGNORE INTO vector_indexes (id, name, dimensions)',
    why: 'Per-namespace vector_indexes provisioning in storeEntry (sql.js fallback) — same root cause as the bridge path; one needs both branches.',
  },

  // #1943 — settings-generator project-local OR $HOME probe
  {
    issue: '#1943',
    file: 'v3/@claude-flow/cli/src/init/settings-generator.ts',
    substring: '[ -f "$D/',
    why: 'POSIX sh probe in hookCmd() — without it, global-install hook paths anchor at `${CLAUDE_PROJECT_DIR}` only and every Bash/Edit/Session hook fires MODULE_NOT_FOUND.',
  },
  {
    issue: '#1943',
    file: 'v3/@claude-flow/cli/src/init/settings-generator.ts',
    substring: 'IF EXIST',
    why: 'Windows `cmd /c IF EXIST … ELSE …` fallback — Win32 equivalent of the sh probe.',
  },

  // #1945 / #1946 — memory bridge + doctor honor CLAUDE_FLOW_MEMORY_PATH
  {
    issue: '#1945',
    file: 'v3/@claude-flow/cli/src/memory/memory-bridge.ts',
    substring: 'getMemoryRoot',
    why: 'getDbPath() routes through getMemoryRoot() — without it, the bridge hard-codes `<cwd>/.swarm/memory.db` and CLI store writes to a different file than memory init created.',
  },
  {
    issue: '#1946',
    file: 'v3/@claude-flow/cli/src/commands/doctor.ts',
    substring: 'getMemoryRoot',
    why: 'doctor.checkMemoryDatabase() routes through getMemoryRoot() — without it, doctor reports "Not initialized" on any DB at a non-default path.',
  },

  // #1951 — statusline reads installed version from plugin package.json
  {
    issue: '#1951',
    file: 'v3/@claude-flow/cli/.claude/helpers/statusline.cjs',
    substring: 'RUFLO_VERSION',
    why: 'Startup version-probe variable in the deployed statusline — without it the header reverts to a hard-coded `RuFlo V3.5`.',
  },
  {
    issue: '#1951',
    file: 'v3/@claude-flow/cli/.claude/helpers/statusline.cjs',
    // Regex matches the path.join(home, '.claude', 'plugins', 'marketplaces', 'ruflo', …) form.
    // The original substring form happened to hit because of a comment in the v3 snapshot,
    // not the actual code path; switch to a regex that catches the real call site.
    regex: /['"]marketplaces['"]\s*,\s*['"]ruflo['"]/,
    why: 'Plugin-install candidate path probed first — without it, plugin users always fall through to the hardcoded default.',
  },
  {
    issue: '#1951',
    file: '.claude/helpers/statusline.cjs',
    regex: /['"]marketplaces['"]\s*,\s*['"]ruflo['"]/,
    why: 'Same plugin-install candidate in the root statusline copy.',
  },
  // #2679 sync: the init template no longer inlines the statusline —
  // it reads .claude/helpers/statusline.cjs and substitutes. The
  // marketplaces/ruflo candidate path therefore lives in the helper
  // file (already covered by the two invariants above). Dropping this
  // entry since the invariant is now enforced by the paired
  // .claude/helpers/statusline.cjs + v3/@claude-flow/cli/.claude/helpers/
  // statusline.cjs invariants; the generator can't ship a copy without
  // that candidate because it doesn't ship a copy at all — it reads one.

  // #1953 — hooks_pretrain code-file budget + code-dir-first traversal
  {
    issue: '#1953',
    file: 'v3/@claude-flow/cli/src/mcp-tools/hooks-tools.ts',
    substring: 'codeFilesScanned',
    why: 'Separate code-file budget counter — without it, the 50-file budget is burned by .md/.yaml/.db files and patternsExtracted: 0 on docs-heavy repos.',
  },

  // #1968 — daemon launcher forwards --workers / --headless / --sandbox
  {
    issue: '#1968',
    file: 'v3/@claude-flow/cli/src/commands/daemon.ts',
    regex: /forkArgs\.push\(['"]--workers['"]/,
    why: 'Daemon launcher forwards --workers to the forked child — without it, `daemon start --workers map` silently uses the default worker set.',
  },
  {
    issue: '#1968',
    file: 'v3/@claude-flow/cli/src/commands/daemon.ts',
    regex: /forkArgs\.push\(['"]--headless['"]\)/,
    why: 'Daemon launcher forwards --headless — same family as the --workers gap.',
  },

  // #1989 — statusline previously guarded raw SQLite header reads against
  // RFE1-encrypted memory.db (the bug rendered 3.3B `patterns` and cascaded
  // into fake DDD 5/5 / 100% / 🧠 100%). Superseded by #2196's delegation
  // refactor: statusline-generator.ts no longer reads .swarm/memory.db
  // bytes directly — it delegates to `hooks-statusline --json`, which
  // queries AgentDB via the typed SDK and never touches raw SQLite pages.
  // The regression vector is closed by ARCHITECTURE: if a future refactor
  // reintroduces raw-bytes reading from a memory.db path, the #2196 guard
  // (presence of the delegation pattern) catches it before the SQLite
  // magic-check would ever be relevant. See ruvnet/ruflo#2216 for the
  // user-deployed (pre-#2196) statusline still having the bug.
  // #2679 sync: statusline-generator no longer inlines the delegation
  // template as a big string — it now READS
  // .claude/helpers/statusline.cjs at generation time and interpolates
  // maxAgents + bakedVersion. The delegation contract therefore lives
  // in the HELPER file, not the generator. Two paired invariants:
  //   1. the helper must contain the delegation pattern (unchanged intent)
  //   2. the generator must still be reading the helper (so the pattern
  //      actually reaches init output)
  // Splitting the check catches drift on either side of the sync.
  {
    issue: '#2196',
    file: 'v3/@claude-flow/cli/.claude/helpers/statusline.cjs',
    regex: /hooks[- ]statusline|hooksStatusline/,
    why: 'Statusline helper must delegate to hooks-statusline rather than re-implementing memory.db readers (#2195/#1989 supersession). Without delegation, the shipped statusline.cjs goes back to raw-bytes reading which broke for encrypted RFE1 DBs. (Was previously checked in statusline-generator.ts; moved here per #2679 read-and-substitute refactor.)',
  },
  {
    issue: '#2679',
    file: 'v3/@claude-flow/cli/src/init/statusline-generator.ts',
    regex: /statusline\.cjs/,
    why: 'Generator must READ .claude/helpers/statusline.cjs as its single source of truth (see #2679). Removing this reference would silently regress the generator to whatever inline template shape existed at the time — the pre-#2195 non-delegation build in the prior history.',
  },

  // #1987 — memory stats uses persistent HNSW count from MCP tool, not
  // the in-process JS state (which is always 0 from a fresh CLI invocation).
  {
    issue: '#1987',
    file: 'v3/@claude-flow/cli/src/commands/memory.ts',
    substring: 'statsResult.entriesWithEmbeddings',
    why: 'memory stats reads persistent entriesWithEmbeddings, not in-process hnsw.entryCount. Without this, `memory stats` shows HNSW (0 entries) even when the DB has thousands of vectors.',
  },

  // #1948 — Windows-specific statusLine command (no `sh` required)
  {
    issue: '#1948',
    file: 'v3/@claude-flow/cli/src/init/settings-generator.ts',
    regex: /process\.platform === ['"]win32['"]/,
    why: 'Platform-aware statusLine emission. On native Windows we emit `node -e "…"` instead of `sh -c …` so missing/mangled-quoting `sh` no longer produces stray repo-root files.',
  },

  // #1937 — exclusion patterns for memory_import_claude (voice-fidelity)
  {
    issue: '#1937',
    file: 'v3/@claude-flow/cli/src/mcp-tools/memory-tools.ts',
    substring: 'excludeFilePatterns',
    why: 'memory_import_claude accepts excludeFilePatterns (glob) for voice-fidelity / persona-restricted operators. Per-file granularity beyond the coarse allProjects:true/false.',
  },

  // #1921 — override @opentelemetry/core to dodge arborist Invalid Version
  {
    issue: '#1921',
    file: 'package.json',
    substring: '"@opentelemetry/core": ">=2.8.0"',
    why: 'overrides entry for @opentelemetry/core (originally an exact 1.25.1 pin, raised to a >=2.8.0 floor in #2547 for the OTel 2.x audit fix). Keeping a single resolvable @opentelemetry/core in overrides eliminates the npm 10.8.x arborist `Invalid Version: ` placeholder that fails every `npx claude-flow@alpha …` install (including all 5 hook fires). Do not delete the override — retune the range instead.',
  },

  // #1910 — MCP stdio mode protects stdout from stray console.log
  {
    issue: '#1910',
    file: 'v3/@claude-flow/cli/src/mcp-server.ts',
    substring: 'process.env.MCP_STDIO_MODE',
    why: 'stdio MCP server hijacks console.log/info/debug → stderr so lazy-loaded module diagnostics never corrupt the JSON-RPC stream. Without this, hooks_route lazy-loads transformers.js/ONNX whose init prints to stdout and closes the Codex transport mid-batch.',
  },
  {
    issue: '#1910',
    file: 'v3/@claude-flow/cli/src/mcp-server.ts',
    substring: 'uncaughtException',
    why: 'stdio MCP server installs uncaughtException + unhandledRejection handlers so a lazy-loaded native init failure goes to stderr instead of crashing the transport silently.',
  },

  // #1872 — SwarmCoordinator scaleAgents targets total, executeTask catches throws
  {
    issue: '#1872',
    file: 'v3/src/coordination/application/SwarmCoordinator.ts',
    substring: 'TARGET TOTAL',
    why: 'scaleAgents({type, count}) treats count as the target total, not a delta. Without this, repeated scaleAgents calls accumulate (1 → 4 → 6 instead of 1 → 4 → 2).',
  },
  {
    issue: '#1872',
    file: 'v3/src/coordination/application/SwarmCoordinator.ts',
    regex: /try\s*\{[\s\S]{0,200}agent\.executeTask\(task\)/,
    why: 'executeTask wraps agent.executeTask in try/catch so a thrown error becomes a structured TaskResult{status:"failed", error} instead of crashing the swarm.',
  },

  // ADR-120 Step 2 — midstream-aware federation loader prefers
  // midstreamer's real QUIC build when MIDSTREAMER_QUIC_NATIVE=1,
  // falls back to agentic-flow's loader otherwise. Without this
  // invariant, a refactor could silently re-introduce the bare
  // loadQuicTransport import that bypasses the midstream preference.
  {
    issue: 'ADR-120',
    file: 'v3/@claude-flow/plugin-agent-federation/src/transport/midstream-aware-loader.ts',
    substring: 'MIDSTREAMER_QUIC_NATIVE',
    why: 'midstream-aware loader probes MIDSTREAMER_QUIC_NATIVE first; without this env flag check, the federation transport silently stays on agentic-flow even after midstream@0.3.0 ships real QUIC.',
  },
  {
    issue: 'ADR-120',
    file: 'v3/@claude-flow/plugin-agent-federation/src/plugin.ts',
    substring: 'loadFederationTransport',
    why: 'plugin.ts dispatches through the midstream-aware loader. Reverting to the bare loadQuicTransport import bypasses the ADR-120 preference layer entirely.',
  },

  // Issue #1949 — agentic-flow is an OPTIONAL peer dependency, not a
  // hard runtime dep. Hardened npm registries that block the deep
  // koa-router → cookies@0.9.1 transitive chain (under agentic-flow ->
  // fastmcp -> mcp-proxy -> pipenet -> koa) can otherwise reject the
  // plugin install with a 403 even on a clean checkout.
  {
    issue: '#1949',
    file: 'v3/@claude-flow/plugin-agent-federation/package.json',
    regex: /"peerDependencies"[\s\S]*?"agentic-flow"/,
    why: 'agentic-flow must be a peer dependency (not a hard runtime dep) so hardened npm registries that block cookies@0.9.1 transitively can still install the federation plugin (issue #1949).',
  },
  {
    issue: '#1949',
    file: 'v3/@claude-flow/plugin-agent-federation/package.json',
    regex: /"peerDependenciesMeta"[\s\S]*?"agentic-flow"[\s\S]*?"optional"\s*:\s*true/,
    why: 'agentic-flow must be marked optional in peerDependenciesMeta so npm doesn\'t warn or fail when the peer is missing (#1949).',
  },
  {
    issue: '#1949',
    file: 'v3/@claude-flow/plugin-agent-federation/src/transport/midstream-aware-loader.ts',
    substring: "import type {",
    why: 'midstream-aware-loader.ts must use TYPE-ONLY imports from agentic-flow (which are erased at compile time). Reverting to a static value import would force users to install agentic-flow even when only midstreamer is needed (#1949).',
  },
  {
    issue: '#1949',
    file: 'v3/@claude-flow/plugin-agent-federation/src/transport/midstream-aware-loader.ts',
    substring: "loadAgenticFlowQuicTransport",
    why: 'midstream-aware-loader.ts must lazy-load agentic-flow via loadAgenticFlowQuicTransport so it can degrade gracefully when the peer dep is absent (#1949).',
  },

  // ADR-120 Step 3 — ruflo-federation-peer Rust crate composes the
  // QUIC transport (midstreamer-quic) with the AIMDS 3-gate pipeline.
  {
    issue: 'ADR-120',
    file: 'v3/crates/ruflo-federation-peer/Cargo.toml',
    substring: 'name = "ruflo-federation-peer"',
    why: 'Step 3 crate name pin. The crate composes midstreamer-quic + aimds-* into a single Rust process per federation peer.',
  },
  {
    issue: 'ADR-120',
    file: 'v3/crates/ruflo-federation-peer/Cargo.toml',
    substring: 'midstreamer-quic = { version = "0.3.0"',
    why: 'Step 3 crate pins midstreamer-quic@0.3.0 (ruvnet/midstream PR #82 added the QuicTransport embedding trait this crate needs for its TransportProvider blanket impl).',
  },
  {
    issue: 'ADR-120',
    file: 'v3/crates/ruflo-federation-peer/Cargo.toml',
    substring: 'aimds-core = { version = "0.2.0"',
    why: 'Step 3 crate pins aimds-core@0.2.0 (ruvnet/midstream PR #82 added the SafetyGate composing trait this crate adapts in native_gate).',
  },
  {
    issue: 'ADR-120',
    file: 'v3/crates/ruflo-federation-peer/src/lib.rs',
    substring: 'midstreamer_quic::{QuicConnection, QuicTransport}',
    why: 'Step 3 native_transport must import the upstream QuicTransport trait (not just QuicConnection) so MidstreamerTransport is generic over any embedder-supplied transport.',
  },
  {
    issue: 'ADR-120',
    file: 'v3/crates/ruflo-federation-peer/src/lib.rs',
    substring: 'aimds_core::{PromptInput, SafetyGate as AimdsSafetyGate, SafetyVerdict as AimdsVerdict}',
    why: 'Step 3 native_gate must adapt aimds_core::SafetyGate to the peer-local SafetyGate trait — without this import the adapter degrades to a typed placeholder.',
  },
  {
    issue: 'ADR-120',
    file: 'v3/crates/ruflo-federation-peer/src/lib.rs',
    substring: 'pub trait TransportProvider',
    why: 'Step 3 trait surface: TransportProvider abstracts the QUIC backend so the Peer dispatch loop is testable without the upstream Rust deps materialized.',
  },
  {
    issue: 'ADR-120',
    file: 'v3/crates/ruflo-federation-peer/src/lib.rs',
    substring: 'pub trait SafetyGate',
    why: 'Step 3 trait surface: SafetyGate abstracts the AIMDS 3-gate pipeline so the Peer dispatch loop is testable without the upstream aimds-* deps materialized.',
  },
];

const offenders = [];
for (const inv of INVARIANTS) {
  const p = join(REPO_ROOT, inv.file);
  if (!existsSync(p)) {
    offenders.push({ ...inv, error: 'file missing' });
    continue;
  }
  const src = readFileSync(p, 'utf8');
  const found = inv.substring
    ? src.includes(inv.substring)
    : inv.regex
    ? inv.regex.test(src)
    : false;
  if (!found) {
    offenders.push({ ...inv, error: 'invariant missing' });
  }
}

if (JSON_OUT) {
  process.stdout.write(JSON.stringify({ checked: INVARIANTS.length, offenders }, null, 2) + '\n');
  process.exit(offenders.length === 0 ? 0 : 1);
}

console.log(`fix-invariants audit — ${INVARIANTS.length} invariants across ${new Set(INVARIANTS.map(i => i.file)).size} file(s)`);
if (offenders.length === 0) {
  console.log(`  ✓ all invariants present`);
  process.exit(0);
}

console.error(`\n  ✗ ${offenders.length} missing invariant(s):`);
for (const o of offenders) {
  console.error(`\n    [${o.issue}] ${o.file}`);
  console.error(`      ${o.error}: ${o.substring ?? o.regex}`);
  console.error(`      why this matters: ${o.why}`);
}
console.error('\n  If the fix moved to a different file or got refactored, update the invariant in scripts/audit-fix-invariants.mjs to point at the new location — do NOT delete it without confirming the regression is impossible by another mechanism.');
process.exit(1);
