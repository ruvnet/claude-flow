/**
 * A2A (Agent2Agent, Linux Foundation) Agent Card adapter — cards only.
 *
 * Maps ruflo's bespoke federation identity (`FederationManifest` /
 * `FederationNode`) to and from a spec-compliant A2A Agent Card so ruflo
 * nodes are discoverable by A2A peers and A2A peers appear in federation
 * discovery. This is an ADAPTER over the existing federation schema, not a
 * rewrite — A2A Tasks/messaging are deliberately out of scope.
 *
 * Spec: A2A Protocol 1.0.0 — https://a2a-protocol.org/latest/specification/
 * (schema source of truth: specification/a2a.proto in a2aproject/A2A).
 * Required AgentCard fields per spec §4.4.1: name, description,
 * supportedInterfaces, version, capabilities, defaultInputModes,
 * defaultOutputModes, skills.
 */

import { FederationNode } from '../domain/entities/federation-node.js';
import { TrustLevel } from '../domain/entities/trust-level.js';
import type { FederationManifest } from '../domain/services/discovery-service.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** A2A protocol version this adapter targets. */
export const A2A_PROTOCOL_VERSION = '1.0';

/**
 * Well-known URI for Agent Card discovery (A2A 1.0 §8.2 + IANA registration
 * §14). NOTE: earlier drafts used `/.well-known/agent.json`; 0.3.0+ settled
 * on `agent-card.json`.
 */
export const A2A_WELL_KNOWN_PATH = '/.well-known/agent-card.json';

/**
 * Open-form protocol binding string advertising ruflo's federation wire
 * (Ed25519-signed envelopes over WebSocket/QUIC). Spec §4.4.6 explicitly
 * allows non-core bindings: "This is an open form string, to be easily
 * extended for other protocol bindings."
 */
export const RUFLO_FEDERATION_BINDING = 'RUFLO-FEDERATION';

/**
 * Extension URI carrying the bespoke federation identity inside the card
 * (spec §4.6 AgentExtension). Enables lossless round-trip in fromAgentCard.
 */
export const RUFLO_FEDERATION_EXTENSION_URI = 'urn:ruflo:federation:manifest:v1';

// ---------------------------------------------------------------------------
// A2A 1.0 card types (subset used by this adapter — field names per spec JSON
// mapping, i.e. lowerCamelCase of the proto fields)
// ---------------------------------------------------------------------------

export interface A2AAgentInterface {
  readonly url: string;
  readonly protocolBinding: string;
  readonly protocolVersion: string;
  readonly tenant?: string;
}

export interface A2AAgentSkill {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly tags: readonly string[];
  readonly examples?: readonly string[];
  readonly inputModes?: readonly string[];
  readonly outputModes?: readonly string[];
}

export interface A2AAgentExtension {
  readonly uri: string;
  readonly description?: string;
  readonly required?: boolean;
  readonly params?: Record<string, unknown>;
}

export interface A2AAgentCapabilities {
  readonly streaming?: boolean;
  readonly pushNotifications?: boolean;
  readonly extensions?: readonly A2AAgentExtension[];
  readonly extendedAgentCard?: boolean;
}

export interface A2AAgentProvider {
  readonly url: string;
  readonly organization: string;
}

export interface A2AAgentCard {
  readonly name: string;
  readonly description: string;
  readonly supportedInterfaces: readonly A2AAgentInterface[];
  readonly version: string;
  readonly capabilities: A2AAgentCapabilities;
  readonly defaultInputModes: readonly string[];
  readonly defaultOutputModes: readonly string[];
  readonly skills: readonly A2AAgentSkill[];
  readonly provider?: A2AAgentProvider;
  readonly documentationUrl?: string;
  readonly iconUrl?: string;
  readonly securitySchemes?: Record<string, unknown>;
  readonly securityRequirements?: readonly Record<string, readonly string[]>[];
  readonly signatures?: readonly { protected: string; signature: string }[];
}

// ---------------------------------------------------------------------------
// Generation: FederationManifest → A2A Agent Card
// ---------------------------------------------------------------------------

export interface ToAgentCardOptions {
  /** Human-readable agent name; defaults to `ruflo-federation/<nodeId>`. */
  readonly name?: string;
  /** Human-readable description override. */
  readonly description?: string;
  readonly provider?: A2AAgentProvider;
  readonly documentationUrl?: string;
  /**
   * Extra spec-core interfaces to advertise ahead of the federation binding
   * (e.g. a JSONRPC endpoint once A2A messaging lands). First entry is the
   * preferred interface per spec.
   */
  readonly additionalInterfaces?: readonly A2AAgentInterface[];
}

/** Normalize a federation endpoint (ws://host:port, host:port, …) to a URL. */
function endpointToUrl(endpoint: string): string {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(endpoint)) return endpoint;
  return `ws://${endpoint}`;
}

/**
 * Generate a spec-compliant A2A Agent Card from a ruflo federation manifest.
 * Every agent type becomes an AgentSkill; the federation endpoint becomes a
 * `RUFLO-FEDERATION` interface; the bespoke identity (nodeId, publicKey,
 * complianceModes, manifest signature) rides in a spec §4.6 extension so
 * `fromAgentCard` can restore it.
 */
export function toAgentCard(
  manifest: FederationManifest,
  options: ToAgentCardOptions = {},
): A2AAgentCard {
  const skills: A2AAgentSkill[] = manifest.capabilities.agentTypes.map((agentType) => ({
    id: `agent-type:${agentType}`,
    name: agentType,
    description: `Federated ruflo agent role "${agentType}" — dispatchable via cross-installation federation sessions.`,
    tags: ['ruflo', 'federation', 'agent-role', agentType],
  }));

  const interfaces: A2AAgentInterface[] = [
    ...(options.additionalInterfaces ?? []),
    {
      url: endpointToUrl(manifest.endpoint),
      protocolBinding: RUFLO_FEDERATION_BINDING,
      protocolVersion: A2A_PROTOCOL_VERSION,
    },
  ];

  const federationExtension: A2AAgentExtension = {
    uri: RUFLO_FEDERATION_EXTENSION_URI,
    description: 'ruflo cross-installation federation identity (Ed25519-signed manifest)',
    required: false,
    params: {
      nodeId: manifest.nodeId,
      publicKey: manifest.publicKey,
      endpoint: manifest.endpoint,
      maxConcurrentSessions: manifest.capabilities.maxConcurrentSessions,
      supportedProtocols: [...manifest.capabilities.supportedProtocols],
      complianceModes: [...manifest.capabilities.complianceModes],
      manifestSignature: manifest.signature,
      manifestTimestamp: manifest.timestamp,
    },
  };

  return {
    name: options.name ?? `ruflo-federation/${manifest.nodeId}`,
    description:
      options.description ??
      `Ruflo federation node ${manifest.nodeId} — zero-trust cross-installation agent federation ` +
      `(${manifest.capabilities.agentTypes.length} agent role(s), PII-gated data flow, compliance-grade audit trail).`,
    supportedInterfaces: interfaces,
    version: manifest.version,
    capabilities: {
      streaming: false,
      pushNotifications: false,
      extendedAgentCard: false,
      extensions: [federationExtension],
    },
    defaultInputModes: ['application/json', 'text/plain'],
    defaultOutputModes: ['application/json', 'text/plain'],
    skills,
    ...(options.provider ? { provider: options.provider } : {}),
    ...(options.documentationUrl ? { documentationUrl: options.documentationUrl } : {}),
  };
}

// ---------------------------------------------------------------------------
// Validation (spec §4.4.1 REQUIRED fields)
// ---------------------------------------------------------------------------

export interface AgentCardValidation {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

/**
 * Structural validation against the A2A 1.0 AgentCard REQUIRED fields.
 * Intentionally strict on required shape, lenient on unknown extra fields
 * (forward compatibility with future spec minors).
 */
export function validateAgentCard(value: unknown): AgentCardValidation {
  const errors: string[] = [];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { valid: false, errors: ['card must be a JSON object'] };
  }
  const card = value as Record<string, unknown>;

  const requireString = (field: string) => {
    if (typeof card[field] !== 'string' || (card[field] as string).length === 0) {
      errors.push(`missing or empty required string field: ${field}`);
    }
  };
  requireString('name');
  requireString('description');
  requireString('version');

  const interfaces = card['supportedInterfaces'];
  if (!Array.isArray(interfaces) || interfaces.length === 0) {
    errors.push('supportedInterfaces must be a non-empty array (spec 4.4.1)');
  } else {
    interfaces.forEach((iface, i) => {
      if (typeof iface !== 'object' || iface === null) {
        errors.push(`supportedInterfaces[${i}] must be an object`);
        return;
      }
      for (const f of ['url', 'protocolBinding', 'protocolVersion']) {
        if (typeof (iface as Record<string, unknown>)[f] !== 'string' || !(iface as Record<string, unknown>)[f]) {
          errors.push(`supportedInterfaces[${i}].${f} is required (spec 4.4.6)`);
        }
      }
    });
  }

  if (typeof card['capabilities'] !== 'object' || card['capabilities'] === null || Array.isArray(card['capabilities'])) {
    errors.push('capabilities must be an object (spec 4.4.1)');
  }

  for (const field of ['defaultInputModes', 'defaultOutputModes']) {
    const v = card[field];
    if (!Array.isArray(v) || v.length === 0 || !v.every((x) => typeof x === 'string')) {
      errors.push(`${field} must be a non-empty array of media-type strings (spec 4.4.1)`);
    }
  }

  const skills = card['skills'];
  if (!Array.isArray(skills)) {
    errors.push('skills must be an array (spec 4.4.1)');
  } else {
    skills.forEach((skill, i) => {
      if (typeof skill !== 'object' || skill === null) {
        errors.push(`skills[${i}] must be an object`);
        return;
      }
      const s = skill as Record<string, unknown>;
      for (const f of ['id', 'name', 'description']) {
        if (typeof s[f] !== 'string' || !s[f]) errors.push(`skills[${i}].${f} is required (spec 4.4.5)`);
      }
      if (!Array.isArray(s['tags'])) errors.push(`skills[${i}].tags is required (spec 4.4.5)`);
    });
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Consumption: A2A Agent Card → bespoke federation registry shape
// ---------------------------------------------------------------------------

/** Slugify a card name into a stable nodeId when no extension identity exists. */
function slugify(name: string): string {
  // Linear-time dash trim (no /^-+|-+$/ regex — that anchor+quantifier pattern
  // is polynomial-time on adversarial all-dash input, flagged js/polynomial-redos).
  const collapsed = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  let start = 0;
  let end = collapsed.length;
  while (start < end && collapsed.charCodeAt(start) === 45 /* '-' */) start++;
  while (end > start && collapsed.charCodeAt(end - 1) === 45 /* '-' */) end--;
  return collapsed.slice(start, end).slice(0, 64) || 'a2a-peer';
}

function findFederationExtension(card: A2AAgentCard): A2AAgentExtension | undefined {
  return card.capabilities.extensions?.find((e) => e.uri === RUFLO_FEDERATION_EXTENSION_URI);
}

/**
 * Map a validated remote A2A Agent Card into the bespoke federation registry
 * shape (a `FederationNode`) so A2A peers appear in federation discovery.
 *
 * Trust posture: A2A cards are self-describing metadata, NOT authenticated
 * federation manifests — consumed peers always enter at
 * `TrustLevel.UNTRUSTED` regardless of embedded identity claims. Trust is
 * earned afterwards through the normal handshake + TrustEvaluator path.
 */
export function fromAgentCard(card: A2AAgentCard, sourceUrl?: string): FederationNode {
  const ext = findFederationExtension(card);
  const params = (ext?.params ?? {}) as Record<string, unknown>;

  const preferred = card.supportedInterfaces[0];
  const federationIface = card.supportedInterfaces.find(
    (i) => i.protocolBinding === RUFLO_FEDERATION_BINDING,
  );
  const endpoint =
    (typeof params['endpoint'] === 'string' && params['endpoint']) ||
    federationIface?.url ||
    preferred?.url ||
    '';

  const nodeId =
    (typeof params['nodeId'] === 'string' && params['nodeId']) || `a2a-${slugify(card.name)}`;

  const agentTypes = card.skills.map((s) =>
    s.id.startsWith('agent-type:') ? s.id.slice('agent-type:'.length) : s.id,
  );

  const supportedProtocols = Array.isArray(params['supportedProtocols'])
    ? (params['supportedProtocols'] as string[])
    : [...new Set(card.supportedInterfaces.map((i) => i.protocolBinding.toLowerCase()))];

  return FederationNode.create({
    nodeId,
    publicKey: typeof params['publicKey'] === 'string' ? (params['publicKey'] as string) : '',
    endpoint,
    capabilities: {
      agentTypes,
      maxConcurrentSessions:
        typeof params['maxConcurrentSessions'] === 'number'
          ? (params['maxConcurrentSessions'] as number)
          : 1,
      supportedProtocols,
      complianceModes: Array.isArray(params['complianceModes'])
        ? (params['complianceModes'] as string[])
        : [],
    },
    trustLevel: TrustLevel.UNTRUSTED,
    metadata: {
      discoveryMechanism: 'a2a-card',
      version: card.version,
      a2a: {
        cardName: card.name,
        protocolVersion: preferred?.protocolVersion ?? A2A_PROTOCOL_VERSION,
        sourceUrl: sourceUrl ?? null,
        skillCount: card.skills.length,
      },
    },
  });
}
