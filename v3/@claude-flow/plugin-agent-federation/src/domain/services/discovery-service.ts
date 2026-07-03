import { FederationNode, type FederationNodeProps } from '../entities/federation-node.js';
import { TrustLevel } from '../entities/trust-level.js';
import type { WgManifestSection } from '../value-objects/wg-config.js';

export type DiscoveryMechanism = 'static' | 'dns-sd' | 'ipfs-registry' | 'a2a-card';

export interface FederationManifest {
  readonly nodeId: string;
  readonly publicKey: string;
  readonly endpoint: string;
  readonly capabilities: {
    readonly agentTypes: readonly string[];
    readonly maxConcurrentSessions: number;
    readonly supportedProtocols: readonly string[];
    readonly complianceModes: readonly string[];
  };
  readonly version: string;
  readonly signature: string;
  readonly timestamp: string;
  /**
   * ADR-111 — optional WG mesh identity. Present only when the publishing
   * node has opted into the in-tree WG layer (`config.wgMesh: true`).
   * The Ed25519 manifest signature covers this block too — peers verifying
   * the manifest also verify the WG-key binding.
   */
  readonly wg?: WgManifestSection;
}

export interface DiscoveryServiceDeps {
  signManifest: (manifest: Omit<FederationManifest, 'signature'>) => Promise<string>;
  verifyManifest: (manifest: FederationManifest) => Promise<boolean>;
  onPeerDiscovered?: (node: FederationNode) => void;
}

export interface DiscoveryConfig {
  readonly staticPeers: readonly string[];
  readonly enableDnsSd: boolean;
  readonly enableIpfsRegistry: boolean;
  readonly ipfsRegistryCid?: string;
  readonly discoveryIntervalMs: number;
  readonly staleThresholdMs: number;
}

const DEFAULT_DISCOVERY_CONFIG: DiscoveryConfig = {
  staticPeers: [],
  enableDnsSd: false,
  enableIpfsRegistry: false,
  discoveryIntervalMs: 60_000,
  staleThresholdMs: 300_000,
};

export class DiscoveryService {
  private readonly deps: DiscoveryServiceDeps;
  private readonly config: DiscoveryConfig;
  private readonly knownPeers: Map<string, FederationNode>;
  private localManifest: FederationManifest | null;
  private discoveryTimer: ReturnType<typeof setInterval> | null;

  constructor(deps: DiscoveryServiceDeps, config?: Partial<DiscoveryConfig>) {
    this.deps = deps;
    this.config = { ...DEFAULT_DISCOVERY_CONFIG, ...config };
    this.knownPeers = new Map();
    this.localManifest = null;
    this.discoveryTimer = null;
  }

  async publishManifest(manifest: Omit<FederationManifest, 'signature'>): Promise<FederationManifest> {
    const signature = await this.deps.signManifest(manifest);
    this.localManifest = { ...manifest, signature };
    return this.localManifest;
  }

  getLocalManifest(): FederationManifest | null {
    return this.localManifest;
  }

  async discoverPeers(): Promise<FederationNode[]> {
    const discovered: FederationNode[] = [];

    for (const endpoint of this.config.staticPeers) {
      const existing = this.findByEndpoint(endpoint);
      if (!existing) {
        const node = FederationNode.create({
          nodeId: `static-${this.hashEndpoint(endpoint)}`,
          publicKey: '',
          endpoint,
          capabilities: {
            agentTypes: [],
            maxConcurrentSessions: 1,
            supportedProtocols: ['websocket', 'http'],
            complianceModes: [],
          },
          metadata: { discoveryMechanism: 'static' },
        });
        this.knownPeers.set(node.nodeId, node);
        discovered.push(node);
        this.deps.onPeerDiscovered?.(node);
      }
    }

    return discovered;
  }

  async addStaticPeer(endpoint: string, manifest?: FederationManifest): Promise<FederationNode> {
    if (manifest) {
      const valid = await this.deps.verifyManifest(manifest);
      if (!valid) {
        throw new Error(`Invalid manifest signature for endpoint: ${endpoint}`);
      }
    }

    const nodeId = manifest?.nodeId ?? `static-${this.hashEndpoint(endpoint)}`;
    const existing = this.knownPeers.get(nodeId);
    if (existing) {
      existing.markSeen();
      return existing;
    }

    const node = FederationNode.create({
      nodeId,
      publicKey: manifest?.publicKey ?? '',
      endpoint,
      capabilities: manifest?.capabilities ?? {
        agentTypes: [],
        maxConcurrentSessions: 1,
        supportedProtocols: ['websocket', 'http'],
        complianceModes: [],
      },
      trustLevel: manifest ? TrustLevel.VERIFIED : TrustLevel.UNTRUSTED,
      metadata: {
        discoveryMechanism: 'static' as DiscoveryMechanism,
        version: manifest?.version,
      },
    });

    this.knownPeers.set(nodeId, node);
    this.deps.onPeerDiscovered?.(node);
    return node;
  }

  /**
   * Register an externally-discovered peer (e.g. mapped from an A2A Agent
   * Card via `fromAgentCard`). Unlike `addStaticPeer` this takes a fully
   * constructed node — the caller owns validation of the external format —
   * and the node keeps whatever trust level it was constructed with
   * (A2A-card peers arrive UNTRUSTED). Existing peers are refreshed, not
   * replaced, so accumulated trust state survives re-discovery.
   */
  registerExternalPeer(node: FederationNode): FederationNode {
    const existing = this.knownPeers.get(node.nodeId);
    if (existing) {
      existing.markSeen();
      return existing;
    }
    this.knownPeers.set(node.nodeId, node);
    this.deps.onPeerDiscovered?.(node);
    return node;
  }

  removePeer(nodeId: string): boolean {
    return this.knownPeers.delete(nodeId);
  }

  getPeer(nodeId: string): FederationNode | undefined {
    return this.knownPeers.get(nodeId);
  }

  listPeers(): FederationNode[] {
    return Array.from(this.knownPeers.values());
  }

  listActivePeers(): FederationNode[] {
    return this.listPeers().filter(p => !p.isStale(this.config.staleThresholdMs));
  }

  pruneStale(): string[] {
    const pruned: string[] = [];
    for (const [nodeId, node] of this.knownPeers) {
      if (node.isStale(this.config.staleThresholdMs)) {
        this.knownPeers.delete(nodeId);
        pruned.push(nodeId);
      }
    }
    return pruned;
  }

  startPeriodicDiscovery(): void {
    if (this.discoveryTimer) return;
    this.discoveryTimer = setInterval(() => {
      this.discoverPeers().catch(() => {});
    }, this.config.discoveryIntervalMs);
  }

  stopPeriodicDiscovery(): void {
    if (this.discoveryTimer) {
      clearInterval(this.discoveryTimer);
      this.discoveryTimer = null;
    }
  }

  private findByEndpoint(endpoint: string): FederationNode | undefined {
    for (const node of this.knownPeers.values()) {
      if (node.endpoint === endpoint) return node;
    }
    return undefined;
  }

  private hashEndpoint(endpoint: string): string {
    let hash = 0;
    for (let i = 0; i < endpoint.length; i++) {
      const char = endpoint.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return Math.abs(hash).toString(36);
  }
}
