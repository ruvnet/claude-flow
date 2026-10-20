#!/usr/bin/env node
// Synthetic, source-bound ledger benchmark. Operates only in an explicitly
// supplied scratch fixture; no automatic project discovery or live data paths.
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { performance } from 'node:perf_hooks';
const require = createRequire(import.meta.url);
const [mode, suppliedRoot, suppliedBundle, suppliedCount] = process.argv.slice(2);
if (!['generate', 'audit', 'preflight', 'transaction', 'prepare'].includes(mode) || !suppliedRoot || !suppliedBundle) throw new Error('usage: generate|prepare|audit|transaction <owned-scratch-root> <source-bound-bundle> [count]');
const root = resolve(suppliedRoot);
if (!root.startsWith('/tmp/ruflo-3892-benchmark-')) throw new Error('benchmark requires an owned /tmp/ruflo-3892-benchmark-* fixture');
process.env.HOME = join(root, 'scratch-home');
mkdirSync(process.env.HOME, { recursive: true, mode: 0o700 });
process.env.XDG_CONFIG_HOME = join(root, 'scratch-config');
process.env.RUFLO_DAEMON_AUTOSTART = '0';
const runtime = require(resolve(suppliedBundle));
const policy = join(root, '.claude-flow', 'policy');
const trustRoot = join(root, 'scratch-config', 'ruflo', 'policy-trust');
process.env.XDG_CONFIG_HOME = join(root, 'scratch-config');
const digestFile = file => createHash('sha256').update(readFileSync(file)).digest('hex');
function bufferedWriter(file, header = '') {
  const fd = openSync(file, 'wx', 0o600); let buffered = header;
  return { put(text) { buffered += text; if (buffered.length >= 65536) { writeSync(fd, buffered); buffered = ''; } }, close(footer = '') { buffered += footer; if (buffered) writeSync(fd, buffered); closeSync(fd); } };
}
if (mode === 'generate') {
  if (existsSync(policy)) throw new Error('refuse to overwrite an existing fixture');
  const count = Number(suppliedCount ?? 170000); const retention = 2000;
  if (!Number.isSafeInteger(count) || count <= retention) throw new Error('invalid synthetic count');
  mkdirSync(policy, { recursive: true, mode: 0o700 });
  const archiveFile = join(policy, 'receipts.ledger.jsonl'); const anchorFile = join(policy, 'ledger-anchors.json');
  const archive = bufferedWriter(archiveFile); const anchors = bufferedWriter(anchorFile, '{"version":1,"entries":[');
  const hot = []; let previous = null; let prevAnchor = null; let archivedHead = null; let lastAnchor;
  const policyHash = runtime.policyHash([]);
  for (let sequence = 0; sequence < count; sequence++) {
    const unsigned = { previousReceiptHash: previous, sequence, issuedAt: 1000 + sequence,
      request: { identity: { id: `synthetic-agent:${sequence % 16}`, type: 'agent' }, action: { type: 'code.read', resource: `synthetic-${sequence}-${'x'.repeat(600)}` } },
      decision: { outcome: 'allowed', enforcedOutcome: 'allowed', reason: 'synthetic benchmark fixture, not production evidence' }, policyHash };
    const payload = { ...unsigned, receiptId: runtime.policyHash(unsigned) }; const receipt = { payload, hash: runtime.policyHash(payload) };
    hot.push(receipt); if (hot.length > retention) { const removed = hot.shift(); archive.put(`${JSON.stringify(removed)}\n`); archivedHead = removed.hash; }
    previous = receipt.hash;
    const retainedFrom = Math.max(0, sequence + 1 - retention);
    const entry = { seq: sequence, length: sequence + 1, headHash: receipt.hash, prevAnchorHash: prevAnchor, ts: 1000 + sequence, event: 'append',
      ...(retainedFrom > 0 ? { archivedThrough: retainedFrom, archiveHeadHash: archivedHead } : {}) };
    const fields = [entry.seq, entry.length, entry.headHash, entry.prevAnchorHash, entry.ts, entry.event, null];
    if (entry.archivedThrough !== undefined) fields.push(entry.archivedThrough, entry.archiveHeadHash);
    lastAnchor = { ...entry, hash: createHash('sha256').update(JSON.stringify(fields)).digest('hex') };
    if (sequence) anchors.put(','); anchors.put(JSON.stringify(lastAnchor)); prevAnchor = lastAnchor.hash;
  }
  archive.close(); anchors.close(']}\n');
  const state = { version: 1, mode: 'legacy', rules: [], budgets: [], usage: [], approvals: [], receipts: hot, retainedFrom: count - retention,
    prunedHead: archivedHead, ledgerLength: count, ledgerHead: previous };
  writeFileSync(join(policy, 'state.json'), JSON.stringify(state));
  const id = createHash('sha256').update(realpathSync(root)).digest('hex'); mkdirSync(join(trustRoot, id), { recursive: true, mode: 0o700 });
  writeFileSync(join(trustRoot, id, 'ledger-anchor-head.json'), JSON.stringify(lastAnchor));
  const manifest = { schema: 'ruflo.synthetic-policy-ledger-benchmark/v1', synthetic: true, receipts: count, retention, anchorEntries: count,
    archiveBytes: statSync(archiveFile).size, anchorBytes: statSync(anchorFile).size, archiveSha256: digestFile(archiveFile), anchorSha256: digestFile(anchorFile),
    stateSha256: digestFile(join(policy, 'state.json')), finalReceiptHash: previous, signing: 'unsigned legacy fixture', fixtureBundleSha256: digestFile(resolve(suppliedBundle)) };
  writeFileSync(join(root, 'synthetic-manifest.json'), JSON.stringify(manifest, null, 2)); console.log(JSON.stringify(manifest));
} else {
  if (!existsSync(join(root, 'synthetic-manifest.json'))) throw new Error('missing synthetic fixture marker');
  const start = performance.now();
  let outcome;
  try {
  if (mode === 'preflight') outcome = await runtime.verifyPolicyLedger(root);
  if (mode === 'audit') outcome = await runtime.verifyPolicyLedger(root, { full: true });
  if (mode === 'transaction') outcome = await runtime.evaluatePolicyRequest({ identity: { id: `synthetic-client:${process.pid}`, type: 'agent' }, action: { type: 'code.read', resource: `synthetic-transaction:${process.pid}` } }, root);
  if (mode === 'prepare') outcome = await runtime.withPolicyTransaction(root, () => undefined);
  } catch (error) { outcome = { error: error.message }; process.exitCode = 1; }
  console.log(JSON.stringify({ mode, node: process.version, synthetic: true, runtimeBundleSha256: digestFile(resolve(suppliedBundle)), elapsedMs: performance.now() - start,
    maxRssKiB: process.resourceUsage().maxRSS, userCpuMs: process.resourceUsage().userCPUTime / 1000, systemCpuMs: process.resourceUsage().systemCPUTime / 1000, outcome, stateVersion: JSON.parse(readFileSync(join(policy, 'state.json'))).version }));
}
