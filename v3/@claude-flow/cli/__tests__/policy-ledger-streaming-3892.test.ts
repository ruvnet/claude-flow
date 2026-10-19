import './helpers/isolated-policy-trust.js';
import { afterEach, describe, expect, it } from 'vitest';
import { appendFileSync, closeSync, ftruncateSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgenticPolicyEngine, policyHash, type PolicyReceipt, type PolicyState } from '@claude-flow/security';
import { ATOMIC_JSON_WRITER, anchorEntries } from '../src/services/policy-anchor-log.js';
import { assessAnchors, recordAnchor } from '../src/services/policy-ledger-anchor.js';
import { autoMigratePolicyStateIfNeeded, evaluatePolicyRequest, verifyPolicyLedger } from '../src/services/policy-runtime.js';
import { captureArchiveSnapshot, verifyFullPolicyLedger } from '../src/services/policy-ledger-audit.js';

const scratch: string[] = [];
const originalXdg = process.env.XDG_CONFIG_HOME;
function fixture(options: { signed?: boolean; count?: number; retain?: number } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ruflo-stream-test-')); scratch.push(dir);
  const engineOptions = options.signed ? { signingKey: 'disposable-streaming-key', keyId: 'stream-test' } : {};
  const engine = new AgenticPolicyEngine({ ...engineOptions, now: () => 1000 });
  for (let i = 0; i < (options.count ?? 8); i++) engine.evaluate({ identity: { id: `agent:${i}`, type: 'agent' }, action: { type: 'code.read', resource: `café-🙂-${i}` } });
  const archive = engine.pruneReceipts(options.retain ?? 2);
  const state = engine.exportState(); const file = join(dir, 'receipts.jsonl');
  writeFileSync(file, `${archive.map(receipt => JSON.stringify(receipt)).join('\n')}\n`);
  return { dir, file, archive, state, engineOptions };
}
async function audit(file: string, state: PolicyState, engineOptions: { signingKey?: string; keyId?: string } = {}) {
  const snapshot = captureArchiveSnapshot(file);
  try { return await verifyFullPolicyLedger(snapshot, state, engineOptions); }
  finally { if (snapshot) closeSync(snapshot.fd); }
}
afterEach(() => { for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true }); delete process.env.CLAUDE_FLOW_POLICY_AUDIT_MAX_RECORD_BYTES; delete process.env.CLAUDE_FLOW_POLICY_LEDGER_RETENTION;
  if (originalXdg === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = originalXdg; });

describe('bounded full ledger replay', () => {
  it('replays arbitrary physical order and exact duplicates without a history-sized receipt map', async () => {
    const f = fixture({ signed: true });
    writeFileSync(f.file, `${[...f.archive].reverse().concat([f.archive[0], f.archive[3], f.state.receipts[0]]).map(record => JSON.stringify(record)).join('\n')}\n`);
    expect(await audit(f.file, f.state, f.engineOptions)).toEqual({ valid: true, length: 8 });
  });
  it('compares full canonical records even when a duplicate keeps the same valid payload/signature', async () => {
    const f = fixture({ signed: true });
    appendFileSync(f.file, `${JSON.stringify({ ...f.archive[0], untrustedExtra: true })}\n`);
    expect(await audit(f.file, f.state, f.engineOptions)).toMatchObject({ valid: false, error: 'policy-ledger-archive-conflict' });
  });
  it('authenticates and dedupes valid huge-sequence extras without huge sparse index offsets', async () => {
    const f = fixture(); const original = f.archive[0];
    const { receiptId, ...unsigned } = original.payload; unsigned.sequence = Number.MAX_SAFE_INTEGER;
    const payload = { ...unsigned, receiptId: policyHash(unsigned) }; const extra = { payload, hash: policyHash(payload) };
    appendFileSync(f.file, `${JSON.stringify(extra)}\n${JSON.stringify(extra)}\n`);
    expect(await audit(f.file, f.state)).toEqual({ valid: true, length: 8 });
    appendFileSync(f.file, `${JSON.stringify({ ...extra, untrustedExtra: true })}\n`);
    expect(await audit(f.file, f.state)).toMatchObject({ valid: false, error: 'policy-ledger-archive-conflict' });
  });
  it('compares canonical staging duplicates even when finite exponent numbers expand during canonicalization', async () => {
    const f = fixture(); process.env.CLAUDE_FLOW_POLICY_AUDIT_MAX_RECORD_BYTES = '11000';
    const { receiptId, ...unsigned } = f.archive[0].payload; unsigned.sequence = 8;
    const payload = { ...unsigned, receiptId: policyHash(unsigned) }; const extra = { payload, hash: policyHash(payload), metadata: Array(2000).fill(1e20) };
    const compact = JSON.stringify(extra).replaceAll('100000000000000000000', '1e20');
    expect(Buffer.byteLength(compact)).toBeLessThan(11000);
    expect(Buffer.byteLength(JSON.stringify(extra))).toBeGreaterThan(44000);
    appendFileSync(f.file, `${compact}\n${compact}\n`);
    expect(await audit(f.file, f.state)).toEqual({ valid: true, length: 8 });
  });
  it('checks hot overlaps and malformed staging records even with retainedFrom=0', async () => {
    const f = fixture({ count: 2, retain: 2, signed: true });
    writeFileSync(f.file, `${JSON.stringify(f.state.receipts[0])}\nnull\n`);
    expect(await audit(f.file, f.state, f.engineOptions)).toMatchObject({ valid: false, error: 'policy-ledger-archive-conflict' });
  });
  it('fails on a missing claimed sequence and on a broken previous-hash link', async () => {
    const f = fixture();
    writeFileSync(f.file, `${f.archive.filter(receipt => receipt.payload.sequence !== 2).map(receipt => JSON.stringify(receipt)).join('\n')}\n`);
    expect(await audit(f.file, f.state)).toMatchObject({ valid: false, error: 'policy-ledger-archive-gap' });
    const { receiptId, ...unsigned } = f.archive[2].payload; unsigned.previousReceiptHash = `sha256:${'0'.repeat(64)}`;
    const payload = { ...unsigned, receiptId: policyHash(unsigned) }; const broken = { payload, hash: policyHash(payload) };
    writeFileSync(f.file, `${f.archive.map(receipt => JSON.stringify(receipt.payload.sequence === 2 ? broken : receipt)).join('\n')}\n`);
    expect(await audit(f.file, f.state)).toMatchObject({ valid: false, error: 'receipt-chain-mismatch' });
  });
  it('does not read subsequent appends beyond the captured byte boundary', async () => {
    const f = fixture(); const snapshot = captureArchiveSnapshot(f.file)!;
    appendFileSync(f.file, 'null\n');
    try { expect(await verifyFullPolicyLedger(snapshot, f.state, {})).toEqual({ valid: true, length: 8 }); }
    finally { closeSync(snapshot.fd); }
    expect(await audit(f.file, f.state)).toMatchObject({ valid: false, error: 'policy-ledger-archive-conflict' });
  });
  it('fails cleanly on truncation after capture', async () => {
    const f = fixture(); const snapshot = captureArchiveSnapshot(f.file)!; writeFileSync(f.file, '');
    try { expect(await verifyFullPolicyLedger(snapshot, f.state, {})).toMatchObject({ valid: false, error: 'policy-ledger-archive-changed' }); }
    finally { closeSync(snapshot.fd); }
  });
  it.each(['{"torn":', 'null', '{}'])('requires the snapshot to end with a complete newline-delimited record (%s)', async suffix => {
    const f = fixture(); appendFileSync(f.file, suffix);
    expect(await audit(f.file, f.state)).toMatchObject({ valid: false, error: 'policy-ledger-archive-parse-error' });
  });
  it('rejects malformed UTF8 explicitly instead of replacing bytes', async () => {
    const f = fixture(); appendFileSync(f.file, Buffer.from([0xff, 10]));
    expect(await audit(f.file, f.state)).toMatchObject({ valid: false, error: 'policy-ledger-archive-utf8-error' });
  });
  it('handles multibyte UTF8 split across the 64KiB read boundary', async () => {
    const f = fixture(); const receipt = f.archive[0];
    const base = Buffer.from(JSON.stringify({ padding: '', ...receipt }));
    const padding = 'x'.repeat(65536 - base.indexOf(Buffer.from('é')) - 1);
    const record = { padding, ...receipt };
    const bytes = Buffer.from(`${JSON.stringify(record)}\n`);
    expect(bytes.indexOf(Buffer.from('é'))).toBe(65535);
    writeFileSync(f.file, Buffer.concat([bytes, Buffer.from(`${f.archive.slice(1).map(receipt => JSON.stringify(receipt)).join('\n')}\n`)]));
    expect(await audit(f.file, f.state)).toEqual({ valid: true, length: 8 });
  });
  it('reports the configured record-byte limit without skipping or changing ledger bytes', async () => {
    const f = fixture(); process.env.CLAUDE_FLOW_POLICY_AUDIT_MAX_RECORD_BYTES = '1024';
    const first = { ...f.archive[0], padding: 'x'.repeat(2048) };
    writeFileSync(f.file, `${[first, ...f.archive.slice(1)].map(record => JSON.stringify(record)).join('\n')}\n`);
    const before = readFileSync(f.file);
    expect(await audit(f.file, f.state)).toMatchObject({ valid: false, error: 'policy-ledger-archive-record-too-large:1024' });
    expect(readFileSync(f.file)).toEqual(before);
  });
  it('rejects an invalid limit and unsafe claimed state length before indexing', async () => {
    const f = fixture(); process.env.CLAUDE_FLOW_POLICY_AUDIT_MAX_RECORD_BYTES = 'Infinity';
    expect(await audit(f.file, f.state)).toMatchObject({ valid: false, error: 'policy-ledger-audit-invalid-record-limit' });
    delete process.env.CLAUDE_FLOW_POLICY_AUDIT_MAX_RECORD_BYTES;
    expect(await audit(f.file, { ...f.state, retainedFrom: Number.MAX_SAFE_INTEGER })).toMatchObject({ valid: false, error: 'policy-ledger-archive-gap' });
  });
});

describe('policy state format 2 writer fence', () => {
  it('accepts version 1 history and migrates rules/budgets/approvals/usage/receipt bytes without re-signing', () => {
    const f = fixture({ signed: true }); const old = { ...f.state, version: 1 };
    const migrated = AgenticPolicyEngine.fromState(old, f.engineOptions).exportState();
    expect(migrated.version).toBe(2);
    for (const field of ['rules', 'budgets', 'approvals', 'usage', 'receipts', 'retainedFrom', 'prunedHead', 'ledgerHead', 'ledgerLength'] as const) expect(migrated[field]).toEqual(old[field]);
    expect(AgenticPolicyEngine.fromState(migrated, f.engineOptions).verifyLedger()).toEqual({ valid: true, length: 8 });
  });
  it('rejects unknown future versions instead of silently downgrading', () => {
    const f = fixture(); expect(() => AgenticPolicyEngine.fromState({ ...f.state, version: 3 })).toThrow('unsupported-policy-state-version:3');
  });
});


describe('legacy anchor JSON streaming contract', () => {
  it('preserves property order, escaped strings, nested values and unknown valid root fields', () => {
    const f = fixture(); const entries = [{ text: 'quotes " and backslash \\ and { [ café 🙂', nested: { values: [1, 'two', true] } }];
    const value = { metadata: { ignored: [false, null] }, entries, version: 1 };
    writeFileSync(f.file, JSON.stringify(value, null, 2)); expect([...anchorEntries(f.file)]).toEqual(entries);
  });
  it.each([
    '{"version":1,"version":1,"entries":[]}', '{"version":1,"entries":[],"entries":[]}',
    '{"version":1,"entries":[{}', '{"version":1,"entries":[{},]}', '{"version":1,"entries":[]}true',
    '{"version":2,"entries":[]}', '{"version":1,"entries":null}', '{"version":1,"entries":[],"unknown":[1,]}',
    '{\u00a0"version":1,"entries":[]}', '{"version":1,"entries":[]}\u00a0',
  ])('rejects malformed/ambiguous legacy anchor JSON (%s)', text => {
    const f = fixture(); writeFileSync(f.file, text); expect(() => [...anchorEntries(f.file)]).toThrow();
  });
  it('binds reused assessments to exact source count and tip before publishing', async () => {
    const f = fixture({ retain: 8 }); process.env.XDG_CONFIG_HOME = join(f.dir, 'scratch-home');
    mkdirSync(join(process.env.XDG_CONFIG_HOME, 'ruflo', 'policy-trust'), { recursive: true });
    const write = async (file: string, value: unknown) => { mkdirSync(join(file, '..'), { recursive: true }); writeFileSync(file, JSON.stringify(value)); };
    await recordAnchor(f.dir, f.state, write);
    const assessed = assessAnchors(f.dir, f.state); expect(assessed.kind).toBe('ok');
    if (assessed.kind !== 'ok') throw new Error('assessment required');
    const engine = AgenticPolicyEngine.fromState(f.state); engine.evaluate({ identity: { id: 'new', type: 'agent' }, action: { type: 'code.read' } });
    await recordAnchor(f.dir, engine.exportState(), write);
    const log = join(f.dir, '.claude-flow/policy/ledger-anchors.json'); const before = readFileSync(log);
    let published = false;
    const streaming = async (_file: string, source: { [ATOMIC_JSON_WRITER]: (fd: number) => void }) => {
      const temporary = join(f.dir, 'temp-anchor'); const fd = openSync(temporary, 'w');
      try { source[ATOMIC_JSON_WRITER](fd); published = true; } finally { closeSync(fd); }
    };
    engine.evaluate({ identity: { id: 'newer', type: 'agent' }, action: { type: 'code.read' } });
    await expect(recordAnchor(f.dir, engine.exportState(), write, 'append', undefined, streaming, assessed.last)).rejects.toThrow('policy-anchor-log-corrupt');
    expect(published).toBe(false); expect(readFileSync(log)).toEqual(before);
  });
  it('does not grant private assessment reuse to plain JSON or another project', async () => {
    const f = fixture({ retain: 8 }); const other = fixture({ retain: 8 }); process.env.XDG_CONFIG_HOME = join(f.dir, 'scratch-home');
    mkdirSync(join(process.env.XDG_CONFIG_HOME, 'ruflo', 'policy-trust'), { recursive: true });
    const write = async (file: string, value: unknown) => { mkdirSync(join(file, '..'), { recursive: true }); writeFileSync(file, JSON.stringify(value)); };
    await recordAnchor(f.dir, f.state, write); await recordAnchor(other.dir, other.state, write);
    const assessed = assessAnchors(f.dir, f.state); if (assessed.kind !== 'ok') throw new Error('assessment required');
    const engine = AgenticPolicyEngine.fromState(f.state); engine.evaluate({ identity: { id: 'new', type: 'agent' }, action: { type: 'code.read' } });
    const streaming = async () => { throw new Error('corrupt log must be rejected before serialization'); };
    writeFileSync(join(other.dir, '.claude-flow/policy/ledger-anchors.json'), 'null');
    await expect(recordAnchor(other.dir, engine.exportState(), write, 'append', undefined, streaming, assessed.last)).rejects.toThrow('policy-anchor-log-corrupt');
    writeFileSync(join(f.dir, '.claude-flow/policy/ledger-anchors.json'), 'null');
    await expect(recordAnchor(f.dir, engine.exportState(), write, 'append', undefined, streaming, JSON.parse(JSON.stringify(assessed.last)))).rejects.toThrow('policy-anchor-log-corrupt');
  });
  it('retains the exported custom AnchorWriter JSON-object contract', async () => {
    const f = fixture(); const writes: Array<{ file: string; value: unknown }> = [];
    await recordAnchor(f.dir, f.state, async (file, value) => { writes.push({ file, value: JSON.parse(JSON.stringify(value)) }); });
    expect(writes[0].value).toMatchObject({ version: 1, entries: [expect.objectContaining({ length: 8 })] });
    expect(writes[1].value).toMatchObject({ length: 8 });
  });
});

describe('public full-audit preflight is bounded and fails closed', () => {
  async function project() {
    const f = fixture(); process.env.XDG_CONFIG_HOME = join(f.dir, 'private-config');
    mkdirSync(join(process.env.XDG_CONFIG_HOME, 'ruflo', 'policy-trust'), { recursive: true });
    mkdirSync(join(f.dir, '.claude-flow')); process.env.CLAUDE_FLOW_POLICY_LEDGER_RETENTION = '2';
    await autoMigratePolicyStateIfNeeded(f.dir);
    for (let i = 0; i < 4; i++) await evaluatePolicyRequest({ identity: { id: `public:${i}`, type: 'agent' }, action: { type: 'code.read' } }, f.dir);
    return { ...f, archivePath: join(f.dir, '.claude-flow', 'policy', 'receipts.ledger.jsonl') };
  }
  it('rejects a sparse oversize unterminated suffix before any whole-file allocation', async () => {
    const f = await project(); process.env.CLAUDE_FLOW_POLICY_AUDIT_MAX_RECORD_BYTES = '1024';
    const before = readFileSync(join(f.dir, '.claude-flow', 'policy', 'state.json'));
    const fd = openSync(f.archivePath, 'r+'); try { ftruncateSync(fd, readFileSync(f.archivePath).length + 4096); } finally { closeSync(fd); }
    expect(await verifyPolicyLedger(f.dir, { full: true })).toMatchObject({ valid: false, error: 'policy-ledger-archive-record-too-large:1024' });
    expect(readFileSync(join(f.dir, '.claude-flow', 'policy', 'state.json'))).toEqual(before);
  });
  it('reports malformed UTF8 from the tip preflight through the public API', async () => {
    const f = await project(); appendFileSync(f.archivePath, Buffer.from([0xff, 10]));
    expect(await verifyPolicyLedger(f.dir, { full: true })).toMatchObject({ valid: false, error: 'policy-ledger-archive-utf8-error' });
  });
});
