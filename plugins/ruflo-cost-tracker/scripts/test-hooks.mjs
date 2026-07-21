#!/usr/bin/env node
/**
 * Regression guard for ruvnet/ruflo#2721.
 *
 * Drives the Stop hook command from `hooks/hooks.json` exactly as Claude
 * Code/Codex would — `spawnSync(command, { shell: true, ... })`, no bash
 * wrapper of our own — asserting it exits 0 on every OS without requiring
 * bash. Before #2721 the command hard-coded `/bin/bash -c '...'`, which
 * fails outright on native Windows.
 *
 * TRACK_CWD points at a throwaway directory with no session jsonl files,
 * so track.mjs takes its fast no-op path instead of scanning/touching a
 * real ~/.claude/projects session — this is a hook-wiring smoke, not a
 * cost-tracking behavior test.
 *
 * Usage (from repo root):
 *   node plugins/ruflo-cost-tracker/scripts/test-hooks.mjs
 *
 * Wired into .github/workflows/v3-ci.yml as part of the `plugin-hooks-smoke`
 * job (windows-latest, macos-latest, ubuntu-latest).
 */

import { readFileSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = join(__dirname, '..');
const HOOKS_JSON = join(PLUGIN_ROOT, 'hooks', 'hooks.json');

const hooks = JSON.parse(readFileSync(HOOKS_JSON, 'utf8'));
const cmdStop = hooks.hooks?.Stop?.[0]?.hooks?.[0]?.command;
if (!cmdStop) throw new Error('No Stop hook found in hooks.json');

const scratchCwd = mkdtempSync(join(tmpdir(), 'ruflo-cost-tracker-smoke-'));

let failed = 0;
const cases = [];

const run = (name, stdin) => {
  const r = spawnSync(cmdStop, {
    shell: true,
    input: stdin,
    encoding: 'utf8',
    env: {
      ...process.env,
      CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT,
      TRACK_CWD: scratchCwd,
      TRACK_DRY_RUN: '1',
    },
    timeout: 15_000,
  });
  const errors = [];
  if (r.error) errors.push(`spawn error: ${r.error.message}`);
  if (r.status !== 0) errors.push(`exit ${r.status} (expected 0)`);
  if (errors.length === 0) {
    console.log(`ok: ${name}`);
  } else {
    console.error(`FAIL: ${name}`);
    for (const e of errors) console.error(`     - ${e}`);
    const combined = (r.stdout ?? '') + (r.stderr ?? '');
    if (combined.trim()) {
      console.error('     output:');
      for (const line of combined.split('\n').slice(0, 8)) console.error(`       ${line}`);
    }
    failed++;
  }
  cases.push(name);
};

run('Stop hook exits 0 with valid stdin', '{"session_id":"test"}');
run('Stop hook exits 0 with empty stdin', '');
run('Stop hook exits 0 with malformed stdin', '{not json');

console.log(`\n${cases.length - failed}/${cases.length} passed`);
process.exit(failed === 0 ? 0 : 1);
