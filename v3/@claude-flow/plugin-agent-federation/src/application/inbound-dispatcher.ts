/**
 * Inbound message dispatcher (ADR-109).
 *
 * The federation plugin's `transport.listen()` accepts inbound bytes
 * but until this module landed, the bytes had no consumer — they sat
 * in the transport's per-address message queue with no one polling.
 *
 * `dispatchInbound()` is what the plugin registers as the
 * transport.onMessage handler. For each received message it:
 *
 *   1. Resolves the sender via `sourceNodeId` in metadata
 *   2. Verifies the peer is in the discovery registry (unknown → reject)
 *   3. Verifies peer is ACTIVE (SUSPENDED/EVICTED → reject defense-in-depth)
 *   4. Audits success or rejection
 *   5. Emits a typed event on the eventBus for the integrator to handle
 *
 * Anti-coupling: dispatcher does NOT actually execute inbound tasks.
 * That's the integrator's job. The dispatcher's contract is "deliver
 * an envelope to the integrator's handler IFF it passes safety gates."
 */

import type { AgentMessage } from '../transport/midstream-aware-loader.js';
import type { DiscoveryService } from '../domain/services/discovery-service.js';
import type { AuditService } from '../domain/services/audit-service.js';
import { FederationNodeState } from '../domain/value-objects/federation-node-state.js';

/** What gets emitted on the event bus per messageType. */
export const FEDERATION_INBOUND_EVENT_PREFIX = 'federation:inbound';

/** Reasons we reject an inbound message — constant strings, no oracle leak. */
export type InboundRejectionReason =
  | 'PEER_UNKNOWN'
  | 'PEER_SUSPENDED'
  | 'PEER_EVICTED'
  | 'MISSING_METADATA'
  | 'INVALID_PAYLOAD'
  | 'INVALID_SIGNATURE';

/**
 * Verifier function for inbound envelopes. Given the canonical bytes of
 * the message + the claimed signature + the peer's published public
 * key, returns true iff the signature is valid. Plugin wires this with
 * `@noble/ed25519`; tests inject a mock.
 *
 * Returning `null` means "no signature provided" — handled by the
 * dispatcher as INVALID_SIGNATURE (defense: unsigned messages from
 * known peers are still rejected).
 */
export type EnvelopeVerifier = (
  canonicalBytes: string,
  signatureHex: string | null,
  peerPublicKeyHex: string,
) => boolean;

/** Dispatch dependencies (kept narrow for testability). */
export interface InboundDispatchDeps {
  readonly discovery: Pick<DiscoveryService, 'getPeer'>;
  readonly audit: Pick<AuditService, 'log'>;
  readonly eventBus: { emit: (event: string, data: unknown) => void };
  readonly logger: {
    debug: (m: string) => void;
    warn: (m: string) => void;
  };
  /**
   * Optional Ed25519 envelope verifier. When PROVIDED, every accepted
   * message MUST pass verification — `null` signature or false-returning
   * verifier rejects the message as INVALID_SIGNATURE.
   *
   * When OMITTED, the dispatcher operates in legacy "trust the metadata"
   * mode (backward compat for tests that inject minimal deps). Production
   * MUST inject this — see the plugin.ts wiring.
   */
  readonly verifyEnvelope?: EnvelopeVerifier;
}

/**
 * Canonical serialization of an envelope for signing. Sorts keys to
 * make the signed bytes deterministic regardless of object construction
 * order. Excludes the `signature` field itself (it's what we're
 * verifying).
 *
 * Federation messages are wrapped as `AgentMessage{id, type, payload,
 * metadata}` on the wire. The `payload` is the actual FederationEnvelope
 * (per `plugin.ts sendToNode`); we canonicalize the payload + the
 * metadata so the receiver verifies the same bytes the sender signed.
 */
export function canonicalizeEnvelopeForVerify(message: AgentMessage): string {
  const meta = (message.metadata ?? {}) as Record<string, unknown>;
  // Strip signature from metadata if present (we verify the rest)
  const { signature: _sig, ...metaForSig } = meta;
  const canon = {
    id: message.id,
    type: message.type,
    payload: message.payload,
    metadata: metaForSig,
  };
  // Sort keys for determinism
  return JSON.stringify(canon, Object.keys(canon).sort());
}

/** Outcome reported to the caller (mostly for tests + observability). */
export type InboundDispatchOutcome =
  | { readonly accepted: true; readonly sourceNodeId: string; readonly messageType: string }
  | { readonly accepted: false; readonly reason: InboundRejectionReason };

/**
 * Process one received message. Pure-ish: no side effects beyond audit
 * + event emission, both injected.
 *
 * `address` is the wire-level remote (e.g. `192.168.1.42:54321`).
 * `message.metadata.sourceNodeId` is the cryptographic identity claim.
 * The two MAY differ (e.g. behind NAT) — we trust `sourceNodeId` for
 * peer lookup since it's bound to the Ed25519 keypair.
 */
export async function dispatchInbound(
  address: string,
  message: AgentMessage,
  deps: InboundDispatchDeps,
): Promise<InboundDispatchOutcome> {
  const meta = (message.metadata ?? {}) as Record<string, unknown>;
  const sourceNodeId = typeof meta.sourceNodeId === 'string' ? meta.sourceNodeId : null;

  if (!sourceNodeId) {
    await deps.audit.log('message_rejected', {
      sourceNodeId: undefined,
      metadata: { address, reason: 'MISSING_METADATA' },
    });
    deps.logger.warn(`Inbound rejected: no sourceNodeId in metadata (from ${address})`);
    return { accepted: false, reason: 'MISSING_METADATA' };
  }

  const peer = deps.discovery.getPeer(sourceNodeId);
  if (!peer) {
    await deps.audit.log('message_rejected', {
      sourceNodeId,
      metadata: { address, reason: 'PEER_UNKNOWN' },
    });
    deps.logger.warn(`Inbound rejected: ${sourceNodeId} not in discovery (from ${address})`);
    return { accepted: false, reason: 'PEER_UNKNOWN' };
  }

  if (peer.state === FederationNodeState.SUSPENDED) {
    await deps.audit.log('message_rejected', {
      sourceNodeId,
      metadata: { address, reason: 'PEER_SUSPENDED' },
    });
    return { accepted: false, reason: 'PEER_SUSPENDED' };
  }

  if (peer.state === FederationNodeState.EVICTED) {
    await deps.audit.log('message_rejected', {
      sourceNodeId,
      metadata: { address, reason: 'PEER_EVICTED' },
    });
    return { accepted: false, reason: 'PEER_EVICTED' };
  }

  // Cryptographic signature verification (closes the trust gate that
  // peer-state checks alone don't provide — without this, a malicious
  // sender could just claim sourceNodeId='known-peer' in metadata and
  // pass the previous gates).
  if (deps.verifyEnvelope) {
    const sig = typeof meta.signature === 'string' ? meta.signature : null;
    const canon = canonicalizeEnvelopeForVerify(message);
    const ok = deps.verifyEnvelope(canon, sig, peer.publicKey);
    if (!ok) {
      await deps.audit.log('message_rejected', {
        sourceNodeId,
        metadata: { address, reason: 'INVALID_SIGNATURE' },
      });
      deps.logger.warn(`Inbound rejected: bad signature from ${sourceNodeId} (addr=${address})`);
      return { accepted: false, reason: 'INVALID_SIGNATURE' };
    }
  }

  // Touch lastSeen on every successful inbound — drives the
  // discovery service's stale-peer detection.
  peer.markSeen();

  // Audit accepted delivery
  await deps.audit.log('message_received', {
    sourceNodeId,
    metadata: {
      address,
      messageType: message.type,
      messageId: message.id,
    },
  });

  // Emit typed event for the integrator
  // Examples: federation:inbound:task, federation:inbound:memory-query
  const eventName = `${FEDERATION_INBOUND_EVENT_PREFIX}:${message.type}`;
  try {
    deps.eventBus.emit(eventName, {
      address,
      sourceNodeId,
      message,
      peer,
    });
  } catch (err) {
    // EventBus throw should not crash the receive loop.
    deps.logger.warn(
      `EventBus emit failed for ${eventName}: ${err instanceof Error ? err.message : err}`,
    );
  }

  return { accepted: true, sourceNodeId, messageType: message.type };
}
