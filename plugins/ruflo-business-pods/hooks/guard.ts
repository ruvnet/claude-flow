import type { ModOptions } from './options'
import { hasCredentialField, hasSecret, splitName, textsOf } from './screen'

export type Verdict = { readonly rule: string; readonly reason: string }

const OWN = new Set(['business_pod_validate', 'business_pod_route_backend'])
// Where credentials live: a pod template path has no business pointing at any of these.
const SENSITIVE = /(?:^|[\\/])(?:\.env(?:\.[^\\/]*)?|\.ssh|\.aws|\.gnupg|\.netrc|\.npmrc|id_(?:rsa|ed25519|ecdsa)|credentials(?:\.json)?|passwd|shadow)(?:$|[\\/])/i

/** Why a template path is refused (traversal, not .json, a credential location), or undefined. Never echoes the path. */
export function badTemplatePath(path: string): string | undefined {
  if (path.includes('\0')) return 'holds a NUL byte'
  if (path.split(/[\\/]+/).includes('..')) return 'climbs out of its directory with ..'
  if (SENSITIVE.test(path)) return 'points at a credentials location'
  if (!/\.json$/i.test(path)) return 'is not a .json file'
  return undefined
}

const refuse = (rule: string, reason: string): Verdict => ({ rule, reason: `ruflo-business-pods: ${reason}` })

/** Tighten-only verdict for a business_pod_* call: undefined for other tools, 'pass' when allowed, else the refusal. Reasons never echo input. */
export function verdict(tool: string, input: unknown, _opts: ModOptions): Verdict | 'pass' | undefined {
  const parts = splitName(tool)
  if (!parts || !OWN.has(parts.tool)) return undefined
  const args = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>
  const template = args.podTemplate
  if (template !== undefined && (hasCredentialField(template) || textsOf(template).some(hasSecret))) {
    return refuse('secret in template', 'this pod template holds what looks like a secret or a credential field. Templates are committed and posted to rooms; reference secrets by id.')
  }
  if (typeof args.podTemplatePath === 'string') {
    const why = badTemplatePath(args.podTemplatePath)
    if (why !== undefined) return refuse('template path', `the template path ${why}.`)
  }
  return 'pass'
}
