#!/usr/bin/env node
/**
 * Loop checkpoint — tiny durable state for autonomous /loop iterations.
 *
 * Usage:
 *   node scripts/loop-checkpoint.mjs read
 *   node scripts/loop-checkpoint.mjs write --iteration N --done-criteria "<cmd>" --next "<step>" --blockers "<or empty>"
 *   node scripts/loop-checkpoint.mjs check
 *
 * Exit codes for `check`:
 *   0 — progress made, keep going
 *   3 — DONE (done-criteria command exits 0) — stop and report
 *   4 — NO-PROGRESS (2 strikes on the same `next`) — stop, state blocker
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const stateDir = resolve(repoRoot, '.ruvnet-brain');
const stateFile = resolve(stateDir, 'checkpoint.json');

function readState() {
  if (!existsSync(stateFile)) return null;
  try { return JSON.parse(readFileSync(stateFile, 'utf-8')); } catch { return null; }
}

function writeState(state) {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf-8');
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { out[argv[i].slice(2)] = argv[i + 1]; i++; }
  }
  return out;
}

const [, , cmd, ...rest] = process.argv;

if (cmd === 'read') {
  const state = readState();
  if (!state) { console.log('(no checkpoint)'); process.exit(0); }
  console.log(JSON.stringify(state, null, 2));
  process.exit(0);
}

if (cmd === 'write') {
  const args = parseArgs(rest);
  const prev = readState() || { history: [] };
  const state = {
    iteration: Number(args.iteration ?? (prev.iteration ?? 0) + 1),
    doneCriteria: args['done-criteria'] ?? prev.doneCriteria ?? '',
    next: args.next ?? '',
    blockers: args.blockers ?? '',
    lastNext: prev.next ?? '',
    stalledOnSameNextCount: (prev.next && args.next === prev.next) ? (prev.stalledOnSameNextCount ?? 0) + 1 : 0,
    updatedAt: new Date().toISOString(),
    history: [...(prev.history ?? []).slice(-9), { iteration: prev.iteration, next: prev.next, at: prev.updatedAt }],
  };
  writeState(state);
  console.log(`checkpoint written · iter=${state.iteration} · stalledOnSameNextCount=${state.stalledOnSameNextCount}`);
  process.exit(0);
}

if (cmd === 'check') {
  const state = readState();
  if (!state) { console.error('no checkpoint — nothing to check'); process.exit(0); }
  if (state.doneCriteria) {
    try {
      execSync(state.doneCriteria, { stdio: 'ignore', shell: '/bin/bash' });
      console.log(`DONE — done-criteria satisfied: ${state.doneCriteria}`);
      process.exit(3);
    } catch { /* not done yet */ }
  }
  if ((state.stalledOnSameNextCount ?? 0) >= 2) {
    console.error(`NO-PROGRESS — same next repeated ${state.stalledOnSameNextCount} times: ${state.next}`);
    console.error(`Blockers: ${state.blockers || '(none stated)'}`);
    process.exit(4);
  }
  console.log(`ok — iter=${state.iteration} · next="${state.next}"`);
  process.exit(0);
}

console.error(`unknown command: ${cmd}. Use: read | write | check`);
process.exit(1);
