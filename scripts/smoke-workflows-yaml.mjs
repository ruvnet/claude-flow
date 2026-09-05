#!/usr/bin/env node
/**
 * Smoke test for #2267: every .github/workflows/*.yml must parse as YAML.
 *
 * Root cause that motivated this guard: an unquoted `:` inside a step `name`
 * (`Guard 2 — smoke: generate ...`) made the YAML parser treat `smoke:` as a
 * second mapping key, rejecting the whole workflow. GitHub Actions accepted
 * the push and scheduled the run, but produced zero jobs and a "workflow
 * file issue" failure — invisible to the kind of green-build dashboard that
 * usually catches regressions. Five consecutive scheduled runs failed
 * silently before #2267 surfaced it.
 *
 * This guard runs as an early CI step so any future YAML break is caught
 * at PR-time, not at scheduled-cron-time when nobody is looking.
 *
 * Exit codes:
 *   0  — every workflow parsed
 *   1  — at least one workflow failed to parse
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
// js-yaml's package exports map removed the synthetic default in newer
// versions when loaded as ESM, so `import yaml from 'js-yaml'` throws
// `SyntaxError: does not provide an export named 'default'`. Use the
// namespace import — works in every js-yaml release since 4.x.
import * as yaml from 'js-yaml';

const WORKFLOWS_DIR = '.github/workflows';

let files;
try {
  files = readdirSync(WORKFLOWS_DIR).filter(f => f.endsWith('.yml') || f.endsWith('.yaml'));
} catch (e) {
  console.error(`No ${WORKFLOWS_DIR} directory (or unreadable): ${e.message}`);
  process.exit(1);
}

let failed = 0;
const results = [];
for (const file of files.sort()) {
  const full = join(WORKFLOWS_DIR, file);
  try {
    const parsed = yaml.load(readFileSync(full, 'utf8'));
    const jobCount = parsed && parsed.jobs ? Object.keys(parsed.jobs).length : 0;
    results.push({ file, ok: true, jobs: jobCount });
  } catch (e) {
    failed++;
    results.push({
      file,
      ok: false,
      error: e.message,
      line: e.mark ? e.mark.line + 1 : null,
      column: e.mark ? e.mark.column + 1 : null,
    });
  }
}

const okCount = results.filter(r => r.ok).length;
console.log(`Workflows: ${okCount}/${results.length} parsed`);
for (const r of results) {
  if (r.ok) {
    console.log(`  ok    ${r.file}  (${r.jobs} jobs)`);
  } else {
    console.log(`  FAIL  ${r.file}  ${r.line}:${r.column}  ${r.error}`);
  }
}
process.exit(failed > 0 ? 1 : 0);
