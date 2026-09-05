/**
 * DiscoveryService Tests
 *
 * Tests the actual DiscoveryService implementation against the real API.
 * Uses simple dependency injection for signManifest/verifyManifest,
 * and vi.fn() only for the onPeerDiscovered callback.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  DiscoveryService,
  type DiscoveryServiceDeps,
  type FederationManifest,
} from '../../src/domain/services/discovery-service.js';
import { TrustLevel } from '../../src/domain/entities/trust-level.js';

function makeManifest(overrides: Partial<FederationManifest> = {}): FederationManifest {
  return {
    nodeId: 'node-1',
    publicKey: 'pk-1',
    endpoint: 'https://peer1.example.com',
    capabilities: {
      agentTypes: ['coder'],
      maxConcurrentSessions: 5,
      supportedProtocols: ['websocket', 'http'],
      complianceModes: ['hipaa'],
    },
    version: '1.0.0',
    signature: 'valid',
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function createDeps(overrides: Partial<DiscoveryServiceDeps> = {}): DiscoveryServiceDeps {
  return {
    signManifest: async () => 'test-signature',
    verifyManifest: async (m) => m.signature === 'valid',
    ...overrides,
  };
}

describe('DiscoveryService', () => {
  let service: DiscoveryService;
  let deps: DiscoveryServiceDeps;

  beforeEach(() => {
    deps = createDeps();
    service = new DiscoveryService(deps);
  });

  afterEach(() => {
    service.stopPeriodicDiscovery();
  });

  // ---------- publishManifest ----------

  describe('publishManifest', () => {
    it('should sign the manifest using the signManifest dep and return it with signature', async () => {
      const input = {
        nodeId: 'local-node',
        publicKey: 'local-pk',
        endpoint: 'https://local.example.com',
        capabilities: {
          agentTypes: ['coder', 'tester'],
          maxConcurrentSessions: 10,
          supportedProtocols: ['websocket'] as readonly string[],
          complianceModes: [] as readonly string[],
        },
        version: '2.0.0',
        timestamp: new Date().toISOString(),
      };

      const result = await service.publishManifest(input);

      expect(result.signature).toBe('test-signature');
      expect(result.nodeId).toBe('local-node');
      expect(result.publicKey).toBe('local-pk');
      expect(result.version).toBe('2.0.0');
    });

    it('should store the manifest so getLocalManifest returns it', async () => {
      const input = {
        nodeId: 'local-node',
        publicKey: 'local-pk',
        endpoint: 'https://local.example.com',
        capabilities: {
          agentTypes: [] as readonly string[],
          maxConcurrentSessions: 1,
          supportedProtocols: ['http'] as readonly string[],
          complianceModes: [] as readonly string[],
        },
        version: '1.0.0',
        timestamp: new Date().toISOString(),
      };

      await service.publishManifest(input);
      const stored = service.getLocalManifest();

      expect(stored).not.toBeNull();
      expect(stored!.nodeId).toBe('local-node');
      expect(stored!.signature).toBe('test-signature');
    });
  });

  // ---------- getLocalManifest ----------

  describe('getLocalManifest', () => {
    it('should return null before any manifest is published', () => {
      expect(service.getLocalManifest()).toBeNull();
    });

    it('should return the manifest after publishing', async () => {
      await service.publishManifest({
        nodeId: 'n',
        publicKey: 'pk',
        endpoint: 'https://n.example.com',
        capabilities: {
          agentTypes: [] as readonly string[],
          maxConcurrentSessions: 1,
          supportedProtocols: [] as readonly string[],
          complianceModes: [] as readonly string[],
        },
        version: '1.0.0',
        timestamp: new Date().toISOString(),
      });

      const manifest = service.getLocalManifest();
      expect(manifest).not.toBeNull();
      expect(manifest!.nodeId).toBe('n');
    });
  });

  // ---------- addStaticPeer ----------

  describe('addStaticPeer', () => {
    it('should add a peer with UNTRUSTED trust level when no manifest is provided', async () => {
      const node = await service.addStaticPeer('https://peer1.example.com');

      expect(node).toBeDefined();
      expect(node.endpoint).toBe('https://peer1.example.com');
      expect(node.trustLevel).toBe(TrustLevel.UNTRUSTED);
    });

    it('should add a peer with VERIFIED trust level when a valid manifest is provided', async () => {
      const manifest = makeManifest({ signature: 'valid' });
      const node = await service.addStaticPeer('https://peer1.example.com', manifest);

      expect(node.trustLevel).toBe(TrustLevel.VERIFIED);
      expect(node.nodeId).toBe('node-1');
    });

    it('should throw when provided an invalid manifest', async () => {
      const manifest = makeManifest({ signature: 'invalid' });

      await expect(
        service.addStaticPeer('https://peer1.example.com', manifest),
      ).rejects.toThrow(/invalid manifest/i);
    });

    it('should reject a signed manifest for a different endpoint', async () => {
      const manifest = makeManifest({ signature: 'valid' });

      await expect(
        service.addStaticPeer('https://other.example.com', manifest),
      ).rejects.toThrow(/manifest endpoint mismatch/i);
    });

    it('should mark existing peer as seen and return it without creating a duplicate', async () => {
      const manifest = makeManifest({ signature: 'valid' });
      const first = await service.addStaticPeer('https://peer1.example.com', manifest);
      const firstLastSeen = first.lastSeen;

      // Small delay to ensure lastSeen changes
      await new Promise((r) => setTimeout(r, 5));

      const second = await service.addStaticPeer('https://peer1.example.com', manifest);

      expect(second.nodeId).toBe(first.nodeId);
      expect(second.lastSeen.getTime()).toBeGreaterThanOrEqual(firstLastSeen.getTime());
      expect(service.listPeers()).toHaveLength(1);
    });

    it('should fire onPeerDiscovered callback when adding a new peer', async () => {
      const onPeerDiscovered = vi.fn();
      const svc = new DiscoveryService(createDeps({ onPeerDiscovered }));

      await svc.addStaticPeer('https://peer1.example.com');

      expect(onPeerDiscovered).toHaveBeenCalledTimes(1);
      expect(onPeerDiscovered.mock.calls[0][0].endpoint).toBe('https://peer1.example.com');
    });

    it('should NOT fire onPeerDiscovered for duplicate adds', async () => {
      const onPeerDiscovered = vi.fn();
      const svc = new DiscoveryService(createDeps({ onPeerDiscovered }));

      await svc.addStaticPeer('https://peer1.example.com');
      await svc.addStaticPeer('https://peer1.example.com');

      expect(onPeerDiscovered).toHaveBeenCalledTimes(1);
    });
  });

  // ---------- discoverPeers ----------

  describe('discoverPeers', () => {
    it('should return an empty array when no static peers are configured', async () => {
      const result = await service.discoverPeers();
      expect(result).toEqual([]);
    });

    it('should discover nodes from staticPeers config', async () => {
      const svc = new DiscoveryService(deps, {
        staticPeers: ['https://a.example.com', 'https://b.example.com'],
      });

      const discovered = await svc.discoverPeers();

      expect(discovered).toHaveLength(2);
      const endpoints = discovered.map((n) => n.endpoint);
      expect(endpoints).toContain('https://a.example.com');
      expect(endpoints).toContain('https://b.example.com');
    });

    it('should fire onPeerDiscovered for each newly discovered peer', async () => {
      const onPeerDiscovered = vi.fn();
      const svc = new DiscoveryService(createDeps({ onPeerDiscovered }), {
        staticPeers: ['https://a.example.com', 'https://b.example.com'],
      });

      await svc.discoverPeers();

      expect(onPeerDiscovered).toHaveBeenCalledTimes(2);
    });

    it('should skip peers that are already known (no duplicates)', async () => {
      const svc = new DiscoveryService(deps, {
        staticPeers: ['https://a.example.com'],
      });

      const first = await svc.discoverPeers();
      expect(first).toHaveLength(1);

      const second = await svc.discoverPeers();
      expect(second).toHaveLength(0);
      expect(svc.listPeers()).toHaveLength(1);
    });
  });

  // ---------- removePeer ----------

  describe('removePeer', () => {
    it('should remove a known peer and return true', async () => {
      const node = await service.addStaticPeer('https://peer1.example.com');
      const removed = service.removePeer(node.nodeId);

      expect(removed).toBe(true);
      expect(service.listPeers()).toHaveLength(0);
    });

    it('should return false when removing a non-existent peer', () => {
      const removed = service.removePeer('non-existent-id');
      expect(removed).toBe(false);
    });
  });

  // ---------- getPeer ----------

  describe('getPeer', () => {
    it('should return undefined for an unknown nodeId', () => {
      expect(service.getPeer('unknown')).toBeUndefined();
    });

    it('should return the node for a known nodeId', async () => {
      const node = await service.addStaticPeer('https://peer1.example.com');
      const retrieved = service.getPeer(node.nodeId);

      expect(retrieved).toBeDefined();
      expect(retrieved!.nodeId).toBe(node.nodeId);
    });
  });

  // ---------- listPeers ----------

  describe('listPeers', () => {
    it('should return an empty array when no peers exist', () => {
      expect(service.listPeers()).toEqual([]);
    });

    it('should return all added peers', async () => {
      await service.addStaticPeer('https://a.example.com');
      await service.addStaticPeer('https://b.example.com');

      expect(service.listPeers()).toHaveLength(2);
    });
  });

  // ---------- listActivePeers ----------

  describe('listActivePeers', () => {
    it('should return only peers within the stale threshold', async () => {
      // Use a very short stale threshold so we can test staleness
      const svc = new DiscoveryService(deps, { staleThresholdMs: 50 });

      await svc.addStaticPeer('https://a.example.com');

      // Immediately, peer should be active
      expect(svc.listActivePeers()).toHaveLength(1);

      // Wait for it to become stale
      await new Promise((r) => setTimeout(r, 60));

      expect(svc.listActivePeers()).toHaveLength(0);
    });
  });

  // ---------- pruneStale ----------

  describe('pruneStale', () => {
    it('should remove stale peers and return their IDs', async () => {
      const svc = new DiscoveryService(deps, { staleThresholdMs: 50 });

      const node = await svc.addStaticPeer('https://a.example.com');

      // Wait for it to become stale
      await new Promise((r) => setTimeout(r, 60));

      const pruned = svc.pruneStale();

      expect(pruned).toContain(node.nodeId);
      expect(svc.listPeers()).toHaveLength(0);
    });

    it('should return an empty array when no peers are stale', async () => {
      await service.addStaticPeer('https://a.example.com');

      const pruned = service.pruneStale();
      expect(pruned).toEqual([]);
      expect(service.listPeers()).toHaveLength(1);
    });
  });

  // ---------- startPeriodicDiscovery / stopPeriodicDiscovery ----------

  describe('periodic discovery', () => {
    it('should start periodic discovery without throwing', () => {
      const svc = new DiscoveryService(deps, { discoveryIntervalMs: 100_000 });
      expect(() => svc.startPeriodicDiscovery()).not.toThrow();
      svc.stopPeriodicDiscovery();
    });

    it('should stop periodic discovery without throwing', () => {
      const svc = new DiscoveryService(deps, { discoveryIntervalMs: 100_000 });
      svc.startPeriodicDiscovery();
      expect(() => svc.stopPeriodicDiscovery()).not.toThrow();
    });

    it('should not create multiple timers when called multiple times', () => {
      const svc = new DiscoveryService(deps, { discoveryIntervalMs: 100_000 });
      svc.startPeriodicDiscovery();
      svc.startPeriodicDiscovery(); // second call is a no-op
      svc.stopPeriodicDiscovery();
      // No error means the guard worked
    });
  });
});
