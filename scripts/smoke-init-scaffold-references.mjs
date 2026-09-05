#!/usr/bin/env node
/**
 * Init-scaffold content-drift guard — ADR-382 Part C (#2971).
 *
 * Four static assertions over the shipped @claude-flow/cli init scaffold and
 * the marketplace/plugin surface it depends on:
 *
 *   1. DEAD CLI INVOCATION — `npx claude-flow` (bare, unscoped, unpinned) in
 *      v3/@claude-flow/cli/.claude/**. The canonical form is derived from
 *      that package's own package.json `name`, not hand-maintained, so this
 *      check tracks a future rename automatically. `npx claude-flow@alpha` /
 *      `@v3alpha` are intentionally NOT flagged — those are the maintained
 *      legacy dist-tags (see root CLAUDE.md Publishing section), not dead.
 *
 *   2. DEAD MCP TOOL REFERENCES — `mcp__claude-flow__<name>` (or the
 *      `mcp__claude_flow__` underscore typo) where <name> is not present in
 *      the live tool registry. The live set is derived by statically
 *      parsing mcp-client.ts's own import list and extracting every
 *      `name: '...'` tool declaration from each imported module — the same
 *      registry the running MCP server assembles at startup (mcp-client.ts
 *      TOOL_REGISTRY), just read without executing TypeScript. Wildcard doc
 *      references like `mcp__claude-flow__swarm_*` are not flagged.
 *
 *   3. PLUGIN MCP-LAUNCH PINNING REGRESSION — any plugins/*\/.mcp.json whose
 *      server launches a bare `npx ... <pkg>@latest` with no local-bin-first
 *      resolver in front of it (ADR-382 Part A fixes this for ruflo-core by
 *      mirroring resolveCliBinForHook() in .claude/helpers/hook-handler.cjs;
 *      this check guards the fix from regressing and catches any other
 *      plugin with the same unpinned pattern).
 *
 *   4. MARKETPLACE COMPLETENESS — every directory under plugins/ has a
 *      matching entry in .claude-plugin/marketplace.json. Guards the
 *      regression that let ruflo-agntcy / ruflo-bbs-federation /
 *      ruflo-business-pods silently go unlisted (ADR-382 Gap 4).
 *
 * Ships in WARN-ONLY mode: violations are always printed, but the process
 * exits 0 unless `--strict` is passed, in which case it exits 1 on any
 * violation. Run `--strict` once the deterministic remap (ADR-382 Part C
 * step 2) has driven checks 1-2's backlog to zero; checks 3-4 can go
 * `--strict` as soon as Part A lands.
 *
 * Zero runtime dependencies beyond Node built-ins — pure readFileSync /
 * readdirSync / regex, following the smoke-deprecated-actions.mjs /
 * smoke-init-bundle-invariants.mjs pattern.
 *
 * Usage:
 *   node scripts/smoke-init-scaffold-references.mjs           # warn-only, always exit 0
 *   node scripts/smoke-init-scaffold-references.mjs --strict  # exit 1 on any violation
 *   node scripts/smoke-init-scaffold-references.mjs --help    # this text
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = process.cwd();
const STRICT = process.argv.includes('--strict');
const HELP = process.argv.includes('--help') || process.argv.includes('-h');

const USAGE = `smoke-init-scaffold-references.mjs — ADR-382 Part C dead-reference guard

Checks the @claude-flow/cli init scaffold (v3/@claude-flow/cli/.claude/**)
and the plugin/marketplace surface for stale CLI invocations, dead MCP tool
references, unpinned plugin MCP launches, and marketplace registry gaps.

Modes:
  (default)  warn-only — prints every violation, always exits 0
  --strict   blocking  — prints every violation, exits 1 if any are found

This ships warn-only in the PR that introduces it (ADR-382 Part C), because
the dead-reference backlog (checks 1-2) is nonzero until the deterministic
remap lands. Flip CI to --strict once that backlog clears; checks 3-4 can go
--strict independently once ADR-382 Part A merges.

Flags:
  --strict   exit 1 on any violation (see above)
  --help,-h  print this message and exit 0
`;

if (HELP) {
  console.log(USAGE);
  process.exit(0);
}

const CLI_ROOT = join(REPO_ROOT, 'v3', '@claude-flow', 'cli');
const CLI_SRC = join(CLI_ROOT, 'src');
const MCP_CLIENT_TS = join(CLI_SRC, 'mcp-client.ts');
const SCAFFOLD_DIR = join(CLI_ROOT, '.claude');
const PLUGINS_DIR = join(REPO_ROOT, 'plugins');
const MARKETPLACE_JSON = join(REPO_ROOT, '.claude-plugin', 'marketplace.json');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function walkFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(full));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

function rel(p) {
  return p.startsWith(REPO_ROOT + '/') ? p.slice(REPO_ROOT.length + 1) : p;
}

function readText(p) {
  try {
    return readFileSync(p, 'utf-8');
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Live-registry derivation (checks 1-2)
// ---------------------------------------------------------------------------

// Statically parses mcp-client.ts's own `from './mcp-tools/foo.js'` imports
// and extracts every `name: '...'` MCPTool declaration from each resolved
// .ts source — the exact set TOOL_REGISTRY assembles at runtime, derived
// without executing TypeScript.
function deriveLiveToolNames() {
  const names = new Set();
  const src = readText(MCP_CLIENT_TS);
  if (!src) return names;

  const modules = new Set();
  for (const m of src.matchAll(/from\s+'(\.\/[^']+)\.js'/g)) {
    modules.add(m[1].replace(/^\.\//, ''));
  }

  for (const mod of modules) {
    const modSrc = readText(join(CLI_SRC, `${mod}.ts`));
    if (!modSrc) continue;
    for (const m of modSrc.matchAll(/^\s*name:\s*'([a-zA-Z0-9_-]+)'/gm)) {
      names.add(m[1]);
    }
  }
  return names;
}

// Derives the canonical `npx <pkg>@latest` form from the CLI package's own
// package.json `name` field rather than hand-maintaining the string, so a
// future rename doesn't silently desync the guard from reality.
function deriveCanonicalCliInvocation() {
  const pkgSrc = readText(join(CLI_ROOT, 'package.json'));
  if (!pkgSrc) return 'npx @claude-flow/cli@latest';
  try {
    const pkg = JSON.parse(pkgSrc);
    return `npx ${pkg.name}@latest`;
  } catch {
    return 'npx @claude-flow/cli@latest';
  }
}

const LIVE_TOOL_NAMES = deriveLiveToolNames();
const CANONICAL_CLI_INVOCATION = deriveCanonicalCliInvocation();

// ---------------------------------------------------------------------------
// Check 1 — dead `npx claude-flow` (bare) invocation
// ---------------------------------------------------------------------------

// Negative lookahead excludes `@version` (maintained legacy dist-tags),
// word chars, `/` and `-` so we never match inside `@claude-flow/cli` or a
// hypothetical `claude-flow-codex` — only the bare, unscoped, unpinned form.
const DEAD_CLI_PATTERN = /npx claude-flow(?![\w@/-])/g;

function checkDeadCliInvocations(files) {
  const violations = [];
  for (const file of files) {
    const content = readText(file);
    if (!content) continue;
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (DEAD_CLI_PATTERN.test(lines[i])) {
        violations.push({
          file: rel(file),
          line: i + 1,
          text: lines[i].trim(),
          message: `'npx claude-flow' (bare) — supersede with '${CANONICAL_CLI_INVOCATION}'`,
        });
      }
      DEAD_CLI_PATTERN.lastIndex = 0;
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Check 2 — dead `mcp__claude-flow__<tool>` references
// ---------------------------------------------------------------------------

const TOOL_REF_PATTERN = /mcp__claude[-_]flow__([A-Za-z][A-Za-z0-9_-]*)/g;

function checkDeadToolReferences(files) {
  const violations = [];
  for (const file of files) {
    const content = readText(file);
    if (!content) continue;
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const m of line.matchAll(TOOL_REF_PATTERN)) {
        const name = m[1];
        const endIdx = m.index + m[0].length;
        if (line[endIdx] === '*') continue; // wildcard family doc, e.g. swarm_*
        if (LIVE_TOOL_NAMES.has(name)) continue;
        violations.push({
          file: rel(file),
          line: i + 1,
          text: line.trim(),
          message: `mcp__claude-flow__${name} — not in the live ${LIVE_TOOL_NAMES.size}-tool registry`,
        });
      }
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Check 3 — plugin MCP-launch pinning regression
// ---------------------------------------------------------------------------

// Matches an npx arg that is a bare `@latest`-tagged launch of one of the
// three public release-train packages (root CLAUDE.md), with no local-bin
// resolver indirection in front of it.
const UNPINNED_LATEST_ARG = /^(?:@claude-flow\/cli|claude-flow|ruflo)@latest$/;

function findPluginMcpJsonFiles() {
  if (!existsSync(PLUGINS_DIR)) return [];
  const out = [];
  for (const entry of readdirSync(PLUGINS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const p = join(PLUGINS_DIR, entry.name, '.mcp.json');
    if (existsSync(p)) out.push(p);
  }
  return out;
}

function checkPluginMcpPinning() {
  const violations = [];
  for (const file of findPluginMcpJsonFiles()) {
    const src = readText(file);
    if (!src) continue;
    let json;
    try {
      json = JSON.parse(src);
    } catch (e) {
      violations.push({ file: rel(file), message: `invalid JSON: ${e.message}` });
      continue;
    }
    const servers = json.mcpServers || {};
    for (const [serverName, cfg] of Object.entries(servers)) {
      const args = Array.isArray(cfg.args) ? cfg.args : [];
      const bareLatestArg = args.find((a) => typeof a === 'string' && UNPINNED_LATEST_ARG.test(a));
      if (cfg.command === 'npx' && bareLatestArg) {
        violations.push({
          file: rel(file),
          message: `server '${serverName}' launches bare 'npx -y ${bareLatestArg}' — no local-bin-first ` +
            `resolver in front of it (mirror resolveCliBinForHook() in .claude/helpers/hook-handler.cjs, ADR-382 Part A)`,
        });
      }
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Check 4 — marketplace completeness
// ---------------------------------------------------------------------------

function checkMarketplaceCompleteness() {
  const violations = [];
  if (!existsSync(PLUGINS_DIR) || !existsSync(MARKETPLACE_JSON)) return violations;

  const pluginDirs = readdirSync(PLUGINS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  const marketplaceSrc = readText(MARKETPLACE_JSON);
  let marketplace;
  try {
    marketplace = JSON.parse(marketplaceSrc);
  } catch (e) {
    violations.push({ file: rel(MARKETPLACE_JSON), message: `invalid JSON: ${e.message}` });
    return violations;
  }

  const registered = new Set(
    (marketplace.plugins || [])
      .map((p) => (typeof p.source === 'string' ? p.source.replace(/^\.\/plugins\//, '').replace(/\/$/, '') : null))
      .filter(Boolean)
  );

  for (const dir of pluginDirs) {
    if (!registered.has(dir)) {
      violations.push({
        file: `plugins/${dir}`,
        message: `directory has no entry in .claude-plugin/marketplace.json (plugin uninstallable via marketplace)`,
      });
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Run all checks
// ---------------------------------------------------------------------------

const scaffoldFiles = walkFiles(SCAFFOLD_DIR);

const results = [
  { id: 1, name: 'dead CLI invocation (npx claude-flow bare)', violations: checkDeadCliInvocations(scaffoldFiles) },
  { id: 2, name: 'dead MCP tool references (mcp__claude-flow__*)', violations: checkDeadToolReferences(scaffoldFiles) },
  { id: 3, name: 'plugin MCP-launch pinning regression', violations: checkPluginMcpPinning() },
  { id: 4, name: 'marketplace completeness', violations: checkMarketplaceCompleteness() },
];

const totalViolations = results.reduce((sum, r) => sum + r.violations.length, 0);

console.log(`init-scaffold-references: scanned ${scaffoldFiles.length} scaffold files, ` +
  `${LIVE_TOOL_NAMES.size} live MCP tools derived, canonical CLI form '${CANONICAL_CLI_INVOCATION}'`);
console.log(STRICT ? 'mode: --strict (blocking)' : 'mode: warn-only (pass --strict to block on violations)');
console.log();

for (const { id, name, violations } of results) {
  if (violations.length === 0) {
    console.log(`ok: check ${id} (${name}) — 0 violations`);
    continue;
  }
  console.log(`FAIL: check ${id} (${name}) — ${violations.length} violation(s)`);
  for (const v of violations) {
    if (v.line) {
      console.log(`  ${v.file}:${v.line}  ${v.text}`);
      console.log(`    ${v.message}`);
    } else {
      console.log(`  ${v.file}`);
      console.log(`    ${v.message}`);
    }
  }
}

console.log();
console.log(`total: ${totalViolations} violation(s) across 4 checks`);
console.log('ADR-382: https://github.com/ruvnet/ruflo/blob/main/v3/docs/adr/ADR-382-init-scaffold-content-drift-remediation.md');
console.log('Issue: https://github.com/ruvnet/ruflo/issues/2971');

if (totalViolations > 0 && !STRICT) {
  console.log('\nwarn-only mode: exiting 0 despite violations above. Pass --strict to make this blocking.');
}

process.exit(totalViolations > 0 && STRICT ? 1 : 0);
