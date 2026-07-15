/**
 * ADR-321 P1/P2/P3 — HMAC-Sealed Collaboration Memory Namespace.
 *
 * Tamper-evident sealing for writes into namespaces marked "sealed" (P1
 * scope: `collaboration` only by default; P3 makes this extensible at
 * runtime — see `AgentDBAdapter.isNamespaceSealed` /
 * `AgentDBAdapter.markNamespaceSealed`).
 * Mitigates the ClawWorm read-time trust failure (arXiv:2603.15727): a
 * seal proves content read back is exactly what an authorized writer
 * produced. `seal()`/`verify()` now accept an optional precomputed content
 * hash — `AgentDBAdapter` passes `entry.vmg.writeHash` (task #11, ADR-178
 * Primitive 1) so the HMAC input matches the ADR's literal composition
 * (`content + writerId + namespace + writeHash-from-ADR-178`) rather than
 * this module recomputing its own hash independently. The parameter
 * defaults to this module's own SHA-256 when omitted, for callers/tests
 * that exercise `SealedMemoryWriter` without a `MemoryEntry`/`vmg`.
 *
 * The HMAC input covers a SHA-256 content hash + writerId + namespace, so
 * a seal is both writer-scoped and namespace-scoped: sealing under one
 * namespace's key must not verify under another's (ADR-321 validation
 * requirement).
 *
 * Key management: one active HMAC key + keyEpoch counter per namespace,
 * generated lazily via `crypto.randomBytes` on first use. `rotateKey`
 * discards the prior key entirely (deliberate — a seal computed under a
 * retired epoch must never verify again). Keys never leave this module;
 * callers only ever see `seal()` / `verify()`, matching the ADR's "held
 * server-side, never distributed to individual agents" requirement.
 *
 * ADR-321 P2 — propagation-chain detection: `seal()` records a
 * `(writerId, sealedAt)` observation per content-hash (the SAME SHA-256
 * hash used as the HMAC input above — not a second, independently
 * computed hash). `verify()` (via `checkPropagation`) flags when the
 * content hash currently being verified has a recorded observation from
 * a DIFFERENT writerId still inside `CLAUDE_FLOW_SEAL_REPLAY_WINDOW_MS`
 * (default 5 minutes) of "now". This is exactly ClawWorm's propagation
 * shape: the same content reappearing under a different writer, whether
 * in the same namespace (re-entry after partial cleanup) or a different
 * one (namespace hop) — so the history is intentionally NOT scoped per
 * namespace. A propagation hit does not invalidate the seal (the content
 * is still cryptographically exactly what the second writer sealed); it
 * is a separate, additive heuristic signal for the caller to act on.
 *
 * Escalation routing gap (documented, not built here): the ADR text
 * says propagation hits should reuse "the same human-in-the-loop / block
 * routing ADR-178's RepE hook already uses (`CLAUDE_FLOW_IPI_MODE`)".
 * Neither `CLAUDE_FLOW_IPI_MODE` nor an `IpiDetector` exists anywhere in
 * this codebase — ADR-178 itself is unimplemented. Building that
 * escalation system is out of scope for this change (a different,
 * unimplemented ADR); `AgentDBAdapter` instead emits
 * `seal:propagation-detected` so a future ADR-178 implementation has a
 * concrete event to subscribe to.
 *
 * See v3/docs/adr/ADR-321-hmac-sealed-collaboration-memory-namespace.md.
 *
 * P5: CLAUDE_FLOW_STRICT_SEALING becomes default in v4.0, see ADR-321 §Integration plan
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Default replay window (ms) for ADR-321 P2 propagation-chain detection. */
const DEFAULT_REPLAY_WINDOW_MS = 300_000; // 5 minutes

/**
 * One `seal()` observation of a content-hash, retained for propagation-chain
 * detection. Pruned once older than `CLAUDE_FLOW_SEAL_REPLAY_WINDOW_MS`.
 */
interface SealObservation {
  writerId: string;
  sealedAt: number;
}

/** Tamper-evident envelope wrapping a sealed write (ADR-321 `SealedEnvelope`). */
export interface SealedEnvelope {
  /** The original, unsealed content. */
  content: unknown;
  /** HMAC-SHA256 hex digest over (content-hash + writerId + namespace). */
  seal: string;
  /** Identity of the agent that produced the seal. */
  writerId: string;
  /** Unix ms timestamp of sealing. */
  sealedAt: number;
  /** Which namespace signing-key epoch produced this seal. */
  keyEpoch: number;
}

/**
 * Holds one active HMAC key + epoch counter per namespace. Implementations
 * must never expose key material outside `getKey`/`rotateKey` callers that
 * are themselves part of the trusted sealing module (i.e. `SealedMemoryWriter`).
 */
export interface SealedKeyStore {
  /**
   * Returns (lazily generating on first call) the namespace's active key + epoch.
   *
   * `createdAt` (unix ms) is OPTIONAL — added in ADR-321 P4 so a
   * `KeyRotationPolicy` (see `./key-rotation.ts`) can decide whether a key is
   * due for time-based rotation. It is optional rather than required so
   * pre-P4 mocks/implementations that only ever return `{ key, epoch }`
   * (e.g. `sealed-writer.test.ts`'s `makeKeyStoreMock`) remain valid
   * `SealedKeyStore` implementations without modification.
   */
  getKey(namespace: string): { key: Uint8Array; epoch: number; createdAt?: number };
  /** Generates a new key for the namespace and bumps its epoch, discarding the old key. */
  rotateKey(namespace: string): void;
}

interface KeyRecord {
  key: Uint8Array;
  epoch: number;
  /** ADR-321 P4 — unix ms the current key was generated; feeds `isRotationDue`. */
  createdAt: number;
}

/**
 * Default in-process `SealedKeyStore`. Both `seal()` and `verify()` run in
 * the same process (no key distribution — P1 scope per ADR-321). Not
 * exported as part of the public seal/verify surface; construct a
 * `SealedMemoryWriter` with no arguments to get one of these for free.
 */
export class InProcessSealedKeyStore implements SealedKeyStore {
  private readonly keys = new Map<string, KeyRecord>();

  getKey(namespace: string): KeyRecord {
    let record = this.keys.get(namespace);
    if (!record) {
      record = { key: randomBytes(32), epoch: 1, createdAt: Date.now() };
      this.keys.set(namespace, record);
    }
    return record;
  }

  rotateKey(namespace: string): void {
    const previous = this.keys.get(namespace);
    const epoch = (previous?.epoch ?? 0) + 1;
    // Deliberately discard the old key material — a seal computed under a
    // retired epoch must fail verification after rotation (ADR-321 P1
    // validation requirement).
    this.keys.set(namespace, { key: randomBytes(32), epoch, createdAt: Date.now() });
  }
}

/**
 * `SealedMemoryWriter` — ADR-321 P1 primitive.
 *
 * The key store is injected (defaults to `InProcessSealedKeyStore`) so
 * tests can substitute a mock without depending on real key material.
 */
export class SealedMemoryWriter {
  /**
   * ADR-321 P2 propagation history: content-hash -> observations of every
   * `seal()` call over that content, across ALL namespaces (deliberately
   * not namespace-scoped — see class doc "propagation-chain detection").
   * Pruned to the replay window on every `seal()`/`checkPropagation()`
   * call; no background sweep (P2 scope, per ADR).
   */
  private readonly propagationHistory = new Map<string, SealObservation[]>();

  constructor(private readonly keyStore: SealedKeyStore = new InProcessSealedKeyStore()) {}

  /**
   * ADR-321 P4 — manual `keyEpoch` bump tooling. Delegates directly to the
   * injected `SealedKeyStore.rotateKey`; this is the sole rotation entry
   * point exposed to callers outside this module (e.g.
   * `AgentDBAdapter.rotateSealKey`) so key material itself never leaves the
   * store. See `./key-rotation.ts` for the policy layer (when/whether to
   * call this) — this method is the mechanism, not the policy.
   */
  rotateKey(namespace: string): void {
    this.keyStore.rotateKey(namespace);
  }

  /**
   * ADR-321 P4 — exposes the injected key store so a `KeyRotationPolicy`
   * (see `./key-rotation.ts`) can inspect key age via `getKey(namespace)`
   * without this class needing to know about rotation policy at all.
   */
  getKeyStore(): SealedKeyStore {
    return this.keyStore;
  }

  /**
   * Seals `content` under `namespace`'s current key on behalf of `writerId`.
   *
   * `precomputedContentHash` lets a caller supply the real ADR-178 VMG
   * `writeHash` (see `AgentDBAdapter.sealEntry`) instead of this module
   * recomputing its own — the ADR's `seal()` spec is HMAC over
   * `content + writerId + namespace + writeHash-from-ADR-178`, and now that
   * VMG metadata exists (task #11), this is how that composition is
   * threaded through. Omit it (or pass `undefined`) to fall back to this
   * module's own SHA-256 of `content` — kept for callers/tests that predate
   * VMG or that seal content with no corresponding `MemoryEntry.vmg` (e.g.
   * unit tests exercising `SealedMemoryWriter` in isolation). Both paths
   * produce the identical hash for `MemoryEntry.content` today (a plain
   * string, hashed directly by both `computeWriteHash` and `contentHashOf`)
   * — the parameter exists for composition correctness per the ADR, not
   * because the two currently disagree.
   */
  seal(content: unknown, writerId: string, namespace: string, precomputedContentHash?: string): SealedEnvelope {
    const { key, epoch } = this.keyStore.getKey(namespace);
    const contentHash = precomputedContentHash ?? contentHashOf(content);
    const sealedAt = Date.now();

    this.recordObservation(contentHash, writerId, sealedAt);

    return {
      content,
      seal: computeSealFromHash(key, contentHash, writerId, namespace),
      writerId,
      sealedAt,
      keyEpoch: epoch,
    };
  }

  /**
   * Verifies `envelope` against `namespace`'s CURRENT key. Fails closed
   * (`{ valid: false }`) when the epoch is stale (rotated since sealing),
   * when the namespace doesn't match the one it was sealed for, or when
   * the recomputed HMAC doesn't match — using a constant-time comparison,
   * never `===`.
   *
   * DELIBERATELY always recomputes the content hash from `envelope.content`
   * itself — never accepts a caller-supplied precomputed hash, unlike
   * `seal()`. This is the load-bearing tamper-detection property: if a
   * verifier trusted a stored/cached hash (e.g. `entry.vmg.writeHash`)
   * instead of re-deriving it from the content actually being read, an
   * attacker who mutates stored content without also updating that cached
   * hash would sail through verification untouched — exactly the ClawWorm
   * read-time trust failure this ADR exists to close. `seal()` may safely
   * accept a precomputed hash because it always runs synchronously against
   * the same, not-yet-mutated content; `verify()` runs at read time, when
   * that freshness guarantee no longer holds, so it must self-compute.
   *
   * ADR-321 P2: when the seal verifies, additionally checks
   * `propagationDetected` (see `checkPropagation`). This is additive only
   * — existing callers that read only `.valid`/`.content` are unaffected,
   * and a propagation hit never flips `valid` to `false` (the seal is
   * still cryptographically genuine; propagation is a heuristic signal,
   * not a forgery).
   */
  verify(
    envelope: SealedEnvelope,
    namespace: string,
  ): { valid: boolean; content?: unknown; propagationDetected?: boolean } {
    const { key, epoch } = this.keyStore.getKey(namespace);

    if (envelope.keyEpoch !== epoch) {
      return { valid: false };
    }

    const contentHash = contentHashOf(envelope.content);
    const expected = computeSealFromHash(key, contentHash, envelope.writerId, namespace);
    if (!hexEqual(expected, envelope.seal)) {
      return { valid: false };
    }

    return {
      valid: true,
      content: envelope.content,
      propagationDetected: this.checkPropagation(envelope, namespace),
    };
  }

  /**
   * ADR-321 P2 — has `envelope.content`'s hash been sealed under a
   * DIFFERENT `writerId` within `CLAUDE_FLOW_SEAL_REPLAY_WINDOW_MS` of now?
   * Reuses the same content-hash `seal()`/`verify()` already compute (never
   * a second, independently-derived hash). `namespace` is accepted for API
   * symmetry with `verify()` but is intentionally not part of the lookup
   * key — see class doc for why the history is cross-namespace.
   */
  checkPropagation(envelope: SealedEnvelope, _namespace: string): boolean {
    const contentHash = contentHashOf(envelope.content);
    const now = Date.now();
    this.pruneHistory(now);

    const observations = this.propagationHistory.get(contentHash);
    if (!observations) return false;

    return observations.some((o) => o.writerId !== envelope.writerId);
  }

  /** Records a `seal()` observation and prunes stale entries (P2). */
  private recordObservation(contentHash: string, writerId: string, sealedAt: number): void {
    this.pruneHistory(sealedAt);
    const observations = this.propagationHistory.get(contentHash) ?? [];
    observations.push({ writerId, sealedAt });
    this.propagationHistory.set(contentHash, observations);
  }

  /** Evicts observations older than the replay window, relative to `now`. */
  private pruneHistory(now: number): void {
    const windowMs = replayWindowMs();
    for (const [hash, observations] of this.propagationHistory) {
      const kept = observations.filter((o) => now - o.sealedAt <= windowMs);
      if (kept.length === 0) {
        this.propagationHistory.delete(hash);
      } else if (kept.length !== observations.length) {
        this.propagationHistory.set(hash, kept);
      }
    }
  }
}

/** SHA-256 content hash — the single source of truth reused by seal, verify, and propagation detection. */
function contentHashOf(content: unknown): string {
  return createHash('sha256').update(serialize(content)).digest('hex');
}

/** HMAC-SHA256 over (content-hash + writerId + namespace); see class doc. */
function computeSealFromHash(
  key: Uint8Array,
  contentHash: string,
  writerId: string,
  namespace: string
): string {
  return createHmac('sha256', key)
    .update(`${contentHash}:${writerId}:${namespace}`)
    .digest('hex');
}

/**
 * ADR-321 P2 replay/propagation window, read fresh on every check (not
 * cached at construction) so tests can flip it via `process.env`. Falls
 * back to the 5-minute default on missing/non-positive/non-numeric values.
 */
function replayWindowMs(): number {
  const raw = process.env.CLAUDE_FLOW_SEAL_REPLAY_WINDOW_MS;
  if (!raw) return DEFAULT_REPLAY_WINDOW_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_REPLAY_WINDOW_MS;
}

/** Deterministic serialization of arbitrary content for hashing. */
function serialize(content: unknown): string {
  if (typeof content === 'string') return content;
  const json = JSON.stringify(content);
  return json ?? String(content);
}

/** Constant-time hex-digest comparison (never `===` — timing side-channel). */
function hexEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
