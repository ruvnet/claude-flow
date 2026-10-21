import type { MemberState, PulseKind } from '../model/members'

/**
 * Colours by the names of Claude Code's own theme, so they follow a dark or a light theme. ANSI names (`cyan`, `yellow`)
 * are whatever the terminal makes of them and fade on a white background.
 */
export const HEAD = 'suggestion'
export const GOOD = 'success'
export const BAD = 'error'
export const WARN = 'warning'
export const ACCENT = 'claude'

/** A tile's colour by state; idle is drawn dim instead. Every state also has its word, so colour is never the only cue. */
export const STATE_COLORS: Record<MemberState, string | undefined> = {
  idle: undefined,
  working: ACCENT,
  blocked: WARN,
  done: GOOD,
  failed: BAD,
}

export const STATE_GLYPHS: Record<MemberState, string> = { idle: '○', working: '●', blocked: '◆', done: '✓', failed: '✗' }

/** A lit tile: blue while its agent reads files, yellow while it writes, drawn inverse so it stands out of its state colour. */
export const PULSE_COLORS: Record<PulseKind, string> = { read: HEAD, write: WARN }
