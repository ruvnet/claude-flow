/**
 * A2A Agent Card adapter tests — generation (FederationManifest → card,
 * golden-file), validation (A2A 1.0 §4.4.1 required fields), and
 * consumption (card → bespoke federation registry shape).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  toAgentCard,
  fromAgentCard,
  validateAgentCard,
  A2A_PROTOCOL_VERSION,
  A2A_WELL_KNOWN_PATH,
  RUFLO_FEDERATION_BINDING,
  RUFLO_FEDERATION_EXTENSION_URI,
  type A2AAgentCard,
} from '../../src/a2a/agent-card.js';
import { DiscoveryService } from '../../src/domain/services/discovery-service.js';
import { TrustLevel } from '../../src/domain/entities/trust-level.js';
import type { FederationManifest } from '../../src/domain/services/discovery-service.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

function goldenCard(): A2AAgentCard {
  return JSON.parse(readFileSync(join(FIXTURES, 'a2a-agent-card.golden.json'), 'utf-8'));
}

function makeManifest(overrides: Partial<FederationManifest> = {}): FederationManifest {
  return {
    nodeId: 'node-golden',
    publicKey: 'aabbccddeeff',
    endpoint: 'ws://127.0.0.1:9100',
    capabilities: {
      agentTypes: ['coder', 'reviewer'],
      maxConcurrentSessions: 5,
      supportedProtocols: ['websocket', 'http'],
      complianceModes: ['hipaa'],
    },
    version: '1.0.0-alpha.16',
    signature: 'sig-golden',
    timestamp: '2026-07-03T00:00:00.000Z',
    ...overrides,
  };
}

describe('A2A constants', () => {
  it('targets A2A protocol 1.0 at the spec well-known path', () => {
    expect(A2A_PROTOCOL_VERSION).toBe('1.0');
    // 0.3.0+ renamed agent.json → agent-card.json; 1.0 keeps agent-card.json
    expect(A2A_WELL_KNOWN_PATH).toBe('/.well-known/agent-card.json');
  });
});

describe('toAgentCard', () => {
  it('matches the golden card byte-for-byte (deep equal)', () => {
    expect(toAgentCard(makeManifest())).toEqual(goldenCard());
  });

  it('produces a card that passes its own spec validation', () => {
    const result = validateAgentCard(toAgentCard(makeManifest()));
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('includes every A2A 1.0 REQUIRED field', () => {
    const card = toAgentCard(makeManifest());
    // spec §4.4.1 required: name, description, supportedInterfaces, version,
    // capabilities, defaultInputModes, defaultOutputModes, skills
    expect(card.name).toBeTruthy();
    expect(card.description).toBeTruthy();
    expect(card.supportedInterfaces.length).toBeGreaterThan(0);
    expect(card.version).toBeTruthy();
    expect(card.capabilities).toBeTypeOf('object');
    expect(card.defaultInputModes.length).toBeGreaterThan(0);
    expect(card.defaultOutputModes.length).toBeGreaterThan(0);
    expect(Array.isArray(card.skills)).toBe(true);
  });

  it('advertises the federation endpoint as an open-form RUFLO-FEDERATION binding', () => {
    const card = toAgentCard(makeManifest());
    const iface = card.supportedInterfaces[0]!;
    expect(iface.protocolBinding).toBe(RUFLO_FEDERATION_BINDING);
    expect(iface.protocolVersion).toBe(A2A_PROTOCOL_VERSION);
    expect(iface.url).toBe('ws://127.0.0.1:9100');
  });

  it('normalizes a bare host:port endpoint into a URL', () => {
    const card = toAgentCard(makeManifest({ endpoint: '10.0.0.5:9100' }));
    expect(card.supportedInterfaces[0]!.url).toBe('ws://10.0.0.5:9100');
  });

  it('maps every agent type to a spec-valid AgentSkill', () => {
    const card = toAgentCard(makeManifest());
    expect(card.skills.map((s) => s.id)).toEqual(['agent-type:coder', 'agent-type:reviewer']);
    for (const skill of card.skills) {
      expect(skill.name).toBeTruthy();
      expect(skill.description).toBeTruthy();
      expect(skill.tags.length).toBeGreaterThan(0); // tags REQUIRED per §4.4.5
    }
  });

  it('supports name/description/provider/interface overrides', () => {
    const card = toAgentCard(makeManifest(), {
      name: 'My Agent',
      description: 'Custom description',
      provider: { url: 'https://ruv.net', organization: 'ruvnet' },
      additionalInterfaces: [
        { url: 'https://api.example.com/a2a/v1', protocolBinding: 'JSONRPC', protocolVersion: '1.0' },
      ],
    });
    expect(card.name).toBe('My Agent');
    expect(card.description).toBe('Custom description');
    expect(card.provider).toEqual({ url: 'https://ruv.net', organization: 'ruvnet' });
    // additional interfaces come first (preferred per spec ordering)
    expect(card.supportedInterfaces[0]!.protocolBinding).toBe('JSONRPC');
    expect(card.supportedInterfaces[1]!.protocolBinding).toBe(RUFLO_FEDERATION_BINDING);
  });
});

describe('validateAgentCard', () => {
  it('accepts the golden card', () => {
    expect(validateAgentCard(goldenCard()).valid).toBe(true);
  });

  it('rejects non-objects', () => {
    expect(validateAgentCard(null).valid).toBe(false);
    expect(validateAgentCard('card').valid).toBe(false);
    expect(validateAgentCard([]).valid).toBe(false);
  });

  it.each([
    ['name'], ['description'], ['version'],
    ['supportedInterfaces'], ['capabilities'],
    ['defaultInputModes'], ['defaultOutputModes'], ['skills'],
  ])('rejects a card missing required field %s', (field) => {
    const card = { ...goldenCard() } as Record<string, unknown>;
    delete card[field];
    const result = validateAgentCard(card);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes(field))).toBe(true);
  });

  it('rejects interfaces missing url/protocolBinding/protocolVersion', () => {
    const card = { ...goldenCard(), supportedInterfaces: [{ url: 'ws://x' }] };
    const result = validateAgentCard(card);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain('protocolBinding');
    expect(result.errors.join(' ')).toContain('protocolVersion');
  });

  it('rejects skills missing required id/name/description/tags', () => {
    const card = { ...goldenCard(), skills: [{ id: 'x' }] };
    const result = validateAgentCard(card);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain('tags');
  });

  it('tolerates unknown extra fields (forward compatibility)', () => {
    const card = { ...goldenCard(), futureField: { anything: true } };
    expect(validateAgentCard(card).valid).toBe(true);
  });
});

describe('fromAgentCard', () => {
  it('round-trips a ruflo-generated card back to the federation identity', () => {
    const manifest = makeManifest();
    const node = fromAgentCard(toAgentCard(manifest), 'http://127.0.0.1:41241/.well-known/agent-card.json');

    expect(node.nodeId).toBe('node-golden');
    expect(node.publicKey).toBe('aabbccddeeff');
    expect(node.endpoint).toBe('ws://127.0.0.1:9100');
    expect(node.capabilities.agentTypes).toEqual(['coder', 'reviewer']);
    expect(node.capabilities.maxConcurrentSessions).toBe(5);
    expect(node.capabilities.supportedProtocols).toEqual(['websocket', 'http']);
    expect(node.capabilities.complianceModes).toEqual(['hipaa']);
    expect(node.metadata.discoveryMechanism).toBe('a2a-card');
  });

  it('always enters at TrustLevel.UNTRUSTED regardless of card claims', () => {
    const node = fromAgentCard(toAgentCard(makeManifest()));
    expect(node.trustLevel).toBe(TrustLevel.UNTRUSTED);
    expect(node.trustScore).toBe(0);
  });

  it('maps a foreign (non-ruflo) A2A card without the federation extension', () => {
    const foreign: A2AAgentCard = {
      name: 'GeoSpatial Route Planner Agent',
      description: 'Route planning services.',
      supportedInterfaces: [
        { url: 'https://georoute.example.com/a2a/v1', protocolBinding: 'JSONRPC', protocolVersion: '1.0' },
      ],
      version: '1.2.0',
      capabilities: { streaming: true },
      defaultInputModes: ['application/json'],
      defaultOutputModes: ['application/json'],
      skills: [
        { id: 'route-optimizer', name: 'Route Optimizer', description: 'Optimizes routes.', tags: ['maps'] },
      ],
    };
    expect(validateAgentCard(foreign).valid).toBe(true);

    const node = fromAgentCard(foreign, 'https://georoute.example.com/.well-known/agent-card.json');
    expect(node.nodeId).toBe('a2a-geospatial-route-planner-agent');
    expect(node.publicKey).toBe('');
    expect(node.endpoint).toBe('https://georoute.example.com/a2a/v1');
    expect(node.capabilities.agentTypes).toEqual(['route-optimizer']);
    expect(node.capabilities.supportedProtocols).toEqual(['jsonrpc']);
    expect(node.trustLevel).toBe(TrustLevel.UNTRUSTED);
    expect((node.metadata as { a2a?: { sourceUrl?: string } }).a2a?.sourceUrl)
      .toBe('https://georoute.example.com/.well-known/agent-card.json');
  });
});

describe('DiscoveryService.registerExternalPeer', () => {
  function makeDiscovery() {
    return new DiscoveryService({
      signManifest: async () => 'sig',
      verifyManifest: async () => true,
    });
  }

  it('registers an A2A-card peer so it appears in federation discovery', () => {
    const discovery = makeDiscovery();
    const node = fromAgentCard(toAgentCard(makeManifest()));
    discovery.registerExternalPeer(node);

    const peers = discovery.listPeers();
    expect(peers).toHaveLength(1);
    expect(peers[0]!.nodeId).toBe('node-golden');
    expect(peers[0]!.metadata.discoveryMechanism).toBe('a2a-card');
  });

  it('refreshes (not replaces) an existing peer, preserving trust state', () => {
    const discovery = makeDiscovery();
    const first = discovery.registerExternalPeer(fromAgentCard(toAgentCard(makeManifest())));
    first.updateTrustScore(0.7);

    const again = discovery.registerExternalPeer(fromAgentCard(toAgentCard(makeManifest())));
    expect(again).toBe(first);
    expect(again.trustScore).toBe(0.7);
    expect(discovery.listPeers()).toHaveLength(1);
  });
});
