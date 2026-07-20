#!/usr/bin/env node
// cost-federation — aggregate per-peer federation_spend events into rolling
// 1h / 24h / 7d windows. Implements the consumer side of ADR-097 Phase 3.
//
// Phase 3 contract (from ADR-097):
//   Event: federation_spend = { peerId, taskId, tokensUsed, usdSpent, ts }
//   Storage: namespace `federation-spend`, key `fed-spend-<peerId>-<ts>`
//   Aggregation: per-peer rolling sums (1h, 24h, 7d)
//   Consumer: `cost-report` (this plugin), `breaker` (federation suspension)
//
// Phase 3 isn't landed upstream yet (federation_spend events aren't emitted).
// This script reads whatever IS in the namespace today (empty by default) and
// reports gracefully. The moment upstream emits, this works without changes.
//
// Usage:
//   node scripts/federation.mjs                       # markdown summary
//   FED_FORMAT=json node scripts/federation.mjs       # JSON
//   FED_NAMESPACE=federation-spend (default)

import { spawnNpxSync } from './_npx.mjs';

// ADR-100 / #1748 Issue 3 — CLI_CORE=1 routes to lite cli-core (~2s cold-cache).
// Federation aggregation is list+retrieve only on the federation-spend namespace.
const CLI_PKG = process.env.CLI_CORE === '1'
  ? '@claude-flow/cli-core@alpha'
  : '@claude-flow/cli@latest';

const NS = process.env.FED_NAMESPACE || 'federation-spend';

function memoryList() {
  const r = spawnNpxSync([
    CLI_PKG, 'memory', 'list',
    '--namespace', NS, '--format', 'json',
  ], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf-8', shell: process.platform === 'win32' });
  if (r.status !== 0) return [];
  const m = /\[[\s\S]*\]/.exec(r.stdout || '');
  if (!m) return [];
  try { return JSON.parse(m[0]).map((e) => e.key).filter(Boolean); } catch { return []; }
}
function memoryRetrieve(key) {
  const r = spawnNpxSync([
    CLI_PKG, 'memory', 'retrieve',
    '--namespace', NS, '--key', key, '--value-only',
  ], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf-8', shell: process.platform === 'win32' });
  if (r.status !== 0) return null;
  try { return JSON.parse((r.stdout || '').trim()); } catch { return null; }
}

function gather() {
  const keys = memoryList();
  const events = keys
    .filter((k) => k.startsWith('fed-spend-'))
    .map(memoryRetrieve)
    .filter(Boolean);
  return events;
}

function bucket(events) {
  const now = Date.now();
  const h = 3600 * 1000;
  const day = 24 * h;
  const perPeer = {};
  for (const e of events) {
    const peer = e.peerId || 'unknown';
    const ts = e.ts ? new Date(e.ts).getTime() : 0;
    if (!perPeer[peer]) perPeer[peer] = {
      peer, count1h: 0, count24h: 0, count7d: 0,
      tokens1h: 0, tokens24h: 0, tokens7d: 0,
      usd1h: 0, usd24h: 0, usd7d: 0,
      total: { tokens: 0, usd: 0, count: 0 },
    };
    const p = perPeer[peer];
    const tokens = e.tokensUsed || 0;
    const usd = e.usdSpent || 0;
    p.total.tokens += tokens; p.total.usd += usd; p.total.count++;
    if (ts && now - ts < 7 * day) { p.count7d++; p.tokens7d += tokens; p.usd7d += usd; }
    if (ts && now - ts < day)     { p.count24h++; p.tokens24h += tokens; p.usd24h += usd; }
    if (ts && now - ts < h)       { p.count1h++; p.tokens1h += tokens; p.usd1h += usd; }
  }
  return Object.values(perPeer).sort((a, b) => b.usd24h - a.usd24h);
}

function fmtUsd(n) { return `$${(n || 0).toFixed(4)}`; }

function main() {
  const events = gather();
  const peers = bucket(events);
  const totalUsd24h = peers.reduce((s, p) => s + p.usd24h, 0);

  if (process.env.FED_FORMAT === 'json') {
    console.log(JSON.stringify({
      eventCount: events.length,
      peers,
      totalUsd24h,
      phase3Active: events.length > 0,
    }, null, 2));
    return;
  }

  console.log(`# cost-federation — per-peer federation_spend rolling windows`);
  console.log('');
  console.log(`Namespace: \`${NS}\`  ·  Events: ${events.length}  ·  Peers: ${peers.length}`);
  if (events.length === 0) {
    console.log('');
    console.log('> No federation_spend events found. Phase 3 of ADR-097 is not yet emitting.');
    console.log('> This skill is the consumer-side wiring; it will activate the moment upstream');
    console.log('> publishes events with shape `{peerId, taskId, tokensUsed, usdSpent, ts}` to');
    console.log('> the `' + NS + '` namespace.');
    return;
  }
  console.log('');
  console.log(`Total 24h spend: **${fmtUsd(totalUsd24h)}**`);
  console.log('');
  console.log('| Peer | 1h count | 1h $ | 24h count | 24h $ | 7d count | 7d $ |');
  console.log('|---|---:|---:|---:|---:|---:|---:|');
  for (const p of peers) {
    console.log(`| \`${p.peer}\` | ${p.count1h} | ${fmtUsd(p.usd1h)} | ${p.count24h} | ${fmtUsd(p.usd24h)} | ${p.count7d} | ${fmtUsd(p.usd7d)} |`);
  }
  console.log('');
  console.log('## Suspension threshold check (ADR-097 default $5/24h)');
  console.log('');
  const SUSPEND_THRESHOLD = parseFloat(process.env.FED_SUSPEND_THRESHOLD_USD || '5.0');
  const offenders = peers.filter((p) => p.usd24h > SUSPEND_THRESHOLD);
  if (offenders.length === 0) {
    console.log(`No peer exceeds the $${SUSPEND_THRESHOLD.toFixed(2)}/24h threshold.`);
  } else {
    console.log(`**⚠ ${offenders.length} peer(s) exceed $${SUSPEND_THRESHOLD.toFixed(2)}/24h** (Phase 2 breaker would suspend):`);
    for (const p of offenders) console.log(`- \`${p.peer}\` — 24h $${p.usd24h.toFixed(2)}`);
  }
}

main();
