#!/usr/bin/env node
// Runtime test for the multi-provider ledger: builds throwaway Claude, Codex and
// Grok logs and asserts every counting rule that trackers commonly get wrong.
//   node plugins/ruflo-cost-tracker/scripts/test-ledger.mjs

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'ledger-'));
process.env.CLAUDE_CONFIG_DIR = join(tmp, 'claude');
process.env.CODEX_HOME = join(tmp, 'codex');
process.env.GROK_HOME = join(tmp, 'grok');
mkdirSync(join(process.env.CLAUDE_CONFIG_DIR, 'projects', 'p'), { recursive: true });
mkdirSync(join(process.env.CODEX_HOME, 'sessions', '2026', '10', '03'), { recursive: true });
mkdirSync(join(process.env.CODEX_HOME, 'archived_sessions'), { recursive: true });
const grokSession = join(process.env.GROK_HOME, 'sessions', encodeURIComponent('/proj/g'), 'gs1');
mkdirSync(grokSession, { recursive: true });

const { collect } = await import('./_ledger.mjs');
const { priceUsage, lookup } = await import('./_pricebook.mjs');
const { summarise } = await import('./ledger.mjs');
const { advise } = await import('./advise.mjs');
const { localCost, breakEvenBusy } = await import('./local-cost.mjs');

const jsonl = (path, items) => writeFileSync(path, items.map(item => JSON.stringify(item)).join('\n') + '\n');
const T = i => `2026-10-03T00:00:${String(i).padStart(2, '0')}.000Z`;
let failed = 0;
const test = (name, fn) => { try { fn(); console.log(`ok   ${name}`); } catch (error) { failed += 1; console.log(`FAIL ${name}\n     ${error.message}`); } };

// ── Claude: one message logged three times (content blocks) counts once; TTL split is priced.
const message = (id, extra = {}) => ({ type: 'assistant', sessionId: 's1', cwd: '/x', requestId: `r-${id}`, timestamp: T(1), message: { id, role: 'assistant', model: 'claude-opus-5-5', usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 10000, cache_creation_input_tokens: 2000, cache_creation: { ephemeral_5m_input_tokens: 500, ephemeral_1h_input_tokens: 1500 } } }, ...extra });
jsonl(join(process.env.CLAUDE_CONFIG_DIR, 'projects', 'p', 's1.jsonl'), [message('m1'), message('m1'), message('m1'), message('m2', { isSidechain: true }), { type: 'user', message: { role: 'user' } }, { type: 'assistant', timestamp: T(2), message: { id: 'syn', role: 'assistant', model: '<synthetic>', usage: { input_tokens: 9 } } }]);

// ── Codex: running totals → deltas, cached ⊂ input, a reset, a replayed (forked) event, model from turn_context.
const total = (input, cached, output) => ({ input_tokens: input, cached_input_tokens: cached, cache_write_input_tokens: 0, output_tokens: output, reasoning_output_tokens: 0, total_tokens: input + output });
const event = (i, usage) => ({ timestamp: T(i), type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: usage } } });
const rollout = [
  { type: 'session_meta', payload: { id: 'cx1', cwd: '/y' } },
  { type: 'turn_context', payload: { model: 'gpt-5.3-codex', effort: 'high' } },
  event(10, total(1000, 800, 100)),
  event(10, total(1000, 800, 100)), // identical running total: no new usage
  event(11, total(3000, 2600, 300)),
  event(12, total(500, 400, 50)), // total went DOWN: compaction/reset, a fresh base
];
jsonl(join(process.env.CODEX_HOME, 'sessions', '2026', '10', '03', 'rollout-a.jsonl'), rollout);
jsonl(join(process.env.CODEX_HOME, 'archived_sessions', 'rollout-a.jsonl'), rollout); // same rollout archived: active copy wins
jsonl(join(process.env.CODEX_HOME, 'sessions', '2026', '10', '03', 'rollout-fork.jsonl'), [
  { type: 'session_meta', payload: { id: 'fork', cwd: '/y' } },
  ...rollout.slice(0, 5), // copied parent metadata and usage, before any helper activity
]);

// ── Grok: usage.json with turns[] → one row per turn; cached ⊂ input; project from encoded folder / summary.
writeFileSync(join(grokSession, 'usage.json'), JSON.stringify({
  sessionId: 'gs1',
  updatedAt: '2026-10-03T00:00:20.000Z',
  session: {
    inputTokens: 3000, outputTokens: 300, cachedReadTokens: 2000, cacheCreationTokens: 100,
    reasoningTokens: 50, primaryModelId: 'grok-4.7-build',
  },
  turns: [
    { turnNumber: 1, endedAt: '2026-10-03T00:00:10.000Z', inputTokens: 1000, outputTokens: 100, cachedReadTokens: 800, cacheCreationTokens: 0, reasoningTokens: 20, primaryModelId: 'grok-4.7-build' },
    { turnNumber: 2, endedAt: '2026-10-03T00:00:20.000Z', inputTokens: 2000, outputTokens: 200, cachedReadTokens: 1200, cacheCreationTokens: 100, reasoningTokens: 30, primaryModelId: 'grok-4.7-build' },
  ],
}) + '\n');
writeFileSync(join(grokSession, 'summary.json'), JSON.stringify({ info: { id: 'gs1', cwd: '/proj/g' } }) + '\n');
// Session without turns[] falls back to session totals (and folder-decoded project when summary lacks cwd).
const grokSession2 = join(process.env.GROK_HOME, 'sessions', encodeURIComponent('/proj/h'), 'gs2');
mkdirSync(grokSession2, { recursive: true });
writeFileSync(join(grokSession2, 'usage.json'), JSON.stringify({
  sessionId: 'gs2',
  updatedAt: '2026-10-03T00:00:30.000Z',
  session: { inputTokens: 500, outputTokens: 50, cachedReadTokens: 100, cacheCreationTokens: 0, reasoningTokens: 0, primaryModelId: 'grok-4.6-build' },
  turns: [],
}) + '\n');

const rows = collect();
const claude = rows.filter(row => row.provider === 'claude');
const codex = rows.filter(row => row.provider === 'codex');
const grok = rows.filter(row => row.provider === 'grok');

test('claude: duplicate message ids count once; <synthetic> and non-assistant lines are skipped', () => assert.equal(claude.length, 2));
test('claude: 5m and 1h cache writes are priced separately', () => {
  const r = claude[0];
  assert.equal(r.cache_write_5m, 500); assert.equal(r.cache_write_1h, 1500);
  const p = priceUsage(r.model, r, 'claude');
  const expected = (1000 * 4 + 500 * 20 + 10000 * 0.2 + 500 * 5 + 1500 * 8) / 1e6;
  assert.ok(Math.abs(p.cost - expected) < 1e-9, `${p.cost} vs ${expected}`);
});
test('claude: sidechain flag is kept', () => assert.equal(claude.filter(row => row.sidechain).length, 1));
test('codex: deltas of the running total, replay and archived copies de-duplicated', () => {
  assert.equal(codex.length, 3);
  assert.deepEqual(codex.map(row => row.input + row.cache_read), [1000, 2000, 500]);
});
test('codex: cached input is a subset (uncached = input - cached)', () => assert.deepEqual([codex[0].input, codex[0].cache_read], [200, 800]));
test('codex: model comes from turn_context', () => assert.equal(codex[0].model, 'gpt-5.3-codex'));
test('grok: turns[] emit one row each; empty turns fall back to session totals', () => {
  assert.equal(grok.length, 3);
  assert.deepEqual(grok.map(row => row.session), ['gs1', 'gs1', 'gs2']);
});
test('grok: cached input is a subset (uncached = input - cached - creation)', () => {
  assert.deepEqual([grok[0].input, grok[0].cache_read, grok[0].cache_write_5m, grok[0].output, grok[0].reasoning], [200, 800, 0, 100, 20]);
  assert.deepEqual([grok[1].input, grok[1].cache_read, grok[1].cache_write_5m], [700, 1200, 100]);
});
test('grok: model and project come from usage / summary (or decoded folder)', () => {
  assert.equal(grok[0].model, 'grok-4.7-build');
  assert.equal(grok[0].project, '/proj/g');
  assert.equal(grok[2].model, 'grok-4.6-build');
  assert.equal(grok[2].project, '/proj/h');
});
test('price: grok-4.7-build is priced (approx Fast/Build list)', () => {
  const p = priceUsage('grok-4.7-build', grok[0], 'grok');
  assert.equal(p.priced, true);
  assert.equal(p.approx, true);
  const expected = (200 * 4 + 100 * 12 + 800 * 1) / 1e6;
  assert.ok(Math.abs(p.cost - expected) < 1e-9, `${p.cost} vs ${expected}`);
});
test('price: an unknown model is UNPRICED, not $0', () => assert.equal(priceUsage('mystery-9', { input: 1e6 }, 'codex').priced, false));
test('price: gpt-5.6-sol is not mistaken for gpt-5', () => assert.equal(lookup('gpt-5.6-sol', 'codex'), null));
test('price: family fallback is flagged approximate', () => assert.equal(priceUsage('claude-sonnet-3-5', { input: 1e6 }, 'claude').approx, true));
test('price: credits and usd never merge', () => {
  const s = summarise([{ ...claude[0] }, { provider: 'codex', model: 'gpt-6-sol', ts: 1, session: 'z', input: 1e6, cache_read: 0, cache_write_5m: 0, cache_write_1h: 0, output: 0, reasoning: 0 }]);
  assert.ok(s.totals.usd > 0 && s.totals.credits === 50);
});
test('advise: sub-agent on a top tier reports a what-if saving; unpriced model is surfaced', () => {
  const big = { ...claude[1], input: 5e6, output: 5e6 };
  const f = advise([big, { ...big, model: 'mystery-9' }]);
  assert.ok(f.some(x => x.id.startsWith('subagents-') && x.saving > 1));
  assert.ok(f.some(x => x.id === 'unpriced'));
});
test('local: break-even busy fraction matches the cost curve', () => {
  const config = { wattsIdle: 80, wattsActive: 350, kwh: 0.15, hwPrice: 3000, lifeYears: 3, resale: 0.2, tokPerS: 80 };
  const b = breakEvenBusy(config, 2);
  assert.ok(Math.abs(localCost(config, b).perMtok - 2) < 1e-6);
  assert.equal(breakEvenBusy({ ...config, tokPerS: 0.1 }, 2), null);
});
test('openrouter: without --yes nothing is sent and no key is needed', () => {
  const r = spawnSync(process.execPath, [join(HERE, 'openrouter.mjs'), 'key'], { encoding: 'utf-8', env: { PATH: process.env.PATH } });
  assert.equal(r.status, 0); assert.match(r.stdout, /Nothing was sent/);
});
test('openrouter: a key in the environment is never echoed', () => {
  const r = spawnSync(process.execPath, [join(HERE, 'openrouter.mjs'), 'key'], { encoding: 'utf-8', env: { PATH: process.env.PATH, OPENROUTER_API_KEY: 'sk-or-SECRET123' } });
  assert.ok(!(r.stdout + r.stderr).includes('SECRET123'));
});

// ── Window and project filters, through the real script, on their own fixture logs.
const win = mkdtempSync(join(tmpdir(), 'ledger-window-'));
mkdirSync(join(win, 'claude', 'projects', 'q'), { recursive: true });
mkdirSync(join(win, 'codex'), { recursive: true });
mkdirSync(join(win, 'grok', 'sessions'), { recursive: true });
const at = (iso, id, cwd) => ({ type: 'assistant', sessionId: `s-${id}`, cwd, requestId: `r-${id}`, timestamp: iso, message: { id, role: 'assistant', model: 'claude-opus-5-5', usage: { input_tokens: 1000, output_tokens: 0 } } });
jsonl(join(win, 'claude', 'projects', 'q', 'w.jsonl'), [
  at('2026-10-01T00:00:00.000Z', 'before', '/proj/a'),
  at('2026-10-02T00:00:00.000Z', 'start', '/proj/a'), // exactly on --from: inclusive
  at('2026-10-02T12:00:00.000Z', 'sub', '/proj/a/sub'),
  at('2026-10-02T13:00:00.000Z', 'sibling', '/proj/ab'), // shares the prefix text, not the directory
  at('2026-10-02T14:00:00.000Z', 'other', '/proj/b'),
  at('2026-10-03T00:00:00.000Z', 'end', '/proj/a'), // exactly on --to: inclusive
  at('2026-10-04T00:00:00.000Z', 'after', '/proj/a'),
]);
const ledger = (...flags) => {
  const r = spawnSync(process.execPath, [join(HERE, 'ledger.mjs'), '--format', 'json', ...flags], { encoding: 'utf-8', env: { PATH: process.env.PATH, CLAUDE_CONFIG_DIR: join(win, 'claude'), CODEX_HOME: join(win, 'codex'), GROK_HOME: join(win, 'grok') } });

  return { ...r, json: r.status === 0 ? JSON.parse(r.stdout) : null };
};
const FROM = '2026-10-02T00:00:00Z';
const TO = '2026-10-03T00:00:00Z';

test('window: --from/--to keep rows inside the window, both ends inclusive, in every project', () => {
  const r = ledger('--from', FROM, '--to', TO);
  assert.equal(r.json.rows, 5);
  assert.deepEqual(r.json.window, { from: '2026-10-02T00:00:00.000Z', to: '2026-10-03T00:00:00.000Z', project: null });
});
test('window: a --from older than 7 days is honoured (it replaces the default look-back)', () => assert.equal(ledger('--from', '2026-10-01T00:00:00Z').json.rows, 7));
test('window: --project matches the path and its subdirectories, not a sibling sharing the prefix', () => {
  const r = ledger('--from', FROM, '--to', TO, '--project', '/proj/a');
  assert.equal(r.json.rows, 3); // start, sub, end — not /proj/ab, not /proj/b
  assert.equal(r.json.window.project, '/proj/a');
});
test('window: a trailing slash on --project is ignored; --project alone has no time limit', () => {
  assert.equal(ledger('--project', '/proj/a/').json.rows, 5);
  assert.equal(ledger('--project', '/proj/b').json.rows, 1);
});
test('window: the JSON keeps every existing field', () => {
  const r = ledger('--from', FROM, '--project', '/proj/a');
  for (const key of ['since', 'priceDate', 'totals', 'byProvider', 'byModel', 'byDay', 'unpriced', 'approx', 'cache', 'rows', 'tokens']) assert.ok(key in r.json, key);
});
test('window: without the flags the output has no window and counts every row', () => {
  const r = ledger('--since', 'all');
  assert.equal(r.json.rows, 7);
  assert.ok(!('window' in r.json));
});
test('window: an invalid ISO time, a missing value, or a relative path exits 2 with a message', () => {
  for (const flags of [['--from', 'yesterday'], ['--to', '5'], ['--from'], ['--project', 'proj/a'], ['--project', '/proj/../etc'], ['--from', TO, '--to', FROM]]) {
    const r = ledger(...flags);
    assert.equal(r.status, 2, flags.join(' '));
    assert.match(r.stderr, /^ledger: /, flags.join(' '));
  }
});

if (failed > 0) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');
