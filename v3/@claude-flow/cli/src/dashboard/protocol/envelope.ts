import { z } from 'zod';
import { canonicalize } from './canonical.js';
import { randomToken, signBytes, verifyBytes } from './crypto.js';

export const MAX_ENVELOPE_BYTES = 256 * 1024;
export const CLOCK_SKEW_MS = 120_000;

export const EnvelopeSchema = z.object({
  v: z.literal(1),
  typ: z.enum(['hello', 'digest', 'ack', 'result', 'command', 'ping', 'revoke']),
  /** Device id the message belongs to (the signer for device->server, the target for server->device). */
  did: z.string().regex(/^dev_[A-Za-z0-9_-]{16,64}$/),
  /** Tenant (Cognitum subject hash) — bound into every signature so a device key cannot be replayed across tenants. */
  tid: z.string().regex(/^tnt_[A-Za-z0-9_-]{16,64}$/),
  ts: z.number().int().safe().positive(),
  nonce: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/),
  seq: z.number().int().safe().nonnegative(),
  body: z.record(z.unknown()),
  sig: z.string().regex(/^[A-Za-z0-9_-]{80,100}$/),
}).strict();
export type Envelope = z.infer<typeof EnvelopeSchema>;
export type Unsigned = Omit<Envelope, 'sig' | 'nonce' | 'ts' | 'v'> & Partial<Pick<Envelope, 'nonce' | 'ts'>>;

export function signEnvelope(privateKey: string, u: Unsigned, now = Date.now()): Envelope {
  const base = { v: 1 as const, typ: u.typ, did: u.did, tid: u.tid, ts: u.ts ?? now, nonce: u.nonce ?? randomToken(16), seq: u.seq, body: u.body };
  const sig = signBytes(privateKey, 'ruflo.env.v1\n' + canonicalize(base));
  return { ...base, sig };
}

export type VerifyFailure = 'too_large' | 'malformed' | 'bad_signature' | 'stale' | 'replay' | 'wrong_binding';
export type VerifyResult = { ok: true; env: Envelope } | { ok: false; reason: VerifyFailure };

/** Tracks nonces within the skew window and requires strictly increasing seq per (did). */
export class ReplayGuard {
  private seen = new Map<string, number>();
  private lastSeq = new Map<string, number>();
  constructor(private max = 50_000) {}
  check(env: Envelope, now = Date.now()): boolean {
    if (Math.abs(now - env.ts) > CLOCK_SKEW_MS) return false;
    for (const [k, t] of this.seen) { if (now - t > 2 * CLOCK_SKEW_MS) this.seen.delete(k); else break; }
    const key = env.did + ':' + env.nonce;
    if (this.seen.has(key)) return false;
    const last = this.lastSeq.get(env.did);
    if (last !== undefined && env.seq <= last) return false;
    this.seen.set(key, now);
    if (this.seen.size > this.max) { const first = this.seen.keys().next().value; if (first) this.seen.delete(first); }
    this.lastSeq.set(env.did, env.seq);
    return true;
  }
  /** Seed after reconnect so a restarted process cannot be replayed to. */
  setLastSeq(did: string, seq: number) { this.lastSeq.set(did, Math.max(seq, this.lastSeq.get(did) ?? -1)); }
}

export function verifyEnvelope(
  raw: unknown, publicKey: string, expect: { did: string; tid: string }, guard: ReplayGuard, now = Date.now(),
): VerifyResult {
  let size = 0;
  try { size = Buffer.byteLength(typeof raw === 'string' ? raw : JSON.stringify(raw)); } catch { return { ok: false, reason: 'malformed' }; }
  if (size > MAX_ENVELOPE_BYTES) return { ok: false, reason: 'too_large' };
  let obj: unknown = raw;
  if (typeof raw === 'string') { try { obj = JSON.parse(raw); } catch { return { ok: false, reason: 'malformed' }; } }
  const parsed = EnvelopeSchema.safeParse(obj);
  if (!parsed.success) return { ok: false, reason: 'malformed' };
  const env = parsed.data;
  const { sig, ...base } = env;
  let sigOk = false;
  try { sigOk = verifyBytes(publicKey, 'ruflo.env.v1\n' + canonicalize(base), sig); } catch { sigOk = false; }
  if (!sigOk) return { ok: false, reason: 'bad_signature' };
  if (env.did !== expect.did || env.tid !== expect.tid) return { ok: false, reason: 'wrong_binding' };
  if (!guard.check(env, now)) return { ok: false, reason: Math.abs(now - env.ts) > CLOCK_SKEW_MS ? 'stale' : 'replay' };
  return { ok: true, env };
}
