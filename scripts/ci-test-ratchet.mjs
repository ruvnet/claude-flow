#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function normalizeTestPath(name, repoRoot) {
  const normalized = isAbsolute(name) ? relative(repoRoot, name) : name;
  return normalized.split(sep).join('/').replace(/^\.\//, '');
}

/**
 * The files vitest is told to skip (scripts/ci-test-excluded.txt): tests with their own runner. Throws when an entry no longer exists, so a
 * stale list fails the ratchet instead of quietly skipping nothing.
 */
export function readExcludes(path, repoRoot = REPO_ROOT) {
  if (!existsSync(path)) throw new Error(`excluded-tests list is missing: ${path}`);
  const entries = readFileSync(path, 'utf8').split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
  const stale = entries.filter((entry) => !existsSync(resolve(repoRoot, entry)));
  if (stale.length > 0) throw new Error(`excluded-tests list names files that do not exist: ${stale.join(', ')}`);
  return entries;
}

export function evaluateTestReport(report, baselineEntries, repoRoot = REPO_ROOT) {
  if (!report || !Array.isArray(report.testResults)) {
    return { ok: false, error: 'Vitest JSON report is missing testResults[]' };
  }
  if (report.testResults.length === 0 && report.success !== false) {
    return { ok: false, error: 'Vitest JSON report contains zero test files' };
  }

  const baseline = new Set(
    baselineEntries.map((entry) => entry.trim()).filter((entry) => entry && !entry.startsWith('#')),
  );
  const failed = new Set(
    report.testResults
      .filter((result) => result?.status === 'failed' && typeof result.name === 'string')
      .map((result) => normalizeTestPath(result.name, repoRoot)),
  );
  const unexpected = [...failed].filter((name) => !baseline.has(name)).sort();
  const fixed = [...baseline].filter((name) => !failed.has(name)).sort();

  if (report.success === false && failed.size === 0) {
    return {
      ok: false,
      error: 'Vitest failed without identifying a failing test file',
      failed: [],
      unexpected: [],
      fixed,
    };
  }

  return {
    ok: unexpected.length === 0,
    failed: [...failed].sort(),
    unexpected,
    fixed,
    baselineCount: baseline.size,
  };
}

/**
 * Render each unexpected failure with the assertion that caused it (#3208).
 *
 * The report is written with --outputFile, so nothing vitest prints reaches
 * the job log, and a rerun replaces the artifact — which leaves the filename
 * as the only surviving record of an attempt. The failure messages are
 * already in the report this process parsed, so putting them in the log
 * costs nothing and survives the rerun, because logs are per-attempt.
 *
 * Every field is optional by design: a file-level abort ("No test suite
 * found") has `message` and no assertions, and a report from another
 * reporter version may carry neither.
 */
export function formatUnexpectedFailures(report, unexpected, repoRoot = REPO_ROOT) {
  const lines = [];
  for (const name of unexpected) {
    lines.push(`  + ${name}`);
    const file = (report?.testResults ?? []).find(
      (result) => typeof result?.name === 'string' && normalizeTestPath(result.name, repoRoot) === name,
    );
    const firstLine = (text) => String(text).split('\n')[0].trim();
    if (file?.message) lines.push(`      ${firstLine(file.message)}`);
    for (const assertion of file?.assertionResults ?? []) {
      if (assertion?.status !== 'failed') continue;
      lines.push(`      ✗ ${assertion.fullName || assertion.title || '(unnamed test)'}`);
      const [message] = assertion.failureMessages ?? [];
      if (message) lines.push(`        ${firstLine(message)}`);
    }
  }
  return lines;
}

function parseArgs(argv) {
  const args = { report: '', baseline: resolve(REPO_ROOT, 'scripts/ci-test-baseline.txt'), run: true };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--report' && argv[i + 1]) {
      args.report = resolve(argv[++i]);
      args.run = false;
    } else if (argv[i] === '--baseline' && argv[i + 1]) {
      args.baseline = resolve(argv[++i]);
    } else {
      throw new Error(`Unknown or incomplete argument: ${argv[i]}`);
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const reportPath = args.report || resolve(REPO_ROOT, '.test-results/vitest.json');
  const vitestBin = resolve(REPO_ROOT, 'node_modules/vitest/vitest.mjs');

  if (args.run) {
    let excluded;
    try {
      excluded = readExcludes(resolve(REPO_ROOT, 'scripts/ci-test-excluded.txt'));
    } catch (error) {
      console.error(`CI test ratchet: ${error.message}`);
      process.exit(1);
    }
    mkdirSync(dirname(reportPath), { recursive: true });
    // A killed runner must not accidentally reuse a prior green-enough report.
    rmSync(reportPath, { force: true });
    const run = spawnSync(process.execPath, [
      vitestBin,
      'run',
      // The new guidance file uses Claude Code's native test kit, not
      // Vitest. Do not enlarge the historical known-failure baseline.
      '--exclude=plugins/ruflo-mods/tests/guidance.test.ts',
      // ADR-447 needs the CLI workspace compiler/source aliases. The
      // mod-guidance workflow requires this suite with that configuration.
      '--exclude=v3/@claude-flow/cli/__tests__/mods/mods-guidance-e2e.test.ts',
      ...excluded.map((file) => `--exclude=${file}`),
      '--reporter=json',
      `--outputFile=${reportPath}`,
    ], {
      cwd: REPO_ROOT,
      env: { ...process.env, CI: '1' },
      stdio: 'inherit',
    });
    if (run.error) throw run.error;
    if (run.signal || (run.status !== 0 && run.status !== 1)) {
      console.error(`CI test ratchet: Vitest terminated abnormally (${run.signal ?? run.status})`);
      process.exit(1);
    }
  }

  if (!existsSync(reportPath)) {
    console.error(`CI test ratchet: report was not produced: ${reportPath}`);
    process.exit(1);
  }
  if (!existsSync(args.baseline)) {
    console.error(`CI test ratchet: baseline is missing: ${args.baseline}`);
    process.exit(1);
  }

  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  const baselineEntries = readFileSync(args.baseline, 'utf8').split(/\r?\n/);
  const result = evaluateTestReport(report, baselineEntries);

  if (!result.ok) {
    console.error(`CI test ratchet: FAILED — ${result.unexpected?.length ?? 0} unexpected failing file(s)`);
    for (const line of formatUnexpectedFailures(report, result.unexpected ?? [])) console.error(line);
    if (result.error) console.error(`  ${result.error}`);
    process.exit(1);
  }

  console.log(
    `CI test ratchet: PASS — ${result.failed.length}/${result.baselineCount} known failing files remain; `
      + `${result.fixed.length} baseline file(s) are now green`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}
