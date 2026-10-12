#!/usr/bin/env node
// check-guard-tool-names — every MCP tool name a plugin mod guard watches by string must
// exist in the real tool registry, or the guard silently stops guarding after a rename.
//
//   node scripts/check-guard-tool-names.mjs [--verbose] [--format json]
//
// Watched names: quoted tool-shaped strings in plugins/*/hooks/*.ts whose first segment is a
// known tool family (a family seen in the registry or the allowlist), so event names such as
// `in_progress` or `text_delta` are not mistaken for tools.
// Registry: `name: '...'` in v3/@claude-flow/cli/src/mcp-tools/*.ts, plus the tools a plugin's
// own server declares (plugins with a .mcp.json: `.tool('x'` / `registerTool('x'` in src/).
// Allowlist: scripts/guard-tool-names.allow.json, name -> reason (tools other servers serve).
//
// Exit: 0 clean · 1 unmatched watched names · 3 nothing extracted / empty registry (fail loud).

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SHAPE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*_[a-z0-9]+(?:[_-][a-z0-9]+)*$/;
const QUOTED = /(['"`])([a-z][a-z0-9_-]*)\1/g;
const family = (name) => name.split('_')[0];

/** Quoted strings in `source` that have the tool-name shape. */
export function extractCandidates(source) {
  const found = new Set();
  for (const m of source.matchAll(QUOTED)) if (SHAPE.test(m[2])) found.add(m[2]);
  return found;
}

/** Tool names a core tool module declares: `name: '...'` with the tool shape. */
export function extractRegistryNames(source) {
  const found = new Set();
  for (const m of source.matchAll(/\bname:\s*(['"`])([a-z][a-z0-9_-]*)\1/g)) if (SHAPE.test(m[2])) found.add(m[2]);
  return found;
}

/** Tool names a plugin's own MCP server registers. Their server-local names have no family prefix rule. */
export function extractServerNames(source) {
  const found = new Set();
  for (const m of source.matchAll(/(?:\.tool|registerTool)\(\s*(['"`])([a-z][a-z0-9_-]*)\1/g)) found.add(m[2]);
  return found;
}

/**
 * Split the candidates into those to check and those ignored (family unknown), then report
 * the unmatched. `registry` and `allow` are Set / plain object.
 */
export function check(watched, registry, allow) {
  const families = new Set([...registry, ...Object.keys(allow)].map(family));
  const checked = [];
  const ignored = [];
  for (const name of [...watched].sort()) (families.has(family(name)) ? checked : ignored).push(name);
  const unmatched = checked.filter((n) => !registry.has(n) && !(n in allow));
  return { checked, ignored, unmatched, allowed: checked.filter((n) => !registry.has(n) && n in allow) };
}

const tsFiles = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.ts') && !/\.(test|spec)\.ts$/.test(f)).map((f) => join(dir, f)) : []);

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(mjs|cjs|js|ts)$/.test(e.name)) out.push(p);
  }
  return out;
}

/** Gather watched names (name -> plugins) and the registry from the repo on disk. */
export function gather(root = ROOT) {
  const watched = new Map();
  const registry = new Set();
  const plugins = join(root, 'plugins');
  for (const p of readdirSync(plugins)) {
    for (const f of tsFiles(join(plugins, p, 'hooks'))) {
      for (const n of extractCandidates(readFileSync(f, 'utf8'))) watched.set(n, [...(watched.get(n) ?? []), p]);
    }
    if (existsSync(join(plugins, p, '.mcp.json'))) {
      for (const f of walk(join(plugins, p, 'src'))) for (const n of extractServerNames(readFileSync(f, 'utf8'))) registry.add(n);
    }
  }
  // mcp-tools/ holds most tools; ruvector/coverage-tools.ts is the one tool module outside it.
  const cli = join(root, 'v3/@claude-flow/cli/src');
  const toolFiles = [...tsFiles(join(cli, 'mcp-tools')), join(cli, 'ruvector/coverage-tools.ts')].filter(existsSync);
  for (const f of toolFiles) for (const n of extractRegistryNames(readFileSync(f, 'utf8'))) registry.add(n);
  const allowPath = join(root, 'scripts/guard-tool-names.allow.json');
  const allow = existsSync(allowPath) ? JSON.parse(readFileSync(allowPath, 'utf8')) : {};
  return { watched, registry, allow };
}

function main() {
  const verbose = process.argv.includes('--verbose');
  const json = process.argv.includes('--format') && process.argv[process.argv.indexOf('--format') + 1] === 'json';
  const { watched, registry, allow } = gather();
  if (watched.size === 0 || registry.size === 0) {
    console.error(`check-guard-tool-names: extracted ${watched.size} watched names and ${registry.size} registry names; one is zero, so the check is broken (repo layout drift?). Failing.`);
    process.exit(3);
  }
  const r = check(new Set(watched.keys()), registry, allow);
  if (r.checked.length === 0) {
    console.error('check-guard-tool-names: no watched name belongs to a known tool family; the check is broken. Failing.');
    process.exit(3);
  }
  const stale = Object.keys(allow).filter((n) => registry.has(n));
  if (json) console.log(JSON.stringify({ watched: watched.size, checked: r.checked.length, registry: registry.size, allowed: r.allowed, unmatched: r.unmatched, staleAllow: stale }));
  else {
    console.log(`check-guard-tool-names: ${r.checked.length} watched tool names checked (${r.ignored.length} non-tool strings ignored) against ${registry.size} registry names; ${r.allowed.length} allowlisted.`);
    if (verbose) console.log(`allowlisted: ${r.allowed.join(', ')}\nignored: ${r.ignored.join(', ')}`);
    for (const n of stale) console.log(`note: allowlist entry "${n}" is now in the registry; remove it.`);
    for (const n of r.unmatched) console.error(`UNMATCHED ${n} (watched by ${[...new Set(watched.get(n))].join(', ')}): no such tool in the registry. Renamed or removed? Fix the guard or add it to scripts/guard-tool-names.allow.json with a reason.`);
  }
  process.exit(r.unmatched.length ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
