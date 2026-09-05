/**
 * Smoke test: no hardcoded attribution footers in github command files.
 *
 * ADR-127 Phase 4 moves "Generated with Claude Code" strings out of the
 * static markdown templates and into the opt-in attribution path in
 * helpers-generator.ts (gated on options.attribution). Hardcoded footers
 * silently added a third-party Co-Authored-By line to every user's commits
 * (#1670) and were removed unconditionally.
 *
 * This smoke prevents the pattern from drifting back via copy-paste or
 * AI-generated snippet insertion.
 *
 * Scope (same three trees as the pins smoke):
 *   .claude/agents/github/*.md
 *   .claude/skills/github-[name]/SKILL.md
 *   v3/@claude-flow/cli/.claude/commands/github/[name].md
 *
 * Exit 0 when clean, exit 1 with offending lines printed.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, resolve } from 'path';

const ROOT = resolve(new URL('.', import.meta.url).pathname, '..');

/** Collect markdown files from a directory (non-recursive or one level deep) */
function collectMarkdown(dir, recursive) {
  const files = [];
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isFile() && entry.endsWith('.md')) {
      files.push(full);
    } else if (st.isDirectory() && recursive) {
      // One extra level only (github-[name]/SKILL.md pattern)
      for (const sub of readdirSync(full)) {
        const subFull = join(full, sub);
        if (statSync(subFull).isFile() && sub.endsWith('.md')) {
          files.push(subFull);
        }
      }
    }
  }
  return files;
}

const SCAN_TARGETS = [
  collectMarkdown(join(ROOT, '.claude/agents/github'), false),
  collectMarkdown(join(ROOT, '.claude/skills'), true).filter(f => f.includes('/github-')),
  collectMarkdown(join(ROOT, 'v3/@claude-flow/cli/.claude/commands/github'), false),
];

const allFiles = SCAN_TARGETS.flat();

// Pattern to detect: the emoji + "Generated with" prefix
// Matches both "Generated with Claude Code" and "Generated with [RuFlo](…)"
const HARDCODED_PATTERN = /🤖\s+Generated with/;

const violations = [];

for (const file of allFiles) {
  const content = readFileSync(file, 'utf8');
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (HARDCODED_PATTERN.test(lines[i])) {
      violations.push(`${file.replace(ROOT + '/', '')}:${i + 1}: ${lines[i].trim()}`);
    }
  }
}

if (violations.length > 0) {
  console.error('FAIL: hardcoded attribution footers found in github command scope:');
  for (const v of violations) {
    console.error(`  ${v}`);
  }
  console.error('');
  console.error('These must be removed from the static templates (ADR-127 Phase 4).');
  console.error('Attribution is opt-in via --attribution / options.attribution=true');
  console.error('and injected programmatically by helpers-generator.ts, not hard-wired.');
  process.exit(1);
}

console.log('ok: no hardcoded attribution footers found in github command scope');
