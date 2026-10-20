import type { ModOptions } from './options'
import { hasCredentialField, hasSecret, splitName, textsOf } from './screen'

export type Verdict = { readonly rule: string; readonly reason: string }

const PUBLISHERS = new Set(['federation_bbs_publish', 'federation_bbs_human_join'])
const WILDCARD = new Set(['*', ''])
// Every spelling of "all interfaces": 0, 0.0, 0.0.0.0, 00.0.0.0, 0x0.0.0.0, ::, ::0, [::], 0:0:0:0:0:0:0:0, 0000:...:0000.
const ZERO_V4 = /^(?:0x0*|0+)(?:\.(?:0x0*|0+)){0,3}$/i
const ZERO_V6 = /^\[?[0:]*:[0:]*\]?$/
const isWildcard = (host: string): boolean => {
  const h = host.trim()
  return WILDCARD.has(h) || ZERO_V4.test(h) || ZERO_V6.test(h)
}

/** Why a peer URL is refused (credentials in it, or not http/https), or undefined. Never echoes the URL. */
export function badPeerUrl(url: string): string | undefined {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return 'is not a valid URL'
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'must be http or https'
  if (u.username !== '' || u.password !== '') return 'must not carry credentials (pin the peer by key instead)'
  return undefined
}

const refuse = (rule: string, reason: string): Verdict => ({ rule, reason: `ruflo-bbs-federation: ${reason}` })

/**
 * Tighten-only verdict for a federation_bbs_* call: undefined for tools this plugin does not own, 'pass' when allowed, else the refusal.
 * Reasons never name or echo the offending value.
 */
export function verdict(tool: string, input: unknown, opts: ModOptions): Verdict | 'pass' | undefined {
  const parts = splitName(tool)
  if (!parts || !parts.tool.startsWith('federation_bbs_')) return undefined
  const args = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>
  if (hasCredentialField(args)) return refuse('credential field', 'this call carries a field named like a credential (key, token or password). Reference secrets by id or URL; never pass the value.')
  if (PUBLISHERS.has(parts.tool) && textsOf(args).some(hasSecret)) {
    return refuse('secret in message', 'this message holds what looks like a secret. Channel content is readable by every peer; send a reference, not the value.')
  }
  if (parts.tool === 'federation_bbs_peer_add' && typeof args.url === 'string') {
    const why = badPeerUrl(args.url)
    if (why !== undefined) return refuse('peer url', `the peer url ${why}.`)
  }
  if (parts.tool === 'federation_bbs_serve' && typeof args.bindHost === 'string' && !opts.allowWildcardBind && isWildcard(args.bindHost)) {
    return refuse('wildcard bind', 'serve would listen on every interface. Bind one routable (tailnet or LAN) address, or enable allowWildcardBind.')
  }
  return 'pass'
}
