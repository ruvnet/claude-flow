#!/usr/bin/env node
/**
 * Generate catalog-manifest.json — ANV (Agent-Native Versioning) Phase 1.
 * https://gist.github.com/ruvnet/0d858ad440a4439b4a2281a40c39b1a0
 *
 * Counts are computed from real, shipped files (git-tracked, not fabricated):
 *   - agents: git-tracked markdown files under .claude/agents and plugins agents dirs
 *   - tools:  distinct `name: '...'` tool definitions across the mcp-tools sources
 *   - skills: directories under .claude/skills
 *
 * `generation` is a manually-bumped counter (increment when this run's counts
 * differ from the committed manifest's) — NOT auto-incremented on every run,
 * so a no-op regen doesn't silently claim a new catalog generation.
 *
 * `benchmark` stays null until a real, Ed25519-signed GAIA/HAL submission
 * exists for this exact catalog generation — no fabricated tier numbers
 * (ANV's own "verifiable, no unverifiable claims" principle).
 *
 * Run at publish time: node scripts/generate-catalog-manifest.mjs
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, '..');
const REPO_ROOT = join(PKG_ROOT, '..', '..', '..');
const MANIFEST_PATH = join(PKG_ROOT, 'catalog-manifest.json');

function gitTrackedCount(patterns) {
  try {
    const out = execFileSync('git', ['ls-files', ...patterns], { cwd: REPO_ROOT, encoding: 'utf-8' });
    return out.split('\n').filter(Boolean).length;
  } catch {
    return 0;
  }
}

function countTools() {
  const dir = join(PKG_ROOT, 'src', 'mcp-tools');
  if (!existsSync(dir)) return 0;
  const names = new Set();
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
    const text = readFileSync(join(dir, f), 'utf-8');
    for (const m of text.matchAll(/name:\s*'([a-z_][a-z0-9_-]*)'/g)) names.add(m[1]);
  }
  return names.size;
}

function countSkills() {
  const dir = join(PKG_ROOT, '.claude', 'skills');
  if (!existsSync(dir)) return 0;
  return readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).length;
}

function gitShortSha() {
  try {
    return execFileSync('git', ['rev-parse', '--short=8', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf-8' }).trim();
  } catch {
    return 'unknown';
  }
}

const counts = {
  agents: gitTrackedCount(['.claude/agents/*.md', 'plugins/*/agents/*.md']),
  tools: countTools(),
  skills: countSkills(),
};

let generation = 1;
let previous = null;
if (existsSync(MANIFEST_PATH)) {
  try { previous = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8')); } catch { /* corrupt/missing — start fresh */ }
}
if (previous?.catalog) {
  const changed = previous.catalog.agents !== counts.agents
    || previous.catalog.tools !== counts.tools
    || previous.catalog.skills !== counts.skills;
  generation = changed ? (previous.generation ?? 0) + 1 : (previous.generation ?? 1);
}

const manifest = {
  schemaVersion: 1,
  generation,
  generatedAt: new Date().toISOString(),
  gitSha: gitShortSha(),
  catalog: counts,
  // No fabricated benchmark tier — filled in only by a real, signed GAIA/HAL
  // submission for this exact catalog generation.
  benchmark: previous?.benchmark?.generation === generation ? previous.benchmark : null,
};

writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
console.log(`[catalog-manifest] generation ${generation} — agents:${counts.agents} tools:${counts.tools} skills:${counts.skills} sha:${manifest.gitSha}`);
console.log(`  -> ${MANIFEST_PATH}`);
