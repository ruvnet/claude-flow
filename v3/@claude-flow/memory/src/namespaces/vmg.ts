/**
 * ADR-178 Primitive 1 — Verifiable Memory Governance (VMG) metadata.
 *
 * Extracted out of `agentdb-adapter.ts` (already well over the repo's
 * 500-line-per-file guideline before this change) so VMG derivation logic
 * has its own small, independently testable home instead of growing an
 * already-oversized file further.
 *
 * `AgentDBAdapter.store()` calls {@link computeVmgMetadata} to attach
 * `entry.vmg` before persisting. See `../types.ts` for the `VmgMetadata`
 * shape and its field-level rationale.
 *
 * Not implemented here (documented gaps, tracked against ADR-178 but out of
 * scope for this change):
 * - `sessionId` is not part of `provenance` — `MemoryEntry` has no
 *   `sessionId` field today (see `VmgMetadata.provenance` doc in types.ts).
 * - Session-end retention sweep of `'ephemeral'`-tagged entries — that is a
 *   `@claude-flow/hooks` `sessionEnd()` wiring task, not a memory-package one.
 *
 * @module @claude-flow/memory/namespaces/vmg
 */

import { createHash } from 'node:crypto';
import type { MemoryEntry, MemoryType, VmgMetadata } from '../types.js';

/**
 * Maps `MemoryEntry.type` to a VMG retention `policyTag`. Any `type` not
 * listed here defaults to `'persistent'`. `'immutable'` is unreachable from
 * this mapping in the current phase — no caller marks entries immutable
 * yet — but remains part of the `VmgMetadata.policyTag` union for
 * forward-compatibility (see ADR-178).
 */
const POLICY_TAG_BY_TYPE: Partial<Record<MemoryType, VmgMetadata['policyTag']>> = {
  cache: 'ephemeral',
  working: 'session',
};

/**
 * Derives the VMG retention tag for a given `MemoryEntry.type`. Defaults to
 * `'persistent'` for any type without an explicit mapping (`episodic`,
 * `semantic`, and any future type added to `MemoryType`).
 */
export function deriveVmgPolicyTag(type: MemoryType): VmgMetadata['policyTag'] {
  return POLICY_TAG_BY_TYPE[type] ?? 'persistent';
}

/**
 * Hex SHA-256 of `content`. `MemoryEntry.content` is already a plain
 * string, so this hashes it directly rather than round-tripping through
 * `JSON.stringify` (which would just add quoting noise for the common
 * string case and diverge from what `SealedMemoryWriter` will eventually
 * want to consume here).
 */
export function computeWriteHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Computes the full `VmgMetadata` for a write.
 *
 * @param content   The entry's content (already a string on `MemoryEntry`).
 * @param ownerId   The writing agent's id, if any (`entry.ownerId`).
 * @param type      The entry's `MemoryType`, used to derive `policyTag`.
 * @param priorEntry The previously-stored entry at the same `namespace:key`
 *   (or `null`/`undefined` for the first write to that key). Callers should
 *   look this up via a RAW map lookup (e.g. `AgentDBAdapter`'s internal
 *   `entries`/`keyIndex` maps) rather than the public `get`/`getByKey`
 *   methods, so this computation never re-triggers ADR-321 seal/verify
 *   side effects (tamper-detection emits, access-count bumps, cache
 *   population) as a side effect of writing VMG metadata.
 */
export function computeVmgMetadata(params: {
  content: string;
  ownerId?: string;
  type: MemoryType;
  priorEntry?: MemoryEntry | null;
}): VmgMetadata {
  const { content, ownerId, type, priorEntry } = params;
  const priorVmg = priorEntry?.vmg;

  return {
    provenance: `${ownerId ?? 'unknown'}:${Date.now()}`,
    version: (priorVmg?.version ?? 0) + 1,
    policyTag: deriveVmgPolicyTag(type),
    writeHash: computeWriteHash(content),
    parentHash: priorVmg?.writeHash,
  };
}
