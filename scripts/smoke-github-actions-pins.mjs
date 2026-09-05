#!/usr/bin/env node
/**
 * Static scan guard for ruvnet/ruflo#2089 — ADR-127 Phase 1.
 *
 * Scans every `uses:` line in:
 *   - .claude/agents/github/*.md
 *   - .claude/skills/github-[name]/SKILL.md
 *   - v3/@claude-flow/cli/.claude/commands/github/[name].md
 *
 * For each ref, asserts it is either:
 *   (a) SHA-pinned  — `owner/repo@<40-hex-chars>`
 *   (b) Listed in .github/supply-chain/allowed-deps.json `actions.allowed[]`
 *
 * The `minimumVersion` sub-field is advisory (logged, not enforced by this
 * smoke).  Enforcement of the minimum version is the job of Phase 3's
 * smoke-deprecated-actions.mjs which fails on @v3 refs directly.
 *
 * Zero runtime dependencies — pure readFileSync + regex.
 *
 * Exit 0: all refs are pinned or on the allow-list.
 * Exit 1: one or more violations found (file + line reported for each).
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';

const REPO_ROOT = process.cwd();

// Paths to scan (globs resolved manually to avoid deps).
const SCAN_TREES = [
  join(REPO_ROOT, '.claude', 'agents', 'github'),
  join(REPO_ROOT, '.claude', 'skills'),
  join(REPO_ROOT, 'v3', '@claude-flow', 'cli', '.claude', 'commands', 'github'),
];

const ALLOWED_DEPS_PATH = join(REPO_ROOT, '.github', 'supply-chain', 'allowed-deps.json');

// Load the allow-list.
let allowedActions = [];
if (existsSync(ALLOWED_DEPS_PATH)) {
  try {
    const raw = JSON.parse(readFileSync(ALLOWED_DEPS_PATH, 'utf-8'));
    allowedActions = (raw.actions && raw.actions.allowed) || [];
  } catch (e) {
    console.error(`[warn] Could not parse ${ALLOWED_DEPS_PATH}: ${e.message}`);
  }
}

// SHA-pin pattern: exactly 40 hex characters after @.
const SHA_PIN_RE = /^[a-f0-9]{40}$/i;
// uses: line pattern (inside markdown code blocks or YAML snippets).
const USES_LINE_RE = /^\s*-?\s*uses:\s+(.+)$/;

/**
 * Collect all .md files under a directory (non-recursive for agents/commands,
 * recursive one level for skills to find SKILL.md files).
 */
function collectFiles(dir, recursive = false) {
  if (!existsSync(dir)) return [];
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(full);
    } else if (entry.isDirectory() && recursive) {
      files.push(...collectFiles(full, false)); // one extra level only
    }
  }
  return files;
}

const filesToScan = [
  ...collectFiles(SCAN_TREES[0]),          // .claude/agents/github/*.md
  ...collectFiles(SCAN_TREES[1], true),    // .claude/skills/github-*/SKILL.md
  ...collectFiles(SCAN_TREES[2]),          // v3/.../commands/github/*.md
];

const violations = [];

for (const filePath of filesToScan) {
  const lines = readFileSync(filePath, 'utf-8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(USES_LINE_RE);
    if (!m) continue;

    const ref = m[1].trim();
    // ref looks like: owner/repo@version
    const atIdx = ref.indexOf('@');
    if (atIdx === -1) {
      violations.push({ file: filePath, line: i + 1, ref, reason: 'missing @ in uses: ref' });
      continue;
    }

    const action = ref.slice(0, atIdx);
    const version = ref.slice(atIdx + 1);

    // Check (a): SHA-pinned.
    if (SHA_PIN_RE.test(version)) continue;

    // Check (b): on the allow-list.
    if (allowedActions.includes(action)) continue;

    violations.push({ file: filePath, line: i + 1, ref, reason: 'not SHA-pinned and not in allowed-deps.json actions.allowed' });
  }
}

if (violations.length === 0) {
  console.log('ok: all uses: refs are SHA-pinned or on the allow-list');
  process.exit(0);
}

console.error(`\n${violations.length} uses: pin violation(s) found:\n`);
for (const v of violations) {
  // Shorten path relative to repo root for readability.
  const rel = v.file.replace(REPO_ROOT + '/', '');
  console.error(`  ${rel}:${v.line}  ${v.ref}`);
  console.error(`    reason: ${v.reason}`);
}
console.error(`\nFix: either SHA-pin the ref (uses: owner/repo@<40-hex>) or add the action`);
console.error(`name to .github/supply-chain/allowed-deps.json "actions.allowed".\n`);
process.exit(1);
