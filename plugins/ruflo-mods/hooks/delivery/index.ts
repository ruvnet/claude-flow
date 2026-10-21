import type { On } from 'claude-code'

import type { ModState } from '../state'
import { isScreenedOrigin, screenInbound, screenOutbound } from './screen'

/**
 * `session.receive` and `session.send` (ADR-451 item 3): an in-process
 * pattern screen for what reaches the session from a peer or relay, and for
 * what leaves it for another agent. Off unless `deliveryScreen` is on.
 *
 * Tighten-only: an inbound hit is consumed (nothing is queued, shown or read
 * by the model), an outbound hit is refused; text is never rewritten and never
 * allowed past another hook's refusal (the screen only answers without `next`
 * on a hit). The person's own prompts (Remote Control, scheduled triggers) and
 * the lead's messages are not screened. The rule id is named, never the
 * matched text. Any failure passes the message on.
 */
export function registerDelivery(on: On, state: ModState) {
  const d = state.delivery
  d.enabled = true

  on('session.receive', async ($, e, next) => {
    const rule = isScreenedOrigin(e.origin.kind) ? screenInbound(e.text) : undefined
    if (!rule) return next(e)
    d.consumed += 1
    await state.say({ level: 'error', text: `ruflo deliveryScreen: dropped a ${e.origin.kind} delivery (rule: ${rule})` })
    return { consumed: `ruflo deliveryScreen: ${rule}` }
  }).catch(($, e, next) => next(e)) // fail open

  on('session.send', async ($, e, next) => {
    const rule = screenOutbound(e.text)
    if (!rule) return next(e)
    d.blocked += 1
    await state.say({ level: 'error', text: `ruflo deliveryScreen: held back an outgoing message (rule: ${rule})` })
    return { isDelivered: false, reason: `ruflo deliveryScreen refused to send this message (${rule}); remove it and send again` }
  }).catch(($, e, next) => next(e))
}

