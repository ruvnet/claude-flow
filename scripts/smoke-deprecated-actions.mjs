#!/usr/bin/env node
/**
 * Deprecated-action regression guard for ruvnet/ruflo#2089 — ADR-127 Phase 3.
 *
 * Fails if any file in scope references:
 *   - actions/checkout@v3   (replaced by @v4 in Phase 3)
 *   - actions/setup-node@v3 (replaced by @v4 in Phase 3)
 *   - actions/create-release@*  (archived action — use `gh release create`)
 *   - actions/upload-release-asset@*  (archived action — use `gh release upload`)
 *   - softprops/action-gh-release@v1  (mutable floating ref — use SHA pin or @v2+)
 *
 * The archived actions (create-release, upload-release-asset) are the same
 * ones replaced in ruvnet/neural-trader's release workflow. Catching them
 * here prevents the pattern from re-entering the skill/agent templates.
 *
 * Scope:
 *   .claude/agents/github/[name].md
 *   .claude/skills/github-[name]/SKILL.md
 *   v3/@claude-flow/cli/.claude/commands/github/[name].md
 *
 * Zero runtime dependencies — pure readFileSync + regex.
 * Exit 0: no deprecated refs found.
 * Exit 1: one or more deprecated refs found (file + line reported).
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = process.cwd();

// #2089 — initial Phase 3 commit only scanned 3 of the 6 in-scope trees
// (dogfood agents + dogfood skills + init-template commands). It missed
// the init-template agents and the dogfood commands, both of which still
// shipped `actions/checkout@v3` after the Phase 3 merge. Post-publish
// validation against alpha.74 caught this and added the two missing trees.
const SCAN_TREES = [
  join(REPO_ROOT, '.claude', 'agents', 'github'),
  join(REPO_ROOT, '.claude', 'skills'),
  join(REPO_ROOT, '.claude', 'commands', 'github'),
  join(REPO_ROOT, 'v3', '@claude-flow', 'cli', '.claude', 'agents', 'github'),
  join(REPO_ROOT, 'v3', '@claude-flow', 'cli', '.claude', 'commands', 'github'),
];

// Deprecated refs: [pattern, description, replacement]
const DEPRECATED = [
  [/uses:\s+actions\/checkout@v3\b/, 'actions/checkout@v3 (mutable @v3)', 'actions/checkout@v4'],
  [/uses:\s+actions\/setup-node@v3\b/, 'actions/setup-node@v3 (mutable @v3)', 'actions/setup-node@v4'],
  [/uses:\s+actions\/create-release@/, 'actions/create-release (archived)', 'gh release create'],
  [/uses:\s+actions\/upload-release-asset@/, 'actions/upload-release-asset (archived)', 'gh release upload'],
  [/uses:\s+softprops\/action-gh-release@v1\b/, 'softprops/action-gh-release@v1 (mutable floating)', 'SHA-pin or @v2+'],
];

function collectFiles(dir, recursive = false) {
  if (!existsSync(dir)) return [];
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(full);
    } else if (entry.isDirectory() && recursive) {
      files.push(...collectFiles(full, false));
    }
  }
  return files;
}

const filesToScan = [
  ...collectFiles(SCAN_TREES[0]),
  ...collectFiles(SCAN_TREES[1], true),
  ...collectFiles(SCAN_TREES[2]),
];

const violations = [];

for (const filePath of filesToScan) {
  const lines = readFileSync(filePath, 'utf-8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    for (const [pattern, description, replacement] of DEPRECATED) {
      if (pattern.test(lines[i])) {
        violations.push({ file: filePath, line: i + 1, description, replacement, text: lines[i].trim() });
      }
    }
  }
}

if (violations.length === 0) {
  console.log('ok: no deprecated action refs found in scope');
  process.exit(0);
}

console.error(`\n${violations.length} deprecated action reference(s) found:\n`);
for (const v of violations) {
  const rel = v.file.replace(REPO_ROOT + '/', '');
  console.error(`  ${rel}:${v.line}  ${v.text}`);
  console.error(`    deprecated: ${v.description}`);
  console.error(`    use instead: ${v.replacement}`);
}
console.error('\nFix: replace the deprecated ref with the recommended alternative.\n');
process.exit(1);
