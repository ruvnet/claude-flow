import type { On } from 'claude-code'

import { under, type ModState } from '../state'
import { candidate, MAX_BYTES, MAX_PENDING, MAX_PER_SESSION, MAX_PER_TURN, OFFER_TOOLS, offerLine } from './paths'

/** A ruRE tool the session can call: `mcp__<server>__rure_analyze_binary`, the one every ruRE install carries. */
const RURE_TOOL = /__rure_analyze_binary$/

/**
 * The ruRE offer (ADR-498). Off unless the `rureOffer` option is on. When the model reads or writes a file ruRE can look inside (an
 * executable, a library, an Electron `.asar`, a CUDA `.cubin`), it adds ONE line beneath that turn's answer naming up to three such files
 * and how to inspect them without running them. It never runs ruRE, never denies or changes a tool call, never touches the transcript,
 * and is inert where the session has no ruRE tool or the answer is a subagent's.
 *
 * `tool.call` only records a path; `turn.complete` checks it is still a plain file of a size ruRE accepts, then says it once.
 */
export function registerRureOffer(on: On, state: ModState) {
  const offer = state.rureOffer

  offer.enabled = true

  on('session.start', async ($, e, next) => {
    const result = await next(e)

    try {
      offer.available = (await $.tool.list()).some(tool => tool.mcp && RURE_TOOL.test(tool.name))
    } catch {
      offer.available = false
    }

    return result
  })

  on('tool.call', async ($, e, next) => {
    const result = await next(e)

    if (!offer.available || (result as { deny?: unknown } | undefined)?.deny !== undefined || !OFFER_TOOLS.has(e.tool)) return result

    const path = candidate(state.root, (e as { file_path?: unknown }).file_path)

    if (path !== null && !offer.offered.has(path) && !offer.pending.includes(path) && offer.pending.length < MAX_PENDING) offer.pending.push(path)

    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)

    // Only the main loop's answer carries the line: a subagent's answer goes back to the model that asked for it.
    if (e.agentId !== undefined || offer.pending.length === 0) return result
    if (e.isAborted) {
      offer.pending.length = 0

      return result
    }

    const waiting = offer.pending.splice(0)
    const shown: string[] = []

    for (const path of waiting) {
      if (shown.length >= MAX_PER_TURN || offer.shown + shown.length >= MAX_PER_SESSION) break

      try {
        const stat = await $.fs.stat(under(state, path))

        if (stat.kind === 'file' && stat.isLink !== true && stat.size > 0 && stat.size <= MAX_BYTES) shown.push(path)
      } catch {
        // gone, or not readable: nothing to offer
      }
    }

    if (shown.length === 0 || typeof result?.text !== 'string') return result

    for (const path of shown) offer.offered.add(path)
    offer.shown += shown.length

    return { ...result, text: `${result.text}\n\n${offerLine(shown)}` }
  })
}
