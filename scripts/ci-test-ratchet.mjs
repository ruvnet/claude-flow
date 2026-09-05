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
    mkdirSync(dirname(reportPath), { recursive: true });
    // A killed runner must not accidentally reuse a prior green-enough report.
    rmSync(reportPath, { force: true });
    const run = spawnSync(process.execPath, [
      vitestBin,
      'run',
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
    for (const name of result.unexpected ?? []) console.error(`  + ${name}`);
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
