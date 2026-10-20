#!/usr/bin/env node
// smoke-all-plugins — run every `plugins/*/scripts/smoke.sh` in parallel,
// aggregate pass/fail counts, exit non-zero if any plugin's contract fails.
//
// USAGE
//   node scripts/smoke-all-plugins.mjs                    # parallel, table output
//   node scripts/smoke-all-plugins.mjs --sequential       # one at a time (debugging)
//   node scripts/smoke-all-plugins.mjs --format json      # machine-readable
//   node scripts/smoke-all-plugins.mjs --only ruflo-agent,ruflo-cost-tracker
//   node scripts/smoke-all-plugins.mjs --skip ruflo-iot-cognitum
//   node scripts/smoke-all-plugins.mjs --skip-guard-probe # omit the final guard-probe step
//   node scripts/smoke-all-plugins.mjs --skip-external    # omit the external plugins (no network)
//
// External plugins: a marketplace entry whose source is a git-subdir pinned to a commit on github.com (a plugin maintained in
// another repository) is checked out at that commit into a temporary folder, its manifest must carry the listed name, and its
// own scripts/smoke.sh, when it ships one, runs as one more row with a scrubbed env, a temporary HOME and its checkout as cwd
// (scripts/external-plugins.mjs). This step needs network access to the plugin's repository.
//
// After the per-plugin smokes, `scripts/probe-mod-guards.mjs --fast` runs every hooks/guard.ts through the adversarial corpus. It
// fails only on holes NOT listed in scripts/probe-mod-guards.known-holes.json, so a regression (or a new guard copied from a
// capped template) fails the run while the recorded backlog does not.
//
// CI integration:
//   - name: All-plugin smoke contracts
//     run: node scripts/smoke-all-plugins.mjs
//
// Exit codes:
//   0  every smoke contract passed
//   1  one or more plugins failed
//   2  config error (e.g. invalid CLI args)
//   3  no smoke scripts found (likely repo-layout drift — fail closed)

import { readdirSync, existsSync, statSync, readFileSync, rmSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkoutAt, externalSmokePlan, externalSourceProblem, makeWorkArea } from './external-plugins.mjs';

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(SCRIPTS_DIR);
const PLUGINS_DIR = join(REPO_ROOT, 'plugins');

const ARGS = (() => {
  const a = {
    sequential: false,
    format: 'table',
    only: null,
    skip: new Set(),
    timeoutSec: 120,  // per-plugin hard cap — prevents a hung smoke from deadlocking the run
    failFast: false,  // if true, kill remaining smokes on first failure
    guardProbe: true, // final step: fast adversarial probe of every hooks/guard.ts
    external: true,   // check out each external plugin at its pinned commit and run its own smoke
  };
  for (let i = 2; i < process.argv.length; i++) {
    const v = process.argv[i];
    if (v === '--sequential') a.sequential = true;
    else if (v === '--format') a.format = process.argv[++i];
    else if (v === '--timeout') a.timeoutSec = parseFloat(process.argv[++i]);
    else if (v === '--fail-fast') a.failFast = true;
    else if (v === '--skip-guard-probe') a.guardProbe = false;
    else if (v === '--skip-external') a.external = false;
    else if (v === '--only') {
      a.only = new Set((process.argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean));
    } else if (v === '--skip') {
      for (const s of (process.argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean)) {
        a.skip.add(s);
      }
    }
  }
  if (!isFinite(a.timeoutSec) || a.timeoutSec <= 0) {
    console.error(`smoke-all-plugins: --timeout must be > 0; got ${a.timeoutSec}`);
    process.exit(2);
  }
  return a;
})();

function discoverPlugins() {
  if (!existsSync(PLUGINS_DIR)) return [];
  const entries = readdirSync(PLUGINS_DIR);
  const plugins = [];
  for (const name of entries) {
    if (ARGS.only && !ARGS.only.has(name)) continue;
    if (ARGS.skip.has(name)) continue;
    const dir = join(PLUGINS_DIR, name);
    let stat;
    try { stat = statSync(dir); } catch { continue; }
    if (!stat.isDirectory()) continue;
    const smoke = join(dir, 'scripts', 'smoke.sh');
    if (!existsSync(smoke)) continue;
    plugins.push({ name, smoke });
  }
  return plugins.sort((a, b) => a.name.localeCompare(b.name));
}

/** The marketplace's external entries (a git-subdir source), filtered by --only and --skip. */
function discoverExternal() {
  let plugins = [];
  try { plugins = JSON.parse(readFileSync(join(REPO_ROOT, '.claude-plugin', 'marketplace.json'), 'utf8')).plugins ?? []; } catch { return []; }
  return plugins
    .filter((p) => p && typeof p.source === 'object' && p.source !== null && typeof p.name === 'string')
    .filter((p) => (!ARGS.only || ARGS.only.has(p.name)) && !ARGS.skip.has(p.name))
    .map((p) => ({ name: p.name, source: p.source }));
}

/** One external plugin as a smoke row: checkout at the pinned commit, manifest name, then its own scripts/smoke.sh, run as
 * third-party code (scrubbed env, temporary HOME, cwd = its own checkout outside the workspace; see external-plugins.mjs). */
async function runExternal(entry) {
  const name = `${entry.name} (external)`;
  const t0 = Date.now();
  const fail = (reason) => ({ name, exitCode: 1, ok: false, timedOut: false, aborted: false, terminationReason: reason, passed: null, failed: null, durationMs: Date.now() - t0, failingSteps: [], stderrTail: '' });
  const problem = externalSourceProblem(entry.source);
  if (problem !== null) return fail(problem);
  const { url, path, sha } = entry.source;
  const area = makeWorkArea();
  try {
    const fetched = checkoutAt(url, sha, area.checkout, area.home, ARGS.timeoutSec * 1000);
    if (fetched !== null) return fail(fetched);
    const plan = externalSmokePlan(area.checkout, area.home, path, entry.name);
    if (plan.problem) return fail(plan.problem);
    if (plan.smoke === null) return { ...fail('no scripts/smoke.sh; manifest checked'), exitCode: 0, ok: true };
    return { ...(await runSmoke({ name, smoke: plan.smoke, cwd: plan.cwd, env: plan.env })), durationMs: Date.now() - t0 };
  } finally {
    rmSync(area.dir, { recursive: true, force: true });
  }
}

function runSmoke(plugin, abortSignal) {
  return new Promise((resolve) => {
    const start = Date.now();
    const p = spawn('bash', [plugin.smoke], { stdio: ['ignore', 'pipe', 'pipe'], ...(plugin.cwd && { cwd: plugin.cwd }), ...(plugin.env && { env: plugin.env }) });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let aborted = false;

    // Per-plugin timeout — prevent a hung smoke from deadlocking the run.
    const timer = setTimeout(() => {
      timedOut = true;
      p.kill('SIGTERM');
      // SIGKILL fallback if SIGTERM is ignored
      setTimeout(() => { try { p.kill('SIGKILL'); } catch {} }, 2000);
    }, ARGS.timeoutSec * 1000);

    // External abort signal (e.g. --fail-fast triggered by another smoke).
    const onAbort = () => {
      aborted = true;
      p.kill('SIGTERM');
      setTimeout(() => { try { p.kill('SIGKILL'); } catch {} }, 2000);
    };
    if (abortSignal) abortSignal.addEventListener('abort', onAbort, { once: true });

    p.stdout.on('data', (d) => { stdout += d.toString(); });
    p.stderr.on('data', (d) => { stderr += d.toString(); });
    p.on('close', (exitCode) => {
      clearTimeout(timer);
      if (abortSignal) abortSignal.removeEventListener('abort', onAbort);
      const m = /(\d+)\s+passed,\s+(\d+)\s+failed/.exec(stdout);
      const passed = m ? parseInt(m[1], 10) : null;
      const failed = m ? parseInt(m[2], 10) : null;
      const failingSteps = [];
      const lineRe = /→\s+(.+?)\s+\.\.\.\s+FAIL:?\s*(.*)$/gm;
      let lm;
      while ((lm = lineRe.exec(stdout)) !== null) {
        failingSteps.push({ step: lm[1].trim(), reason: lm[2].trim() });
      }
      const effectiveCode = timedOut ? 124 : (aborted ? 125 : (exitCode ?? 0));
      const reason = timedOut
        ? `timeout after ${ARGS.timeoutSec}s (sent SIGTERM, then SIGKILL)`
        : aborted
          ? 'aborted by --fail-fast'
          : null;
      resolve({
        name: plugin.name,
        exitCode: effectiveCode,
        ok: effectiveCode === 0,
        timedOut,
        aborted,
        terminationReason: reason,
        passed,
        failed,
        durationMs: Date.now() - start,
        failingSteps,
        stderrTail: stderr.slice(-400),
      });
    });
    p.on('error', (err) => {
      clearTimeout(timer);
      if (abortSignal) abortSignal.removeEventListener('abort', onAbort);
      resolve({
        name: plugin.name,
        exitCode: 127,
        ok: false,
        timedOut: false,
        aborted: false,
        terminationReason: `spawn failed: ${err.message}`,
        passed: null,
        failed: null,
        durationMs: Date.now() - start,
        failingSteps: [],
        stderrTail: err.message,
      });
    });
  });
}

/** The guard probe as one more smoke row: ok unless a guard has a hole that is not in the known-holes baseline. */
function runGuardProbe() {
  const probe = join(SCRIPTS_DIR, 'probe-mod-guards.mjs');
  const baseline = join(SCRIPTS_DIR, 'probe-mod-guards.known-holes.json');
  const args = [probe, '--fast', '--format', 'json', '--known-holes', baseline];
  if (ARGS.only) args.push('--only', [...ARGS.only].join(','));
  const t0 = Date.now();
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 10 * 60 * 1000 });
  const row = { name: 'guard-probe (fast)', exitCode: r.status ?? 1, ok: r.status === 0, timedOut: r.error?.code === 'ETIMEDOUT', aborted: false, terminationReason: null, passed: null, failed: null, durationMs: Date.now() - t0, failingSteps: [], stderrTail: (r.stderr || '').slice(-400) };
  try {
    const out = JSON.parse(r.stdout);
    row.passed = out.rows.reduce((n, x) => n + x.results.filter((y) => y.status === 'pass').length, 0);
    row.failed = out.newHoles.length + out.fatal.length;
    row.failingSteps = [...out.newHoles, ...out.fatal.map((f) => `${f.plugin}: ${f.error}`)].slice(0, 6).map((step) => ({ step }));
  } catch {
    if (r.status === 3) { row.ok = true; row.terminationReason = 'no guards found'; } // nothing to probe is not a failure here
    else if (!row.ok) row.terminationReason = 'probe produced no JSON';
  }
  return row;
}

/**
 * The changelog contract (ADR-478): a plugin that ships a What's new page's data keeps a CHANGELOG.md with an entry for the version in its
 * manifest, `## <version> — <date>` then `fix:`/`feat:`/`breaking:`/`chore:` bullets. Enforced for the plugins that bump on their own cadence
 * (console, mods, swarm, protector); every other plugin ships a CHANGELOG.md too, but is not gated until its release flow writes one.
 */
const CHANGELOG_CONTRACT = ['ruflo-console', 'ruflo-mods', 'ruflo-swarm', 'ruflo-protector'];
function runChangelogContract() {
  const t0 = Date.now();
  const names = CHANGELOG_CONTRACT.filter((n) => (!ARGS.only || ARGS.only.has(n)) && !ARGS.skip.has(n) && existsSync(join(PLUGINS_DIR, n)));
  const failingSteps = [];
  for (const name of names) {
    let version = null;
    try { version = JSON.parse(readFileSync(join(PLUGINS_DIR, name, '.claude-plugin', 'plugin.json'), 'utf8')).version; } catch { /* reported below */ }
    if (typeof version !== 'string') { failingSteps.push({ step: `${name}: plugin.json has no version` }); continue; }
    let text = '';
    try { text = readFileSync(join(PLUGINS_DIR, name, 'CHANGELOG.md'), 'utf8').slice(0, 262144); } catch { failingSteps.push({ step: `${name}: no CHANGELOG.md` }); continue; }
    const headers = text.split('\n').filter((l) => l.startsWith('## ')).map((l) => /^## (\d{1,4}\.\d{1,4}\.\d{1,4}) [—–-] \d{4}-\d{2}-\d{2}\s*$/.exec(l.replace(/\r$/, '').slice(0, 64)));
    if (!headers.some((m) => m && m[1] === version)) failingSteps.push({ step: `${name}: CHANGELOG.md has no "## ${version} — <date>" entry` });
  }
  return { name: 'changelog contract', exitCode: failingSteps.length ? 1 : 0, ok: failingSteps.length === 0, timedOut: false, aborted: false, terminationReason: null, passed: names.length - failingSteps.length, failed: failingSteps.length, durationMs: Date.now() - t0, failingSteps, stderrTail: '' };
}

async function main() {
  const plugins = discoverPlugins();
  const external = ARGS.external ? discoverExternal() : [];
  if (plugins.length === 0 && external.length === 0) {
    console.error('smoke-all-plugins: no plugins/*/scripts/smoke.sh found — repo layout drift?');
    process.exit(3);
  }

  // --fail-fast: AbortController kills remaining smokes when any one fails.
  const abortController = ARGS.failFast ? new AbortController() : null;
  let results;
  if (ARGS.sequential) {
    results = [];
    for (const p of plugins) {
      const r = await runSmoke(p, abortController?.signal);
      results.push(r);
      if (ARGS.failFast && !r.ok) {
        // Mark remaining as skipped — they never ran.
        for (const remaining of plugins.slice(plugins.indexOf(p) + 1)) {
          results.push({
            name: remaining.name, exitCode: 125, ok: false,
            timedOut: false, aborted: true,
            terminationReason: 'skipped by --fail-fast (prior plugin failed)',
            passed: null, failed: null, durationMs: 0,
            failingSteps: [], stderrTail: '',
          });
        }
        break;
      }
    }
  } else {
    // For --fail-fast in parallel, wire each promise to abort siblings on failure.
    const pending = plugins.map((p) => runSmoke(p, abortController?.signal).then((r) => {
      if (ARGS.failFast && !r.ok && !abortController.signal.aborted) {
        abortController.abort();
      }
      return r;
    }));
    results = await Promise.all(pending);
  }

  if (ARGS.external && !abortController?.signal.aborted) {
    for (const entry of external) results.push(await runExternal(entry));
  }
  results.push(runChangelogContract());
  if (ARGS.guardProbe && !abortController?.signal.aborted) results.push(runGuardProbe());

  const okCount = results.filter((r) => r.ok).length;
  const failCount = results.length - okCount;
  const totalSteps = results.reduce((s, r) => s + (r.passed || 0) + (r.failed || 0), 0);
  const totalPassed = results.reduce((s, r) => s + (r.passed || 0), 0);
  const totalFailed = results.reduce((s, r) => s + (r.failed || 0), 0);
  const totalDurationMs = results.reduce((s, r) => s + r.durationMs, 0);

  if (ARGS.format === 'json') {
    console.log(JSON.stringify({
      plugins: results,
      summary: {
        pluginsOk: okCount,
        pluginsFailed: failCount,
        stepsPassed: totalPassed,
        stepsFailed: totalFailed,
        stepsTotal: totalSteps,
        wallTimeMs: totalDurationMs,
      },
      generatedAt: new Date().toISOString(),
    }, null, 2));
  } else {
    console.log('# smoke-all-plugins');
    console.log('');
    console.log(`| Plugin | Status | Pass / Total | Duration | Failing steps |`);
    console.log(`|---|:---:|---:|---:|---|`);
    for (const r of results) {
      let status;
      if (r.ok) status = '✓';
      else if (r.timedOut) status = '⏱';
      else if (r.aborted) status = '⊘';
      else status = '⚠';
      const passTotal = r.passed !== null
        ? `${r.passed}/${(r.passed + r.failed)}`
        : '—';
      let failures;
      if (r.failingSteps.length > 0) {
        failures = r.failingSteps.map((f) => `\`${f.step}\``).join(', ').slice(0, 120);
      } else if (r.terminationReason) {
        failures = `**${r.terminationReason}**`;
      } else if (!r.ok) {
        failures = `**exit ${r.exitCode}**`;
      } else {
        failures = '';
      }
      console.log(`| \`${r.name}\` | ${status} | ${passTotal} | ${(r.durationMs / 1000).toFixed(1)}s | ${failures} |`);
    }
    console.log('');
    console.log(`**Summary**: ${okCount}/${results.length} plugins OK · ${totalPassed}/${totalSteps} steps passed · ${(totalDurationMs / 1000).toFixed(1)}s wall (parallel: ${!ARGS.sequential})`);
    console.log('');
    if (failCount > 0) {
      console.log(`⚠ ${failCount} plugin(s) failed their smoke contract — see failing steps above.`);
    } else {
      console.log(`✓ All ${results.length} plugin smoke contracts passed.`);
    }
    console.log('');
  }

  process.exit(failCount > 0 ? 1 : 0);
}

main();
