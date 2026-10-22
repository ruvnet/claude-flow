export type ResourceVerdict = 'admit' | 'defer' | 'reject';
export type ResourceLimit = 'cpu' | 'memory' | 'io' | 'remote_wait' | 'capacity' | 'telemetry' | 'profile' | 'none';

export interface ResourceProfile {
  profileId: string;
  toolId: string;
  profileDigest: string;
  observedAt: string;
  cpuDemand: number;
  memoryDemand: number;
  ioDemand: number;
  remoteWaitFraction: number;
  minCpuCores: number;
  maxCpuCores: number;
}

export interface ResourceHostSnapshot {
  snapshotId: string;
  telemetryDigest: string;
  observedAt: string;
  cpuPressure: number;
  memoryPressure: number;
  ioPressure: number;
  allocatableCpuCores: number;
  maxCpuPerTask: number;
}

export interface ResourcePolicy {
  profileMaxAgeMs: number;
  telemetryMaxAgeMs: number;
  maxCpuPerTask: number;
  cpuPressureDefer: number;
  memoryPressureDefer: number;
  ioPressureDefer: number;
  safetyHeadroomFraction: number;
}

export interface ResourceAdmissionInput {
  profile: ResourceProfile;
  host: ResourceHostSnapshot;
  policy: ResourcePolicy;
  requestedConcurrency: number;
  now: string;
}

export interface ResourceAdmissionDecision {
  verdict: ResourceVerdict;
  recommendedCpuCores: number;
  limitingResource: ResourceLimit;
  reasonCodes: readonly string[];
  evidenceDigest: string;
  authority: 'none';
}

const ID = /^[A-Za-z0-9._:/-]{1,160}$/;
const HEX64 = /^[0-9a-f]{64}$/;

export function decideResourceAdmission(input: ResourceAdmissionInput): ResourceAdmissionDecision {
  const invalid = validate(input);
  if (invalid) return finish('reject', 0, 'profile', [invalid], `invalid:${invalid}`);

  const now = Date.parse(input.now);
  const profileAge = now - Date.parse(input.profile.observedAt);
  const telemetryAge = now - Date.parse(input.host.observedAt);
  if (profileAge < -1000) return make(input, 'reject', 0, 'profile', ['PROFILE_FROM_FUTURE']);
  if (telemetryAge < -1000) return make(input, 'reject', 0, 'telemetry', ['TELEMETRY_FROM_FUTURE']);
  if (profileAge > input.policy.profileMaxAgeMs) return make(input, 'defer', 0, 'profile', ['STALE_PROFILE']);
  if (telemetryAge > input.policy.telemetryMaxAgeMs) return make(input, 'defer', 0, 'telemetry', ['STALE_TELEMETRY']);

  const hardPolicyCeiling = Math.min(input.host.maxCpuPerTask, input.policy.maxCpuPerTask);
  if (hardPolicyCeiling < input.profile.minCpuCores) {
    return make(input, 'reject', 0, 'capacity', ['POLICY_CEILING_BELOW_PROFILE_MINIMUM']);
  }

  const usableCpu = input.host.allocatableCpuCores * (1 - input.policy.safetyHeadroomFraction);
  const concurrencyShare = usableCpu / input.requestedConcurrency;
  const ceiling = Math.min(input.profile.maxCpuCores, hardPolicyCeiling, concurrencyShare);
  if (ceiling < input.profile.minCpuCores) {
    return make(input, 'defer', 0, 'capacity', ['CONCURRENCY_CAPACITY_EXHAUSTED']);
  }

  const cpuSensitivity = clamp(input.profile.cpuDemand * (1 - 0.85 * input.profile.remoteWaitFraction));
  if (input.profile.memoryDemand >= 0.4 && input.host.memoryPressure >= input.policy.memoryPressureDefer) {
    return make(input, 'defer', 0, 'memory', ['MEMORY_PRESSURE']);
  }
  if (input.profile.ioDemand >= 0.4 && input.host.ioPressure >= input.policy.ioPressureDefer) {
    return make(input, 'defer', 0, 'io', ['IO_PRESSURE']);
  }
  if (cpuSensitivity >= 0.35 && input.host.cpuPressure >= input.policy.cpuPressureDefer) {
    return make(input, 'defer', 0, 'cpu', ['CPU_PRESSURE']);
  }

  const reasons: string[] = [];
  if (input.profile.remoteWaitFraction >= 0.7) reasons.push('REMOTE_WAIT_DOMINANT');
  if (cpuSensitivity >= 0.6) reasons.push('CPU_SENSITIVE');
  if (reasons.length === 0) reasons.push('WITHIN_RESOURCE_ENVELOPE');

  const target = input.profile.remoteWaitFraction >= 0.7
    ? input.profile.minCpuCores
    : input.profile.minCpuCores + (ceiling - input.profile.minCpuCores) * cpuSensitivity;
  const cpu = Math.min(ceiling, Math.ceil(target * 4) / 4);
  return make(input, 'admit', cpu, limitingResource(input, cpuSensitivity), reasons);
}

function validate(input: ResourceAdmissionInput): string | undefined {
  if (!input || typeof input !== 'object' || !input.profile || !input.host || !input.policy) return 'INVALID_INPUT';
  if (!ID.test(input.profile.profileId) || !ID.test(input.profile.toolId) || !ID.test(input.host.snapshotId)) return 'INVALID_ID';
  if (!HEX64.test(input.profile.profileDigest) || !HEX64.test(input.host.telemetryDigest)) return 'INVALID_DIGEST';
  if (![input.profile.observedAt, input.host.observedAt, input.now].every(canonicalTime)) return 'INVALID_TIMESTAMP';
  const units = [input.profile.cpuDemand, input.profile.memoryDemand, input.profile.ioDemand, input.profile.remoteWaitFraction, input.host.cpuPressure, input.host.memoryPressure, input.host.ioPressure, input.policy.cpuPressureDefer, input.policy.memoryPressureDefer, input.policy.ioPressureDefer, input.policy.safetyHeadroomFraction];
  if (units.some((v) => !Number.isFinite(v) || v < 0 || v > 1)) return 'INVALID_UNIT_VALUE';
  if (input.policy.safetyHeadroomFraction > 0.5) return 'EXCESSIVE_HEADROOM';
  const cores = [input.profile.minCpuCores, input.profile.maxCpuCores, input.host.allocatableCpuCores, input.host.maxCpuPerTask, input.policy.maxCpuPerTask];
  if (cores.some((v) => !Number.isFinite(v) || v <= 0 || v > 4096)) return 'INVALID_CPU_BOUND';
  if (input.profile.minCpuCores > input.profile.maxCpuCores) return 'INVALID_PROFILE_CPU_RANGE';
  if (!Number.isSafeInteger(input.requestedConcurrency) || input.requestedConcurrency < 1 || input.requestedConcurrency > 100000) return 'INVALID_CONCURRENCY';
  if (!Number.isSafeInteger(input.policy.profileMaxAgeMs) || input.policy.profileMaxAgeMs < 1 || !Number.isSafeInteger(input.policy.telemetryMaxAgeMs) || input.policy.telemetryMaxAgeMs < 1) return 'INVALID_FRESHNESS_BOUND';
  return undefined;
}

function make(input: ResourceAdmissionInput, verdict: ResourceVerdict, cpu: number, limit: ResourceLimit, reasons: readonly string[]): ResourceAdmissionDecision {
  const material = [input.profile.profileId, input.profile.toolId, input.profile.profileDigest, input.host.snapshotId, input.host.telemetryDigest, input.profile.observedAt, input.host.observedAt, input.now, input.requestedConcurrency, verdict, cpu, limit, reasons.join(',')].join('|');
  return finish(verdict, cpu, limit, reasons, material);
}

function finish(verdict: ResourceVerdict, cpu: number, limit: ResourceLimit, reasons: readonly string[], material: string): ResourceAdmissionDecision {
  return Object.freeze({ verdict, recommendedCpuCores: cpu, limitingResource: limit, reasonCodes: Object.freeze([...reasons]), evidenceDigest: stableFingerprint(material), authority: 'none' as const });
}

function limitingResource(input: ResourceAdmissionInput, cpuSensitivity: number): ResourceLimit {
  if (input.profile.remoteWaitFraction >= 0.7) return 'remote_wait';
  const values: Array<[ResourceLimit, number]> = [['cpu', cpuSensitivity * Math.max(0.1, input.host.cpuPressure)], ['memory', input.profile.memoryDemand * Math.max(0.1, input.host.memoryPressure)], ['io', input.profile.ioDemand * Math.max(0.1, input.host.ioPressure)]];
  return values.sort((a, b) => b[1] - a[1])[0][0];
}

function canonicalTime(value: string): boolean {
  if (typeof value !== 'string') return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function clamp(value: number): number { return Math.max(0, Math.min(1, value)); }

/** Stable evidence fingerprint only. It is not a signature or authority token. */
function stableFingerprint(value: string): string {
  let a = 2166136261 >>> 0;
  let b = 2246822519 >>> 0;
  for (let i = 0; i < value.length; i += 1) {
    const c = value.charCodeAt(i);
    a = Math.imul(a ^ c, 16777619) >>> 0;
    b = Math.imul(b ^ c, 3266489917) >>> 0;
  }
  return `${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}`;
}
