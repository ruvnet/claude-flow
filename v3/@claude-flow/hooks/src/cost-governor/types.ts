/**
 * cost-governor/types.ts — ADR-179 Dynamic Harness Cost Governor.
 *
 * Common schema + config loader shared by all five sub-features. Env var /
 * CLI flag names match docs/harness-cost-governor.md (the user-facing flag
 * contract) — that doc wins over ADR-179's `RUFLO_COST_GOV_*` wording on any
 * naming conflict.
 *
 * @module @claude-flow/hooks/cost-governor/types
 */

/** One event per model completion (not per token — see ADR-179 sub-feature 3). */
export interface CostEvent {
  v: 1;
  ts: string; // ISO-8601
  correlation_id: string; // ties an event to a turn/task/swarm run
  task_id?: string;
  agent_id?: string;
  session_id: string;
  model: string; // concrete model id (model-prices.ts key)
  tier: 'codemod' | 'haiku' | 'sonnet-opus';
  tokens_in: number;
  tokens_out: number;
  cost_usd: number; // computed via injected costUsd() callback — see events.ts
  trimmed_entries?: number; // populated by sub-feature 1 for this completion
  batched_calls?: number; // populated by sub-feature 2 for this completion
  diversity_score?: number; // populated by sub-feature 5 when active
}

export interface CostGovernorConfig {
  /** Master gate — RUFLO_COST_GOVERNOR env / --cost-governor[=on|off] CLI. */
  enabled: boolean;
  contextTrim: { enabled: boolean; maxTurnAge: number; minRetrievalScore: number };
  toolBatch: { enabled: boolean; windowMs: number; maxBatchSize: number };
  costEvents: { enabled: boolean; path: string };
  moeFeedback: { enabled: boolean };
  diversityGate: { enabled: boolean; floor: number; enforce: 'warn' | 'reject' };
}

const DEFAULT_TRIM_AGE_TURNS = 3;
const DEFAULT_TRIM_SCORE_FLOOR = 0.4;
const DEFAULT_BATCH_COALESCE_MS = 500;
const DEFAULT_BATCH_MAX_SIZE = 8;
const DEFAULT_DIVERSITY_FLOOR = 0.2;
const DEFAULT_COST_EVENTS_PATH = '.swarm/cost-events.jsonl';

function parseBoolFlag(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const v = value.trim().toLowerCase();
  if (v === '' || v === '1' || v === 'true' || v === 'on') return true;
  if (v === '0' || v === 'false' || v === 'off') return false;
  return undefined;
}

function parseFloatEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

function parseIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

/** Find a `--flag` / `--flag=value` in argv; returns the value string ('' when bare) or undefined when absent. */
function findCliFlag(argv: string[], flag: string): string | undefined {
  for (const arg of argv) {
    if (arg === `--${flag}`) return '';
    if (arg.startsWith(`--${flag}=`)) return arg.slice(flag.length + 3);
  }
  return undefined;
}

/**
 * Load the Cost Governor config from env vars + CLI argv. All five
 * sub-features are off unless the master gate (`RUFLO_COST_GOVERNOR` /
 * `--cost-governor[=on|off]`) is on — CLI flag takes precedence over env
 * when both are present. `--diversity-gate=off` is the one granular
 * override (force-disables the diversity gate regardless of master).
 */
export function loadCostGovernorConfig(argv: string[] = process.argv.slice(2)): CostGovernorConfig {
  const cliMaster = parseBoolFlag(findCliFlag(argv, 'cost-governor'));
  const envMaster = parseBoolFlag(process.env.RUFLO_COST_GOVERNOR);
  const enabled = cliMaster ?? envMaster ?? false;

  const cliDiversityGate = parseBoolFlag(findCliFlag(argv, 'diversity-gate'));
  const diversityGateEnabled = cliDiversityGate === false ? false : enabled;

  return {
    enabled,
    contextTrim: {
      enabled,
      maxTurnAge: parseIntEnv('RUFLO_COST_GOVERNOR_TRIM_AGE_TURNS', DEFAULT_TRIM_AGE_TURNS),
      minRetrievalScore: parseFloatEnv('RUFLO_COST_GOVERNOR_TRIM_SCORE_FLOOR', DEFAULT_TRIM_SCORE_FLOOR),
    },
    toolBatch: {
      enabled,
      windowMs: parseIntEnv('RUFLO_COST_GOVERNOR_BATCH_COALESCE_MS', DEFAULT_BATCH_COALESCE_MS),
      maxBatchSize: DEFAULT_BATCH_MAX_SIZE,
    },
    costEvents: {
      enabled,
      path: process.env.RUFLO_COST_GOVERNOR_EVENTS_PATH?.trim() || DEFAULT_COST_EVENTS_PATH,
    },
    moeFeedback: { enabled },
    diversityGate: {
      enabled: diversityGateEnabled,
      floor: parseFloatEnv('RUFLO_COST_GOVERNOR_DIVERSITY_FLOOR', DEFAULT_DIVERSITY_FLOOR),
      enforce: 'warn',
    },
  };
}
