import { anyWindow, scanWindows, windows } from '../guidance/screen'

/** Delivery origins that are the person's own or the lead's harness: never screened, so a screen cannot eat the user's prompt. */
const TRUSTED_ORIGINS: ReadonlySet<string> = new Set(['bridge', 'coordinator', 'scheduled-trigger'])

/**
 * Inbound-only rules beyond the shared injection screen, aimed at what a peer or relay sends to an agent: authority and goal
 * reassignment, mode switches, covert actions, prompt disclosure. Tighten-only, so an over-match costs one dropped delivery.
 */
const PEER_RULES: readonly (readonly [string, RegExp])[] = [
  ['mode switch', /\b(?:developer|god|dan|jailbreak(?:en)?|unrestricted) mode\b|\bno (?:limits|restrictions|filters)\b/i],
  ['goal replacement', /\byour (?:new|actual|real|true) (?:goal|task|mission|job|purpose)\b/i],
  ['authority reassignment', /\b(?:stop|do not|don't) following? the (?:user|operator|human)\b|\bfollow me instead\b|\btreat\b[^.\n]{0,40}\bmessages?\b[^.\n]{0,40}\b(?:from|as)\b[^.\n]{0,20}\b(?:user|operator|system|admin)\b|\bi (?:order|command) you\b/i],
  ['skip safeguards', /\b(?:skip|bypass|disable|circumvent)\b[^.\n]{0,25}\b(?:permissions?|safety|security|guards?|guardrails?|approvals?|safeguards?)\b|\bwithout asking (?:the )?(?:user|human|operator)\b/i],
  ['prompt disclosure', /\b(?:reveal|print|show|repeat|output|leak)\b[^.\n]{0,20}\b(?:your|the) (?:hidden |secret |full )?(?:system )?prompt\b/i],
  ['rules pretended away', /\bpretend\b[^.\n]{0,40}\b(?:rules?|polic(?:y|ies)|guidelines?|restrictions?)\b[^.\n]{0,20}\b(?:not exist|don't exist|do not exist|void)\b/i],
  ['covert action', /\b(?:silently|quietly|secretly|covertly)\b[^.\n]{0,30}\b(?:run|add|delete|remove|install|send|upload|write|execute|copy)\b/i],
]

const SSN = /\b\d{3}-\d{2}-\d{4}\b/

/** Whether a `session.receive` origin kind is screened. Unknown kinds are screened (the safe side for a tighten-only screen). */
export const isScreenedOrigin = (kind: string) => !TRUSTED_ORIGINS.has(kind)

/**
 * Rule id of the first injection phrase in an inbound delivery, or undefined.
 * Names only: the matched text is never returned. In-process, no network, no model.
 */
export function screenInbound(text: string): string | undefined {
  // The shared screen's windows, built once: invisible characters cannot split a phrase past the peer rules, and padding cannot hide one.
  const parts = windows(text)
  const shared = scanWindows(parts).injection[0]
  if (shared) return shared
  return PEER_RULES.find(([, re]) => anyWindow(parts, re))?.[0]
}

/** Rule id of the first secret shape (or US social security number) in an outbound message, or undefined. */
export function screenOutbound(text: string): string | undefined {
  const parts = windows(text)
  const found = scanWindows(parts)
  if (found.secrets.length) return found.secrets[0]
  return anyWindow(parts, SSN) ? 'us social security number' : undefined
}
