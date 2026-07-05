/**
 * Flywheel runtime wiring (ADR-176) — binds runFlywheelTick to the LIVE neural
 * store + retrieval so the daemon can self-optimize on real data. Opt-in
 * (RUFLO_HARNESS_LOOP) and bounded; lazily imports neural-tools so the daemon
 * pays the ONNX cost only when actually running a tick. Never throws.
 */
import { harnessLoopOptedIn } from './harness-worker.js';
import { runFlywheelTick, type FlywheelDeps, type FlywheelResult, type RetrievalConfig, type AnchorTask } from './harness-flywheel.js';
import { runFlywheelGeneration, checkServedChampionDrift, type GenerationResult, type GenerationDeps } from './harness-flywheel-generations.js';
import { loadFrozenHumanEval } from './harness-frozen-eval.js';

/** The human-labeled ADR-081 anchor — the never-regress relevance set. */
const ANCHOR: AnchorTask[] = [
  ['how was the Opus model alias fixed', ['opus 4.8', 'opus alias', 'opus model alias', '#2232']],
  ['self-learning wiring task-completed pretrain', ['self-learning', 'adr-074', 'self learning', '#2245', 'task-completed']],
  ['deterministic codemod engine var-to-const', ['deterministic tier-1 codemod', 'adr-143', 'codemod', 'var-to-const']],
  ['MCP server orphan leak parent-death', ['mcp orphan', 'mcp servers orphan', 'parent-death', '#2234', 'orphan on every claude']],
  ['unified learning stats aggregator', ['unified learning-stats', 'adr-075', 'unified learning stats']],
  ['structured distillation 4-field schema', ['structured distillation', 'adr-076', '4-field schema']],
  ['SQL injection migrate.ts table identifier', ['sql injection', 'shell injection', 'migrate.ts', 'agentdb', 'cve']],
  ['recall@k HNSW benchmark harness', ['hnsw', 'memory-recall', 'benchmark suite', 'recall@k', 'benchmark intelligence']],
  ['Q-learning encoder keyword block', ['q-state encoder', 'route q-state', 'keyword block', '#2239', 'q-encoder']],
  ['security hardening crypto random IDs', ['cwe-347', 'crypto.randomuuid', 'security fix', 'random id', 'crypto random']],
].map(([q, labels], i) => ({ id: `q${String(i).padStart(2, '0')}`, input: { id: `q${String(i).padStart(2, '0')}`, q: q as string }, expected: labels as string[] }));

/**
 * Run one live flywheel tick against `projectRoot`. Opt-in + $0 default: with
 * RUFLO_HARNESS_LOOP unset it is a no-op. Best-effort; never throws.
 */
export async function runFlywheelWorker(
  projectRoot: string,
  opts: { sample?: number; optInOverride?: boolean; now?: number } = {},
): Promise<FlywheelResult> {
  try {
    if (!(opts.optInOverride ?? harnessLoopOptedIn())) return { ran: false, reason: 'opt-in required (RUFLO_HARNESS_LOOP=1)' };
    const neural = await import('../mcp-tools/neural-tools.js');
    const applier = await import('../config/harness-feedback-applier.js');
    const tool = neural.neuralTools.find((t) => t.name === 'neural_patterns');
    if (!tool) return { ran: false, reason: 'neural_patterns tool unavailable' };

    const deps: FlywheelDeps = {
      getPatterns: () => neural.getStorePatterns(),
      search: async (query, cfg: RetrievalConfig) => {
        const r = await tool.handler({ action: 'search', query, mode: 'hybrid', limit: 5, rerank: false, ...cfg }) as { results?: Array<{ id?: string; name?: string }> };
        return (r.results || []).slice(0, 5).map((m) => ({ id: m?.id ?? '', name: m?.name ?? '' }));
      },
      anchorTasks: ANCHOR,
      activeParams: () => (applier.activeChampion(projectRoot)?.params as Partial<RetrievalConfig>) ?? null,
      sample: opts.sample ?? 40,
      now: opts.now,
    };
    return await runFlywheelTick(projectRoot, deps);
  } catch (e) {
    return { ran: false, reason: `error: ${(e as Error)?.message ?? e}` };
  }
}

/**
 * Run ONE live COMPOUNDING generation against the persisted lineage (ADR-176
 * A-P3b — the autonomy loop). Reads the current champion as baseline, evaluates
 * a constrained candidate on the frozen self-supervised held-out with the human
 * anchor guard, and — on a verified promotion — advances the champion so the
 * NEXT daemon tick compounds on it. Shadow-first (serve lags one tick). Opt-in,
 * $0 default; never throws.
 */
export async function runFlywheelGenerationWorker(
  projectRoot: string,
  opts: { sample?: number; optInOverride?: boolean; now?: number } = {},
): Promise<GenerationResult> {
  try {
    if (!(opts.optInOverride ?? harnessLoopOptedIn())) return { ran: false, reason: 'opt-in required (RUFLO_HARNESS_LOOP=1)', generation: 0 };
    const neural = await import('../mcp-tools/neural-tools.js');
    const tool = neural.neuralTools.find((t) => t.name === 'neural_patterns');
    if (!tool) return { ran: false, reason: 'neural_patterns tool unavailable', generation: 0 };
    // Load the FROZEN, hashed, public human eval set (throws if it has drifted).
    const frozen = loadFrozenHumanEval();
    const deps: GenerationDeps = {
      getPatterns: () => neural.getStorePatterns(),
      search: async (query, cfg: RetrievalConfig) => {
        const r = await tool.handler({ action: 'search', query, mode: 'hybrid', limit: 5, rerank: false, ...cfg }) as { results?: Array<{ id?: string; name?: string }> };
        return (r.results || []).slice(0, 5).map((m) => ({ id: m?.id ?? '', name: m?.name ?? '' }));
      },
      anchorTasks: frozen.tasks,
      humanEvalHash: frozen.corpusHash,
      sample: opts.sample ?? 120,
      now: opts.now ?? Date.now(),
    };
    // Deployment-safety canary first: roll back the served champion if the real
    // store has drifted since it was promoted. Then run the next generation.
    await checkServedChampionDrift(projectRoot, deps);
    return await runFlywheelGeneration(projectRoot, deps);
  } catch (e) {
    return { ran: false, reason: `error: ${(e as Error)?.message ?? e}`, generation: 0 };
  }
}
