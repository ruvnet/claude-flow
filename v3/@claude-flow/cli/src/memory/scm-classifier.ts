/**
 * Selective Context Memory (SCM) query-intent classifier (#2760).
 *
 * Dream-cycle #2760 (SCM routed memory 86% LongMemEval): agents perform
 * dramatically better on long-memory retrieval when the query is routed
 * to the RIGHT memory tier — episodic (session recall) vs semantic
 * (learned patterns) vs procedural (skills/recipes). Ruflo previously
 * had all these tiers writing to different namespaces but the search
 * command didn't discriminate — every query searched everything.
 *
 * v1 classifier: keyword-scored intent detection. Ships as a bounded
 * MVP so users can opt in via `memory search --intent auto|episodic|
 * semantic|procedural|mixed`. Default remains `mixed` (existing
 * behavior) so no baseline retrieval is disturbed.
 *
 * v2 (future): embedding-based classifier trained on the trajectory
 * store's actual routing outcomes.
 */

export type MemoryIntent = 'episodic' | 'semantic' | 'procedural' | 'mixed';

export interface ClassifiedIntent {
  intent: MemoryIntent;
  confidence: number;
  /** Per-intent scores for transparency; sums roughly to 1. */
  scores: Record<Exclude<MemoryIntent, 'mixed'>, number>;
  /** Namespaces the caller should search for this intent (relative to memory backend). */
  namespaces: string[];
  /** Human-readable rationale. */
  reason: string;
}

/**
 * Keyword catalog per intent — case-insensitive substring match.
 * Order matters for ties: earlier categories win when scores tie.
 */
const KEYWORDS: Record<Exclude<MemoryIntent, 'mixed'>, readonly string[]> = {
  episodic: [
    'when', 'last time', 'yesterday', 'today', 'session',
    'recent', 'recently', 'trajectory', 'did i', 'did we',
    'what happened', 'the previous', 'the last', 'earlier',
    'this morning', 'this afternoon', 'this evening',
  ],
  semantic: [
    'how does', 'what is', 'why', 'why does', 'concept',
    'pattern', 'design', 'architecture', 'principle',
    'means', 'meaning', 'definition', 'explanation',
    'relationship between',
  ],
  procedural: [
    'how do i', 'how to', 'steps to', 'recipe', 'playbook',
    'procedure', 'walk me through', 'guide', 'runbook',
    'checklist', 'template', 'workflow', 'skill',
  ],
};

/**
 * Namespaces owned by each intent. These match ruflo's actual
 * memory-write conventions:
 *   episodic  → session/trajectory writes (hooks_post-task, session-checkpoints)
 *   semantic  → pattern/learning writes (patterns/, learned-*, adr-patterns)
 *   procedural → skill/workflow writes (skills/, agents/, workflow-templates)
 * A namespace listed under more than one intent means it's genuinely dual-nature.
 */
const NAMESPACES: Record<Exclude<MemoryIntent, 'mixed'>, readonly string[]> = {
  episodic: [
    'sessions', 'session-checkpoints', 'trajectory', 'trajectories',
    'routing-outcomes', 'commands', 'feedback',
  ],
  semantic: [
    'patterns', 'learned-patterns', 'adr-patterns', 'adr-edges',
    'reasoning-patterns', 'concepts',
  ],
  procedural: [
    'skills', 'agents', 'workflow-templates', 'playbooks', 'recipes',
  ],
};

const CONFIDENCE_THRESHOLD = 0.35;

export function classifyQueryIntent(query: string): ClassifiedIntent {
  const q = query.toLowerCase();
  const scores: Record<Exclude<MemoryIntent, 'mixed'>, number> = {
    episodic: 0,
    semantic: 0,
    procedural: 0,
  };

  // Score by keyword hits (weighted by phrase length — longer phrases
  // are less ambiguous, e.g. "how do i" beats "how").
  for (const intent of Object.keys(KEYWORDS) as Array<keyof typeof KEYWORDS>) {
    for (const kw of KEYWORDS[intent]) {
      if (q.includes(kw)) {
        // Weight: longer keyword → higher confidence
        scores[intent] += Math.max(1, kw.length / 6);
      }
    }
  }

  const total = scores.episodic + scores.semantic + scores.procedural;
  if (total === 0) {
    return {
      intent: 'mixed',
      confidence: 0,
      scores,
      namespaces: [],
      reason: 'No intent keywords matched — falling back to mixed retrieval (search all namespaces).',
    };
  }

  // Normalize
  const normalized: Record<Exclude<MemoryIntent, 'mixed'>, number> = {
    episodic: scores.episodic / total,
    semantic: scores.semantic / total,
    procedural: scores.procedural / total,
  };

  // Pick the winner
  const entries: Array<[Exclude<MemoryIntent, 'mixed'>, number]> = [
    ['episodic', normalized.episodic],
    ['semantic', normalized.semantic],
    ['procedural', normalized.procedural],
  ];
  entries.sort((a, b) => b[1] - a[1]);

  const [winner, winnerScore] = entries[0];

  // Low-confidence winner → mixed
  if (winnerScore < CONFIDENCE_THRESHOLD) {
    return {
      intent: 'mixed',
      confidence: winnerScore,
      scores: normalized,
      namespaces: [],
      reason: `Top intent (${winner}) below confidence threshold ${CONFIDENCE_THRESHOLD} — falling back to mixed retrieval.`,
    };
  }

  return {
    intent: winner,
    confidence: winnerScore,
    scores: normalized,
    namespaces: [...NAMESPACES[winner]],
    reason: `Classified as ${winner} (confidence ${(winnerScore * 100).toFixed(1)}%) — route to ${NAMESPACES[winner].length} namespaces.`,
  };
}

/**
 * Given a user-requested intent (which may be `auto`), resolve to a
 * concrete ClassifiedIntent for the given query.
 */
export function resolveIntent(query: string, requested: MemoryIntent | 'auto' = 'auto'): ClassifiedIntent {
  if (requested === 'auto') return classifyQueryIntent(query);
  if (requested === 'mixed') {
    return {
      intent: 'mixed',
      confidence: 1,
      scores: { episodic: 0, semantic: 0, procedural: 0 },
      namespaces: [],
      reason: 'Explicitly requested mixed retrieval (search all namespaces).',
    };
  }
  return {
    intent: requested,
    confidence: 1,
    scores: { episodic: 0, semantic: 0, procedural: 0, [requested]: 1 } as Record<Exclude<MemoryIntent, 'mixed'>, number>,
    namespaces: [...NAMESPACES[requested]],
    reason: `Explicitly requested ${requested} retrieval — route to ${NAMESPACES[requested].length} namespaces.`,
  };
}

export { KEYWORDS as INTENT_KEYWORDS, NAMESPACES as INTENT_NAMESPACES };
