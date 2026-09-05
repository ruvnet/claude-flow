/**
 * run-transcript-recorder.ts — Opt-in FULL run-transcript recorder for the
 * weight-eft training-data export path (agenticow / ADR-150 weight-eft slice).
 *
 * WHY THIS EXISTS
 * ---------------
 * The existing `router-trajectory.ts` recorder captures only the ROUTING
 * DECISION for a task: task text, embedding, scalar quality, tokens, cost.
 * `@metaharness/weight-eft` needs something the routing recorder never had —
 * the full ReAct message TRANSCRIPT, the produced patch, and a resolved
 * boolean — to build SFT/DPO training rows. This module is that missing
 * capture surface. It writes one JSON-line per completed run to
 * `.swarm/run-transcripts.jsonl`, in a shape the archive-builder in
 * `services/weight-eft.ts` maps directly to `DarwinTrajectory[]`.
 *
 * OFF BY DEFAULT (PII / RETENTION SURFACE)
 * ----------------------------------------
 * Rows carry the FULL prompt + assistant transcript + patch — a much larger
 * PII/retention surface than the routing recorder. Mirroring why
 * router-trajectory.ts is off-by-default, every write goes through the
 * `CLAUDE_FLOW_RUN_TRANSCRIPTS=1` env gate. When unset (the default),
 * `recordRunTranscript()` is a no-op. There is no way to enable it implicitly.
 *
 * HONESTY: `resolved` IS A PROXY
 * ------------------------------
 * `DarwinTrajectory.resolved` is meant to be GOLD-resolved status from the
 * official SWE-bench harness. Ruflo has NO SWE-bench oracle. Every record
 * therefore stamps `resolved_source` describing where the boolean actually
 * came from, so no downstream consumer can mistake a proxy for gold:
 *   - 'gold-oracle'      — a real conformant gold eval supplied it (never
 *                          ruflo today; reserved for an external caller)
 *   - 'output-verifier'  — ruflo's structural output-verifier confidence,
 *                          thresholded — an EXPLICIT proxy
 *   - 'api-success'      — the model returned without an API error — the
 *                          weakest proxy (says nothing about correctness)
 *   - 'external'         — supplied verbatim by the caller, provenance unknown
 *
 * ARCHITECTURAL CONSTRAINTS (mirror router-trajectory.ts / ADR-150)
 * -----------------------------------------------------------------
 * 1. OPT-IN — gated behind CLAUDE_FLOW_RUN_TRANSCRIPTS=1; default off.
 * 2. NEVER THROWS — every fs op is try/caught at the append boundary; a
 *    failed write is silent (DEBUG-logged) and never breaks the run.
 * 3. NO metaharness COUPLING — this module imports nothing from
 *    `@metaharness/*`; it only defines a portable record shape. The
 *    services/weight-eft.ts archive-builder does the (optional) mapping.
 *
 * SCHEMA (versioned, additive) — one JSONL row per completed run:
 *   { v, ts, instance_id, task_hash, model, tier, resolved, resolved_source,
 *     messages[], model_patch, sample?, source?, tokens?, cost_usd? }
 *
 * @module run-transcript-recorder
 */

import { appendFileSync, mkdirSync, existsSync, statSync, renameSync, unlinkSync, readFileSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';

import { taskHash } from './router-trajectory.js';

// ============================================================================
// Portable record shape (OpenAI-chat compatible; no @metaharness import)
// ============================================================================

/** An OpenAI-style tool call (the ReAct action). Mirrors weight-eft's ToolCall. */
export interface ToolCallLite {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

/** A chat message in an OpenAI-compatible transcript. Mirrors weight-eft's ChatMessage. */
export interface ChatMessageLite {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCallLite[];
  tool_call_id?: string;
  name?: string;
}

/** Where a `resolved` boolean actually came from (never silently "gold"). */
export type ResolvedSource = 'gold-oracle' | 'output-verifier' | 'api-success' | 'external';

/** Ruflo's cascade tier. haiku → 'cheap' (first tier), sonnet/opus → 'frontier'. */
export type RunTier = 'cheap' | 'frontier';

/** One persisted run transcript. Maps 1:1 to a DarwinTrajectory (+ provenance). */
export interface RunTranscriptRecord {
  v: 1;
  ts: string;
  instance_id: string;
  task_hash: string;
  model: string;
  tier: RunTier;
  resolved: boolean;
  resolved_source: ResolvedSource;
  messages: ChatMessageLite[];
  model_patch: string;
  sample?: number;
  source?: string;
  tokens?: { input: number; output: number };
  cost_usd?: number;
}

// ============================================================================
// Config + rotation (mirrors router-trajectory.ts)
// ============================================================================

interface RecorderConfig {
  enabled: boolean;
  path: string;
  maxSizeBytes: number;
  maxRotations: number;
}

let _cfg: RecorderConfig | null = null;
let _cachedSize = -1;

function getConfig(): RecorderConfig {
  if (_cfg !== null) return _cfg;
  const swarmDir = process.env.CLAUDE_FLOW_SWARM_DIR ?? resolvePath(process.cwd(), '.swarm');
  _cfg = {
    enabled: process.env.CLAUDE_FLOW_RUN_TRANSCRIPTS === '1',
    path: process.env.CLAUDE_FLOW_RUN_TRANSCRIPTS_PATH ?? join(swarmDir, 'run-transcripts.jsonl'),
    maxSizeBytes: parseInt(process.env.CLAUDE_FLOW_RUN_TRANSCRIPTS_MAXSIZE ?? `${25 * 1024 * 1024}`, 10) | 0,
    maxRotations: Math.max(0, parseInt(process.env.CLAUDE_FLOW_RUN_TRANSCRIPTS_MAXROTATIONS ?? '3', 10) || 3),
  };
  return _cfg;
}

function rotate(cfg: RecorderConfig): void {
  if (!existsSync(cfg.path)) return;
  try {
    if (cfg.maxRotations === 0) { unlinkSync(cfg.path); return; }
    const oldest = `${cfg.path}.${cfg.maxRotations}`;
    if (existsSync(oldest)) unlinkSync(oldest);
    for (let i = cfg.maxRotations - 1; i >= 1; i--) {
      const src = `${cfg.path}.${i}`;
      if (existsSync(src)) renameSync(src, `${cfg.path}.${i + 1}`);
    }
    renameSync(cfg.path, `${cfg.path}.1`);
  } catch {
    try { unlinkSync(cfg.path); } catch { /* */ }
  }
  _cachedSize = 0;
}

function appendRow(row: RunTranscriptRecord): void {
  const cfg = getConfig();
  if (!cfg.enabled) return;
  try {
    const dir = dirname(cfg.path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    if (_cachedSize < 0) {
      _cachedSize = existsSync(cfg.path) ? statSync(cfg.path).size : 0;
    }
    const line = JSON.stringify(row) + '\n';
    const bytes = Buffer.byteLength(line, 'utf8');
    if (cfg.maxSizeBytes > 0 && _cachedSize + bytes > cfg.maxSizeBytes) rotate(cfg);
    appendFileSync(cfg.path, line);
    _cachedSize += bytes;
  } catch (e) {
    if (process.env.DEBUG) {
      // eslint-disable-next-line no-console
      console.error('run-transcript: appendRow failed:', (e as Error).message);
    }
    // Never throw — transcript collection must never break a run.
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Record one completed run transcript. Cheap — a single appendFileSync of a
 * JSONL row. No-op when CLAUDE_FLOW_RUN_TRANSCRIPTS is unset (the default).
 * Never throws.
 *
 * `resolvedSource` is REQUIRED so a proxy can never masquerade as gold. If you
 * only have "the API returned", pass 'api-success' — the honest weakest label.
 */
export function recordRunTranscript(args: {
  /** Task/issue text — used for the FNV hash + default instance id. */
  task: string;
  /** Concrete model id that produced the run (e.g. "claude-haiku-4"). */
  model: string;
  /** Ruflo cascade tier of `model`. */
  tier: RunTier;
  /** The resolved boolean (see resolvedSource for what it actually means). */
  resolved: boolean;
  /** Provenance of `resolved`. Never omit — honesty is the point. */
  resolvedSource: ResolvedSource;
  /** OpenAI-shaped message transcript (system/user/assistant/tool). */
  messages: ChatMessageLite[];
  /** Unified diff the run produced. '' when the path produces no patch. */
  modelPatch?: string;
  /** Override the default "run-<hash>" instance id (contamination key). */
  instanceId?: string;
  /** Best-of-N sample index on the same instance (default 0). */
  sample?: number;
  /** Provenance tag, e.g. "agent-execute", "autopilot". */
  source?: string;
  tokens?: { input: number; output: number };
  costUsd?: number;
}): { recorded: boolean; instanceId: string; taskHash: string } {
  const cfg = getConfig();
  const hash = taskHash(args.task);
  const instanceId = args.instanceId ?? `run-${hash}`;
  if (!cfg.enabled) return { recorded: false, instanceId, taskHash: hash };

  const row: RunTranscriptRecord = {
    v: 1,
    ts: new Date().toISOString(),
    instance_id: instanceId,
    task_hash: hash,
    model: args.model,
    tier: args.tier,
    resolved: args.resolved,
    resolved_source: args.resolvedSource,
    messages: args.messages,
    model_patch: args.modelPatch ?? '',
    ...(args.sample !== undefined ? { sample: args.sample } : {}),
    ...(args.source ? { source: args.source } : {}),
    ...(args.tokens ? { tokens: args.tokens } : {}),
    ...(args.costUsd != null ? { cost_usd: args.costUsd } : {}),
  };
  appendRow(row);
  return { recorded: true, instanceId, taskHash: hash };
}

/**
 * Read + parse the run-transcript JSONL back into records. Used by the
 * archive-builder (`services/weight-eft.ts`). Malformed lines are skipped and
 * counted, never thrown. Returns `[]` if the file is absent.
 */
export function readRunTranscripts(path?: string): { records: RunTranscriptRecord[]; malformed: number; path: string } {
  const p = path ?? getConfig().path;
  if (!existsSync(p)) return { records: [], malformed: 0, path: p };
  const records: RunTranscriptRecord[] = [];
  let malformed = 0;
  try {
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const r = JSON.parse(line) as RunTranscriptRecord;
        if (r && typeof r === 'object' && r.v === 1 && r.instance_id && Array.isArray(r.messages)) {
          records.push(r);
        } else {
          malformed++;
        }
      } catch { malformed++; }
    }
  } catch {
    // unreadable file — treat as empty, never throw
  }
  return { records, malformed, path: p };
}

/** Map a ruflo model tier label to the weight-eft policy tier. */
export function tierForModel(model: string | undefined): RunTier {
  // haiku (and any explicitly-cheap label) → 'cheap' (cascade first tier).
  // sonnet / opus / everything else → 'frontier' (the escalation tier).
  if (!model) return 'frontier';
  return /haiku/i.test(model) ? 'cheap' : 'frontier';
}

/** Diagnostic for status/CLI. */
export function runTranscriptRecorderStatus(): {
  enabled: boolean; path: string; maxSizeBytes: number; maxRotations: number;
} {
  return { ...getConfig() };
}

/** @internal — test seam: reset cached config so tests can flip env vars. */
export function __resetRunTranscriptRecorderForTests(): void {
  _cfg = null;
  _cachedSize = -1;
}
