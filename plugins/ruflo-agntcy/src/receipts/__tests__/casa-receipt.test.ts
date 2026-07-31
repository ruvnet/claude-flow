import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, rmSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  appendCasaReceipt,
  loadOrCreateCasaSigningKeypair,
  signCasaReceipt,
  verifyCasaReceipt,
  DEFAULT_CASA_RECEIPT_PATH,
  type CasaReceiptInput,
  type SignedCasaReceipt,
} from '../casa-receipt.js';

describe('casa-receipt', () => {
  const tmpDirs: string[] = [];

  function makeTmpDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'casa-receipt-test-'));
    tmpDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  const sampleInput = (overrides: Partial<CasaReceiptInput> = {}): CasaReceiptInput => ({
    envelope: {
      objective: 'review repository security',
      allow: ['repository.read', 'tests.execute'],
      deny: ['git.push', 'secret.export', 'deployment.create'],
      budget_usd: 8,
      expires_at: '2026-07-30T22:00:00Z',
    },
    requestedAction: 'repository.read',
    decision: { allowed: true, reason: 'action is in allow list' },
    timestampIso: '2026-07-30T21:05:00.000Z',
    ...overrides,
  });

  it('exports the documented default receipt path', () => {
    expect(DEFAULT_CASA_RECEIPT_PATH).toBe(join('.swarm', 'casa-receipts.jsonl'));
  });

  it('appends a signed JSONL receipt to the given file path, and the signature verifies', async () => {
    const dir = makeTmpDir();
    const filePath = join(dir, 'nested', 'casa-receipts.jsonl');
    const input = sampleInput();

    await appendCasaReceipt(input, filePath);

    expect(existsSync(filePath)).toBe(true);
    const raw = readFileSync(filePath, 'utf-8');
    const lines = raw.split('\n').filter((l) => l.length > 0);
    expect(lines).toHaveLength(1);

    const record = JSON.parse(lines[0]) as SignedCasaReceipt;

    // JSON round-trips: every input field survives untouched.
    expect(record.envelope).toEqual(input.envelope);
    expect(record.requestedAction).toBe(input.requestedAction);
    expect(record.decision).toEqual(input.decision);
    expect(record.timestampIso).toBe(input.timestampIso);
    expect(record.schema).toBe('ruflo-agntcy-casa-receipt/v1');
    expect(record.publicKey).toMatch(/^ed25519:[0-9a-f]{64}$/);
    expect(record.signature).toMatch(/^[0-9a-f]{128}$/);

    // Signature must validate — self-embedded key (local inspection mode).
    await expect(verifyCasaReceipt(record)).resolves.toBe(true);
    // ...and pinning explicitly to the embedded public key must also pass.
    await expect(verifyCasaReceipt(record, record.publicKey)).resolves.toBe(true);
  });

  it('appends multiple receipts as separate JSON lines, each independently verifiable', async () => {
    const dir = makeTmpDir();
    const filePath = join(dir, 'casa-receipts.jsonl');

    await appendCasaReceipt(sampleInput({ requestedAction: 'repository.read' }), filePath);
    await appendCasaReceipt(
      sampleInput({
        requestedAction: 'git.push',
        decision: { allowed: false, reason: 'git.push is in the deny list' },
      }),
      filePath,
    );

    const lines = readFileSync(filePath, 'utf-8').split('\n').filter((l) => l.length > 0);
    expect(lines).toHaveLength(2);

    const records = lines.map((l) => JSON.parse(l) as SignedCasaReceipt);
    expect(records[0].decision.allowed).toBe(true);
    expect(records[1].decision.allowed).toBe(false);
    expect(records[1].decision.reason).toBe('git.push is in the deny list');

    for (const record of records) {
      await expect(verifyCasaReceipt(record)).resolves.toBe(true);
    }
  });

  it('rejects a tampered receipt body (decision flipped after signing)', async () => {
    const keypair = await loadOrCreateCasaSigningKeypair(join(makeTmpDir(), 'key.json'));
    const signed = await signCasaReceipt(sampleInput(), keypair);

    const tampered: SignedCasaReceipt = {
      ...signed,
      decision: { allowed: !signed.decision.allowed, reason: 'tampered' },
    };

    await expect(verifyCasaReceipt(tampered)).resolves.toBe(false);
  });

  it('rejects verification against an untrusted public key', async () => {
    const keypairA = await loadOrCreateCasaSigningKeypair(join(makeTmpDir(), 'key-a.json'));
    const keypairB = await loadOrCreateCasaSigningKeypair(join(makeTmpDir(), 'key-b.json'));

    const signed = await signCasaReceipt(sampleInput(), keypairA);

    await expect(verifyCasaReceipt(signed, `ed25519:${keypairB.publicKeyHex}`)).resolves.toBe(
      false,
    );
    // ...but pinning to the correct signer's key still passes.
    await expect(verifyCasaReceipt(signed, `ed25519:${keypairA.publicKeyHex}`)).resolves.toBe(
      true,
    );
  });

  it('loadOrCreateCasaSigningKeypair persists and reloads the same key material', async () => {
    const dir = makeTmpDir();
    const keyPath = join(dir, 'nested', 'key.json');

    const first = await loadOrCreateCasaSigningKeypair(keyPath);
    expect(existsSync(keyPath)).toBe(true);

    const second = await loadOrCreateCasaSigningKeypair(keyPath);
    expect(second.publicKeyHex).toBe(first.publicKeyHex);
    expect(Buffer.from(second.privateKey)).toEqual(Buffer.from(first.privateKey));
  });
});
