/**
 * Frozen public human-labeled eval set (ADR-176 — anti-overfitting).
 *
 * The flywheel's compounding gains are measured on a self-supervised retrieval
 * benchmark, which could overfit — improving self-retrieval while human
 * relevance stays merely *preserved*, not improved. The defense is a SINGLE,
 * FROZEN, PUBLIC, hashed human-labeled eval set (`.claude/eval/…-v1.json`):
 *   - it is the red/blue anchor the flywheel must never regress, AND
 *   - the set against which a per-generation HUMAN-RELEVANCE DELTA is recorded
 *     in every receipt — so "self-retrieval up, human relevance flat" is
 *     observable in the lineage, not hidden.
 *
 * `loadFrozenHumanEval()` verifies the file's content hash against a PINNED
 * constant and throws on mismatch — the set cannot silently drift; changing it
 * means shipping a new versioned file, not editing this one.
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { createHash } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const FROZEN_HUMAN_EVAL_VERSION = 'human-relevance-frozen-v1';
export const FROZEN_HUMAN_EVAL_FILE = path.join('.claude', 'eval', `${FROZEN_HUMAN_EVAL_VERSION}.json`);
/** Pinned canonical hash of the frozen eval tasks — the tamper-evidence anchor. */
export const FROZEN_HUMAN_EVAL_HASH = 'sha256:6096e48ef8f2182e0f00348a953f0f00fe0415575b300234fe2316f37b768200';

export interface HumanEvalTask { id: string; q: string; labels: string[]; }
export interface FrozenHumanEval { version: string; tasks: HumanEvalTask[]; corpusHash: string; }

function canon(v: unknown): unknown {
  return Array.isArray(v) ? v.map(canon)
    : (v && typeof v === 'object') ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])])) : v;
}
/** Canonical content hash over the tasks — order-independent (tasks sorted by id). */
export function humanEvalHash(tasks: HumanEvalTask[]): string {
  const sorted = [...tasks].sort((a, b) => a.id.localeCompare(b.id));
  return 'sha256:' + createHash('sha256').update(JSON.stringify(canon(sorted))).digest('hex');
}

function locate(): string | null {
  const candidates: string[] = [];
  try {
    const req = createRequire(import.meta.url);
    candidates.push(path.join(path.dirname(req.resolve('@claude-flow/cli/package.json')), FROZEN_HUMAN_EVAL_FILE));
  } catch { /* not resolvable in this context */ }
  candidates.push(path.resolve(__dirname, '..', '..', '..', FROZEN_HUMAN_EVAL_FILE)); // dist/src/services → pkg root
  candidates.push(path.resolve(__dirname, '..', '..', FROZEN_HUMAN_EVAL_FILE));        // src/services → pkg root
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return null;
}

/**
 * Load + verify the frozen human eval set. Throws if missing or if its content
 * hash != the pinned FROZEN_HUMAN_EVAL_HASH (the "frozen" guarantee).
 */
export function loadFrozenHumanEval(): FrozenHumanEval {
  const p = locate();
  if (!p) throw new Error(`frozen human eval set not found (${FROZEN_HUMAN_EVAL_FILE})`);
  const parsed = JSON.parse(fs.readFileSync(p, 'utf-8')) as { version?: string; tasks?: HumanEvalTask[] };
  const tasks = parsed.tasks ?? [];
  const corpusHash = humanEvalHash(tasks);
  if (corpusHash !== FROZEN_HUMAN_EVAL_HASH) {
    throw new Error(`frozen human eval hash mismatch — set has drifted (got ${corpusHash}, pinned ${FROZEN_HUMAN_EVAL_HASH}); supersede with a new versioned file, do not edit`);
  }
  return { version: parsed.version ?? FROZEN_HUMAN_EVAL_VERSION, tasks, corpusHash };
}
