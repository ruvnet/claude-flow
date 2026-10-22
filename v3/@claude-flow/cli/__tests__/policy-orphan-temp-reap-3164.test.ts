import './helpers/isolated-policy-trust.js';
/**
 * #3164: `writeJsonAtomic` writes `<file>.<pid>.<uuid>.tmp` and renames it over
 * the target. A writer killed between the two (SIGKILL from a caller's
 * timeout, OOM) never reaches its `finally` cleanup, so a full-size copy of
 * state.json or ledger-anchors.json stays in the policy directory forever.
 * On a mature ledger each one is ~250 MB.
 *
 * Every writer of these files holds the project's state.lock, so a
 * transaction or verify that holds the lock may remove temp files of exactly
 * those names. It must leave everything else alone: temps younger than the
 * 10-minute floor, temps whose writer pid is alive, other files' temps,
 * symlinks, and names that only look similar.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { verifyPolicyLedger, withPolicyTransaction } from '../src/services/policy-runtime.js';
import { policyTrustRoot } from '../src/services/policy-ledger-anchor.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'ruflo-policy-orphan-temp-'));
  roots.push(root);
  mkdirSync(join(root, '.claude-flow'), { recursive: true });
  return root;
}

function aged(file: string, contents = 'partial', ageMs = 60 * 60_000): string {
  writeFileSync(file, contents);
  const then = (Date.now() - ageMs) / 1000;
  utimesSync(file, then, then);
  return file;
}

const temp = (base: string, pid = 999_999): string => `${base}.${pid}.${randomUUID()}.tmp`;

async function transact(root: string): Promise<void> {
  await withPolicyTransaction(root, (engine) => engine.setConfiguredMode('legacy'));
}

describe('#3164 orphaned atomic-write temp files', () => {
  it('removes aged state.json and ledger-anchors.json temps in the policy directory', async () => {
    const root = project();
    await transact(root);
    const dir = join(root, '.claude-flow', 'policy');
    const orphans = [
      aged(join(dir, temp('state.json'))),
      aged(join(dir, temp('state.json', 999_998))),
      aged(join(dir, temp('ledger-anchors.json'))),
    ];

    await transact(root);

    for (const file of orphans) expect(existsSync(file), file).toBe(false);
    expect((await verifyPolicyLedger(root)).valid).toBe(true);
  });

  it('removes aged anchor and mirror temps in the project trust directory', async () => {
    const root = project();
    await transact(root);
    const id = createHash('sha256').update(realpathSync(root)).digest('hex');
    const trustDir = join(policyTrustRoot(), id);
    mkdirSync(trustDir, { recursive: true });
    const orphans = [
      aged(join(trustDir, temp('state.anchor.json'))),
      aged(join(trustDir, temp('ledger-anchor-head.json'))),
    ];

    await transact(root);

    for (const file of orphans) expect(existsSync(file), file).toBe(false);
  });

  it('keeps fresh temps, unrelated files, look-alikes and symlinks', async () => {
    const root = project();
    await transact(root);
    const dir = join(root, '.claude-flow', 'policy');
    const target = aged(join(root, 'outside.txt'), 'must survive');
    const link = join(dir, temp('state.json'));
    symlinkSync(target, link);
    const kept = [
      aged(join(dir, temp('state.json')), 'in flight', 1_000),
      aged(join(dir, temp('state.json')), 'suspended writer', 5 * 60_000),
      aged(join(dir, temp('state.json', process.pid)), 'live writer'),
      aged(join(dir, temp('ledger-anchors.json', process.pid)), 'live writer'),
      aged(join(dir, temp('receipts.ledger.jsonl'))),
      aged(join(dir, temp('other.json'))),
      aged(join(dir, 'state.json.tmp')),
      aged(join(dir, 'state.json.123.not-a-uuid.tmp')),
      aged(join(dir, `state.json.123.${randomUUID()}.tmp.bak`)),
      aged(join(dir, `xstate.json.123.${randomUUID()}.tmp`)),
    ];

    await transact(root);

    for (const file of kept) expect(existsSync(file), file).toBe(true);
    expect(existsSync(link)).toBe(true);
    expect(existsSync(target)).toBe(true);
  });

  it('skips a directory with a temp-like name without failing the transaction', async () => {
    const root = project();
    await transact(root);
    const dir = join(root, '.claude-flow', 'policy', temp('state.json'));
    mkdirSync(dir);
    const then = (Date.now() - 60 * 60_000) / 1000;
    utimesSync(dir, then, then);

    await expect(transact(root)).resolves.toBeUndefined();
    expect(existsSync(dir)).toBe(true);
    expect((await verifyPolicyLedger(root)).valid).toBe(true);
  });

  it('removes orphans during a verify that holds the lock, without a transaction', async () => {
    const root = project();
    await transact(root);
    const orphan = aged(join(root, '.claude-flow', 'policy', temp('state.json')));

    expect((await verifyPolicyLedger(root)).valid).toBe(true);

    expect(existsSync(orphan)).toBe(false);
  });
});
