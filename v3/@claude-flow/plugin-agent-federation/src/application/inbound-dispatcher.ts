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
import type { FederationNode } from '../domain/entities/federation-node.js';
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
  | 'INVALID_SIGNATURE'
  | 'LEGACY_SIGNATURE_TYPE_REJECTED'
  | 'AUTHORIZATION_DENIED'
  | 'AUTHORIZATION_ERROR';

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

export const JCS_SIGNATURE_PROTOCOL = 'ruflo-signature-jcs-v1' as const;
export type EnvelopeSignatureVersion = 'legacy-v1' | 'jcs-v1';
export type EnvelopeSignatureMode = 'legacy' | 'prefer-jcs' | 'require-jcs';
/**
 * Updated peers advertise and negotiate recursively complete JCS signatures
 * without operator configuration. Legacy mode remains explicit for low-risk
 * heartbeat/status interoperability only.
 */
export const DEFAULT_ENVELOPE_SIGNATURE_MODE: EnvelopeSignatureMode = 'prefer-jcs';
export type InboundAuthorizationMode = 'legacy' | 'observe' | 'enforce';

/**
 * The historical serializer does not authenticate nested payload fields.
 * Keep it available only for messages whose payload cannot mutate federation
 * state or transfer data/ownership. Unknown types are intentionally denied.
 */
const LEGACY_V1_LOW_RISK_MESSAGE_TYPES: ReadonlySet<string> = new Set([
  'heartbeat',
  'status-broadcast',
]);

export function isLegacyEnvelopeTypeAllowed(messageType: string): boolean {
  return LEGACY_V1_LOW_RISK_MESSAGE_TYPES.has(messageType);
}

export interface InboundAuthorizationRequest {
  readonly address: string;
  readonly sourceNodeId: string;
  readonly messageType: string;
  readonly message: AgentMessage;
  readonly peer: FederationNode;
  readonly signatureVersion: EnvelopeSignatureVersion;
  readonly messageSizeBytes: number;
}

export interface InboundAuthorizationDecision {
  readonly allowed: boolean;
  readonly reason?: string;
}

export type InboundAuthorizationEvaluator = (
  request: InboundAuthorizationRequest,
) => InboundAuthorizationDecision | Promise<InboundAuthorizationDecision>;

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
  /** Defaults to both versions; enforce-only deployments pass `['jcs-v1']`. */
  readonly acceptedSignatureVersions?: readonly EnvelopeSignatureVersion[];
  /** Compatibility mode defaults to legacy; enforce is fail-closed. */
  readonly authorizationMode?: InboundAuthorizationMode;
  /** Injected policy decision point. It is always called before event emission. */
  readonly authorizeInbound?: InboundAuthorizationEvaluator;
}

/**
 * Canonical serialization of an envelope for signing. This is the
 * RFC 8785/JCS-compatible subset used by federation v1 while v2 schema
 * negotiation is introduced. It recursively sorts object keys and rejects
 * values outside the I-JSON-safe subset instead of silently dropping them.
 * The `signature` field itself is excluded because it is what we verify.
 *
 * Federation messages are wrapped as `AgentMessage{id, type, payload,
 * metadata}` on the wire. The `payload` is the actual FederationEnvelope
 * (per `plugin.ts sendToNode`); we canonicalize the payload + the
 * metadata so the receiver verifies the same bytes the sender signed.
 */
function canonicalizeJcsValue(value: unknown, ancestors: Set<object>): string {
  if (value === null) return 'null';

  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'string':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value) || Object.is(value, -0)) {
        throw new TypeError('Federation canonicalization rejects non-canonical numbers');
      }
      if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
        throw new TypeError('Federation canonicalization rejects unsafe integers');
      }
      return JSON.stringify(value);
    case 'bigint':
    case 'function':
    case 'symbol':
    case 'undefined':
      throw new TypeError(`Federation canonicalization rejects ${typeof value}`);
    case 'object':
      break;
    default:
      throw new TypeError(`Federation canonicalization rejects ${typeof value}`);
  }

  const object = value as object;
  if (ancestors.has(object)) {
    throw new TypeError('Federation canonicalization rejects cyclic values');
  }
  ancestors.add(object);

  try {
    if (Array.isArray(value)) {
      const items: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) {
          throw new TypeError('Federation canonicalization rejects sparse arrays');
        }
        items.push(canonicalizeJcsValue(value[index], ancestors));
      }
      return `[${items.join(',')}]`;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('Federation canonicalization accepts only plain objects');
    }

    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalizeJcsValue(record[key], ancestors)}`);
    return `{${entries.join(',')}}`;
  } finally {
    ancestors.delete(object);
  }
}

function envelopeSignatureVersion(message: AgentMessage): EnvelopeSignatureVersion {
  const version = (message.metadata as Record<string, unknown> | undefined)?.signatureVersion;
  if (version === undefined) return 'legacy-v1';
  if (version === 'jcs-v1') return version;
  throw new TypeError(`Unsupported federation signature version: ${String(version)}`);
}

export function selectEnvelopeSignatureVersion(
  mode: EnvelopeSignatureMode,
  peerProtocols: readonly string[],
  messageType?: string,
): EnvelopeSignatureVersion {
  const selected = mode === 'legacy'
    ? 'legacy-v1'
    : peerProtocols.includes(JCS_SIGNATURE_PROTOCOL)
      ? 'jcs-v1'
      : mode === 'prefer-jcs'
        ? 'legacy-v1'
        : null;
  if (selected === null) {
    throw new Error('PEER_SIGNATURE_PROTOCOL_UNSUPPORTED');
  }
  if (
    selected === 'legacy-v1'
    && messageType !== undefined
    && !isLegacyEnvelopeTypeAllowed(messageType)
  ) {
    throw new Error(`PEER_SIGNATURE_PROTOCOL_UNSUPPORTED_FOR_MESSAGE: ${messageType}`);
  }
  return selected;
}

export function canonicalizeEnvelopeForVerify(
  message: AgentMessage,
  requestedVersion?: EnvelopeSignatureVersion,
): string {
  const meta = (message.metadata ?? {}) as Record<string, unknown>;
  // Strip signature from metadata if present (we verify the rest)
  const { signature: _sig, ...metaForSig } = meta;
  const canon = {
    id: message.id,
    type: message.type,
    payload: message.payload,
    metadata: metaForSig,
  };
  const version = requestedVersion ?? envelopeSignatureVersion(message);
  if (version === 'legacy-v1') {
    // Byte-for-byte compatibility with releases through 1.0.0-alpha.16.
    // Its recursive array replacer omits nested fields, so legacy messages
    // cannot become privileged ownership mutations.
    return JSON.stringify(canon, Object.keys(canon).sort());
  }
  return canonicalizeJcsValue(canon, new Set());
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

  let signatureVersion: EnvelopeSignatureVersion;
  let canonicalEnvelope: string;
  try {
    signatureVersion = envelopeSignatureVersion(message);
    const accepted = deps.acceptedSignatureVersions ?? ['legacy-v1', 'jcs-v1'];
    if (!accepted.includes(signatureVersion)) {
      throw new TypeError(`Signature version ${signatureVersion} is disabled`);
    }
    canonicalEnvelope = canonicalizeEnvelopeForVerify(message, signatureVersion);
  } catch {
    await deps.audit.log('message_rejected', {
      sourceNodeId,
      metadata: { address, reason: 'INVALID_PAYLOAD' },
    });
    deps.logger.warn(`Inbound rejected: non-canonical payload from ${sourceNodeId} (addr=${address})`);
    return { accepted: false, reason: 'INVALID_PAYLOAD' };
  }

  // Cryptographic signature verification (closes the trust gate that
  // peer-state checks alone don't provide — without this, a malicious
  // sender could just claim sourceNodeId='known-peer' in metadata and
  // pass the previous gates).
  if (deps.verifyEnvelope) {
    const sig = typeof meta.signature === 'string' ? meta.signature : null;
    let ok = false;
    try {
      ok = deps.verifyEnvelope(canonicalEnvelope, sig, peer.publicKey);
    } catch {
      await deps.audit.log('message_rejected', {
        sourceNodeId,
        metadata: { address, reason: 'INVALID_PAYLOAD' },
      });
      deps.logger.warn(`Inbound rejected: non-canonical payload from ${sourceNodeId} (addr=${address})`);
      return { accepted: false, reason: 'INVALID_PAYLOAD' };
    }
    if (!ok) {
      await deps.audit.log('message_rejected', {
        sourceNodeId,
        metadata: { address, reason: 'INVALID_SIGNATURE' },
      });
      deps.logger.warn(`Inbound rejected: bad signature from ${sourceNodeId} (addr=${address})`);
      return { accepted: false, reason: 'INVALID_SIGNATURE' };
    }
  }

  // The legacy serializer omits nested fields. No policy grant can make those
  // unauthenticated bytes safe for a consequential operation, so this gate is
  // independent of authorization compatibility mode.
  if (
    signatureVersion === 'legacy-v1' &&
    !isLegacyEnvelopeTypeAllowed(message.type)
  ) {
    await deps.audit.log('message_rejected', {
      sourceNodeId,
      metadata: {
        address,
        reason: 'LEGACY_SIGNATURE_TYPE_REJECTED',
        messageType: message.type,
      },
    });
    deps.logger.warn(
      `Inbound rejected: legacy-v1 is not permitted for message type ${message.type} ` +
        `from ${sourceNodeId}`,
    );
    return { accepted: false, reason: 'LEGACY_SIGNATURE_TYPE_REJECTED' };
  }

  const authorizationMode = deps.authorizationMode ?? 'legacy';
  if (
    authorizationMode !== 'legacy' &&
    authorizationMode !== 'observe' &&
    authorizationMode !== 'enforce'
  ) {
    await deps.audit.log('message_rejected', {
      sourceNodeId,
      metadata: { address, reason: 'AUTHORIZATION_ERROR' },
    });
    return { accepted: false, reason: 'AUTHORIZATION_ERROR' };
  }

  let authorizationDecision: InboundAuthorizationDecision | undefined;
  if (deps.authorizeInbound) {
    try {
      const decision = await deps.authorizeInbound({
        address,
        sourceNodeId,
        messageType: message.type,
        message,
        peer,
        signatureVersion,
        messageSizeBytes: new TextEncoder().encode(canonicalEnvelope).byteLength,
      });
      if (!decision || typeof decision.allowed !== 'boolean') {
        throw new TypeError('Inbound authorization evaluator returned an invalid decision');
      }
      authorizationDecision = decision;
    } catch {
      if (authorizationMode === 'enforce') {
        await deps.audit.log('message_rejected', {
          sourceNodeId,
          metadata: { address, reason: 'AUTHORIZATION_ERROR', messageType: message.type },
        });
        deps.logger.warn(`Inbound authorization failed for ${sourceNodeId} (addr=${address})`);
        return { accepted: false, reason: 'AUTHORIZATION_ERROR' };
      }
      deps.logger.warn(
        `Inbound authorization observation failed for ${sourceNodeId} (mode=${authorizationMode})`,
      );
    }
  } else if (authorizationMode === 'enforce') {
    await deps.audit.log('message_rejected', {
      sourceNodeId,
      metadata: { address, reason: 'AUTHORIZATION_ERROR', messageType: message.type },
    });
    deps.logger.warn('Inbound rejected: enforce mode has no authorization evaluator');
    return { accepted: false, reason: 'AUTHORIZATION_ERROR' };
  }

  if (authorizationDecision && !authorizationDecision.allowed) {
    if (authorizationMode === 'enforce') {
      await deps.audit.log('message_rejected', {
        sourceNodeId,
        metadata: {
          address,
          reason: 'AUTHORIZATION_DENIED',
          messageType: message.type,
          policyReason: authorizationDecision.reason,
        },
      });
      deps.logger.warn(`Inbound authorization denied for ${sourceNodeId} (addr=${address})`);
      return { accepted: false, reason: 'AUTHORIZATION_DENIED' };
    }
    deps.logger.warn(
      `Inbound authorization would deny ${message.type} from ${sourceNodeId} ` +
        `(mode=${authorizationMode})`,
    );
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
      authorizationMode,
      authorizationAllowed: authorizationDecision?.allowed,
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
