/**
 * Vendored `$.ruflo` contract (ruflo-mods, ADR-404): the subset ruflo-console calls. Source of truth:
 * plugins/ruflo-mods/types/index.d.ts, kept in step by tests/vendored-types.spec.ts. Where the ruflo mod is not seated
 * there is no `$.ruflo` and a call rejects; the console catches and says "ruflo-mods not seated".
 */
export type RufloSegment = { id: string; text: string | null }

export type RufloRoute = {
  agent: string
  confidence: number
  matched: boolean
  reason: string
}

export type RufloSnapshot = {
  owned: readonly ('route' | 'post-edit')[]
  routed: number
  lastRoute: RufloRoute | null
  policy: 'none' | 'observe' | 'enforce' | 'unreadable'
  tightened: number
  observed: number
  edits: number
  budget?: { level: 'OK' | 'INFO' | 'WARNING' | 'CRITICAL' | 'HARD_STOP'; usd?: number; limit: number }
  segments: readonly { id: string; text: string }[]
}

declare module 'claude-code' {
  interface EngineInterface {
    ruflo: {
      /** Sets (or with `text: null` removes) one status bar segment. */
      segment: (input: RufloSegment) => Promise<void>
      /** The last route, or null before the first owned prompt. */
      lastRoute: () => Promise<RufloRoute | null>
      /** Everything above at once. */
      snapshot: () => Promise<RufloSnapshot>
    }
  }
}
