#!/usr/bin/env node
// Runs the built viewer in child processes with synthetic logs; no model calls.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const cli = fileURLToPath(new URL('../v3/@claude-flow/codex/dist/cli.js', import.meta.url));
const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'ruflo-activity-smoke-')));
const parent = path.join(directory, 'parent.jsonl');
const child = path.join(directory, 'child.jsonl');
const row = (type, payload) => JSON.stringify({ type, timestamp: '2026-10-09T00:00:00Z', payload });
const args = ['activity', '--session-file', parent, '--sessions-dir', directory];
function run(extra) {
  return spawnSync(process.execPath, [cli, ...args, ...extra], {
    encoding: 'utf8', timeout: 15000, env: { ...process.env, NO_COLOR: '1' },
  });
}
try {
  await writeFile(parent, row('session_meta', { id: 'root', source: 'cli' }) + '\n');
  await writeFile(child, [
    row('session_meta', { id: 'child', agent_path: '/root/parser-review', source: {
      subagent: { thread_spawn: { parent_thread_id: 'root' } },
    } }),
    row('response_item', { type: 'message', role: 'user', content: 'INHERITED_PRIVATE_SENTINEL' }),
    row('event_msg', { type: 'thread_settings_applied', thread_id: 'child' }),
    row('response_item', { type: 'message', role: 'user', content: 'Check parser fixtures' }),
    row('response_item', { type: 'message', role: 'assistant', phase: 'analysis', content: 'REASONING_SENTINEL' }),
    row('response_item', { type: 'function_call', name: 'exec_command', call_id: 'one', arguments: '{"cmd":"npm test"}' }),
    row('response_item', { type: 'function_call_output', call_id: 'one', output: { exit_code: 0, output: 'SYNTHETIC_TEST_PASS' } }),
    row('event_msg', { type: 'task_complete' }),
  ].join('\n') + '\n');
  const originals = await Promise.all([readFile(parent), readFile(child)]);
  const list = run(['--once']);
  assert.equal(list.status, 0, list.stderr);
  assert.match(list.stdout, /parser-review/);
  const detail = run(['--once', '--agent', 'child']);
  assert.equal(detail.status, 0, detail.stderr);
  assert.match(detail.stdout, /Check parser fixtures/);
  assert.match(detail.stdout, /npm test/);
  assert.match(detail.stdout, /SYNTHETIC_TEST_PASS/);
  assert.doesNotMatch(detail.stdout, /INHERITED_PRIVATE_SENTINEL|REASONING_SENTINEL/);
  assert.equal(run(['--once', '--agent', 'unrelated']).status, 1);
  assert.equal(run(['--once', '--interval', '0']).status, 1);
  const nonTTY = run([]);
  assert.equal(nonTTY.status, 1);
  assert.match(nonTTY.stderr, /Use --once/);
  assert.deepEqual(await readFile(parent), originals[0]);
  assert.deepEqual(await readFile(child), originals[1]);
  const oversized = row('session_meta', { id: 'HEADER_SENTINEL', source: 'cli' })
    .padEnd(64 * 1024 + 1, ' ') + '\n';
  await writeFile(parent, oversized);
  const rejected = run(['--once']);
  assert.equal(rejected.status, 1);
  assert.doesNotMatch(rejected.stdout + rejected.stderr, /HEADER_SENTINEL|SYNTHETIC_TEST_PASS/);
  assert.equal(await readFile(parent, 'utf8'), oversized);
  console.log('Codex activity smoke passed: picker, detail, isolation, invalid input, non-TTY, read-only files, oversized metadata.');
} finally {
  await rm(directory, { recursive: true, force: true });
}
