/**
 * Entity tagger — regex-based proper-noun / structured-token extractor.
 *
 * Used by the `hybridSearch` controller as a third RRF arm alongside the
 * dense (vector) and sparse (BM25/FTS5) signals (ADR-147, ruvnet/ruflo#2317).
 *
 * Entity matching is a distinct signal because BM25 weights documents by
 * overall token frequency; a per-entity exact match avoids downweighting
 * for tokens that happen to be common but mention an entity by name.
 * Example: querying "Alice OAuth tokens" — BM25 may rank a doc about
 * generic OAuth above one mentioning Alice specifically; entity arm
 * surfaces the Alice doc independently.
 *
 * P1 is regex-only — no NLP model dependency. Tags:
 *   - Emails: foo@bar.com
 *   - URLs: http(s)://...
 *   - File paths: ./foo/bar.ts, C:\foo\bar.ts, src/foo
 *   - Quoted phrases: "..." or '...'
 *   - Proper-noun 2-grams: "Alice Smith", "Acme Corp"
 *
 * Deliberately conservative — false negatives are fine (the dense + sparse
 * arms still cover the query); false positives would dilute the RRF score
 * by adding noise rows. A future P2 can swap this for a CRF/spaCy tagger
 * behind the same `extractEntities(text)` contract.
 */

/**
 * Extract entity-like tokens from free text. Returns a unique list,
 * trimmed and deduplicated, in extraction order.
 */
export function extractEntities(text: string): string[] {
  if (!text) return [];

  const seen = new Set<string>();
  const ordered: string[] = [];

  const add = (raw: string | undefined): void => {
    if (!raw) return;
    const trimmed = raw.trim();
    if (trimmed.length < 2) return;
    if (seen.has(trimmed)) return;
    seen.add(trimmed);
    ordered.push(trimmed);
  };

  // Emails — anchored on @ so we don't pick up arbitrary handles.
  for (const m of text.matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g)) add(m[0]);

  // URLs — http(s) only. Stop at whitespace and common boundary chars.
  for (const m of text.matchAll(/https?:\/\/[^\s)>"'`]+/g)) add(m[0]);

  // File paths — two complementary patterns:
  //
  //   (a) Path with a file extension. Catches `src/foo/bar.ts`, the most
  //       common case. The extension (`.\w{1,5}`) is what separates a
  //       real path from prose like `and/or`.
  //
  //   (b) Path with an explicit leading sentinel: `./...`, `../...`, `/...`,
  //       or `C:\...`. Catches extensionless paths the user clearly meant
  //       (like `./scripts/build` or `/etc/hosts`).
  for (const m of text.matchAll(
    /(?:[A-Za-z]:[\\/])?(?:[\w.-]+[\\/])+[\w-]+\.\w{1,5}\b/g,
  )) {
    add(m[0]);
  }
  for (const m of text.matchAll(/(?:\.{1,2}|[A-Za-z]:)[\\/][\w./\\-]+/g)) add(m[0]);

  // Quoted phrases. Inner content only, both quote styles. The
  // (?<!\w)/(?!\w) guards keep us from pairing a *closing* quote of one
  // phrase with the *opening* quote of the next — e.g. `"a" over "b"`
  // should NOT capture ` over ` from positions 9–16.
  for (const m of text.matchAll(/(?<!\w)"([^"]{2,})"(?!\w)/g)) add(m[1]);
  for (const m of text.matchAll(/(?<!\w)'([^']{2,})'(?!\w)/g)) add(m[1]);

  // Proper-noun 2+ grams — capitalized words with capitalized neighbours.
  // Skip single capitals (too noisy: sentence-initial common nouns).
  for (const m of text.matchAll(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g)) add(m[0]);

  return ordered;
}
