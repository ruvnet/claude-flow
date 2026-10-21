import type { ModOptions } from './options'
import { hasCredentialField, hasSecret, splitName, textsOf } from './screen'

export type Verdict = { readonly rule: string; readonly reason: string }

/** The publisher's own rule (src/publisher.mjs): public channels only. Checking it here refuses a bad call before it leaves the machine. */
export const PUBLIC_CHANNEL = /^pub:[a-z0-9][a-z0-9._-]{0,63}$/

const SERVER = /chatgpt|federation/i

/** True for the connector's own tool: `channel_publish` on a server named for the connector (not ruflo-core's `x_federation_channel_publish`). */
export function isPublish(tool: string): boolean {
  const parts = splitName(tool)
  return parts !== undefined && parts.tool === 'channel_publish' && SERVER.test(parts.server)
}

const refuse = (rule: string, reason: string): Verdict => ({ rule, reason: `ruflo-chatgpt-federation: ${reason}` })

const bytes = (v: unknown): number => {
  try {
    return new TextEncoder().encode(JSON.stringify(v) ?? '').length
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

/** Tighten-only verdict for the connector's channel_publish: undefined for other tools, 'pass' when allowed, else the refusal. Reasons never echo input. */
export function verdict(tool: string, input: unknown, opts: ModOptions): Verdict | 'pass' | undefined {
  if (!isPublish(tool)) return undefined
  const args = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>
  if (typeof args.channel === 'string' && !PUBLIC_CHANNEL.test(args.channel)) {
    return refuse('channel', 'publishing is for public pub:<name> channels only; this connector holds no private channel keys.')
  }
  const body = [args.msgType, args.payload]
  if (hasCredentialField(args.payload) || textsOf(body).some(hasSecret)) {
    return refuse('secret in message', 'this message holds what looks like a secret or a credential field. Channel content is readable by every relay member; send a reference, not the value.')
  }
  if (bytes(args.payload) > opts.maxPayloadBytes) {
    return refuse('oversize', `the payload is larger than the ${opts.maxPayloadBytes}-byte cap. Publish a summary and link the detail.`)
  }
  return 'pass'
}
