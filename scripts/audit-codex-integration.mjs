#!/usr/bin/env node
/**
 * Codex ↔ Ruflo integration audit (issue #1909).
 *
 * Static invariants that must hold for the OpenAI Codex integration to work.
 * Build + unit tests are covered by the main CI; this guards the
 * integration-specific contracts that a regular test run won't catch.
 *
 * Usage: node scripts/audit-codex-integration.mjs
 * Exits non-zero on any failure.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const rel = (p) => relative(ROOT, p);

let failures = 0;
const C = { g: '\x1b[32m', r: '\x1b[31m', dim: '\x1b[2m', x: '\x1b[0m' };
const ok = (m) => console.log(`  ${C.g}✓${C.x} ${m}`);
const fail = (m) => { console.log(`  ${C.r}✗${C.x} ${m}`); failures++; };
const check = (cond, passMsg, failMsg) => (cond ? ok(passMsg) : fail(failMsg ?? passMsg));
const section = (t) => console.log(`\n${t}`);

console.log('Codex ↔ Ruflo integration audit (#1909)\n' + '─'.repeat(48));

// ── 1. Codex MCP backend uses the real `mcp-server` subcommand ──────────────
section('MCP backend registration (`codex` group):');
for (const p of ['ruflo/src/mcp-bridge/index.js', 'ruflo/src/ruvocal/mcp-bridge/index.js']) {
  if (!existsSync(resolve(ROOT, p))) { fail(`${p}: file missing`); continue; }
  const src = read(p);
  const codexLine = (src.match(/.*@openai\/codex.*/g) ?? [])[0]?.trim() ?? '(no @openai/codex entry)';
  check(/@openai\/codex"\s*,\s*"mcp-server"/.test(src),
    `${p}: codex backend uses "mcp-server"`,
    `${p}: codex backend must use "mcp-server" — found: ${codexLine}`);
  check(!/@openai\/codex"\s*,\s*"mcp"\s*,\s*"serve"/.test(src),
    `${p}: no invalid "mcp serve" subcommand`,
    `${p}: still uses "mcp serve" (not a valid \`codex\` subcommand) — ${codexLine}`);
}

// ── 2. @claude-flow/codex VERSION const tracks package.json ─────────────────
section('@claude-flow/codex version sync:');
const cfPkg = JSON.parse(read('v3/@claude-flow/codex/package.json'));
const versionMatch = read('v3/@claude-flow/codex/src/index.ts').match(/export const VERSION\s*=\s*'([^']+)'/);
check(versionMatch && versionMatch[1] === cfPkg.version,
  `VERSION const === package.json version ("${cfPkg.version}")`,
  `VERSION const (${versionMatch ? `"${versionMatch[1]}"` : 'not found'}) != package.json ("${cfPkg.version}")`);

// ── 3. Dual-mode orchestrator drives a real `codex exec` for codex workers ──
section('Dual-mode orchestrator:');
const orch = read('v3/@claude-flow/codex/src/dual-mode/orchestrator.ts');
check(/codexCommand:\s*config\.codexCommand\s*\?\?\s*'codex'/.test(orch),
  `codexCommand defaults to 'codex'`,
  `codexCommand must default to 'codex' (it was 'claude' — "Both use claude CLI")`);
check(!/codexCommand:\s*config\.codexCommand\s*\?\?\s*'claude'/.test(orch),
  `codexCommand no longer falls back to 'claude'`);
check(/\['exec',\s*'--sandbox'/.test(orch),
  `codex workers spawn \`codex exec --sandbox …\``,
  `codex worker branch must build \`['exec', '--sandbox', …]\` args`);

// ── 4. Dual-mode agent defs invoke `codex exec`, not `claude -p` ────────────
section('Dual-mode agent definitions:');
for (const p of ['.claude/agents/dual-mode/codex-worker.md', '.claude/agents/dual-mode/codex-coordinator.md']) {
  if (!existsSync(resolve(ROOT, p))) { fail(`${p}: file missing`); continue; }
  const src = read(p);
  check(/codex exec /.test(src), `${p}: references \`codex exec\``);
  // The legacy worker examples all used `claude -p "<task>" --session-id <id>`.
  // (A generic `claude -p "<prompt>"` mention in the mixed-platform note is fine.)
  check(!/--session-id/.test(src) && !/(via|using) `claude -p`/.test(src),
    `${p}: no legacy \`claude -p … --session-id\` worker spawns`,
    `${p}: still uses the legacy \`claude -p\` worker pattern (should be \`codex exec\`)`);
}

// ── 5. No stale claude-flow CLI refs left in the codex package source ───────
section('CLI references standardized to ruflo:');
const walk = (dir) => readdirSync(dir).flatMap((e) => {
  const f = resolve(dir, e);
  return statSync(f).isDirectory() ? walk(f) : [f];
});
const stale = walk(resolve(ROOT, 'v3/@claude-flow/codex/src'))
  .filter((f) => f.endsWith('.ts'))
  .filter((f) => /claude-flow@alpha|@claude-flow\/cli@latest/.test(readFileSync(f, 'utf8')))
  .map(rel);
check(stale.length === 0,
  `no \`claude-flow@alpha\` / \`@claude-flow/cli@latest\` in codex src`,
  `stale CLI refs remain in: ${stale.join(', ')}`);

// ── 6. `dual run` CLI surface (W2) ─────────────────────────────────────────
section('`dual run` CLI surface:');
const dualCli = read('v3/@claude-flow/codex/src/dual-mode/cli.ts');
check(/'-w, --worker <spec>'/.test(dualCli), `\`dual run\` exposes \`--worker <spec>\``);
check(/\.argument\('\[template\]'/.test(dualCli), `\`dual run\` accepts positional \`[template]\``);
check(/export function parseWorkerSpecs/.test(dualCli), `\`parseWorkerSpecs\` exported (so it's unit-testable)`);

// ── 7. Generated SKILL.md frontmatter (W5) ─────────────────────────────────
section('SKILL.md generator frontmatter:');
const skillGen = read('v3/@claude-flow/codex/src/generators/skill-md.ts');
check(/version: "\$\{version\}"/.test(skillGen) && /author: \$\{author\}/.test(skillGen) && /tags: \[\$\{tagList/.test(skillGen),
  `generateSkillMd emits version/author/tags frontmatter`,
  `generateSkillMd must emit version/author/tags so generated skills validate clean`);

// ── 8. config.toml generator emits a working `ruflo` MCP server ────────────
section('config.toml generator MCP default:');
const cfgGen = read('v3/@claude-flow/codex/src/generators/config-toml.ts');
const mcpConfig = read('v3/@claude-flow/codex/src/mcp-config.ts');
check(/getRufloMcpServerConfig/.test(cfgGen)
    && /RUFLO_MCP_SERVER_NAME\s*=\s*'ruflo'/.test(mcpConfig)
    && /RUFLO_MCP_PACKAGE\s*=\s*'ruflo@latest'/.test(mcpConfig)
    && /args:\s*\['\/c',\s*'npx',\s*\.\.\.args\]/.test(mcpConfig)
    && /RUFLO_MCP_STARTUP_TIMEOUT_SEC\s*=\s*120/.test(mcpConfig),
  `default MCP server is Windows-safe \`ruflo@latest mcp start\` with 120s startup timeout`,
  `default MCP server must use the shared platform-aware Ruflo definition (cmd /c npx on Windows)`);

console.log('\n' + '─'.repeat(48));
if (failures > 0) {
  console.error(`${C.r}${failures} check(s) failed${C.x}`);
  process.exit(1);
}
console.log(`${C.g}All codex-integration checks passed${C.x}`);
