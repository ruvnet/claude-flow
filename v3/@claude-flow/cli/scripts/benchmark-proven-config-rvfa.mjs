#!/usr/bin/env node
/**
 * Measured benchmark for ADR-177 RVFA packaging of proven-config champions.
 * Reports envelope size overhead vs raw signed JSON, and pack/unpack throughput.
 * Pure Node, no network — deterministic, $0. Run: node scripts/benchmark-proven-config-rvfa.mjs
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeyPairSync } from 'node:crypto';
import { existsSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dist = join(__dirname, '..', 'dist', 'src', 'config');
const rvfaMod = join(dist, 'proven-config-rvfa.js');
const pcMod = join(dist, 'proven-config.js');
if (!existsSync(rvfaMod) || !existsSync(pcMod)) {
  console.error('dist not built — run: npm run build'); process.exit(1);
}
const { packProvenConfigRvfa, unpackProvenConfigRvfa } = await import(`file://${rvfaMod}`);
const { signProvenConfig } = await import(`file://${pcMod}`);

const { privateKey } = generateKeyPairSync('ed25519');
const priv = privateKey.export({ type: 'pkcs8', format: 'pem' });

// A realistic champion manifest (with a receipt block — the heavier case).
const manifest = {
  schema: 'ruflo.proven-config/v1',
  policy: { ref: 'sha256:' + 'a'.repeat(64) },
  host: { 'claude-code': '>=1.9' },
  platform: ['linux', 'macOS', 'windows'],
  compatibility: { ruflo: '>=3.24.0', metaharness: '>=0.3.0' },
  benchmark: { corpus: 'LAB-v1', corpusHash: 'b'.repeat(64) },
  layer: 'framework/node-cli',
  receipt: {
    heldOutDelta: 0.037, redblue: 'PASS', drift: 0.008, replay: 'deterministic',
    receiptCoverage: 1, canaryRollbackRate: 0.0,
  },
  rollback: { previousManifest: 'sha256:' + 'c'.repeat(64) },
};

const signed = signProvenConfig(manifest, priv);
const rawJson = Buffer.from(JSON.stringify(signed), 'utf-8');
const rvf = packProvenConfigRvfa(signed);

// Correctness gate before timing.
const back = unpackProvenConfigRvfa(rvf);
if (!back || back.signature !== signed.signature) { console.error('roundtrip FAILED'); process.exit(1); }

const N = 5000;
let t0 = performance.now();
for (let i = 0; i < N; i++) packProvenConfigRvfa(signed);
const packMs = performance.now() - t0;

t0 = performance.now();
for (let i = 0; i < N; i++) unpackProvenConfigRvfa(rvf);
const unpackMs = performance.now() - t0;

const pct = ((rvf.length - rawJson.length) / rawJson.length) * 100;
console.log('ADR-177 RVFA proven-config packaging — measured');
console.log('------------------------------------------------');
console.log(`raw signed JSON      : ${rawJson.length} bytes`);
console.log(`RVFA envelope (gzip) : ${rvf.length} bytes  (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}% vs raw)`);
console.log(`pack                 : ${(packMs / N).toFixed(4)} ms/op  (${Math.round(N / (packMs / 1000))} ops/s)`);
console.log(`unpack + integrity   : ${(unpackMs / N).toFixed(4)} ms/op  (${Math.round(N / (unpackMs / 1000))} ops/s)`);
console.log(`roundtrip correctness: OK (signature preserved, integrity verified)`);
