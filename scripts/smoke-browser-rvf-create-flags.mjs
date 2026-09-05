#!/usr/bin/env node
/**
 * Regression guard for ruvnet/ruflo#2015.
 *
 * `ruvector@0.2.25 rvf create` accepts only:
 *   -d, --dimension <n>    (required)
 *   -m, --metric <metric>  (optional, default cosine)
 *
 * It does NOT accept `--kind <value>` — commander's required-option
 * check fires before its unknown-option check, so the original bug
 * report only showed the dimension error. Stripping the bogus
 * `--kind browser-session` was round 2 of the fix; this guard now
 * polices BOTH invariants on every call site:
 *
 *   - `--dimension` / `-d` is present
 *   - `--kind` is absent
 *
 * Scans TS, compiled dist, shell scripts, and the markdown recipes
 * agents copy-paste into bashes.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(process.cwd());

// We police every `rvf create` call we control across the repo —
// the original anchor (`--kind browser-session`) is gone post-fix, so
// we have to identify call sites by path, not by content.
const PATHS_IN_SCOPE = [
  'v3/@claude-flow/cli/src/mcp-tools/browser-session-tools.ts',
  'v3/@claude-flow/cli/dist/src/mcp-tools/browser-session-tools.js',
  'plugins/ruflo-browser/scripts/replay-spike.sh',
  'plugins/ruflo-browser/agents/browser-agent.md',
  'plugins/ruflo-browser/skills/browser-record/SKILL.md',
  'plugins/ruflo-browser/docs/adrs/0001-browser-skills-architecture.md',
];
const failures = [];
const checked = [];

for (const rel of PATHS_IN_SCOPE) {
  const path = resolve(REPO_ROOT, rel);
  if (!existsSync(path)) {
    // Dist artifacts are derivable from source — missing dist is not a
    // regression in `rvf create` callsites; the matching `src/` file will
    // still be scanned. Source files MUST exist.
    if (rel.includes('/dist/')) {
      checked.push(`${rel}  (skipped — dist artifact not built; src form is scanned instead)`);
      continue;
    }
    failures.push(`${rel}  expected call-site file missing from checkout`);
    continue;
  }

  const content = readFileSync(path, 'utf8');
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Two invocation shapes we police:
    //   - TS/JS array form:   'rvf', 'create' (comma-separated tokens)
    //   - Shell / markdown:   rvf create (whitespace-separated, not
    //                          enclosed in a single quoted string)
    const isArrayCall = /['"]rvf['"]\s*,\s*['"]create['"]/.test(line);
    const isShellCall = /(^|[^'"`])\brvf\s+create\b(?!\s*(failed|succeeded))/.test(line);
    if (!isArrayCall && !isShellCall) continue;

    // Skip lines whose `rvf create` only appears inside a quoted
    // string literal (e.g. an error message like `'rvf create failed'`).
    // The /failed|succeeded/ negative-lookahead above usually catches it,
    // but belt-and-suspenders for other literal strings.
    if (/['"`][^'"`]*rvf\s+create[^'"`]*['"`]/.test(line) && !isArrayCall) {
      continue;
    }

    // Skip comments.
    const trimmed = line.trim();
    if (/^(#|\/\/|\*)/.test(trimmed)) continue;

    checked.push(`${rel}:${i + 1}`);

    // Required: --dimension or -d
    const hasDim = /--dimension\b|(^|[^a-zA-Z0-9_])-d\b/.test(line);
    if (!hasDim) {
      failures.push(`${rel}:${i + 1}  missing --dimension on rvf create`);
    }

    // Forbidden: --kind (ruvector@0.2.25 rejects it as unknown option)
    const hasKind = /--kind\b/.test(line);
    if (hasKind) {
      failures.push(`${rel}:${i + 1}  carries bogus --kind flag (unknown option in ruvector@0.2.25)`);
    }
  }
}

if (checked.length === 0) {
  console.error('smoke-browser-rvf-create-flags: no call sites matched — pattern broken?');
  process.exit(1);
}

console.log(`Checked ${checked.length} call site(s):`);
for (const c of checked) console.log(`  - ${c}`);

if (failures.length > 0) {
  console.error(`\n${failures.length} call site(s) missing --dimension:`);
  for (const f of failures) console.error(`  ${f}`);
  console.error(`\nFix: append "--dimension 384" (or your project's vector dim)`);
  console.error(`to the rvf create invocation. See ruvnet/ruflo#2015.`);
  process.exit(1);
}

console.log('\nsmoke-browser-rvf-create-flags: all call sites carry --dimension');
