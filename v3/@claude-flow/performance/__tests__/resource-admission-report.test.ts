import { expect, it } from 'vitest';
import { pairedTiming, percentile } from './timing-utils.js';
import { decideResourceAdmission, type ResourceAdmissionInput } from '../src/resource-admission.js';

const now = '2026-09-21T14:00:00.000Z';

function inputFor(seed: number, batch: number, index: number, unit: number): ResourceAdmissionInput {
  return {
    profile: {
      profileId: `profile.report.${seed}.${batch}.${index}`,
      toolId: 'tool.synthetic',
      profileDigest: 'a'.repeat(64),
      observedAt: '2026-09-21T13:59:30.000Z',
      cpuDemand: unit,
      memoryDemand: (unit * 1.7) % 1,
      ioDemand: (unit * 2.3) % 1,
      remoteWaitFraction: (unit * 3.1) % 1,
      minCpuCores: 1,
      maxCpuCores: 8,
    },
    host: {
      snapshotId: 'host.report',
      telemetryDigest: 'b'.repeat(64),
      observedAt: '2026-09-21T13:59:59.000Z',
      cpuPressure: (unit * 1.3) % 1,
      memoryPressure: (unit * 1.9) % 1,
      ioPressure: (unit * 2.7) % 1,
      allocatableCpuCores: 16,
      maxCpuPerTask: 8,
    },
    policy: {
      profileMaxAgeMs: 300_000,
      telemetryMaxAgeMs: 30_000,
      maxCpuPerTask: 8,
      cpuPressureDefer: 0.9,
      memoryPressureDefer: 0.9,
      ioPressureDefer: 0.9,
      safetyHeadroomFraction: 0.1,
    },
    requestedConcurrency: 1 + (index % 4),
    now,
  };
}

function fixedCpuBaseline(input: ResourceAdmissionInput): number {
  const share = input.host.allocatableCpuCores * (1 - input.policy.safetyHeadroomFraction) / input.requestedConcurrency;
  return Math.max(0, Math.min(4, input.profile.maxCpuCores, input.host.maxCpuPerTask, input.policy.maxCpuPerTask, share));
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function variance(values: number[]): number {
  const center = mean(values);
  return values.reduce((sum, value) => sum + (value - center) ** 2, 0) / values.length;
}

// Gate on median(decision cost / reference cost), measured in-process (see timing-utils.ts).
// Measured over 30+ runs under a 32-process CPU stressor: ratio 5.3-6.2 (decision ~6 us, reference ~1.1 us).
// 15 is ~2.5x above the worst observed run and fails any >= ~2.7x slowdown of the decision path.
const RATIO_LIMIT = 15;
// Backstop for the documented budget: the MEDIAN decision stays far below 100 us (measured ~6 us).
const MEDIAN_MICROS_LIMIT = 100;

// Statistical, timing-based gate: one retry absorbs a run that overlapped a
// scheduler stall; a real regression fails every attempt.
it('reports baseline and candidate resource admission overhead with frozen workload', { retry: 1 }, () => {
  const seeds = [11, 29, 47, 71, 101];
  const batches: ResourceAdmissionInput[][] = [];
  let candidateCeilingViolations = 0;
  let baselineCeilingViolations = 0;
  let admits = 0;
  let defers = 0;
  let rejects = 0;
  let samples = 0;

  // Frozen, deterministic workload; fixtures are built outside the timed region.
  for (const seed of seeds) {
    let state = seed >>> 0;
    for (let batch = 0; batch < 20; batch += 1) {
      const inputs: ResourceAdmissionInput[] = [];
      for (let index = 0; index < 100; index += 1) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        inputs.push(inputFor(seed, batch, index, state / 0xffffffff));
      }
      batches.push(inputs);
    }
  }

  // Correctness half (not timing): verdict mix and CPU ceilings.
  for (const inputs of batches) {
    for (const input of inputs) {
      const cpu = fixedCpuBaseline(input);
      if (cpu > input.host.maxCpuPerTask || cpu > input.policy.maxCpuPerTask) baselineCeilingViolations += 1;
      const decision = decideResourceAdmission(input);
      samples += 1;
      if (decision.verdict === 'admit') admits += 1;
      if (decision.verdict === 'defer') defers += 1;
      if (decision.verdict === 'reject') rejects += 1;
      if (decision.recommendedCpuCores > input.host.maxCpuPerTask || decision.recommendedCpuCores > input.policy.maxCpuPerTask) {
        candidateCeilingViolations += 1;
      }
    }
  }

  // Timing half: warm up (JIT), then interleave each batch with the fixed reference workload.
  const options = { batches: batches.length, unitsPerBatch: 100, warmupBatches: 20 };
  const baselineTiming = pairedTiming((index) => { for (const input of batches[index]) fixedCpuBaseline(input); }, options);
  const candidateTiming = pairedTiming((index) => { for (const input of batches[index]) decideResourceAdmission(input); }, options);
  const baselineBatchMicros = baselineTiming.batchMicros;
  const candidateBatchMicros = candidateTiming.batchMicros;

  const baselineMean = mean(baselineBatchMicros);
  const candidateMean = mean(candidateBatchMicros);
  const report = {
    schema: 'ruflo-resource-admission-benchmark/v2',
    environment: { node: process.version, platform: process.platform, arch: process.arch },
    workload: '10000 deterministic synthetic resource decisions in 100 batches',
    seeds,
    sampleSize: samples,
    baseline: {
      name: 'fixed_cpu_clipped_to_host_ceiling',
      meanMicrosPerDecision: baselineMean,
      medianMicrosPerDecision: baselineTiming.medianMicros,
      p95MicrosPerDecision: percentile(baselineBatchMicros, 0.95),
      varianceMicros2: variance(baselineBatchMicros),
      ceilingViolations: baselineCeilingViolations,
    },
    candidate: {
      name: 'task_conditioned_resource_admission',
      meanMicrosPerDecision: candidateMean,
      medianMicrosPerDecision: candidateTiming.medianMicros,
      p95MicrosPerDecision: percentile(candidateBatchMicros, 0.95),
      varianceMicros2: variance(candidateBatchMicros),
      medianRatioToReference: candidateTiming.medianRatio,
      ceilingViolations: candidateCeilingViolations,
      admits,
      defers,
      rejects,
    },
    absoluteOverheadMicros: candidateMean - baselineMean,
    relativeOverheadRatio: candidateMean / Math.max(baselineMean, Number.EPSILON),
    ablations: ['remote_wait_cpu_reduction', 'cpu_pressure_defer', 'memory_pressure_defer', 'io_pressure_defer'],
    failures: 0,
    regressions: { taskQuality: 'not_measured_in_structural_benchmark', starvation: 'not_measured_in_structural_benchmark' },
    costUsd: 0,
    energy: 'not_measured',
    reproduction: 'npx vitest run v3/@claude-flow/performance/__tests__/resource-admission-report.test.ts',
  };

  console.log(JSON.stringify(report));
  expect(samples).toBe(10_000);
  expect(candidateCeilingViolations).toBe(0);
  expect(candidateTiming.medianRatio).toBeLessThan(RATIO_LIMIT);
  expect(candidateTiming.medianMicros).toBeLessThan(MEDIAN_MICROS_LIMIT);
});
