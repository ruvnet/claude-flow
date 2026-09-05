#!/usr/bin/env node
// cost-diff — snapshot delta between two cost-summary JSON outputs.
//
// Consumes the stable JSON contract emitted by `cost summary --format json`.
// Use it to answer "what changed?" between two known-good states:
//   - "Did this PR add expensive sessions?" (baseline = main, current = PR)
//   - "Has spend shifted between tiers since the last release?"
//   - "Which models grew/shrank in usage week-over-week?"
//
// This is the COMPLEMENT to cost-counterfactual (hypothetical baselines)
// and cost-burn (latest-bucket vs prior mean). Where those answer
// "what could have been?" and "is the AVERAGE shifting?", cost-diff
// answers "what changed between these two specific snapshots?".
//
// USAGE
//   cost summary --format json > /tmp/baseline.json   # before
//   cost summary --format json > /tmp/current.json    # after
//   node scripts/diff.mjs --baseline /tmp/baseline.json --current /tmp/current.json
//   node scripts/diff.mjs ... --alert-on-pct 10       # exit 1 if total grew >10%
//   node scripts/diff.mjs ... --alert-on-usd 5.00     # exit 1 if total grew >$5
//   node scripts/diff.mjs ... --format json           # CI-consumable
//
// EXIT CODES
//   0  no alert (or no thresholds configured)
//   1  --alert-on-* threshold exceeded
//   2  config error (missing files, invalid JSON, etc.)

import { readFileSync, existsSync } from 'node:fs';

const ARGS = (() => {
  const a = {
    baseline: null, current: null,
    alertPct: null, alertUsd: null,
    // iter 86 — per-token-class % thresholds. Format: --alert-on-class-pct
    // cache_write:50 (or comma-separated: cache_write:50,output:25). Lets
    // CI catch regressions that grow ONE class disproportionately even if
    // the total USD delta is modest (the iter-82 bug class precedent).
    alertClassPct: {},  // { className: thresholdPct }
    format: 'table',
  };
  for (let i = 2; i < process.argv.length; i++) {
    const v = process.argv[i];
    if (v === '--baseline') a.baseline = process.argv[++i];
    else if (v === '--current') a.current = process.argv[++i];
    else if (v === '--alert-on-pct') a.alertPct = parseFloat(process.argv[++i]);
    else if (v === '--alert-on-usd') a.alertUsd = parseFloat(process.argv[++i]);
    else if (v === '--alert-on-class-pct') {
      const spec = process.argv[++i] || '';
      for (const pair of spec.split(',').map((s) => s.trim()).filter(Boolean)) {
        const m = /^(\w+):([\d.]+)$/.exec(pair);
        if (!m) {
          console.error(`cost-diff: --alert-on-class-pct expects "<class>:<pct>" pairs; got "${pair}"`);
          process.exit(2);
        }
        const cls = m[1], pct = parseFloat(m[2]);
        if (!['input', 'output', 'cache_write', 'cache_read'].includes(cls)) {
          console.error(`cost-diff: --alert-on-class-pct class must be one of input|output|cache_write|cache_read; got "${cls}"`);
          process.exit(2);
        }
        if (!isFinite(pct) || pct <= 0) {
          console.error(`cost-diff: --alert-on-class-pct threshold must be > 0; got ${pct}`);
          process.exit(2);
        }
        a.alertClassPct[cls] = pct;
      }
    }
    else if (v === '--format') a.format = process.argv[++i];
  }
  return a;
})();

function loadSnapshot(path, label) {
  if (!path) {
    console.error(`cost-diff: --${label} is required (a cost-summary JSON file)`);
    process.exit(2);
  }
  if (!existsSync(path)) {
    console.error(`cost-diff: ${label} file not found: ${path}`);
    process.exit(2);
  }
  let raw;
  try { raw = readFileSync(path, 'utf-8'); }
  catch (e) {
    console.error(`cost-diff: cannot read ${label}: ${e.message}`);
    process.exit(2);
  }
  let json;
  try { json = JSON.parse(raw); }
  catch (e) {
    console.error(`cost-diff: ${label} is not valid JSON: ${e.message}`);
    process.exit(2);
  }
  // Sanity check on shape — must look like a cost-summary output.
  if (typeof json.total_cost_usd !== 'number' || typeof json.sessionCount !== 'number') {
    console.error(`cost-diff: ${label} doesn't look like cost-summary output (missing total_cost_usd or sessionCount)`);
    process.exit(2);
  }
  return json;
}

function diffNumber(b, c) {
  const delta = c - b;
  const pct = b > 0 ? (delta / b) * 100 : (c > 0 ? Infinity : 0);
  return { baseline: b, current: c, delta, pct };
}

function diffMap(bMap, cMap) {
  // bMap/cMap: { key: number } or { key: { cost_usd } }
  const keys = new Set([...Object.keys(bMap || {}), ...Object.keys(cMap || {})]);
  const out = [];
  for (const k of keys) {
    const bv = typeof bMap[k] === 'object' ? (bMap[k]?.cost_usd ?? 0) : (bMap[k] ?? 0);
    const cv = typeof cMap[k] === 'object' ? (cMap[k]?.cost_usd ?? 0) : (cMap[k] ?? 0);
    if (bv === 0 && cv === 0) continue;
    out.push({ key: k, ...diffNumber(bv, cv), status: bv === 0 ? 'added' : (cv === 0 ? 'removed' : 'changed') });
  }
  out.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return out;
}

function main() {
  const baseline = loadSnapshot(ARGS.baseline, 'baseline');
  const current = loadSnapshot(ARGS.current, 'current');

  const total = diffNumber(baseline.total_cost_usd, current.total_cost_usd);
  const sessions = diffNumber(baseline.sessionCount, current.sessionCount);
  const tierDeltas = diffMap(baseline.byTier || {}, current.byTier || {});
  const modelDeltas = diffMap(baseline.byModel || {}, current.byModel || {});
  // iter 85 — surface per-token-class deltas. Without this a regression
  // that 10×'d cache_write tokens only showed up in USD totals; operators
  // couldn't see WHERE the growth came from. byTokenClass is emitted by
  // cost-summary (iter 84). Falls back gracefully if either snapshot
  // lacks the field (legacy snapshots).
  const tokenClassDeltas = (baseline.byTokenClass || current.byTokenClass)
    ? diffMap(baseline.byTokenClass || {}, current.byTokenClass || {})
    : null;

  // Alert check.
  let alertTriggered = false;
  let alertReason = null;
  if (ARGS.alertPct !== null) {
    if (!isFinite(ARGS.alertPct)) {
      console.error(`cost-diff: --alert-on-pct must be a finite number`);
      process.exit(2);
    }
    if (isFinite(total.pct) && total.pct > ARGS.alertPct) {
      alertTriggered = true;
      alertReason = `total spend grew ${total.pct.toFixed(2)}% (+$${total.delta.toFixed(6)}); threshold +${ARGS.alertPct}%`;
    }
  }
  if (!alertTriggered && ARGS.alertUsd !== null) {
    if (!isFinite(ARGS.alertUsd)) {
      console.error(`cost-diff: --alert-on-usd must be a finite number`);
      process.exit(2);
    }
    if (total.delta > ARGS.alertUsd) {
      alertTriggered = true;
      alertReason = `total spend grew $${total.delta.toFixed(6)}; threshold +$${ARGS.alertUsd.toFixed(2)}`;
    }
  }
  // iter 86 — per-class % thresholds. First class to breach wins.
  if (!alertTriggered && Object.keys(ARGS.alertClassPct).length > 0) {
    if (!tokenClassDeltas) {
      // Both snapshots lack byTokenClass — class threshold can't fire.
      // Don't error; the rule is silently inapplicable. CI gates that
      // depend on this should ensure their baseline format is current.
    } else {
      for (const [cls, threshold] of Object.entries(ARGS.alertClassPct)) {
        const row = tokenClassDeltas.find((c) => c.key === cls);
        if (row && isFinite(row.pct) && row.pct > threshold) {
          alertTriggered = true;
          alertReason = `\`${cls}\` tokens grew ${row.pct.toFixed(2)}% (+${row.delta.toLocaleString()} tok); threshold +${threshold}%`;
          break;
        }
      }
    }
  }

  const payload = {
    // iter 81 — git context surfaced when snapshots include it (cost-summary
    // started emitting `git` in iter 81 too). Older snapshots without git
    // metadata work fine; the fields are simply omitted.
    baseline: { path: ARGS.baseline, exportedAt: baseline.exportedAt, git: baseline.git || null, total_cost_usd: baseline.total_cost_usd },
    current:  { path: ARGS.current,  exportedAt: current.exportedAt,  git: current.git || null,  total_cost_usd: current.total_cost_usd },
    delta: {
      total_cost_usd: Math.round(total.delta * 1e6) / 1e6,
      total_pct: isFinite(total.pct) ? Math.round(total.pct * 100) / 100 : null,
      sessionCount: sessions.delta,
      sessionCount_pct: isFinite(sessions.pct) ? Math.round(sessions.pct * 100) / 100 : null,
    },
    byTier: tierDeltas,
    byModel: modelDeltas,
    byTokenClass: tokenClassDeltas,
    alert: (ARGS.alertPct !== null || ARGS.alertUsd !== null || Object.keys(ARGS.alertClassPct).length > 0) ? {
      triggered: alertTriggered,
      reason: alertReason,
      thresholdPct: ARGS.alertPct,
      thresholdUsd: ARGS.alertUsd,
      thresholdClassPct: Object.keys(ARGS.alertClassPct).length > 0 ? ARGS.alertClassPct : null,
    } : null,
    generatedAt: new Date().toISOString(),
  };

  if (ARGS.format === 'json') {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(`# cost-diff`);
    // iter 81 — surface git context when present so operators can correlate
    // diffs to commits without leaving the terminal.
    if (baseline.git || current.git) {
      const fmtGit = (g) => g
        ? `\`${g.shaShort}\` (${g.branch || 'detached'}${g.isDirty ? ', dirty' : ''})`
        : '_no git context_';
      console.log('');
      console.log(`_baseline: ${fmtGit(baseline.git)} → current: ${fmtGit(current.git)}_`);
    }
    console.log('');
    console.log(`| Metric | Baseline | Current | Delta | % |`);
    console.log(`|---|---:|---:|---:|---:|`);
    const dStr = total.delta >= 0 ? `+$${total.delta.toFixed(6)}` : `-$${Math.abs(total.delta).toFixed(6)}`;
    const pStr = isFinite(total.pct) ? `${total.pct.toFixed(2)}%` : 'new';
    console.log(`| **Total spend** | $${baseline.total_cost_usd.toFixed(6)} | $${current.total_cost_usd.toFixed(6)} | **${dStr}** | **${pStr}** |`);
    const sStr = sessions.delta >= 0 ? `+${sessions.delta}` : `${sessions.delta}`;
    const spStr = isFinite(sessions.pct) ? `${sessions.pct.toFixed(2)}%` : 'new';
    console.log(`| Sessions | ${baseline.sessionCount} | ${current.sessionCount} | ${sStr} | ${spStr} |`);
    console.log('');
    if (tierDeltas.length > 0) {
      console.log('## By tier');
      console.log('');
      console.log('| Tier | Baseline | Current | Delta | % | Status |');
      console.log('|---|---:|---:|---:|---:|:---:|');
      for (const t of tierDeltas) {
        const td = t.delta >= 0 ? `+$${t.delta.toFixed(6)}` : `-$${Math.abs(t.delta).toFixed(6)}`;
        const tp = isFinite(t.pct) ? `${t.pct.toFixed(2)}%` : (t.status === 'added' ? 'new' : '—');
        console.log(`| ${t.key} | $${t.baseline.toFixed(6)} | $${t.current.toFixed(6)} | ${td} | ${tp} | ${t.status} |`);
      }
      console.log('');
    }
    if (modelDeltas.length > 0) {
      console.log('## By model');
      console.log('');
      console.log('| Model | Baseline | Current | Delta | % | Status |');
      console.log('|---|---:|---:|---:|---:|:---:|');
      for (const m of modelDeltas) {
        const md = m.delta >= 0 ? `+$${m.delta.toFixed(6)}` : `-$${Math.abs(m.delta).toFixed(6)}`;
        const mp = isFinite(m.pct) ? `${m.pct.toFixed(2)}%` : (m.status === 'added' ? 'new' : '—');
        console.log(`| \`${m.key}\` | $${m.baseline.toFixed(6)} | $${m.current.toFixed(6)} | ${md} | ${mp} | ${m.status} |`);
      }
      console.log('');
    }
    // iter 85 — per-token-class delta surfaces cache_write growth driver.
    if (tokenClassDeltas && tokenClassDeltas.length > 0) {
      console.log('## By token class');
      console.log('');
      console.log('| Class | Baseline | Current | Delta | % | Status |');
      console.log('|---|---:|---:|---:|---:|:---:|');
      for (const c of tokenClassDeltas) {
        const cd = c.delta >= 0 ? `+${c.delta.toLocaleString()}` : c.delta.toLocaleString();
        const cp = isFinite(c.pct) ? `${c.pct.toFixed(2)}%` : (c.status === 'added' ? 'new' : '—');
        console.log(`| ${c.key} | ${c.baseline.toLocaleString()} | ${c.current.toLocaleString()} | ${cd} tok | ${cp} | ${c.status} |`);
      }
      console.log('');
      // Surface the cache-write-growth signal explicitly when present.
      const cacheWriteRow = tokenClassDeltas.find((c) => c.key === 'cache_write');
      if (cacheWriteRow && cacheWriteRow.delta > 0 && isFinite(cacheWriteRow.pct) && cacheWriteRow.pct > 50) {
        console.log(`_⚠ \`cache_write\` tokens grew ${cacheWriteRow.pct.toFixed(1)}% — that's the iter-82 cost driver. Investigate WHICH messages cache-wrote heavily via \`cost session --session-id <id>\`._`);
        console.log('');
      }
    }
    if (alertReason !== null) {
      if (alertTriggered) console.log(`⚠ **ALERT**: ${alertReason}`);
      else console.log(`✓ ${alertReason}`);
      console.log('');
    }
  }

  if (alertTriggered) process.exit(1);
}

main();
