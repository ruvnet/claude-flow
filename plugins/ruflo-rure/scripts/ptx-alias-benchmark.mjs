#!/usr/bin/env node
// Node 24: controlled synthetic aggregation ablation, not a release comparison.
// The baseline restores only the two array-copy loops in the frozen candidate.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { cpus, tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const CANDIDATE_SHA256 = '3a90b5c9886d44d963c1d268bd33154035852f33ab86dfa2242ad00f83d6d413';
const BASELINE_SHA256 = 'c3c4fbd5fe39f770cbb3d9163bce7a815d9df40ebf002d4947a791bc1c377c34';
const WORKLOAD_SHA256 = 'de48031bcccf44cb062a298ea6a1887c3dd66f32d423eea7cc44669e8a4b9e97';
const OUTPUT_SHA256 = '05bd1c3461f024c6675e4382a0596169d72bd0e12435ed886cfa01ef5050ba04';
const hash = value => createHash('sha256').update(value).digest('hex');
const input = count => '.version 8.0\n.target sm_80\n.address_size 64\n.entry k() {\n'
  + Array.from({ length: count }, (_, i) => `l${i}:`).join('') + 'ret;\n}';

export function deriveAblation(source) {
  let baseline = source;
  for (const name of ['label', 'name']) {
    const before = `for (const [${name}, at] of Object.entries(fn.labels)) {
    const labels = labelsAt.get(at);
    if (labels) labels.push(${name}); else labelsAt.set(at, [${name}]);
  }`;
    const after = `for (const [${name}, at] of Object.entries(fn.labels)) labelsAt.set(at, [...(labelsAt.get(at) ?? []), ${name}]);`;
    assert.equal(baseline.split(before).length - 1, 1, `exact ${name} aggregation loop required`);
    baseline = baseline.replace(before, after);
  }
  return baseline;
}

export async function benchmark(sourcePath) {
  assert.ok(Number(process.versions.node.split('.')[0]) >= 24, 'Node 24 or newer required for direct TypeScript loading');
  const source = readFileSync(sourcePath, 'utf8');
  assert.equal(hash(source), CANDIDATE_SHA256, 'candidate changed; this frozen comparison requires revalidation');
  const baselineSource = deriveAblation(source);
  assert.equal(hash(baselineSource), BASELINE_SHA256, 'ablation changed beyond the two frozen loops');
  const workload = input(4096);
  assert.equal(hash(workload), WORKLOAD_SHA256);
  const directory = mkdtempSync(join(tmpdir(), 'rure-ptx-alias-ablation-'));
  try {
    const candidatePath = join(directory, 'candidate.ts');
    const baselinePath = join(directory, 'array-copy-ablation.ts');
    writeFileSync(candidatePath, source, { flag: 'wx' });
    writeFileSync(baselinePath, baselineSource, { flag: 'wx' });
    const { decompilePtx: candidate } = await import(pathToFileURL(candidatePath).href);
    const { decompilePtx: baseline } = await import(pathToFileURL(baselinePath).href);

    // The equality assertion also supplies exactly one warmup per variant.
    const baselineOutput = baseline(workload);
    const candidateOutput = candidate(workload);
    assert.deepEqual(baselineOutput, candidateOutput);
    assert.equal(candidateOutput.status, 'complete');
    assert.equal(hash(JSON.stringify(candidateOutput)), OUTPUT_SHA256);
    const rawMs = { baseline: [], candidate: [] };
    for (let i = 0; i < 5; i++) {
      const order = i % 2 ? [['candidate', candidate], ['baseline', baseline]]
        : [['baseline', baseline], ['candidate', candidate]];
      for (const [name, fn] of order) {
        const start = performance.now();
        const result = fn(workload);
        rawMs[name].push(performance.now() - start);
        assert.deepEqual(result, candidateOutput);
      }
    }
    const stats = samples => {
      const sorted = [...samples].sort((a, b) => a - b);
      return { samples: sorted.length, medianMs: sorted[2], p95Ms: sorted[4] };
    };
    const baselineStats = stats(rawMs.baseline);
    const candidateStats = stats(rawMs.candidate);
    const medianImprovement = 1 - candidateStats.medianMs / baselineStats.medianMs;
    const hostileInput = input(20000);
    const start = performance.now();
    const hostile = candidate(hostileInput);
    const hostileMs = performance.now() - start;
    assert.equal(hostile.status, 'invalid');
    assert.equal(hostile.truncated, true);
    return {
      claim: 'controlled label-aggregation ablation only, not original pre-fix source snapshot',
      candidateSha256: CANDIDATE_SHA256, baselineSha256: BASELINE_SHA256,
      workloadSha256: WORKLOAD_SHA256, workloadBytes: Buffer.byteLength(workload),
      labels: 4096, instructions: 1, samples: 5, warmupPerVariant: 1,
      order: 'alternate baseline/candidate each repetition',
      acceptance: { exactJSONOutputEqual: true, candidateComplete: true, medianImprovementMinimum: 0.10 },
      p95Estimator: 'nearest rank (5 samples => maximum)',
      node: process.version, platform: process.platform, architecture: process.arch,
      cpu: cpus()[0]?.model ?? null, rawMs, baseline: baselineStats, candidate: candidateStats,
      medianImprovement, outputSha256: OUTPUT_SHA256, exactOutputEquality: true,
      verdict: medianImprovement >= 0.10 ? 'ACCEPT' : 'REJECT', costUSD: null,
      scope: 'controlled synthetic parser aggregation only; not GPU or real workload speed',
      hostile: { labels: 20000, inputSha256: hash(hostileInput), bytes: Buffer.byteLength(hostileInput),
        ms: hostileMs, status: hostile.status, truncated: hostile.truncated, warnings: hostile.warnings },
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const sourcePath = process.argv[2] ?? resolve(ROOT, 'v3/@claude-flow/cli/src/rure/ptx-decompile.ts');
  const result = await benchmark(resolve(sourcePath));
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.verdict === 'ACCEPT' ? 0 : 1;
}
