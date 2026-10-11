import { z } from 'zod';

const S = (n: number) => z.string().max(n);
export const MAX_ITEMS = 100;
export const DigestSchema = z.object({
  collectedAt: z.number().int().safe().positive(),
  ruflo: z.object({ version: S(40), node: S(40).optional(), os: S(40).optional() }).strict(),
  level: z.enum(['off', 'read', 'write', 'manage', 'full']),
  health: z.object({ ok: z.boolean(), notes: z.array(S(200)).max(20).default([]) }).strict(),
  missions: z.array(z.object({ id: S(40), objective: S(300), state: S(24), revision: z.number().int().safe().nonnegative(), budgetMinor: z.number().int().safe().nonnegative().optional(), updatedAt: z.number().int().safe().optional() }).strict()).max(MAX_ITEMS).default([]),
  tasks: z.object({ total: z.number().int().safe().nonnegative(), pending: z.number().int().safe().nonnegative(), running: z.number().int().safe().nonnegative(), done: z.number().int().safe().nonnegative() }).strict().optional(),
  swarm: z.object({ id: S(80).optional(), topology: S(32).optional(), maxAgents: z.number().int().safe().optional(), agents: z.array(z.object({ id: S(80), type: S(40), state: S(24) }).strict()).max(MAX_ITEMS).default([]) }).strict().optional(),
  memory: z.object({ entries: z.number().int().safe().nonnegative(), namespaces: z.number().int().safe().nonnegative().optional(), backend: S(40).optional() }).strict().optional(),
  cost: z.object({ currency: S(8), totalMinor: z.number().int().safe().nonnegative(), todayMinor: z.number().int().safe().nonnegative().optional() }).strict().optional(),
  adrs: z.array(z.object({ id: S(40), title: S(200), status: S(24) }).strict()).max(MAX_ITEMS).default([]),
  events: z.array(z.object({ at: z.number().int().safe(), kind: S(40), text: S(300) }).strict()).max(MAX_ITEMS).default([]),
}).strict();
export type Digest = z.infer<typeof DigestSchema>;

type Rule = readonly [RegExp, string | ((m: string, ...g: string[]) => string)];
const KEYWORD = '(?:api[_-]?key|apikey|secret|token|passwd|password|pwd|authorization|credential|private[_-]?key)';
/** Order matters: structured tokens first, then URL credentials, then key=value and keyword-adjacent bare secrets. No nested quantifiers. */
const SECRET_RULES: Rule[] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[masked]'],
  [/\bsk-[A-Za-z0-9_-]{16,}/g, '[masked]'], [/\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{8,}/g, '[masked]'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, '[masked]'], [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, '[masked]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[masked]'], [/\bAIza[0-9A-Za-z_-]{30,}/g, '[masked]'], [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, '[masked]'],
  [/\bnpm_[A-Za-z0-9]{30,}/g, '[masked]'], [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, '[masked]'],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/gi, '[masked]'],
  // scheme://user:pass@host (userinfo with a password)
  [/\b([A-Za-z][A-Za-z0-9+.-]{1,20}:\/\/)[^\s/:@]{0,200}:[^\s/@]{1,200}@/g, (_m, scheme) => scheme + '[masked]@'],
  // NAME_SECRET_ACCESS_KEY=..., CLIENT_SECRET: ..., apiKey = "..." (keyword anywhere in the name, no leading \b)
  [new RegExp('(' + KEYWORD + '[A-Za-z0-9_-]{0,40}\\s*[=:]\\s*)["\']?[^\\s"\',;]{6,}', 'gi'), (_m, k) => k + '[masked]'],
  // bare long hex / base64 right after a secret-ish word ("dbpass: 9f8e..."); must contain a digit so plain words stay
  [new RegExp('(' + KEYWORD + '|pass)s?(?:[ \\t]{1,3}(?:is|was))?[ \\t:=>-]{1,6}(?=[A-Za-z0-9+/_-]{0,200}\\d)[A-Za-z0-9+/_-]{32,}={0,2}', 'gi'), (_m) => '[masked]'],
];
/** Mask known secret shapes. Callers truncate AFTER masking (a cut token would otherwise leave a recognisable prefix). */
export function maskSecrets(s: string): string {
  let out = s;
  for (const [re, rep] of SECRET_RULES) out = out.replace(re, rep as never);
  return out;
}
/** Strip control characters (keep \n\t), mask secrets, recursively. Applied both locally before send and server-side on receipt. */
export function sanitize<T>(v: T, depth = 0): T {
  if (depth > 12) return undefined as T;
  if (typeof v === 'string') return maskSecrets(v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g, '')) as T;
  if (Array.isArray(v)) return v.map(x => sanitize(x, depth + 1)) as T;
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) { if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue; o[k] = sanitize(x, depth + 1); }
    return o as T;
  }
  return v;
}
export function parseDigest(raw: unknown): { ok: true; digest: Digest } | { ok: false } {
  const r = DigestSchema.safeParse(sanitize(raw));
  return r.success ? { ok: true, digest: r.data } : { ok: false };
}
