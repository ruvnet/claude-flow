import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { codexRows } from './_ledger.mjs';

const meta = id => ({ type: 'session_meta', payload: { id, cwd: `/project/${id}` } });
const context = id => ({ type: 'turn_context', payload: { thread_id: id, model: `model-${id}`, effort: 'high' } });
const usage = (second, input, output = 10) => ({
  timestamp: `2026-10-03T00:00:${String(second).padStart(2, '0')}.000Z`,
  type: 'event_msg',
  payload: { type: 'token_count', info: { total_token_usage: {
    input_tokens: input, cached_input_tokens: 0, output_tokens: output,
  } } },
});

function read(files, options) {
  const home = mkdtempSync(join(tmpdir(), 'codex-ledger-'));
  const previous = process.env.CODEX_HOME;
  try {
    process.env.CODEX_HOME = home;
    for (const [name, records] of Object.entries(files)) {
      const file = join(home, name);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, records.map(record => JSON.stringify(record)).join('\n') + '\n');
    }
    return [...codexRows(options)].sort((a, b) => a.ts - b.ts || a.session.localeCompare(b.session));
  } finally {
    if (previous === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previous;
    rmSync(home, { recursive: true, force: true });
  }
}

test('independent sessions retain identical timestamps and totals', () => {
  const rows = read({
    'sessions/rollout-a.jsonl': [meta('a'), context('a'), usage(1, 100)],
    'sessions/rollout-b.jsonl': [meta('b'), context('b'), usage(1, 100)],
  });
  assert.deepEqual(rows.map(row => row.session), ['a', 'b']);
  assert.equal(rows.reduce((sum, row) => sum + row.input + row.output, 0), 220);
});

for (const marker of [context('child'), ...['thread_settings_applied', 'task_started'].map(type => ({ type: 'event_msg', payload: { type, thread_id: 'child' } }))]) {
  test(`${marker.payload.type ?? marker.type} restores child ownership after copied metadata`, () => {
    const rows = read({ 'sessions/rollout-child.jsonl': [meta('child'), meta('parent'), context('parent'), marker, usage(2, 100)] });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].session, 'child');
    assert.equal(rows[0].project, '/project/child');
    assert.equal(rows[0].model, marker.type === 'turn_context' ? 'model-child' : 'unknown');
    assert.equal(rows[0].effort, marker.type === 'turn_context' ? 'high' : '');
  });
}

for (const childFirst of [false, true]) {
  test(`copied parent usage counts once with child read ${childFirst ? 'first' : 'last'}`, () => {
    const parent = [meta('parent'), context('parent'), usage(1, 100)];
    const child = [meta('child'), ...parent, context('child'), usage(2, 150, 20)];
    const rows = read({
      'sessions/rollout-a.jsonl': childFirst ? child : parent,
      'sessions/rollout-z.jsonl': childFirst ? parent : child,
    });
    assert.deepEqual(rows.map(row => [row.session, row.input, row.output, row.model, row.project]), [
      ['parent', 100, 10, 'model-parent', '/project/parent'],
      ['child', 50, 10, 'model-child', '/project/child'],
    ]);
  });
}

test('a replay before the time window still supplies the child delta baseline', () => {
  const rows = read({ 'sessions/rollout-child.jsonl': [
    meta('child'), meta('parent'), context('parent'), usage(1, 100), context('child'), usage(2, 150, 20),
  ] }, { sinceMs: Date.parse('2026-10-03T00:00:02.000Z') });
  assert.deepEqual(rows.map(row => [row.session, row.input, row.output]), [['child', 50, 10]]);
});

test('a thread reference in another event does not change usage ownership', () => {
  const rows = read({ 'sessions/rollout-child.jsonl': [
    meta('child'), context('child'),
    { type: 'event_msg', payload: { type: 'collab_agent_spawn_end', thread_id: 'other' } },
    usage(1, 100),
  ] });
  assert.equal(rows[0].session, 'child');
  assert.equal(rows[0].model, 'model-child');
});

test('repeated events and archived copies count once', () => {
  const records = [meta('a'), context('a'), usage(1, 100), usage(1, 100), usage(2, 150, 20)];
  const rows = read({
    'sessions/rollout-a.jsonl': records,
    'archived_sessions/rollout-a.jsonl': records,
    'sessions/rollout-copy.jsonl': records,
  });
  assert.deepEqual(rows.map(row => [row.input, row.output]), [[100, 10], [50, 10]]);
});

test('same-owner metadata and settings preserve the active model and effort', () => {
  const rows = read({ 'sessions/rollout-a.jsonl': [
    meta('a'), context('a'), usage(1, 100), meta('a'),
    { type: 'event_msg', payload: { type: 'thread_settings_applied', thread_id: 'a' } },
    usage(2, 150, 20),
  ] });
  assert.deepEqual(rows.map(row => [row.model, row.effort]), [['model-a', 'high'], ['model-a', 'high']]);
});

test('a child counter reset starts a fresh baseline', () => {
  const rows = read({ 'sessions/rollout-child.jsonl': [
    meta('child'), meta('parent'), context('parent'), usage(1, 1000, 100), context('child'), usage(2, 50, 5),
  ] });
  assert.deepEqual(rows.map(row => [row.session, row.input, row.output]), [['parent', 1000, 100], ['child', 50, 5]]);
});
