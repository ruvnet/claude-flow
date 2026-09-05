/**
 * Corpus harvester — grows the benchmark yardstick from REAL store data so the
 * flywheel gets a bigger, fresher test set as ruflo is used (ADR-176).
 *
 * Self-supervised self-retrieval: a stored doc is unambiguous ground truth for a
 * query derived from its OWN body. To make it discriminative (so different
 * retrieval configs actually score differently — a usable gradient) the query is
 * built from body keywords with the doc's SUBJECT tokens removed: "can retrieval
 * find this doc from its content when the obvious title words are withheld?"
 * The label is the doc's identity — oracle-grade, not a proxy guess.
 *
 * This grows the auto signal; callers keep the human-labeled seed as a separate
 * NON-REGRESSION anchor (Goodhart guard) so optimizing self-retrieval can never
 * silently drift away from human relevance. Pure + deterministic (no RNG): the
 * sample is a fixed stride, so the same store yields the same corpus.
 */
import { createHash } from 'node:crypto';

export interface HarvestPattern { id: string; name?: string; content?: string; }

export interface HarvestedTask {
  id: string;
  input: { id: string; q: string; targetId: string };
  expected: string;          // the source doc id (self-identity oracle)
  provenanceTier: 'oracle:self-identity';
}

export interface BlendedCorpus {
  version: string;
  corpusHash: string;
  anchorIds: string[];       // ids of the human-labeled anchor tasks (never-regress set)
  tasks: Array<{ id: string; input: unknown; expected: unknown }>;
}

const STOP = new Set(['the', 'a', 'an', 'of', 'to', 'in', 'on', 'for', 'and', 'or', 'is', 'was', 'with', 'by', 'at', 'as', 'it', 'this', 'that', 'from', 'be', 'are', 'so', 'if', 'we', 'i', 'you', 'not', 'no', 'do', 'via', 'per']);

function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9][a-z0-9_-]{1,}/g) ?? []).filter((t) => !STOP.has(t));
}

/** Top-K body keywords with the subject tokens removed, most-frequent first. */
function deriveQuery(name: string, content: string, k = 6): string {
  const nameToks = new Set(tokenize(name));
  const freq = new Map<string, number>();
  for (const t of tokenize(content)) {
    if (nameToks.has(t)) continue;      // withhold the obvious title words
    freq.set(t, (freq.get(t) ?? 0) + 1);
  }
  return [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, k).map(([t]) => t).join(' ');
}

/**
 * Harvest up to `sample` self-retrieval tasks from real patterns. Deterministic
 * stride sampling (stable across runs); skips docs whose body is too thin to
 * form a discriminative query.
 */
export function harvestSelfSupervisedTasks(patterns: HarvestPattern[], opts: { sample?: number; minQueryTerms?: number } = {}): HarvestedTask[] {
  const sample = Math.max(1, opts.sample ?? 40);
  const minTerms = opts.minQueryTerms ?? 3;
  // Deterministic order: sort by id, then take an even stride to cover the store.
  const ordered = [...patterns].sort((a, b) => a.id.localeCompare(b.id));
  const stride = Math.max(1, Math.floor(ordered.length / sample));
  const out: HarvestedTask[] = [];
  for (let i = 0; i < ordered.length && out.length < sample; i += stride) {
    const p = ordered[i];
    const q = deriveQuery(p.name ?? '', p.content ?? '', 6);
    if (q.split(' ').filter(Boolean).length < minTerms) continue; // too thin → skip
    out.push({ id: `hv-${p.id}`, input: { id: `hv-${p.id}`, q, targetId: p.id }, expected: p.id, provenanceTier: 'oracle:self-identity' });
  }
  return out;
}

/** Content hash over the task ids+queries — changes iff the corpus changes. */
export function hashBlend(tasks: Array<{ id: string; input: unknown; expected: unknown }>): string {
  const canon = tasks.map((t) => `${t.id}|${JSON.stringify(t.input)}|${JSON.stringify(t.expected)}`).sort().join('\n');
  return 'sha256:' + createHash('sha256').update(canon).digest('hex');
}

/**
 * Blend a human-labeled anchor set with harvested tasks into one versioned,
 * hashed corpus. The version encodes the sizes + hash so it visibly grows as the
 * store does; `anchorIds` marks the never-regress subset.
 */
export function blendCorpus(
  anchor: Array<{ id: string; input: unknown; expected: unknown }>,
  harvested: HarvestedTask[],
): BlendedCorpus {
  const tasks = [...anchor, ...harvested.map((h) => ({ id: h.id, input: h.input, expected: h.expected }))];
  const corpusHash = hashBlend(tasks);
  return {
    version: `flywheel-a${anchor.length}-h${harvested.length}-${corpusHash.slice(7, 19)}`,
    corpusHash,
    anchorIds: anchor.map((a) => a.id),
    tasks,
  };
}
