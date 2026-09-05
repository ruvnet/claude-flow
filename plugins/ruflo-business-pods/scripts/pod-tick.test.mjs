/**
 * pod-tick.mjs tests — uses Node's built-in test runner (no extra deps).
 * Run with: node --test scripts/pod-tick.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseArgs,
  validatePodTemplate,
  KNOWN_AGENT_TYPES,
  reserveBudget,
  commitReservation,
  pruneExpired,
  resetIfNewMonth,
  constructPrompt,
  publishEnvelope,
} from './pod-tick.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PLUGIN_ROOT = resolve(__dirname, '..');
const SALES_TEMPLATE = join(PLUGIN_ROOT, 'templates', 'sales.json');
const POD_TICK = join(__dirname, 'pod-tick.mjs');

function tmp(prefix = 'pod-tick-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

test('parseArgs — defaults: dryRun=true, live=false', () => {
  const a = parseArgs([]);
  assert.equal(a.dryRun, true);
  assert.equal(a.live, false);
  assert.equal(a.podTemplate, null);
});

test('parseArgs — --live flips dryRun off', () => {
  const a = parseArgs(['--live']);
  assert.equal(a.live, true);
  assert.equal(a.dryRun, false);
});

test('validatePodTemplate — sales.json validates verbatim', () => {
  const sales = JSON.parse(readFileSync(SALES_TEMPLATE, 'utf-8'));
  const t = validatePodTemplate(sales);
  assert.equal(t.name, 'sales');
  assert.equal(t.agents.length, 4);
  assert.equal(t.reservationExpiryMs, 60_000);
});

test('validatePodTemplate — reservationExpiryMs out of bounds rejected', () => {
  const sales = JSON.parse(readFileSync(SALES_TEMPLATE, 'utf-8'));
  sales.reservationExpiryMs = 1;
  assert.throws(() => validatePodTemplate(sales), /reservationExpiryMs must be within/);
});

test('KNOWN_AGENT_TYPES — every sales-pod agentType is registered', () => {
  const sales = JSON.parse(readFileSync(SALES_TEMPLATE, 'utf-8'));
  for (const a of sales.agents) {
    assert.ok(
      KNOWN_AGENT_TYPES.has(a.agentType),
      `agentType "${a.agentType}" not in KNOWN_AGENT_TYPES`,
    );
  }
});

test('reserveBudget/commit — happy path returns reservationId then commits', () => {
  let ledger = resetIfNewMonth({}, 'sales');
  ledger.monthlyCap = 50;
  const r = reserveBudget(ledger, 0.5, 60_000);
  assert.equal(r.ok, true);
  assert.ok(r.reservationId.startsWith('res-'));
  assert.equal(ledger.reserved, 0.5);
  const c = commitReservation(ledger, r.reservationId, 0); // dry-run actual = $0
  assert.equal(c.ok, true);
  assert.equal(ledger.reserved, 0);
  assert.equal(ledger.spent, 0);
});

test('reserveBudget — refuses when budget exhausted', () => {
  let ledger = resetIfNewMonth({}, 'sales');
  ledger.monthlyCap = 1;
  ledger.spent = 0.95;
  const r = reserveBudget(ledger, 0.5, 60_000);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'BUDGET_EXHAUSTED');
});

test('pruneExpired — releases reservations past their expiry', () => {
  let ledger = resetIfNewMonth({}, 'sales');
  ledger.monthlyCap = 50;
  reserveBudget(ledger, 1.0, 60_000);
  // Manually expire the only reservation by rewinding its expiresAtMs.
  ledger.reservations[0].expiresAtMs = Date.now() - 1000;
  ledger = pruneExpired(ledger, Date.now());
  assert.equal(ledger.reservations.length, 0);
  assert.equal(ledger.reserved, 0);
});

test('constructPrompt — includes role, bench description, PII policy', () => {
  const sales = JSON.parse(readFileSync(SALES_TEMPLATE, 'utf-8'));
  const t = validatePodTemplate(sales);
  const p = constructPrompt(t, t.agents[0]);
  assert.match(p, /lead-gen-agent/);
  assert.match(p, /researcher/);
  assert.match(p, /sales-pipeline-bench/);
  assert.match(p, /PII policy: soc2/);
});

test('publishEnvelope — appends a JSONL row to the room log', () => {
  const work = tmp();
  try {
    const env = publishEnvelope(work, 'sales', 'pod-status', { foo: 'bar' });
    assert.ok(env.envelopeId);
    assert.equal(env.msgType, 'pod-status');
    // The room log path uses a derived roomId — find it by listing the dir.
    const fs = readFileSync(join(work, '.agentbbs', `room-${env.roomId}.jsonl`), 'utf-8');
    const parsed = JSON.parse(fs.trim().split('\n')[0]);
    assert.equal(parsed.msgType, 'pod-status');
    assert.deepEqual(parsed.payload, { foo: 'bar' });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test('CLI: dry-run on sales.json exits 0 with expected stdout shape', () => {
  const work = tmp();
  try {
    const res = spawnSync('node', [
      POD_TICK,
      '--pod-template', SALES_TEMPLATE,
      '--base-path', work,
      '--dry-run',
      '--tick-id', 'test-tick-1',
    ], { encoding: 'utf-8' });
    assert.equal(res.status, 0, `non-zero exit: stderr=${res.stderr}`);
    const out = JSON.parse(res.stdout.trim().split('\n').pop());
    assert.equal(out.podName, 'sales');
    assert.equal(out.tickId, 'test-tick-1');
    assert.equal(out.agentsRan, 4);
    assert.equal(out.totalUsd, 0);
    assert.equal(out.status, 'success');
    assert.equal(out.dryRun, true);
    assert.ok(out.envelopeId);

    // Dry-run prompts are logged to stderr, one per agent
    assert.match(res.stderr, /lead-gen-agent/);
    assert.match(res.stderr, /pipeline-analyst/);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test('CLI: --live exits 3 with refusal message (Phase 2 gate)', () => {
  const work = tmp();
  try {
    const res = spawnSync('node', [
      POD_TICK,
      '--pod-template', SALES_TEMPLATE,
      '--base-path', work,
      '--live',
    ], { encoding: 'utf-8' });
    assert.equal(res.status, 3);
    assert.match(res.stderr, /Phase 3/);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test('CLI: unknown agent type produces actionable error', () => {
  const work = tmp();
  try {
    const badTemplate = JSON.parse(readFileSync(SALES_TEMPLATE, 'utf-8'));
    badTemplate.agents[0].agentType = 'not-a-real-agent-xyz';
    const badPath = join(work, 'bad-sales.json');
    writeFileSync(badPath, JSON.stringify(badTemplate));
    const res = spawnSync('node', [
      POD_TICK,
      '--pod-template', badPath,
      '--base-path', work,
      '--dry-run',
    ], { encoding: 'utf-8' });
    assert.equal(res.status, 2);
    assert.match(res.stderr, /unknown agent types.*not-a-real-agent-xyz/);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test('CLI: budget reservation creates ledger and commits to $0 on dry-run', () => {
  const work = tmp();
  try {
    const res = spawnSync('node', [
      POD_TICK,
      '--pod-template', SALES_TEMPLATE,
      '--base-path', work,
      '--dry-run',
    ], { encoding: 'utf-8' });
    assert.equal(res.status, 0);
    const ledgerPath = join(work, 'budget', 'sales.json');
    assert.ok(existsSync(ledgerPath), 'budget ledger should exist');
    const ledger = JSON.parse(readFileSync(ledgerPath, 'utf-8'));
    assert.equal(ledger.roomId, 'sales');
    assert.equal(ledger.spent, 0); // dry-run actual = $0
    assert.equal(ledger.reserved, 0); // reservation committed and released
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

// ADR-164 Phase 3 — every additional pod template (marketing/finance/ops/
// support/hr/exec) must validate and produce a successful dry-run tick. The
// existing sales template is covered by 'CLI: dry-run on sales.json' above;
// this loop covers the new six.
const PHASE3_PODS = ['marketing', 'finance', 'ops', 'support', 'hr', 'exec'];
for (const pod of PHASE3_PODS) {
  test(`Phase 3: ${pod}.json validates and dry-runs cleanly`, () => {
    const podPath = join(PLUGIN_ROOT, 'templates', `${pod}.json`);
    // schema validation first
    const raw = JSON.parse(readFileSync(podPath, 'utf-8'));
    const t = validatePodTemplate(raw);
    assert.equal(t.name, pod);
    // every agentType must be in the registry — pod-tick.mjs hard-checks this
    for (const a of t.agents) {
      assert.ok(
        KNOWN_AGENT_TYPES.has(a.agentType),
        `${pod}.json agentType "${a.agentType}" not in KNOWN_AGENT_TYPES`,
      );
    }
    // dry-run the tick end-to-end
    const work = tmp(`pod-tick-${pod}-`);
    try {
      const res = spawnSync('node', [
        POD_TICK,
        '--pod-template', podPath,
        '--base-path', work,
        '--dry-run',
        '--tick-id', `phase3-${pod}-tick`,
      ], { encoding: 'utf-8' });
      assert.equal(res.status, 0, `non-zero exit for ${pod}: stderr=${res.stderr}`);
      const out = JSON.parse(res.stdout.trim().split('\n').pop());
      assert.equal(out.podName, pod);
      assert.equal(out.tickId, `phase3-${pod}-tick`);
      assert.equal(out.agentsRan, t.agents.length);
      assert.equal(out.totalUsd, 0); // dry-run actual = $0
      assert.equal(out.status, 'success');
      assert.equal(out.dryRun, true);
      assert.ok(out.envelopeId);
      // envelope JSONL exists
      const ledgerPath = join(work, 'budget', `${t.roomId}.json`);
      assert.ok(existsSync(ledgerPath), `${pod} ledger should exist`);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });
}

test('CLI: envelope is written to room JSONL backing store', async () => {
  const work = tmp();
  try {
    const res = spawnSync('node', [
      POD_TICK,
      '--pod-template', SALES_TEMPLATE,
      '--base-path', work,
      '--dry-run',
    ], { encoding: 'utf-8' });
    assert.equal(res.status, 0);
    const out = JSON.parse(res.stdout.trim().split('\n').pop());
    // Find the JSONL log produced by publishEnvelope
    const { readdirSync } = await import('node:fs');
    const agentbbsDir = join(work, '.agentbbs');
    const files = readdirSync(agentbbsDir);
    const log = files.find((f) => f.startsWith('room-') && f.endsWith('.jsonl'));
    assert.ok(log, `expected room jsonl file in ${agentbbsDir}`);
    const lines = readFileSync(join(agentbbsDir, log), 'utf-8').trim().split('\n');
    const last = JSON.parse(lines[lines.length - 1]);
    assert.equal(last.envelopeId, out.envelopeId);
    assert.equal(last.msgType, 'pod-status');
    assert.equal(last.payload.podName, 'sales');
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
