/**
 * Vendored `$.ruflo` contract (ruflo-mods, ADR-404), the subset ruflo-ruos
 * uses. Source of truth: plugins/ruflo-mods/types/index.d.ts — kept in step
 * by tests/vendored-types.test.mjs. Where the ruflo mod is not seated there
 * is no `$.ruflo` and a call rejects; ruflo-ruos catches and draws nothing.
 */
export type RufloSegment = { id: string; text: string | null }

declare module 'claude-code' {
  interface EngineInterface {
    ruflo: {
      /** Sets (or with `text: null` removes) one status bar segment. */
      segment: (input: RufloSegment) => Promise<void>
    }
  }
}
