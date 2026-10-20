/**
 * Default relevance floor for memory search (#4129).
 *
 * The bundled 384-dim embedding model scores a correct paraphrase match at
 * roughly 0.25-0.5 and unrelated text at 0.0-0.15, so the old 0.3 floor sent
 * back an empty list for natural-language queries whose right answer was
 * clearly the best match (0.28 in the report). 0.2 sits between the two
 * populations. An explicit `threshold` always wins, including 0.
 *
 * #2558 constraint stays: the fused recall score of a full-coverage exact
 * keyword hit with semantic cosine <= 0 tops out at 0.40, so this must stay
 * well below 0.4.
 */
export const DEFAULT_SEARCH_THRESHOLD = 0.2;

/** How many below-threshold matches an empty default search reports as hints. */
export const NEAR_MISS_LIMIT = 3;

interface NearMissSearch {
  (req: { query: string; namespace?: string; limit?: number; threshold?: number; provenanceFilter?: string[]; dbPath?: string }):
    Promise<{ success: boolean; results?: Array<{ key: string; namespace: string; score: number }> }>;
}

/**
 * When a search that used the DEFAULT threshold returns nothing, say what was
 * close instead of leaving the caller to assume the store has no answer
 * (#4129). One extra, cheap query at threshold 0; never throws; absent when
 * nothing at all matched.
 */
export async function nearMisses(
  search: NearMissSearch,
  req: { query: string; namespace?: string; provenanceFilter?: string[]; dbPath?: string },
): Promise<{ nearMisses: Array<{ key: string; namespace: string; similarity: number }>; hint: string } | undefined> {
  try {
    const r = await search({ ...req, limit: NEAR_MISS_LIMIT, threshold: 0 });
    if (!r?.success || !r.results?.length) return undefined;
    return {
      nearMisses: r.results.map(e => ({ key: e.key, namespace: e.namespace, similarity: e.score })),
      hint: `No result reached the default threshold (${DEFAULT_SEARCH_THRESHOLD}); the closest matches are in nearMisses. Pass threshold: 0 to include them in results.`,
    };
  } catch {
    return undefined;
  }
}
