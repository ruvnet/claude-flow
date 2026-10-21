import type { ModOptions } from './options'
import { hasSecret, splitName, textsOf } from './screen'

export type Verdict = { readonly rule: string; readonly reason: string }

// What reads a page's cookies or storage, and what can carry them off the page. Both in one script is exfiltration.
const READS = /document\s*(?:\.\s*cookie|\[\s*['"`]cookie['"`]\s*\])|\b(?:local|session)Storage\b|\bindexedDB\b|cookieStore/
const SINKS = /\b(?:fetch|XMLHttpRequest|sendBeacon|WebSocket|EventSource|importScripts)\b|new\s+Image\b|\.src\s*=(?!=)|\blocation(?:\s*\.\s*(?:href|assign|replace))?\s*(?:=(?!=)|\()|window\s*\.\s*open\b/
const METADATA = new Set(['169.254.169.254', 'metadata.google.internal', '[fd00:ec2::254]', 'metadata.azure.com', '100.100.100.200'])
const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]'])
// Tools that type or record caller-supplied text into a page or a stored session: a secret in their arguments leaves through the page.
const TYPES = new Set(['browser_fill', 'browser_type', 'browser_session_record'])
const BAD_FLAGS = /^--(?:disable-web-security|remote-debugging-(?:port|address|pipe)|load-extension|disable-site-isolation-trials)\b/

/** Why a script is refused: it reads cookies or storage and also has a way to send them out. */
export const exfiltrates = (script: string): boolean => READS.test(script) && SINKS.test(script)

/** Why a URL is refused, or undefined. `strict` also refuses plain http outside localhost. Never echoes the URL. */
export function badUrl(url: string, strict: boolean): string | undefined {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return 'is not a valid absolute URL'
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return u.href === 'about:blank' ? undefined : 'uses a scheme other than http or https (file, javascript, data and chrome pages are refused)'
  if (u.username !== '' || u.password !== '') return 'carries credentials in the URL'
  if (METADATA.has(u.hostname.toLowerCase().replace(/\.$/, ''))) return 'points at a cloud metadata service'
  if (strict && u.protocol === 'http:' && !LOCAL.has(u.hostname.toLowerCase())) return 'is plain http outside localhost'
  return undefined
}

const refuse = (rule: string, reason: string): Verdict => ({ rule, reason: `ruflo-browser: ${reason}` })

/** Tighten-only verdict for a browser_* call: undefined for other tools, 'pass' when allowed, else the refusal. Reasons never echo input. */
export function verdict(tool: string, input: unknown, opts: ModOptions): Verdict | 'pass' | undefined {
  const parts = splitName(tool)
  if (!parts || !parts.tool.startsWith('browser_')) return undefined
  const args = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>
  if (parts.tool === 'browser_open') {
    if (typeof args.url === 'string') {
      const why = badUrl(args.url, opts.strictUrls)
      if (why !== undefined) return refuse('url', `the URL ${why}.`)
    }
    if (Array.isArray(args.args) && args.args.some(a => typeof a === 'string' && BAD_FLAGS.test(a.trim()))) {
      return refuse('launch flag', 'a Chrome launch flag would switch off page isolation or open a debugging port.')
    }
  }
  if (parts.tool === 'browser_eval' && typeof args.script === 'string' && exfiltrates(args.script)) {
    return refuse('exfiltration', 'this script reads cookies or storage and can send them off the page. Read them in one call, check them here, and never post them out.')
  }
  if (TYPES.has(parts.tool) && textsOf(args).some(hasSecret)) {
    return refuse('secret', 'this call types what looks like a secret (a key, token or password) into a page or session record. Use a vaulted cookie handle (browser_cookie_use), not the value.')
  }
  return 'pass'
}
