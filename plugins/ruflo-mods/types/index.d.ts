/**
 * The `$.ruflo` noun (ADR-404): the one contract for it, exported here and
 * declared on `EngineInterface`, as the telemetry mod keeps `$.telemetry`'s.
 *
 * The ruflo mod adds it in the `engine.create` fold. Every method is flat,
 * `$.ruflo.<method>(input)`, the only shape `claude plugin validate` accepts.
 * Where the ruflo mod is not seated there is no `$.ruflo`, and a call rejects:
 * a consumer (ruOS, ruflo-ruos, ruflo-swarm) catches and degrades.
 *
 * Stable: other mods vendor this file with a parity test. A change here is a
 * breaking change for them; add, never rename.
 */

/**
 * One segment of the ruflo status bar, contributed by another mod.
 *
 * `id`: 1-32 characters of letters, digits, `_` or `-`, the contributor's
 * own name (`ruos`). `text`: what to show; `null` (or text that sanitises to
 * nothing) removes the segment. Text is untrusted: control and bidi-override
 * characters are stripped, whitespace collapsed, and it is cut to 48
 * characters. At most 8 segments; a new id past that rejects. Segments are
 * shown sorted by id, after ruflo's own parts.
 */
export type RufloSegment = { id: string; text: string | null }

/** The last prompt route the mod made, as the model was told it. */
export type RufloRoute = {
  agent: string
  /** A heuristic prior, not a calibrated probability: 0.6 on a keyword match, 0.3 on none (#3567). */
  confidence: number
  matched: boolean
  reason: string
}

/** What the mod knows this process: nothing estimated, nothing invented. */
export type RufloSnapshot = {
  /** Classic events the mod runs in-process; empty when classic hooks keep them. */
  owned: readonly ('route' | 'post-edit')[]
  routed: number
  lastRoute: RufloRoute | null
  /** `none`: no ruflo policy for Claude Code tools. `unreadable`: present, failing closed. */
  policy: 'none' | 'observe' | 'enforce' | 'unreadable'
  /** Tool calls ruflo tightened (allow to ask or deny, ask to deny). */
  tightened: number
  /** Calls observe-mode policy would have tightened. */
  observed: number
  edits: number
  /** Absent when no budget is set. */
  budget?: { level: 'OK' | 'INFO' | 'WARNING' | 'CRITICAL' | 'HARD_STOP'; usd?: number; limit: number }
  segments: readonly { id: string; text: string }[]
}

export type Ruflo = {
  /** Sets (or with `text: null` removes) one status bar segment. */
  segment: (input: RufloSegment) => Promise<void>
  /** The last route, or null before the first owned prompt. */
  lastRoute: () => Promise<RufloRoute | null>
  /** Everything above at once. */
  snapshot: () => Promise<RufloSnapshot>
}

declare module 'claude-code' {
  interface EngineInterface {
    /** ruflo's routing, policy and status state; present where the ruflo mod is seated. */
    ruflo: Ruflo
  }
}
