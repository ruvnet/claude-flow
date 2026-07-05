/**
 * Embedding policy — "no more stubs" enforcement.
 *
 * Every embedder in the codebase tries REAL models first (Lattice WASM →
 * ruvector ONNX → AgentDB bridge → transformers.js) and only falls back to a
 * deterministic HASH embedding when none loads. A hash embedding has no semantic
 * meaning — it silently degrades similarity search into noise.
 *
 * This module makes that failure mode a POLICY choice instead of a silent
 * default. With RUFLO_REQUIRE_REAL_EMBEDDINGS truthy, any hash last-resort throws
 * loudly ("no stubs") rather than returning a meaningless vector — fail-closed,
 * so a broken embedding substrate is a hard error, not corrupt retrieval.
 *
 * Default (unset): unchanged behavior (warn + degrade), so nothing breaks for
 * installs where a real embedder genuinely can't load. Set the flag in any
 * environment that must never serve pseudo-embeddings.
 */
export function requireRealEmbeddings(): boolean {
  return /^(1|true|yes|on|strict)$/i.test(process.env.RUFLO_REQUIRE_REAL_EMBEDDINGS ?? '');
}

/** Throw the canonical "no stubs" error if strict mode is on; else no-op. */
export function enforceNoStub(where: string): void {
  if (requireRealEmbeddings()) {
    throw new Error(
      `[no-stub] real embeddings required but only a hash fallback was available at ${where}. ` +
      `RUFLO_REQUIRE_REAL_EMBEDDINGS is set — install a real embedder ` +
      `(ruvector, or @claude-flow/embeddings with "embeddings init --download") ` +
      `or unset the flag to allow degraded hash embeddings.`,
    );
  }
}
