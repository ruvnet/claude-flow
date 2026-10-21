/** Native mod adapter: compiler projection and untrusted review candidates. */
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

interface Rule {
  id: string;
  text: string;
  source: string;
  isConstitution: boolean;
  intents: string[];
  priority: number;
}
interface Bundle {
  constitution: { rules: Rule[]; hash: string };
  shards: { rule: Rule }[];
  manifest: { sourceHashes: Record<string, string> };
}

export const MOD_GUIDANCE_DIR = '.claude-flow/mods/guidance';
const MAX_BYTES = 256 * 1024;
const HEX = /^[a-f0-9]{64}$/;
const RUN = /^mod-[a-z0-9]+-[a-z0-9]{1,12}-[a-z0-9]{1,12}$/;
const ID = /^[A-Z]{1,58}-?\d{3,4}$/;

export interface ModObservation {
  version: 1;
  kind: 'guidance-observation';
  id: string;
  runId: string;
  taskId: number;
  bundleId: string;
  sourceRevision: string;
  ruleIds: string[];
  checks: { allow: number; ask: number; deny: number };
  tools: { ok: number; error: number; denied: number };
  completion: 'completed' | 'aborted' | 'interrupted';
  verified: false;
  learningEligible: false;
}

/** Stable digest of the exported rules; a provenance identifier, not a signature. */
export function buildModProjection(bundle: Bundle, sourceRevision: string, sourceDigests?: Record<string, string>) {
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(sourceRevision)) throw new Error('--revision must be an immutable source commit SHA');
  const rules = [...bundle.constitution.rules, ...bundle.shards.map(s => s.rule)];
  if (rules.length > 256) throw new Error('Mod projection supports at most 256 rules; supply a reviewed scoped source');
  const ids = new Set<string>();
  const entries = rules.map(rule => {
    if (!ID.test(rule.id) || ids.has(rule.id) || !['root', 'local'].includes(rule.source) || rule.text.length > 1200 ||
        !Number.isFinite(rule.priority) || rule.priority < 0 || rule.priority > 10000) throw new Error('Unsupported mod guidance rule');
    ids.add(rule.id);
    return { id: rule.id, text: rule.text, source: rule.source, constitution: rule.isConstitution, intents: [...rule.intents], priority: rule.priority };
  }).sort((a, b) => a.id.localeCompare(b.id));
  const sourceHashes = Object.fromEntries(Object.entries(bundle.manifest.sourceHashes).sort(([a], [b]) => a.localeCompare(b)));
  if (!/^[a-f0-9]{16}$/.test(bundle.constitution.hash) || Object.entries(sourceHashes).some(([key, value]) => !['root', 'local'].includes(key) || !/^[a-f0-9]{16}$/.test(value))) {
    throw new Error('Unsupported compiler source hashes');
  }
  // The compiler omits an empty local overlay from its manifest. Bind that
  // explicitly supplied empty source too, without changing compiler semantics.
  const emptyDigest = createHash('sha256').update('').digest('hex');
  if (sourceDigests && (Object.entries(sourceHashes).some(([key, hash]) => sourceDigests[key]?.slice(0, 16) !== hash) ||
      Object.entries(sourceDigests).some(([key, digest]) => !['root', 'local'].includes(key) || !HEX.test(digest) ||
        (!sourceHashes[key] && !(key === 'local' && digest === emptyDigest))))) throw new Error('Source digests do not match compiler snapshots');
  const data = { version: 1 as const, sourceRevision, constitutionHash: bundle.constitution.hash, sourceHashes,
    ...(sourceDigests ? { sourceDigests: Object.fromEntries(Object.entries(sourceDigests).sort(([a], [b]) => a.localeCompare(b))) } : {}), entries };
  const bundleId = createHash('sha256').update(JSON.stringify(data)).digest('hex');
  const projection = { ...data, bundleId };
  if (Buffer.byteLength(JSON.stringify(projection)) > MAX_BYTES) throw new Error('Mod projection exceeds 256 KiB');
  return projection;
}

/** Explicit CLI export only. Never called from the native prompt/tool hooks. */
export async function writeModProjection(directory: string, projection: ReturnType<typeof buildModProjection>) {
  const serialized = `${JSON.stringify(projection)}\n`;
  if (Buffer.byteLength(serialized) > MAX_BYTES) throw new Error('Serialized mod projection exceeds 256 KiB');
  await mkdir(directory, { recursive: true });
  const target = join(directory, 'projection.json');
  const temp = join(directory, `.projection-${process.pid}-${Date.now()}.tmp`);
  await writeFile(temp, serialized, { flag: 'wx', mode: 0o600 });
  await rename(temp, target);
  return target;
}

const keys = ['version', 'kind', 'id', 'runId', 'taskId', 'bundleId', 'sourceRevision', 'ruleIds', 'checks', 'tools', 'completion', 'verified', 'learningEligible'];
const counters = (value: any, names: string[]) => value && !Array.isArray(value) && Object.keys(value).length === names.length && names.every(k => Number.isSafeInteger(value[k]) && value[k] >= 0 && value[k] <= 100000);

/** Strict allowlist: a writable `verified: true` or receipt cannot become evidence. */
export function parseModObservations(text: string): ModObservation[] {
  if (Buffer.byteLength(text) > MAX_BYTES) throw new Error('Observation file exceeds 256 KiB');
  const records = JSON.parse(text);
  if (!Array.isArray(records) || records.length > 128) throw new Error('Invalid observation queue');
  const seen = new Set<string>();
  for (const r of records) {
    if (!r || Object.keys(r).length !== keys.length || Object.keys(r).some(k => !keys.includes(k)) ||
        r.version !== 1 || r.kind !== 'guidance-observation' || !RUN.test(r.runId ?? '') ||
        !Number.isSafeInteger(r.taskId) || r.taskId < 1 || r.id !== `${r.runId}:${r.taskId}` || seen.has(r.id) ||
        !HEX.test(r.bundleId ?? '') || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(r.sourceRevision ?? '') ||
        !Array.isArray(r.ruleIds) || r.ruleIds.length > 5 || r.ruleIds.some((id: unknown) => typeof id !== 'string' || !ID.test(id)) || new Set(r.ruleIds).size !== r.ruleIds.length ||
        !counters(r.checks, ['allow', 'ask', 'deny']) || !counters(r.tools, ['ok', 'error', 'denied']) ||
        !['completed', 'aborted', 'interrupted'].includes(r.completion) || r.verified !== false || r.learningEligible !== false) {
      throw new Error('Invalid or forged mod observation');
    }
    seen.add(r.id);
  }
  return records;
}

/** Review priorities only. Never feeds the accepted RunEvent ledger or optimizer. */
export async function collectModCandidates(directory: string, bundleId?: string) {
  if (bundleId !== undefined && !HEX.test(bundleId)) throw new Error('Invalid bundle ID filter');
  let names: string[];
  try { names = (await readdir(directory)).filter(name => /^mod-[a-z0-9-]+\.json$/.test(name)).sort(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') names = []; else throw error; }
  if (names.length > 128) throw new Error('At most 128 observation files may be reviewed per batch');
  const seen = new Set<string>();
  const groups = new Map<string, { bundleId: string; sourceRevision: string; ruleId: string; observations: number; affectedObservations: number; toolErrors: number; toolExecutions: number; deniedTools: number; deniedChecks: number; permissionChecks: number; aborted: number; interrupted: number; completed: number }>();
  let observations = 0;
  let excluded = 0;
  const summary = { files: names.length, withGuidance: 0, withoutGuidance: 0, completed: 0, aborted: 0, interrupted: 0,
    checks: { allow: 0, ask: 0, deny: 0 }, tools: { ok: 0, error: 0, denied: 0 } };
  for (const name of names) {
    const path = join(directory, name);
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BYTES) throw new Error('Unsafe observation file');
    for (const r of parseModObservations(await readFile(path, 'utf8'))) {
      if (name !== `${r.runId}.json`) throw new Error('Observation namespace mismatch');
      if (seen.has(r.id)) throw new Error('Replayed observation');
      seen.add(r.id);
      if (bundleId && r.bundleId !== bundleId) { excluded++; continue; }
      observations++;
      summary[r.ruleIds.length ? 'withGuidance' : 'withoutGuidance']++;
      summary[r.completion]++;
      for (const key of ['allow', 'ask', 'deny'] as const) summary.checks[key] += r.checks[key];
      for (const key of ['ok', 'error', 'denied'] as const) summary.tools[key] += r.tools[key];
      for (const ruleId of r.ruleIds) {
        const key = `${r.bundleId}:${r.sourceRevision}:${ruleId}`;
        const group = groups.get(key) ?? { bundleId: r.bundleId, sourceRevision: r.sourceRevision, ruleId, observations: 0, affectedObservations: 0,
          toolErrors: 0, toolExecutions: 0, deniedTools: 0, deniedChecks: 0, permissionChecks: 0, aborted: 0, interrupted: 0, completed: 0 };
        group.observations++;
        group.affectedObservations += r.tools.error > 0 || r.tools.denied > 0 || r.checks.deny > 0 || r.completion !== 'completed' ? 1 : 0;
        group.toolErrors += r.tools.error;
        group.toolExecutions += r.tools.ok + r.tools.error;
        group.deniedTools += r.tools.denied;
        group.deniedChecks += r.checks.deny;
        group.permissionChecks += r.checks.allow + r.checks.ask + r.checks.deny;
        group[r.completion]++;
        groups.set(key, group);
      }
    }
  }
  return {
    version: 1, status: 'pending-independent-verification', verified: false, learningEligible: false,
    observations, excluded, summary,
    candidates: [...groups.values()].sort((a, b) => b.affectedObservations - a.affectedObservations || b.toolErrors - a.toolErrors ||
      b.deniedChecks - a.deniedChecks || a.bundleId.localeCompare(b.bundleId) || a.sourceRevision.localeCompare(b.sourceRevision) || a.ruleId.localeCompare(b.ruleId))
      .map(group => ({ ...group, verified: false, learningEligible: false,
        toolErrorRate: group.toolExecutions ? group.toolErrors / group.toolExecutions : null,
        deniedCheckRate: group.permissionChecks ? group.deniedChecks / group.permissionChecks : null,
        reviewReasons: [group.toolErrors ? 'observed tool errors' : '', group.deniedTools ? 'denied tool calls' : '', group.deniedChecks ? 'denied checks' : '',
          group.aborted ? 'aborted turns' : '', group.interrupted ? 'interrupted turns' : ''].filter(Boolean),
      })),
    interpretation: 'Activity correlations only. Completed turns are not accepted successes; displayed rules are not proven causes.',
    requiredBeforeLearning: ['task-bound acceptance evidence', 'held-out baseline and candidate evaluation', 'authorized promotion'],
  };
}
