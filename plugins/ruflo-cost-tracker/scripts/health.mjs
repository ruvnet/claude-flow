#!/usr/bin/env node
// cost-health — composition skill: runs all four CI-gate checks in parallel
// and surfaces a single combined health status with max exit code.
//
// Each underlying check answers a different question; together they form
// a complete spend health picture:
//
//   budget-check  (reactive)    "have we crossed the budget?"
//   burn          (trend)       "is daily burn accelerating?"
//   anomaly       (point)       "is any specific session an outlier?"
//   projection    (predictive)  "when will we hit the budget?"
//
// USAGE
//   node scripts/health.mjs                                    # default thresholds
//   node scripts/health.mjs --alert-acceleration 50            # burn threshold
//   node scripts/health.mjs --alert-outliers 1                 # anomaly threshold
//   node scripts/health.mjs --alert-days-to-exhaust 7          # projection threshold
//   node scripts/health.mjs --format json
//
// Default thresholds are set to "would you want to know about this on Slack?":
//   - burn:       +100% (latest day spent 2× the prior weekly mean)
//   - anomaly:    ≥1 outlier (any single session > 3.5σ from median)
//   - projection: <14d until 100% budget (only fires when budget is set)
//   - budget:     HARD_STOP at 100% (the budget-check default)
//
// EXIT CODE = max(component exits). If ANY subcheck failed, the gate fails.
//
// Env: HEALTH_QUIET=1, HEALTH_BUDGET_PERIOD=today|week|month|all,
//      HEALTH_NAMESPACE=cost-tracking (forwarded to each subcheck).

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));

const ARGS = (() => {
  const a = {
    alertAcceleration: 100,   // burn  — +100% bucket vs prior mean
    alertOutliers: 1,         // anomaly — any outlier fails
    alertDaysToExhaust: 14,   // projection — < 14d to 100% budget
    format: 'table',
    skip: new Set(),          // --skip burn,anomaly  to disable subchecks
  };
  if (process.env.HEALTH_QUIET === '1') a.format = 'json';
  for (let i = 2; i < process.argv.length; i++) {
    const v = process.argv[i];
    if (v === '--alert-acceleration') a.alertAcceleration = parseFloat(process.argv[++i]);
    else if (v === '--alert-outliers') a.alertOutliers = parseInt(process.argv[++i], 10);
    else if (v === '--alert-days-to-exhaust') a.alertDaysToExhaust = parseFloat(process.argv[++i]);
    else if (v === '--format') a.format = process.argv[++i];
    else if (v === '--skip') {
      for (const s of (process.argv[++i] || '').split(',')) a.skip.add(s.trim());
    }
  }
  return a;
})();

function runScript(name, scriptFile, scriptArgs, jsonViaEnv) {
  // Most scripts take `--format json` as a flag. budget.mjs uses
  // positional subcommands + BUDGET_QUIET=1 env to opt into JSON. The
  // jsonViaEnv parameter lets the caller pick which mechanism to use.
  const args = jsonViaEnv
    ? [scriptFile, ...scriptArgs]
    : [scriptFile, ...scriptArgs, '--format', 'json'];
  const env = jsonViaEnv
    ? { ...process.env, [jsonViaEnv]: '1' }
    : process.env;
  return new Promise((resolve) => {
    const p = spawn('node', args, { stdio: ['ignore', 'pipe', 'pipe'], env });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => { stdout += d.toString(); });
    p.stderr.on('data', (d) => { stderr += d.toString(); });
    p.on('close', (code) => {
      let json = null;
      const m = /\{[\s\S]*\}/.exec(stdout);
      if (m) {
        try { json = JSON.parse(m[0]); } catch { /* leave null */ }
      }
      resolve({ name, exitCode: code ?? 0, json, stderr: stderr.slice(0, 300) });
    });
    p.on('error', (err) => {
      resolve({ name, exitCode: 127, json: null, stderr: err.message });
    });
  });
}

async function main() {
  const budgetPeriod = process.env.HEALTH_BUDGET_PERIOD || 'all';

  const tasks = [];
  if (!ARGS.skip.has('budget')) {
    tasks.push(runScript('budget', join(SCRIPTS_DIR, 'budget.mjs'), ['check'], 'BUDGET_QUIET'));
  }
  if (!ARGS.skip.has('burn')) {
    tasks.push(runScript('burn', join(SCRIPTS_DIR, 'burn.mjs'), [
      '--alert-on-acceleration-pct', String(ARGS.alertAcceleration),
    ]));
  }
  if (!ARGS.skip.has('anomaly')) {
    tasks.push(runScript('anomaly', join(SCRIPTS_DIR, 'anomaly.mjs'), [
      '--alert-on-outliers', String(ARGS.alertOutliers),
    ]));
  }
  if (!ARGS.skip.has('projection')) {
    tasks.push(runScript('projection', join(SCRIPTS_DIR, 'projection.mjs'), []));
  }

  // Run in parallel — each spawns its own npx CLI shellout.
  const results = await Promise.all(tasks);

  // Projection has no built-in exit code, so derive a synthetic one from
  // days-until-100%-budget-exhaustion.
  const projectionResult = results.find((r) => r.name === 'projection');
  let projectionExit = 0;
  let projectionDays = null;
  if (projectionResult?.json?.budget?.exhaustion) {
    const hundred = projectionResult.json.budget.exhaustion.find((e) => e.thresholdPct === 100);
    if (hundred?.daysUntilReached !== undefined && hundred.daysUntilReached !== null) {
      projectionDays = hundred.daysUntilReached;
      if (hundred.daysUntilReached < ARGS.alertDaysToExhaust) {
        projectionExit = 1;
      }
    }
    projectionResult.exitCode = projectionExit;
  } else if (projectionResult) {
    // No budget configured or no data — projection is "OK" by default.
    projectionResult.exitCode = 0;
  }

  const maxExit = Math.max(...results.map((r) => r.exitCode));

  const payload = {
    config: {
      alertAcceleration: ARGS.alertAcceleration,
      alertOutliers: ARGS.alertOutliers,
      alertDaysToExhaust: ARGS.alertDaysToExhaust,
      budgetPeriod,
      skipped: [...ARGS.skip],
    },
    checks: results.map((r) => ({
      name: r.name,
      exitCode: r.exitCode,
      ok: r.exitCode === 0,
      summary: summarize(r),
    })),
    overall: {
      ok: maxExit === 0,
      exitCode: maxExit,
    },
    generatedAt: new Date().toISOString(),
  };

  if (ARGS.format === 'json') {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(`# cost-health`);
    console.log('');
    const badge = maxExit === 0 ? '✓ HEALTHY' : '⚠ UNHEALTHY';
    console.log(`**Overall**: ${badge} (max exit code ${maxExit})`);
    console.log('');
    console.log('| Check | Status | Detail |');
    console.log('|---|:---:|---|');
    for (const r of results) {
      const status = r.exitCode === 0 ? '✓' : '⚠';
      console.log(`| \`${r.name}\` | ${status} | ${summarize(r)} |`);
    }
    if (ARGS.skip.size > 0) {
      console.log('');
      console.log(`_Skipped: ${[...ARGS.skip].join(', ')}_`);
    }
    console.log('');
    console.log(`_Run \`cost <check>\` for the full detail of any failing leg._`);
    console.log('');
  }

  process.exit(maxExit);
}

function summarize(r) {
  if (!r) return 'no result';
  if (r.exitCode === 127 || !r.json) {
    return `**error** (exit ${r.exitCode}${r.stderr ? `: ${r.stderr.slice(0, 80)}` : ''})`;
  }
  const j = r.json;
  switch (r.name) {
    case 'budget': {
      // budget.mjs returns { error: 'no budget configured', totalSpend, recordCount }
      // when no budget is set; otherwise { level, utilization_pct, budget_usd, spent_usd }.
      if (j.error === 'no budget configured') {
        const spend = typeof j.totalSpend === 'number' ? `$${j.totalSpend.toFixed(2)}` : '—';
        return `no budget set (${spend} measured spend; run \`cost budget set <usd>\` to enable)`;
      }
      const level = j.level || 'OK';
      const util = (typeof j.utilization_pct === 'number') ? `${j.utilization_pct.toFixed(1)}%` : '—';
      const budget = (typeof j.budget_usd === 'number') ? `$${j.budget_usd.toFixed(2)}` : '—';
      return `${level} — ${util} of ${budget} budget consumed`;
    }
    case 'burn': {
      const d = j.delta?.deltaPct;
      const triggered = j.alert?.triggered;
      const reason = j.alert?.reason || '';
      if (triggered) return `**ALERT** ${d?.toFixed(1)}% acceleration: ${reason.slice(0, 100)}`;
      return `delta ${d === null ? 'n/a' : (d?.toFixed?.(1) ?? '0') + '%'} — within ±${ARGS.alertAcceleration}%`;
    }
    case 'anomaly': {
      const n = j.outliers?.length ?? 0;
      const triggered = j.alert?.triggered;
      if (triggered) return `**ALERT** ${n} outlier session(s) detected (|z|>${j.filters?.threshold ?? 3.5})`;
      if (!j.sufficient) return `insufficient data (${j.reason || 'n<3'})`;
      return `${n} outlier(s) — under threshold ≥${ARGS.alertOutliers}`;
    }
    case 'projection': {
      if (!j.budget) return 'no budget configured — skipping forward-look';
      const hundred = j.budget.exhaustion?.find((e) => e.thresholdPct === 100);
      if (!hundred || hundred.daysUntilReached === null || hundred.daysUntilReached === undefined) {
        return 'no spend rate yet — cannot project';
      }
      const d = hundred.daysUntilReached;
      if (d < ARGS.alertDaysToExhaust) return `**ALERT** ${d.toFixed(1)}d to 100% budget (threshold <${ARGS.alertDaysToExhaust}d)`;
      return `${d.toFixed(1)}d to 100% budget — over ${ARGS.alertDaysToExhaust}d horizon`;
    }
    default:
      return `exit ${r.exitCode}`;
  }
}

main();
