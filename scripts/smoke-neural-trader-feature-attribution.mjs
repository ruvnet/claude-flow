#!/usr/bin/env node
/**
 * Smoke test for ADR-126 Phase 6 (#2068) — feature attribution via single-
 * entry PageRank.
 *
 * Locks in three layers (modelled on scripts/smoke-neural-trader-backtest-
 * signing.mjs, the Phase 4 reference):
 *
 *   [1/3] STATIC CONTRACT on signed-attribution.{ts,mjs} + trader-explain/SKILL.md:
 *         - both files exist and export `signAttributionArtifact` +
 *           `verifyAttributionArtifact` + the local PageRank fallback
 *         - the verifier pins to a caller-supplied `trustedPublicKey`,
 *           NOT to artifact.witnessPublicKey (CWE-347 / #1922) — same
 *           defense the Phase 4 artifact uses
 *         - canonical message construction strips BOTH signature fields
 *         - skill mentions `mcp__ruflo-sublinear__page-rank-entry` and
 *           documents the local fallback
 *         - skill writes to `trading-analysis` namespace (canonical per
 *           ADR-126 Phase 1)
 *         - skill calls `signAttributionArtifact` from the new module
 *
 *   [2/3] CRYPTO ROUND-TRIP with real Ed25519 against the .mjs runtime:
 *         - signed attribution fixture verifies with the trusted pubkey
 *         - tampered feature score fails verification
 *         - tampered graphMetadata.seed fails (seed is signed)
 *         - empty signature fails
 *         - empty trusted pubkey fails
 *         - swapped served witnessPublicKey still verifies (pin to trusted)
 *         - wrong trusted pubkey fails (pin is real, not a no-op)
 *
 *   [3/3] REPRODUCIBILITY check (the Phase-6-unique invariant):
 *         - build a deterministic feature-contribution graph
 *         - run the local seeded PageRank twice with the same seed
 *         - assert top-K rankings are byte-identical
 *         - change the seed → assert rankings differ (proves seed is
 *           actually load-bearing, not dead weight)
 *
 * If a future PR drops the verify call, reverts the seeded initialization,
 * removes the topK helper, or rewrites the skill without the namespace +
 * signing wiring, this smoke catches it before merge.
 *
 * Usage:  node scripts/smoke-neural-trader-feature-attribution.mjs
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const PLUGIN_DIR = join(REPO_ROOT, 'plugins', 'ruflo-neural-trader');
const ATTR_TS = join(PLUGIN_DIR, 'src', 'signed-attribution.ts');
const ATTR_MJS = join(PLUGIN_DIR, 'src', 'signed-attribution.mjs');
const SKILL_MD = join(PLUGIN_DIR, 'skills', 'trader-explain', 'SKILL.md');

const failures = [];
function check(label, ok, detail = '') {
  if (ok) console.log(`  ✓ ${label}`);
  else {
    console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`);
    failures.push(label);
  }
}

// ---------------------------------------------------------------------------
// Part 1 — Static contract on signed-attribution.{ts,mjs} + trader-explain/SKILL.md
// ---------------------------------------------------------------------------

console.log('[1/3] Static contract on signed-attribution.{ts,mjs} + trader-explain/SKILL.md');

if (!existsSync(ATTR_TS)) {
  failures.push('signed-attribution.ts not found');
} else {
  const src = readFileSync(ATTR_TS, 'utf8');
  check(
    'TS exports `signAttributionArtifact` + `verifyAttributionArtifact`',
    /export\s+async\s+function\s+signAttributionArtifact\s*\(/.test(src) &&
      /export\s+async\s+function\s+verifyAttributionArtifact\s*\(/.test(src),
    'expected both functions to be exported as async',
  );
  check(
    'TS exports `localSingleEntryPageRank` + `singleEntryPageRank` + `topKFeatures`',
    /export\s+function\s+localSingleEntryPageRank\s*\(/.test(src) &&
      /export\s+async\s+function\s+singleEntryPageRank\s*\(/.test(src) &&
      /export\s+function\s+topKFeatures\s*\(/.test(src),
    'PageRank primitives + ranking helper must be exported for the smoke + skill harnesses',
  );
  check(
    'TS declares `SignedAttributionArtifact` interface with required fields',
    /interface\s+SignedAttributionArtifact/.test(src) &&
      /schema\s*:\s*'ruflo-neural-trader-attribution\/v1'/.test(src) &&
      /signalId\s*:\s*string/.test(src) &&
      /modelId\s*:\s*string/.test(src) &&
      /features\s*:\s*AttributionFeature\[\]/.test(src) &&
      /graphMetadata\s*:/.test(src) &&
      /witnessPublicKey\s*:\s*string/.test(src) &&
      /witnessSignature\s*:\s*string/.test(src),
    'shape per ADR-126 Phase 6 spec',
  );
  check(
    'TS `AttributionFeature` has name/score/rank',
    /interface\s+AttributionFeature\s*\{[\s\S]*?name\s*:\s*string[\s\S]*?score\s*:\s*number[\s\S]*?rank\s*:\s*number[\s\S]*?\}/.test(
      src,
    ),
    'features must carry name + score + 1-indexed rank',
  );
  check(
    'TS `graphMetadata` includes seed for reproducibility',
    /graphMetadata\s*:\s*\{[\s\S]*?seed\s*:\s*number[\s\S]*?\}/.test(src),
    'seed is load-bearing for Phase 6 reproducibility acceptance',
  );

  if (
    /export\s+async\s+function\s+verifyAttributionArtifact\s*\(\s*[^)]*trustedPublicKey/.test(
      src,
    )
  ) {
    check('TS verifier accepts `trustedPublicKey` as a parameter', true);
  } else {
    check(
      'TS verifier accepts `trustedPublicKey` as a parameter',
      false,
      'verifier MUST take trustedPublicKey, not infer from artifact (CWE-347)',
    );
  }

  const verifierBody = (() => {
    const m = /export\s+async\s+function\s+verifyAttributionArtifact[\s\S]*?\{([\s\S]*?)\n\}/.exec(
      src,
    );
    return m ? m[1] : '';
  })();
  check(
    'TS verifier does NOT consume artifact.witnessPublicKey for verification',
    verifierBody && !/artifact\.witnessPublicKey/.test(verifierBody),
    'reading artifact.witnessPublicKey defeats the pin — pin to trustedPublicKey only',
  );
  check(
    'TS verifier builds canonical body WITHOUT witnessSignature + witnessPublicKey',
    /const\s+body[\s\S]{0,400}?signalId:\s*artifact\.signalId/.test(src) &&
      !/body\.witnessSignature\s*=/.test(src) &&
      !/body\.witnessPublicKey\s*=/.test(src),
    'canonical body MUST exclude both signature fields before stringify',
  );
  check(
    'TS canonical bytes use plain JSON.stringify (no whitespace, no sort)',
    /JSON\.stringify\(\s*body\s*\)/.test(src),
    'match the Phase 4 signer scheme exactly',
  );
  check(
    'TS detects `mcp__ruflo-sublinear__page-rank-entry` for MCP dispatch',
    /mcp__ruflo-sublinear__page-rank-entry/.test(src),
    'singleEntryPageRank must check for the MCP tool before falling through to local',
  );
}

if (!existsSync(ATTR_MJS)) {
  failures.push('signed-attribution.mjs (runtime mirror) not found');
} else {
  const mjs = readFileSync(ATTR_MJS, 'utf8');
  check(
    'MJS runtime exports `signAttributionArtifact` + `verifyAttributionArtifact`',
    /export\s+async\s+function\s+signAttributionArtifact\b/.test(mjs) &&
      /export\s+async\s+function\s+verifyAttributionArtifact\b/.test(mjs),
    '.mjs mirror must keep parity with the .ts source',
  );
  check(
    'MJS runtime exports `localSingleEntryPageRank` + `singleEntryPageRank` + `topKFeatures`',
    /export\s+function\s+localSingleEntryPageRank\b/.test(mjs) &&
      /export\s+async\s+function\s+singleEntryPageRank\b/.test(mjs) &&
      /export\s+function\s+topKFeatures\b/.test(mjs),
    'PageRank + ranking primitives must be importable from .mjs',
  );
  check(
    'MJS verifier pins to caller-supplied `trustedPublicKey`',
    /verifyAttributionArtifact\s*\(\s*artifact\s*,\s*trustedPublicKey/.test(mjs) &&
      /trustedPublicKey\.replace\(\s*\/\^ed25519:\/\s*,\s*''\)/.test(mjs),
    'verifier param name must be trustedPublicKey AND it must be the one normalized',
  );
  check(
    'MJS canonical body excludes signature fields',
    /signalId:\s*artifact\.signalId/.test(mjs) &&
      !/body\.witnessSignature\s*=/.test(mjs) &&
      !/body\.witnessPublicKey\s*=/.test(mjs),
    'canonical body MUST exclude both signature fields before stringify',
  );
}

if (!existsSync(SKILL_MD)) {
  failures.push('trader-explain/SKILL.md not found');
} else {
  const skill = readFileSync(SKILL_MD, 'utf8');
  check(
    'skill frontmatter declares name: trader-explain',
    /^---[\s\S]*?\nname:\s*trader-explain\s*\n[\s\S]*?\n---/.test(skill),
    'frontmatter must include the addressable skill name',
  );
  check(
    'skill references `mcp__ruflo-sublinear__page-rank-entry`',
    /mcp__ruflo-sublinear__page-rank-entry/.test(skill),
    'skill must invoke (or fall back from) the single-entry PR MCP tool',
  );
  check(
    'skill documents the local fallback path',
    /local fallback|localSingleEntryPageRank|local kernel|power-iteration/i.test(skill),
    'skill must document the local fallback when MCP unavailable',
  );
  check(
    'skill writes to `trading-analysis` namespace',
    /trading-analysis/.test(skill) &&
      /memory_store[\s\S]{0,400}?trading-analysis|namespace:\s*"trading-analysis"/.test(
        skill,
      ),
    'skill must persist artifact to the canonical trading-analysis namespace',
  );
  check(
    'skill calls `signAttributionArtifact` from the new module',
    /signAttributionArtifact/.test(skill),
    'skill must invoke the signer when a key is present',
  );
  check(
    'skill documents the UNSIGNED degraded mode warning',
    /UNSIGNED degraded mode|unsigned.*degraded/i.test(skill),
    'no-key case must be logged loudly, never silent (parity with Phase 4)',
  );
  check(
    'skill retrieves signal from `trading-signals` namespace',
    /trading-signals/.test(skill),
    'skill must retrieve the signal entry that Phase 2 lifecycle stores',
  );
  check(
    'skill documents the `--explain` fallback path (z-score heuristic)',
    /z-score|zscore|input-zscore-fallback|input-vector|attribution_method/i.test(skill),
    'skill must graceful-degrade when --explain is missing upstream',
  );
}

// ---------------------------------------------------------------------------
// Part 2 — Crypto round-trip with real Ed25519
// ---------------------------------------------------------------------------

console.log('\n[2/3] Crypto round-trip via the .mjs runtime');

let ed;
try {
  ed = await import('@noble/ed25519');
} catch (err) {
  failures.push('@noble/ed25519 not installed — run `npm install` at repo root');
  console.error(`  ✗ @noble/ed25519 import failed: ${err.message}`);
}

let signAttributionArtifact;
let verifyAttributionArtifact;
let localSingleEntryPageRank;
let topKFeatures;
try {
  const mod = await import(pathToFileURL(ATTR_MJS).href);
  signAttributionArtifact = mod.signAttributionArtifact;
  verifyAttributionArtifact = mod.verifyAttributionArtifact;
  localSingleEntryPageRank = mod.localSingleEntryPageRank;
  topKFeatures = mod.topKFeatures;
} catch (err) {
  failures.push('signed-attribution.mjs runtime import failed');
  console.error(`  ✗ runtime import failed: ${err.message}`);
}

if (ed && signAttributionArtifact && verifyAttributionArtifact) {
  // Deterministic test key (same scheme as the Phase 4 smoke).
  const privateKey = new Uint8Array(32);
  for (let i = 0; i < 32; i++) privateKey[i] = (i * 19 + 7) % 256;
  const privateKeyHex = Buffer.from(privateKey).toString('hex');
  const publicKeyBytes = await ed.getPublicKeyAsync(privateKey);
  const trustedPubKeyHex = `ed25519:${Buffer.from(publicKeyBytes).toString('hex')}`;

  const body = {
    signalId: 'sig-momentum-spy-20260519-001',
    modelId: 'transformer-attn8h-v2',
    features: [
      { name: 'rsi_14', score: 0.42, rank: 1 },
      { name: 'attention_head_3', score: 0.21, rank: 2 },
      { name: 'price_close_t-7', score: 0.13, rank: 3 },
      { name: 'macd_signal', score: 0.09, rank: 4 },
    ],
    graphMetadata: {
      nodeCount: 17,
      edgeCount: 42,
      pageRankIterations: 18,
      seed: 42,
    },
    generatedAt: '2026-05-19T12:00:00.000Z',
  };

  const signed = await signAttributionArtifact(body, privateKeyHex);

  check(
    'signed fixture verifies with the trusted pubkey',
    await verifyAttributionArtifact(signed, trustedPubKeyHex),
  );

  check(
    'signed artifact carries schema + witnessPublicKey + witnessSignature',
    signed.schema === 'ruflo-neural-trader-attribution/v1' &&
      typeof signed.witnessPublicKey === 'string' &&
      signed.witnessPublicKey.startsWith('ed25519:') &&
      typeof signed.witnessSignature === 'string' &&
      signed.witnessSignature.length === 128,
    `got: schema=${signed.schema} pk-len=${signed.witnessPublicKey?.length} sig-len=${signed.witnessSignature?.length}`,
  );

  // Tamper a feature score → verify fails.
  const tamperedFeature = JSON.parse(JSON.stringify(signed));
  tamperedFeature.features[0].score = 0.99;
  check(
    'tampered feature score fails verification',
    !(await verifyAttributionArtifact(tamperedFeature, trustedPubKeyHex)),
    'inflating a feature score MUST invalidate the signature',
  );

  // Tamper the seed → verify fails (proves seed is signed-in, not metadata-only).
  const tamperedSeed = JSON.parse(JSON.stringify(signed));
  tamperedSeed.graphMetadata.seed = 9999;
  check(
    'tampered graphMetadata.seed fails verification',
    !(await verifyAttributionArtifact(tamperedSeed, trustedPubKeyHex)),
    'seed is load-bearing for reproducibility and MUST be covered by the signature',
  );

  // Empty signature fails.
  check(
    'empty signature fails',
    !(await verifyAttributionArtifact({ ...signed, witnessSignature: '' }, trustedPubKeyHex)),
  );

  // Empty pubkey fails.
  check('empty trusted pubkey fails', !(await verifyAttributionArtifact(signed, '')));

  // Swapped served witnessPublicKey — still verifies (pin to TRUSTED key, CWE-347 / #1922).
  const swappedServed = {
    ...signed,
    witnessPublicKey: 'ed25519:' + '0'.repeat(64),
  };
  check(
    'verifier ignores swapped served witnessPublicKey (pinned to trusted key)',
    await verifyAttributionArtifact(swappedServed, trustedPubKeyHex),
    'pin to trustedPublicKey MUST override the served self-asserted pubkey',
  );

  // Wrong trusted pubkey fails — proves the pin is real.
  const wrongTrusted = 'ed25519:' + '0'.repeat(64);
  check(
    'wrong trusted pubkey fails (pin is real, not a no-op)',
    !(await verifyAttributionArtifact(signed, wrongTrusted)),
  );
}

// ---------------------------------------------------------------------------
// Part 3 — Reproducibility check on the local PageRank
// ---------------------------------------------------------------------------

console.log('\n[3/3] Reproducibility check on local single-entry PageRank');

if (localSingleEntryPageRank && topKFeatures) {
  // Build a deterministic small feature-contribution graph.
  //
  //   __signal_output__ (idx 0)
  //     ├──→ rsi_14            (idx 1, w=0.40)
  //     ├──→ macd_signal       (idx 2, w=0.30)
  //     ├──→ price_close_t-7   (idx 3, w=0.15)
  //     ├──→ attention_head_3  (idx 4, w=0.10)
  //     └──→ volume_t-1        (idx 5, w=0.05)
  //
  //   Plus a few feature↔feature co-occurrence edges so PR redistributes
  //   mass non-trivially (not just a degenerate top-K of weights):
  //     rsi_14 ──→ macd_signal (w=0.20)
  //     macd_signal ──→ rsi_14 (w=0.15)
  //     attention_head_3 ──→ rsi_14 (w=0.10)
  //
  const graph = {
    nodes: [
      '__signal_output__',
      'rsi_14',
      'macd_signal',
      'price_close_t-7',
      'attention_head_3',
      'volume_t-1',
    ],
    edges: [
      // 0: __signal_output__
      [
        { target: 1, weight: 0.4 },
        { target: 2, weight: 0.3 },
        { target: 3, weight: 0.15 },
        { target: 4, weight: 0.1 },
        { target: 5, weight: 0.05 },
      ],
      // 1: rsi_14
      [{ target: 2, weight: 0.2 }],
      // 2: macd_signal
      [{ target: 1, weight: 0.15 }],
      // 3: price_close_t-7
      [],
      // 4: attention_head_3
      [{ target: 1, weight: 0.1 }],
      // 5: volume_t-1
      [],
    ],
  };

  // Run twice with same seed → identical scores AND identical ranking.
  const opts = { sourceIndex: 0, seed: 42, damping: 0.85 };
  const a = localSingleEntryPageRank(graph, opts);
  const b = localSingleEntryPageRank(graph, opts);

  const scoresEqual =
    a.scores.length === b.scores.length &&
    a.scores.every((s, i) => Math.abs(s - b.scores[i]) < 1e-12);
  check(
    'same seed → byte-identical PageRank scores across runs',
    scoresEqual,
    'reproducibility is the Phase 6 acceptance invariant',
  );

  const topA = topKFeatures(graph, a.scores, 5, 0);
  const topB = topKFeatures(graph, b.scores, 5, 0);
  const topNamesEqual =
    topA.length === topB.length && topA.every((f, i) => f.name === topB[i].name);
  check(
    'same seed → identical top-K ranking ordering',
    topNamesEqual,
    `got A=[${topA.map((f) => f.name).join(',')}] B=[${topB.map((f) => f.name).join(',')}]`,
  );

  // Top-K has all-non-source features (we excluded sourceIndex=0).
  check(
    'top-K excludes the source node',
    topA.every((f) => f.name !== '__signal_output__'),
    'topKFeatures with excludeIndex=0 must drop the signal-output node',
  );

  // Top-K is sorted descending and rank is 1-indexed.
  check(
    'top-K is sorted desc by score AND rank is 1-indexed',
    topA.every(
      (f, i) =>
        f.rank === i + 1 && (i === 0 || f.score <= topA[i - 1].score),
    ),
  );

  // The graph is constructed so rsi_14 dominates (highest direct weight +
  // most inbound co-occurrence). It MUST be the rank-1 feature.
  check(
    'graph structure → rsi_14 ranks first (sanity that PageRank ran, not random)',
    topA[0].name === 'rsi_14',
    `got rank-1=${topA[0].name}`,
  );

  // Change the seed — scores must differ (proves the seed is actually used,
  // not dead weight). Top-K ordering may or may not change depending on
  // tie structure; the smoke only asserts scores differ.
  const c = localSingleEntryPageRank(graph, { ...opts, seed: 999 });
  const scoresDiffer = a.scores.some((s, i) => Math.abs(s - c.scores[i]) > 1e-12);
  check(
    'different seed → different PageRank scores (seed is load-bearing)',
    scoresDiffer,
    'seed must affect the result; otherwise the reproducibility claim is vacuous',
  );

  // PageRank scores should sum to ~1 (mass conservation up to dangling
  // handling + renormalization).
  const sumA = a.scores.reduce((s, v) => s + v, 0);
  check(
    'PageRank scores sum to ~1 (mass conservation)',
    Math.abs(sumA - 1) < 1e-6,
    `sum=${sumA}`,
  );
}

// ---------------------------------------------------------------------------
console.log('');
if (failures.length > 0) {
  console.log(`FAIL: ${failures.length} issue(s) — see above`);
  process.exit(1);
} else {
  console.log(
    'OK: ADR-126 Phase 6 feature-attribution — schema + signer + verifier + skill + reproducibility verified',
  );
  process.exit(0);
}
