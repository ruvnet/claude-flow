/**
 * Feedback applier — close the loop (ADR-176 phase 9).
 *
 * A proven champion adopted by the propagation channel (ADR-177,
 * proven-config-refresh.ts writes `.claude/proven-config.json`) is inert until
 * something *applies* it to what ruflo actually runs. This applier promotes the
 * adopted champion to the ACTIVE harness policy that routing/agents consume —
 * reversibly (keeps the previous pointer) and provenance-tagged (ADR-171), so
 * it composes with the promote-gate discipline rather than bypassing it. It only
 * ever sets a pointer to a proven, signed champion; it never invents config.
 * Zero deps, $0.
 */
import * as fs from 'fs';
import * as path from 'path';

export const ADOPTED_CONFIG_FILE = 'proven-config.json';         // written by proven-config-refresh (in .claude)
export const ACTIVE_POLICY_FILE = 'harness-active-policy.json';  // consumed by routing/agents (in .claude-flow)

export interface ActivePolicy {
  championId: string;      // manifest.policy.ref
  provenanceTier: string;  // 'oracle:test-exec' | 'judge:fable' (proxy can never reach here)
  layer?: string;
  appliedAt: number;
  previous?: string | null; // the champion this superseded (rollback pointer)
  rolledBack?: boolean;
  params?: Record<string, unknown>; // the champion's policy payload (manifest.policy.value) consumers read
}

export interface ApplyResult { applied: boolean; from?: string | null; to?: string; reason?: string }

interface AdoptedRecord {
  championId: string;
  manifest?: { layer?: string; policy?: { value?: Record<string, unknown> }; receipt?: { redblue?: string }; rollback?: { previousManifest?: string } };
  previous?: string | null;
}

function readJson<T>(p: string): T | null {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')) as T; } catch { return null; }
}

/**
 * Apply the adopted champion to the active harness policy. Idempotent (applying
 * the same champion is a no-op), reversible (records the superseded champion),
 * best-effort. `now` is injectable for tests.
 */
export function applyChampion(cwd: string, opts: { now?: number } = {}): ApplyResult {
  try {
    const claudeDir = path.join(cwd, '.claude');
    const adopted = readJson<AdoptedRecord>(path.join(claudeDir, ADOPTED_CONFIG_FILE));
    if (!adopted?.championId) return { applied: false, reason: 'no adopted champion' };

    const cfDir = path.join(cwd, '.claude-flow');
    const activePath = path.join(cfDir, ACTIVE_POLICY_FILE);
    const current = readJson<ActivePolicy>(activePath);
    if (current?.championId === adopted.championId && !current.rolledBack) {
      return { applied: false, reason: 'already active' }; // idempotent
    }

    const active: ActivePolicy = {
      championId: adopted.championId,
      // A champion only reaches adoption if it cleared the promote-gate, so it is
      // oracle/judge-backed; proxy can never be here (ADR-171). Default oracle.
      provenanceTier: 'oracle:test-exec',
      layer: adopted.manifest?.layer,
      appliedAt: opts.now ?? Date.now(),
      previous: current?.championId ?? adopted.previous ?? null,
      params: adopted.manifest?.policy?.value,
    };
    fs.mkdirSync(cfDir, { recursive: true });
    fs.writeFileSync(activePath, JSON.stringify(active, null, 2), 'utf-8');
    return { applied: true, from: active.previous, to: active.championId };
  } catch (e) {
    return { applied: false, reason: `error: ${(e as Error)?.message ?? e}` };
  }
}

/**
 * Apply a champion directly by its config payload (local self-optimization,
 * ADR-176 flywheel). Unlike applyChampion (which reads a propagated, signed,
 * adopted record), this activates a LOCALLY-mined champion that just cleared the
 * install's own measured gate — no signing, because nothing is propagated. Still
 * reversible (records `previous`) and idempotent. Consumers read `params`.
 */
export function applyChampionParams(
  cwd: string,
  opts: { championId: string; params?: Record<string, unknown>; layer?: string; previous?: string | null; now?: number },
): ApplyResult {
  try {
    const cfDir = path.join(cwd, '.claude-flow');
    const activePath = path.join(cfDir, ACTIVE_POLICY_FILE);
    const current = readJson<ActivePolicy>(activePath);
    if (current?.championId === opts.championId && !current.rolledBack) return { applied: false, reason: 'already active' };
    const active: ActivePolicy = {
      championId: opts.championId,
      provenanceTier: 'oracle:test-exec', // only a gate-cleared champion reaches here
      layer: opts.layer,
      appliedAt: opts.now ?? Date.now(),
      previous: opts.previous ?? current?.championId ?? null,
      params: opts.params,
    };
    fs.mkdirSync(cfDir, { recursive: true });
    fs.writeFileSync(activePath, JSON.stringify(active, null, 2), 'utf-8');
    return { applied: true, from: active.previous, to: active.championId };
  } catch (e) {
    return { applied: false, reason: `error: ${(e as Error)?.message ?? e}` };
  }
}

/**
 * Reverse the last apply: point the active policy back at its `previous`
 * champion (reversibility, ADR-177 rollback pointer). No-op if there is no
 * previous. The previous champion's policy is fetched by ref by consumers.
 */
export function rollbackActivePolicy(cwd: string, opts: { now?: number } = {}): ApplyResult {
  try {
    const activePath = path.join(cwd, '.claude-flow', ACTIVE_POLICY_FILE);
    const current = readJson<ActivePolicy>(activePath);
    if (!current) return { applied: false, reason: 'no active policy' };
    if (!current.previous) return { applied: false, reason: 'no previous to roll back to' };
    const reverted: ActivePolicy = {
      championId: current.previous,
      provenanceTier: current.provenanceTier,
      layer: current.layer,
      appliedAt: opts.now ?? Date.now(),
      previous: null,
      rolledBack: true,
    };
    fs.writeFileSync(activePath, JSON.stringify(reverted, null, 2), 'utf-8');
    return { applied: true, from: current.championId, to: reverted.championId };
  } catch (e) {
    return { applied: false, reason: `error: ${(e as Error)?.message ?? e}` };
  }
}

/** The champion routing/agents should currently use, or null. */
export function activeChampion(cwd: string): ActivePolicy | null {
  return readJson<ActivePolicy>(path.join(cwd, '.claude-flow', ACTIVE_POLICY_FILE));
}
