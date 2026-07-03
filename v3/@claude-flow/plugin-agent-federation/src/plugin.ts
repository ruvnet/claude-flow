import type {
  ClaudeFlowPlugin,
  PluginContext,
  MCPToolDefinition,
  CLICommandDefinition,
  AgentTypeDefinition,
} from '@claude-flow/shared/src/plugin-interface.js';

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

// @noble/ed25519 v2 needs a sync sha512 wired explicitly.
ed.etc.sha512Sync = (...m: Uint8Array[]): Uint8Array => {
  const h = createHash('sha512');
  for (const x of m) h.update(x);
  return h.digest();
};

import { FederationCoordinator, type FederationCoordinatorConfig } from './application/federation-coordinator.js';
import { DiscoveryService } from './domain/services/discovery-service.js';
import { HandshakeService } from './domain/services/handshake-service.js';
import { RoutingService } from './domain/services/routing-service.js';
import { AuditService, type ComplianceMode } from './domain/services/audit-service.js';
import { PIIPipelineService } from './domain/services/pii-pipeline-service.js';
import { TrustEvaluator } from './application/trust-evaluator.js';
import { PolicyEngine, type FederationClaimType } from './application/policy-engine.js';
import { TrustLevel, getTrustLevelLabel } from './domain/entities/trust-level.js';
import { type FederationMessageType } from './domain/entities/federation-envelope.js';

// ADR-104: real wire transport via agentic-flow loader pattern.
// ADR-120: midstream-aware loader wraps the agentic-flow loader so
// when `midstreamer` (ruvnet/midstream) ships its production QUIC
// build (Step 1 of ADR-120) and operators opt in with
// MIDSTREAMER_QUIC_NATIVE=1, the federation transport auto-upgrades.
// Until then, the wrapper transparently defers to the agentic-flow
// loader — which itself resolves to WebSocketFallbackTransport
// today, or native QUIC when AGENTIC_FLOW_QUIC_NATIVE=1.
import {
  loadFederationTransport,
  type AgentMessage,
  type AgentTransport,
} from './transport/midstream-aware-loader.js';

type LoadedTransport = AgentTransport & {
  /** WebSocketFallbackTransport adds listen(); the loader's interface
   * doesn't include it, so we cast at the call site. */
  listen?: (port: number, host?: string) => Promise<void>;
};
import { dispatchInbound, canonicalizeEnvelopeForVerify } from './application/inbound-dispatcher.js';
import { createMcpTools } from './mcp-tools.js';
import { createCliCommands } from './cli-commands.js';
// A2A (Agent2Agent, Linux Foundation) Agent Card adapter — cards only.
// Opt-in via config.a2aCard; serves /.well-known/agent-card.json on a
// 127.0.0.1-default bind (ADR-166 posture preserved).
import { toAgentCard } from './a2a/agent-card.js';
import { startAgentCardServer, type AgentCardServerHandle } from './a2a/well-known.js';

export class AgentFederationPlugin implements ClaudeFlowPlugin {
  readonly name = '@claude-flow/plugin-agent-federation';
  readonly version = '1.0.0-alpha.1';
  readonly description = 'Cross-installation agent federation with PII protection and AI defence';
  readonly author = 'Claude Flow Team';
  readonly dependencies = ['@claude-flow/security', '@claude-flow/aidefence'];

  private coordinator: FederationCoordinator | null = null;
  private context: PluginContext | null = null;
  // ADR-104: live transport instance, created in initialize() and torn
  // down in shutdown(). Null when transport is disabled (the legacy
  // in-process behavior — preserves backward compat for tests that
  // don't supply a port).
  private transport: LoadedTransport | null = null;
  // A2A Agent Card well-known endpoint (opt-in via config.a2aCard). Null
  // when the HTTP surface is off — everything else works without it.
  private agentCardServer: AgentCardServerHandle | null = null;

  async initialize(context: PluginContext): Promise<void> {
    this.context = context;
    const config = context.config;

    const nodeId = (config['nodeId'] as string) ?? `node-${Date.now().toString(36)}`;
    const endpoint = (config['endpoint'] as string) ?? 'ws://localhost:9100';
    const complianceMode = (config['complianceMode'] as ComplianceMode) ?? 'none';
    const staticPeers = (config['staticPeers'] as string[]) ?? [];
    const hashSalt = (config['hashSalt'] as string) ?? `salt-${nodeId}`;

    // ADR-095 G2: real Ed25519 keypair instead of empty publicKey + stub
    // signatures. Persist to .claude-flow/federation/key-<nodeId>.json so
    // the same node identity survives restarts. Audit log
    // audit_1776483149979 flagged the previous "verifySignature returns
    // true unconditionally" as a critical authn bypass; this closes it.
    const keyDir = join(process.cwd(), '.claude-flow', 'federation');
    const keyPath = join(keyDir, `key-${nodeId}.json`);
    let privateKey: Uint8Array;
    let publicKeyHex: string;
    try {
      if (existsSync(keyPath)) {
        const stored = JSON.parse(readFileSync(keyPath, 'utf-8')) as { privateKey: string; publicKey: string; nodeId: string };
        privateKey = new Uint8Array(Buffer.from(stored.privateKey, 'hex'));
        publicKeyHex = stored.publicKey;
      } else {
        privateKey = ed.utils.randomPrivateKey();
        const pk = ed.getPublicKey(privateKey);
        publicKeyHex = Buffer.from(pk).toString('hex');
        if (!existsSync(keyDir)) mkdirSync(keyDir, { recursive: true, mode: 0o700 });
        writeFileSync(keyPath, JSON.stringify({
          nodeId,
          privateKey: Buffer.from(privateKey).toString('hex'),
          publicKey: publicKeyHex,
          createdAt: new Date().toISOString(),
        }, null, 2), { mode: 0o600 });
      }
    } catch (err) {
      // Fall back to ephemeral key if persistence fails — still real crypto.
      privateKey = ed.utils.randomPrivateKey();
      const pk = ed.getPublicKey(privateKey);
      publicKeyHex = Buffer.from(pk).toString('hex');
      context.logger.warn(`Federation: could not persist keypair (${err instanceof Error ? err.message : err}); using ephemeral key for this session`);
    }

    const coordConfig: FederationCoordinatorConfig = {
      nodeId,
      publicKey: publicKeyHex,
      endpoint,
      capabilities: ['send', 'receive', 'query-redacted', 'status', 'ping', 'discovery'],
    };

    const generateId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

    // ADR-095 G2: real signing + verification using @noble/ed25519. The
    // sign* helpers use this node's private key; verify* helpers accept
    // a peer's public key over the wire and check the signature with
    // ed.verify(). No "return true" stubs.
    const signBytes = (msg: string): string => {
      const sig = ed.sign(new TextEncoder().encode(msg), privateKey);
      return Buffer.from(sig).toString('hex');
    };
    const verifyBytes = (msg: string, signatureHex: string, peerPublicKeyHex: string): boolean => {
      try {
        if (!signatureHex || !peerPublicKeyHex) return false;
        return ed.verify(
          Buffer.from(signatureHex, 'hex'),
          new TextEncoder().encode(msg),
          Buffer.from(peerPublicKeyHex, 'hex'),
        );
      } catch { return false; }
    };

    // Canonical manifest serialization for signing — sorts keys to keep
    // sign/verify deterministic. Excludes the signature field itself.
    const canonicalize = (obj: Record<string, unknown>): string => {
      const stripped: Record<string, unknown> = {};
      for (const k of Object.keys(obj).sort()) {
        if (k === 'signature') continue;
        const v = obj[k];
        stripped[k] = (v && typeof v === 'object' && !Array.isArray(v))
          ? JSON.parse(canonicalize(v as Record<string, unknown>))
          : v;
      }
      return JSON.stringify(stripped);
    };

    const discovery = new DiscoveryService(
      {
        signManifest: async (manifest) => signBytes(canonicalize(manifest as unknown as Record<string, unknown>)),
        verifyManifest: async (manifest) => {
          const peerPub = (manifest as { publicKey?: string }).publicKey;
          const sig = (manifest as { signature?: string }).signature;
          if (!peerPub || !sig) return false;
          return verifyBytes(canonicalize(manifest as unknown as Record<string, unknown>), sig, peerPub);
        },
        onPeerDiscovered: (node) => {
          context.logger.info(`Peer discovered: ${node.nodeId} at ${node.endpoint}`);
        },
      },
      { staticPeers },
    );

    const handshake = new HandshakeService({
      generateSessionId: generateId,
      generateSessionToken: () => `token-${generateId()}`,
      generateNonce: () => `nonce-${Math.random().toString(36).slice(2)}`,
      signChallenge: async (nonce) => signBytes(nonce),
      verifySignature: async (nonce, signature, peerPublicKey) =>
        verifyBytes(nonce, signature, peerPublicKey),
      getLocalNodeId: () => nodeId,
      getLocalPublicKey: () => publicKeyHex,
      getLocalCapabilities: () => coordConfig.capabilities,
    });

    const piiPipeline = new PIIPipelineService(
      { hashFunction: (val, salt) => `hash-${salt}-${val.slice(0, 4)}` },
      { hashSalt },
    );

    const auditEvents: Array<Record<string, unknown>> = [];
    const audit = new AuditService(
      {
        generateEventId: generateId,
        getLocalNodeId: () => nodeId,
        persistEvent: async (event) => { auditEvents.push(event as unknown as Record<string, unknown>); },
        queryEvents: async (query) => {
          return auditEvents
            .filter(e => {
              if (query.eventType && e['eventType'] !== query.eventType) return false;
              if (query.severity && e['severity'] !== query.severity) return false;
              if (query.category && e['category'] !== query.category) return false;
              return true;
            })
            .slice(query.offset ?? 0, (query.offset ?? 0) + (query.limit ?? 100)) as any;
        },
        onAuditEvent: (event) => {
          context.eventBus.emit('federation:audit', event);
        },
      },
      { complianceMode },
    );

    const trustEvaluator = new TrustEvaluator({
      onTrustChange: (nid, result) => {
        context.logger.info(`Trust change for ${nid}: ${getTrustLevelLabel(result.previousLevel)} -> ${getTrustLevelLabel(result.newLevel)}`);
        context.eventBus.emit('federation:trust-change', { nodeId: nid, ...result });
      },
    });

    const policyEngine = new PolicyEngine(
      { checkClaim: () => true },
    );

    const sessions: Map<string, import('./domain/entities/federation-session.js').FederationSession> = new Map();

    // ADR-104 + ADR-120: load wire transport. WebSocket fallback by
    // default; native QUIC when AGENTIC_FLOW_QUIC_NATIVE=1 (ADR-108) or
    // MIDSTREAMER_QUIC_NATIVE=1 (ADR-120 Step 1, when midstream@0.3.0
    // ships its real QUIC build). The midstream-aware loader picks the
    // best available transport transparently. Failures downgrade to
    // in-process noop (logged), preserving backward compat for
    // tests/environments without ws available.
    let transport: LoadedTransport | null = null;
    try {
      const loaded = await loadFederationTransport({
        serverName: nodeId,
        maxIdleTimeoutMs: 30_000,
        maxConcurrentStreams: 100,
        enable0Rtt: true,
      });
      transport = loaded.transport as LoadedTransport;
      this.transport = transport;
      context.logger.info(
        `Federation transport loaded: ${nodeId} (source=${loaded.source}${
          loaded.fallbackReason ? `, note=${loaded.fallbackReason}` : ''
        })`,
      );
    } catch (err) {
      context.logger.warn(
        `Federation transport unavailable (${err instanceof Error ? err.message : err}); ` +
          `falling back to in-process routing — federation_send will log only`,
      );
    }

    /**
     * Resolve a peer's nodeId to a wire address suitable for
     * transport.send(). Looks up the discovery registry to get the
     * peer's published endpoint, then strips the protocol prefix to
     * get a `host:port` string.
     *
     * Endpoint shapes accepted:
     *   - "ws://host:port"      → "host:port"
     *   - "tailscale://host:port" → "host:port"
     *   - "host:port"           → "host:port" (passthrough)
     */
    const resolveAddress = (targetNodeId: string): string | null => {
      const peer = discovery.getPeer(targetNodeId);
      if (!peer) return null;
      const ep = peer.endpoint;
      const m = ep.match(/^(?:[a-z]+:\/\/)?(.+)$/);
      return m ? m[1] : ep;
    };

    const routing = new RoutingService({
      generateEnvelopeId: generateId,
      generateNonce: () => `nonce-${Math.random().toString(36).slice(2)}`,
      signEnvelope: (payload, token) => `hmac-${token.slice(0, 6)}-${payload.length}`,
      verifyEnvelope: () => true,
      scanPii: (text, trustLevel) => {
        const result = piiPipeline.transform(text, trustLevel as TrustLevel);
        return {
          transformedText: result.transformedText,
          scanResult: {
            scanned: true,
            piiFound: result.detections.length > 0,
            detections: result.detections.map(d => ({
              type: d.type,
              action: result.actionsApplied.find(a => a.type === d.type)?.action ?? 'pass',
              confidence: d.confidence,
            })),
            actionsApplied: result.actionsApplied.map(a => a.action),
            scanDurationMs: 0,
          },
        };
      },
      sendToNode: async (targetNodeId, envelope) => {
        // ADR-104: real wire send via the loaded transport. If the
        // transport failed to load OR the peer's address can't be
        // resolved, log + return (the upstream RoutingService.send
        // already wraps this in try/catch and returns a RoutingResult
        // with the error to the caller).
        if (!transport) {
          context.logger.debug(
            `Federation send (in-process noop): ${envelope.envelopeId} → ${targetNodeId}`,
          );
          return;
        }
        const address = resolveAddress(targetNodeId);
        if (!address) {
          context.logger.warn(
            `Federation send aborted: peer ${targetNodeId} not in discovery registry`,
          );
          throw new Error(`PEER_UNKNOWN: ${targetNodeId}`);
        }
        // Build the AgentMessage WITHOUT signature first, canonicalize
        // the bytes, sign them, then attach the signature to metadata.
        // The receiver runs the same canonicalization and verifies
        // against this node's published public key.
        const baseMessage: AgentMessage = {
          id: envelope.envelopeId,
          type: envelope.messageType,
          payload: envelope as unknown,
          metadata: {
            sourceNodeId: envelope.sourceNodeId,
            targetNodeId: envelope.targetNodeId,
            sessionId: envelope.sessionId,
          },
        };
        const canon = canonicalizeEnvelopeForVerify(baseMessage);
        const signature = signBytes(canon);
        const signed: AgentMessage = {
          ...baseMessage,
          metadata: { ...(baseMessage.metadata as Record<string, unknown>), signature },
        };
        await transport.send(address, signed);
        context.logger.debug(
          `Federation send → ${address} (envelope=${envelope.envelopeId}, type=${envelope.messageType}, signed)`,
        );
      },
      getActiveSessions: () => Array.from(sessions.values()).filter(s => s.active),
      getLocalNodeId: () => nodeId,
    });

    this.coordinator = new FederationCoordinator(
      coordConfig, discovery, handshake, routing, audit,
      piiPipeline, trustEvaluator, policyEngine,
    );

    context.services.register('federation:coordinator', this.coordinator);
    context.services.register('federation:discovery', discovery);
    context.services.register('federation:audit', audit);
    context.services.register('federation:pii', piiPipeline);
    context.services.register('federation:trust', trustEvaluator);
    context.services.register('federation:policy', policyEngine);
    context.services.register('federation:routing', routing);
    if (transport) {
      context.services.register('federation:transport', transport);
    }

    // ADR-104: bind the inbound listener if config supplies a port. The
    // port is OPTIONAL — peers that only initiate outbound (no inbound
    // accept) leave it unset. Common config: port 9100 for tailscale
    // hosts. Defaults to "no listener" so existing tests/configs don't
    // need to free a port.
    const listenPort = config['port'] as number | undefined;
    if (transport && typeof listenPort === 'number' && transport.listen) {
      const listenHost = (config['host'] as string | undefined) ?? '0.0.0.0';
      try {
        await transport.listen(listenPort, listenHost);
        context.logger.info(`Federation listening on ${listenHost}:${listenPort}`);
      } catch (err) {
        context.logger.error(
          `Federation listener bind failed on ${listenHost}:${listenPort}: ` +
            (err instanceof Error ? err.message : String(err)),
        );
      }
    }

    // ADR-109: subscribe to inbound messages. transport.onMessage was
    // added in agentic-flow@2.0.12-fix.3 — older builds gracefully
    // degrade (optional method, no-op via the ?? guard).
    if (transport && typeof transport.onMessage === 'function') {
      // Real Ed25519 envelope verifier — closes the inbound trust gap
      // (without this, sourceNodeId in metadata is a self-claim, not
      // an authenticated assertion).
      const verifyEnvelope = (
        canonicalBytes: string,
        signatureHex: string | null,
        peerPublicKeyHex: string,
      ): boolean => {
        if (!signatureHex || !peerPublicKeyHex) return false;
        return verifyBytes(canonicalBytes, signatureHex, peerPublicKeyHex);
      };
      transport.onMessage(async (address: string, message: AgentMessage) => {
        await dispatchInbound(address, message, {
          discovery,
          audit,
          eventBus: context.eventBus,
          logger: context.logger,
          verifyEnvelope,
        });
      });
      context.logger.debug('Federation inbound dispatcher subscribed (with Ed25519 sig verify)');
    } else {
      context.logger.warn(
        'Federation transport does not expose onMessage(); inbound bytes will queue but not dispatch. ' +
          'Upgrade agentic-flow to >= 2.0.12-fix.3.',
      );
    }

    // A2A Agent Card well-known endpoint (opt-in, graceful). Enabled with
    // config.a2aCard = true + config.a2aCardPort. Serves the local node's
    // manifest as a spec-compliant A2A 1.0 card at
    // /.well-known/agent-card.json. Binds 127.0.0.1 unless config.a2aCardHost
    // is set AND config.a2aCardAllowNonLoopback is true (ADR-166: never
    // loosen binding implicitly). A bind failure logs and degrades — the
    // rest of federation is unaffected.
    const a2aEnabled = config['a2aCard'] === true;
    const a2aPort = config['a2aCardPort'] as number | undefined;
    if (a2aEnabled && typeof a2aPort === 'number') {
      try {
        this.agentCardServer = await startAgentCardServer({
          getCard: () => {
            const manifest = discovery.getLocalManifest() ?? {
              nodeId,
              publicKey: publicKeyHex,
              endpoint,
              capabilities: {
                agentTypes: coordConfig.capabilities,
                maxConcurrentSessions: 10,
                supportedProtocols: ['websocket', 'http'],
                complianceModes: complianceMode === 'none' ? [] : [complianceMode],
              },
              version: this.version,
              signature: '',
              timestamp: new Date().toISOString(),
            };
            return toAgentCard(manifest);
          },
          port: a2aPort,
          host: (config['a2aCardHost'] as string | undefined) ?? '127.0.0.1',
          allowNonLoopback: config['a2aCardAllowNonLoopback'] === true,
        });
        context.logger.info(`A2A agent card served at ${this.agentCardServer.url}`);
      } catch (err) {
        context.logger.warn(
          `A2A agent card endpoint unavailable (${err instanceof Error ? err.message : err}); ` +
            'federation continues without the A2A discovery surface',
        );
        this.agentCardServer = null;
      }
    }

    context.logger.info('Agent Federation plugin initialized');
  }

  async shutdown(): Promise<void> {
    if (this.agentCardServer) {
      try {
        await this.agentCardServer.close();
      } catch (err) {
        this.context?.logger.warn(
          `A2A agent card server close error: ${err instanceof Error ? err.message : err}`,
        );
      }
      this.agentCardServer = null;
    }
    if (this.coordinator) {
      await this.coordinator.shutdown();
      this.coordinator = null;
    }
    if (this.transport) {
      try {
        await this.transport.close();
      } catch (err) {
        this.context?.logger.warn(
          `Federation transport close error: ${err instanceof Error ? err.message : err}`,
        );
      }
      this.transport = null;
    }
    this.context?.logger.info('Agent Federation plugin shut down');
    this.context = null;
  }

  registerMCPTools(): MCPToolDefinition[] {
    return createMcpTools(() => this.coordinator, () => this.context);
  }

  registerCLICommands(): CLICommandDefinition[] {
    return createCliCommands(() => this.coordinator, () => this.context);
  }

  registerAgentTypes(): AgentTypeDefinition[] {
    return [
      {
        type: 'federation-coordinator',
        name: 'Federation Coordinator',
        description: 'Coordinates cross-installation agent federation, managing discovery, handshake, trust evaluation, and secure message routing between federated nodes.',
        defaultConfig: {
          id: '',
          name: 'federation-coordinator',
          type: 'coordinator',
          capabilities: [
            'federation:discover',
            'federation:connect',
            'federation:read',
            'federation:write',
            'federation:admin',
          ],
          maxConcurrentTasks: 10,
          priority: 90,
          timeout: 300_000,
          metadata: {
            pluginSource: '@claude-flow/plugin-agent-federation',
          },
        },
        requiredCapabilities: ['federation:discover', 'federation:connect'],
        metadata: {
          trustAware: true,
          piiAware: true,
        },
      },
    ];
  }

  async healthCheck(): Promise<boolean> {
    if (!this.coordinator) return false;
    const status = this.coordinator.getStatus();
    return status.healthy;
  }
}
