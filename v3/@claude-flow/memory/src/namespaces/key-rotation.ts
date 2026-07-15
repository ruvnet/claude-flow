/**
 * ADR-321 P4 — Key rotation policy + `keyEpoch` bump tooling.
 *
 * P1 built the raw primitive (`SealedKeyStore.rotateKey` /
 * `SealedMemoryWriter.rotateKey`, see `./sealed-writer.ts`): a mechanism to
 * discard a namespace's current HMAC key and bump its epoch. What P1-P3 did
 * NOT provide is a POLICY for when/how that mechanism should be invoked, or
 * any tooling to trigger it deliberately. This module is that policy layer.
 *
 * Per the ADR's Decision section ("Key management"): rotation is bumped "on
 * a `keyEpoch` counter (not per-write — per-write rotation would defeat
 * verification of historical entries)". Rotation is therefore a deliberate,
 * INFREQUENT operation, never automatic per-write. This module offers two
 * ways to trigger it, both opt-in and neither wired to any scheduler:
 *
 *  - time-based: `isRotationDue`/`rotateIfDue`, gated by `maxKeyAgeMs`. If
 *    `maxKeyAgeMs` is omitted, time-based rotation is disabled entirely —
 *    the policy defaults to ON-DEMAND-ONLY rotation with no automatic
 *    interval, which is the safer default (an unconfigured interval could
 *    otherwise silently invalidate historical seals on a schedule nobody
 *    reviewed). Callers who want periodic rotation must set `maxKeyAgeMs`
 *    explicitly.
 *  - on-demand: `rotateNow`, gated by `policy.rotateOnDemand`. This is the
 *    "bump tooling" entry point — e.g. `AgentDBAdapter.rotateSealKey`
 *    forwards here (indirectly, via `SealedMemoryWriter.rotateKey`) for a
 *    human- or automation-triggered manual rotation.
 *
 * Deliberately NOT built here (out of scope per the ADR's P4 row, which
 * asks for "policy + tooling", not an autonomous scheduler): a cron/daemon
 * that calls `rotateIfDue` on a timer. Wiring that up, if ever wanted, is a
 * thin caller on top of these pure functions — this module stays decoupled
 * from any specific invocation context (CLI command, background worker,
 * hook, etc).
 */

import type { SealedKeyStore } from './sealed-writer.js';

/**
 * A namespace's key-rotation policy.
 *
 * - `maxKeyAgeMs`: rotate once the current key is at least this old. Omit
 *   for on-demand-only rotation (no automatic time-based default — see
 *   module doc for why).
 * - `rotateOnDemand`: whether manual/on-demand rotation (`rotateNow`) is
 *   permitted for this namespace at all. Set to `false` to lock a namespace
 *   to schedule-only rotation (or no rotation, if `maxKeyAgeMs` is also
 *   unset) so an operator can't bump the epoch out-of-band.
 */
export interface KeyRotationPolicy {
  maxKeyAgeMs?: number;
  rotateOnDemand: boolean;
}

/** Convenience default: on-demand rotation allowed, no automatic interval. */
export const ON_DEMAND_ONLY_POLICY: KeyRotationPolicy = { rotateOnDemand: true };

/**
 * Is `namespace`'s current key due for time-based rotation under `policy`?
 * Always `false` when `policy.maxKeyAgeMs` is unset (on-demand-only) or when
 * the key store hasn't recorded a `createdAt` for this namespace's key
 * (e.g. a pre-P4 `SealedKeyStore` implementation that doesn't track it).
 */
export function isRotationDue(
  keyStore: SealedKeyStore,
  namespace: string,
  policy: KeyRotationPolicy,
  now: number = Date.now()
): boolean {
  if (policy.maxKeyAgeMs === undefined) return false;
  const { createdAt } = keyStore.getKey(namespace);
  if (createdAt === undefined) return false;
  return now - createdAt >= policy.maxKeyAgeMs;
}

/**
 * Rotates `namespace`'s key if `isRotationDue` says it should, per `policy`.
 * Returns whether a rotation actually happened. Time-based only — does not
 * consult `policy.rotateOnDemand` (that flag governs `rotateNow`, below).
 */
export function rotateIfDue(
  keyStore: SealedKeyStore,
  namespace: string,
  policy: KeyRotationPolicy,
  now: number = Date.now()
): boolean {
  if (!isRotationDue(keyStore, namespace, policy, now)) return false;
  keyStore.rotateKey(namespace);
  return true;
}

/**
 * Manually bumps `namespace`'s key epoch right now, regardless of age,
 * gated only by `policy.rotateOnDemand`. This is the "bump tooling" entry
 * point for a human- or automation-triggered rotation outside any
 * time-based schedule. Returns whether the rotation happened (`false` when
 * the policy forbids on-demand rotation for this namespace).
 */
export function rotateNow(
  keyStore: SealedKeyStore,
  namespace: string,
  policy: KeyRotationPolicy
): boolean {
  if (!policy.rotateOnDemand) return false;
  keyStore.rotateKey(namespace);
  return true;
}
