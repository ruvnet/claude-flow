import type { MCPToolDefinition } from '@claude-flow/shared/src/plugin-interface.js';
import type { PluginContext } from '@claude-flow/shared/src/plugin-interface.js';
import type { FederationCoordinator } from './application/federation-coordinator.js';
import type { FederationMessageType } from './domain/entities/federation-envelope.js';
import type { FederationManifest } from './domain/services/discovery-service.js';
import type { WgMeshService } from './domain/services/wg-mesh-service.js';
import { generateWgKeyPair } from './domain/value-objects/wg-config.js';
import { JCS_SIGNATURE_PROTOCOL } from './application/inbound-dispatcher.js';
import { FEDERATION_PLUGIN_VERSION } from './version.js';

type CoordinatorGetter = () => FederationCoordinator | null;
type ContextGetter = () => PluginContext | null;
type WgMeshGetter = () => WgMeshService | null;

function textResult(text: string, isError = false) {
  return { content: [{ type: 'text' as const, text }], isError };
}

export function createMcpTools(
  getCoordinator: CoordinatorGetter,
  getContext: ContextGetter,
  getWgMesh: WgMeshGetter = () => null,
): MCPToolDefinition[] {
  function requireCoordinator(): FederationCoordinator {
    const c = getCoordinator();
    if (!c) throw new Error('Federation not initialized');
    return c;
  }
  function requireWgMesh(): WgMeshService {
    const w = getWgMesh();
    if (!w) throw new Error('WG mesh layer not initialized (set config.wgMesh = true and inject WgMeshService)');
    return w;
  }

  return [
    {
      name: 'federation_init',
      description: 'Initialize federation on this node with a manifest and begin discovery',
      pluginName: '@claude-flow/plugin-agent-federation',
      version: FEDERATION_PLUGIN_VERSION,
      inputSchema: {
        type: 'object',
        properties: {
          nodeId: { type: 'string', description: 'Unique node identifier' },
          endpoint: { type: 'string', description: 'WebSocket or HTTP endpoint for this node' },
          agentTypes: { type: 'array', description: 'Supported agent types', items: { type: 'string' } },
        },
        required: ['endpoint'],
      },
      handler: async (params) => {
        const coordinator = requireCoordinator();
        const nodeId = (params['nodeId'] as string) ?? `node-${Date.now().toString(36)}`;
        await coordinator.initialize({
          nodeId,
          publicKey: '',
          endpoint: params['endpoint'] as string,
          capabilities: {
            agentTypes: (params['agentTypes'] as string[]) ?? ['coder', 'reviewer'],
            maxConcurrentSessions: 10,
            supportedProtocols: ['websocket', 'http', JCS_SIGNATURE_PROTOCOL],
            complianceModes: [],
          },
          version: FEDERATION_PLUGIN_VERSION,
          timestamp: new Date().toISOString(),
        });
        return textResult(`Federation initialized for node ${nodeId}`);
      },
    },
    {
      name: 'federation_join',
      description: 'Join a federation endpoint. A signed manifest is required before consequential protocol capabilities are trusted.',
      pluginName: '@claude-flow/plugin-agent-federation',
      version: FEDERATION_PLUGIN_VERSION,
      inputSchema: {
        type: 'object',
        properties: {
          endpoint: { type: 'string', description: 'Remote peer endpoint to join' },
          manifest: {
            type: 'object',
            description: 'Optional signed peer manifest. Without it the session remains endpoint-only, untrusted, and legacy-low-risk.',
          },
        },
        required: ['endpoint'],
      },
      handler: async (params) => {
        const coordinator = requireCoordinator();
        const session = await coordinator.joinPeer(
          params['endpoint'] as string,
          params['manifest'] as FederationManifest | undefined,
        );
        return textResult(`Joined peer. Session: ${session.sessionId}, Trust: ${session.trustLevel}`);
      },
    },
    {
      name: 'federation_peers',
      description: 'List all known federation peers with their trust levels and status',
      pluginName: '@claude-flow/plugin-agent-federation',
      version: FEDERATION_PLUGIN_VERSION,
      inputSchema: {
        type: 'object',
        properties: {},
      },
      handler: async () => {
        const coordinator = requireCoordinator();
        const status = coordinator.getStatus();
        return textResult(JSON.stringify(status.trustLevels, null, 2));
      },
    },
    {
      name: 'federation_send',
      description: 'Send a message to a federated peer through the PII pipeline and security gates. Optional budget controls (ADR-097): maxHops defaults to 8 to prevent recursive delegation; maxTokens/maxUsd cap cumulative spend across the hop chain.',
      pluginName: '@claude-flow/plugin-agent-federation',
      version: FEDERATION_PLUGIN_VERSION,
      inputSchema: {
        type: 'object',
        properties: {
          targetNodeId: { type: 'string', description: 'Target node ID' },
          messageType: { type: 'string', description: 'Message type (task-assignment, memory-query, context-share, etc.)' },
          payload: { type: 'object', description: 'Message payload' },
          // ADR-097 Phase 1: optional budget envelope. Backward compatible —
          // omitting these preserves the legacy unbounded-tokens/USD path,
          // with maxHops still defaulting to 8 to defang recursion loops.
          budget: {
            type: 'object',
            description: 'Optional cumulative spend budget for this delegation chain',
            properties: {
              maxTokens: { type: 'number', description: 'Hard cap on Σ tokens across hops' },
              maxUsd: { type: 'number', description: 'Hard cap on Σ USD spent' },
            },
          },
          maxHops: {
            type: 'number',
            description: 'Maximum hops this message may travel (default 8, 0 disallows remote delegation)',
          },
          hopCount: {
            type: 'number',
            description: 'How many hops this message has already taken (0 on the originator)',
          },
          spent: {
            type: 'object',
            description: 'Caller-reported usage from previous legs (cumulative)',
            properties: {
              tokens: { type: 'number' },
              usd: { type: 'number' },
            },
          },
        },
        required: ['targetNodeId', 'messageType', 'payload'],
      },
      handler: async (params) => {
        const coordinator = requireCoordinator();
        const result = await coordinator.sendMessage(
          params['targetNodeId'] as string,
          params['messageType'] as FederationMessageType,
          params['payload'],
          {
            budget: params['budget'] as { maxTokens?: number; maxUsd?: number } | undefined,
            maxHops: params['maxHops'] as number | undefined,
            hopCount: params['hopCount'] as number | undefined,
            spent: params['spent'] as { tokens?: number; usd?: number } | undefined,
          },
        );
        return textResult(JSON.stringify(result, null, 2), !result.success);
      },
    },
    {
      name: 'federation_query',
      description: 'Query federated memory from a remote peer (PII-gated)',
      pluginName: '@claude-flow/plugin-agent-federation',
      version: FEDERATION_PLUGIN_VERSION,
      inputSchema: {
        type: 'object',
        properties: {
          targetNodeId: { type: 'string', description: 'Target node ID to query' },
          query: { type: 'string', description: 'Memory query string' },
          namespace: { type: 'string', description: 'Memory namespace to query' },
        },
        required: ['targetNodeId', 'query'],
      },
      handler: async (params) => {
        const coordinator = requireCoordinator();
        const result = await coordinator.sendMessage(
          params['targetNodeId'] as string,
          'memory-query',
          { query: params['query'], namespace: params['namespace'] ?? 'default' },
        );
        return textResult(JSON.stringify(result, null, 2), !result.success);
      },
    },
    {
      name: 'federation_status',
      description: 'Get federation health status including active sessions, peers, and trust levels',
      pluginName: '@claude-flow/plugin-agent-federation',
      version: FEDERATION_PLUGIN_VERSION,
      inputSchema: {
        type: 'object',
        properties: {},
      },
      handler: async () => {
        const coordinator = requireCoordinator();
        return textResult(JSON.stringify(coordinator.getStatus(), null, 2));
      },
    },
    {
      name: 'federation_trust',
      description: 'View or review trust score details for a specific node',
      pluginName: '@claude-flow/plugin-agent-federation',
      version: FEDERATION_PLUGIN_VERSION,
      inputSchema: {
        type: 'object',
        properties: {
          nodeId: { type: 'string', description: 'Node ID to inspect' },
        },
        required: ['nodeId'],
      },
      handler: async (params) => {
        const coordinator = requireCoordinator();
        const status = coordinator.getStatus();
        const nodeId = params['nodeId'] as string;
        const trustLevel = status.trustLevels[nodeId];
        if (trustLevel === undefined) {
          return textResult(`Node ${nodeId} not found`, true);
        }
        return textResult(JSON.stringify({ nodeId, trustLevel }, null, 2));
      },
    },
    {
      name: 'federation_audit',
      description: 'Query federation audit logs with optional compliance mode filtering',
      pluginName: '@claude-flow/plugin-agent-federation',
      version: FEDERATION_PLUGIN_VERSION,
      inputSchema: {
        type: 'object',
        properties: {
          eventType: { type: 'string', description: 'Filter by event type' },
          severity: { type: 'string', description: 'Filter by severity (info, warn, error, critical)' },
          since: { type: 'string', description: 'ISO 8601 date to filter events since' },
          limit: { type: 'number', description: 'Maximum number of results' },
        },
      },
      handler: async (params) => {
        const context = getContext();
        if (!context) return textResult('Plugin not initialized', true);
        const audit = context.services.get<import('./domain/services/audit-service.js').AuditService>('federation:audit');
        if (!audit) return textResult('Audit service not found', true);

        const events = await audit.query({
          eventType: params['eventType'] as any,
          severity: params['severity'] as any,
          since: params['since'] ? new Date(params['since'] as string) : undefined,
          limit: (params['limit'] as number) ?? 50,
        });
        return textResult(JSON.stringify(events, null, 2));
      },
    },
    {
      name: 'federation_breaker_status',
      description: 'ADR-097 Phase 4: per-peer circuit-breaker state snapshot. Returns each known peer with its lifecycle state (ACTIVE/SUSPENDED/EVICTED), when it changed, and why. Combine with federation_evict / federation_reactivate to operate the breaker manually.',
      pluginName: '@claude-flow/plugin-agent-federation',
      version: FEDERATION_PLUGIN_VERSION,
      inputSchema: {
        type: 'object',
        properties: {
          nodeId: { type: 'string', description: 'Optional: filter to a single peer' },
        },
      },
      handler: async (params) => {
        const coordinator = requireCoordinator();
        const states = coordinator.getPeerStates();
        const filter = params['nodeId'] as string | undefined;
        const filtered = filter ? states.filter((s) => s.nodeId === filter) : states;
        const counts = coordinator.getPeerStateCounts();
        return textResult(JSON.stringify({ counts, peers: filtered }, null, 2));
      },
    },
    {
      name: 'federation_evict',
      description: 'ADR-097 Phase 4: operator-initiated evict for a peer. Marks the peer EVICTED so subsequent federation_send calls short-circuit with PEER_EVICTED. Reversible only via federation_reactivate (operator override).',
      pluginName: '@claude-flow/plugin-agent-federation',
      version: FEDERATION_PLUGIN_VERSION,
      inputSchema: {
        type: 'object',
        properties: {
          nodeId: { type: 'string', description: 'Target peer to evict' },
          correlationId: { type: 'string', description: 'Optional audit-trail correlation key (operator ticket, etc.)' },
        },
        required: ['nodeId'],
      },
      handler: async (params) => {
        const coordinator = requireCoordinator();
        const ok = await coordinator.evictPeer(
          params['nodeId'] as string,
          'MANUAL_EVICT',
          params['correlationId'] as string | undefined,
        );
        const msg = ok
          ? `Evicted peer ${params['nodeId']}`
          : `No transition (peer unknown or already EVICTED): ${params['nodeId']}`;
        return textResult(msg, !ok);
      },
    },
    {
      name: 'federation_reactivate',
      description: 'ADR-097 Phase 4: operator-initiated reactivate for a SUSPENDED or EVICTED peer. Used after a health probe confirms recovery, or as an operator override on a manual evict. The breaker does NOT auto-reactivate; this MCP tool is the explicit lever.',
      pluginName: '@claude-flow/plugin-agent-federation',
      version: FEDERATION_PLUGIN_VERSION,
      inputSchema: {
        type: 'object',
        properties: {
          nodeId: { type: 'string', description: 'Target peer to reactivate' },
          correlationId: { type: 'string', description: 'Optional audit-trail correlation key (probe ID, ticket, etc.)' },
        },
        required: ['nodeId'],
      },
      handler: async (params) => {
        const coordinator = requireCoordinator();
        const ok = await coordinator.reactivatePeer(
          params['nodeId'] as string,
          params['correlationId'] as string | undefined,
        );
        const msg = ok
          ? `Reactivated peer ${params['nodeId']}`
          : `No transition (peer unknown or already ACTIVE): ${params['nodeId']}`;
        return textResult(msg, !ok);
      },
    },
    {
      name: 'federation_report_spend',
      description: 'ADR-097 Phase 3 upstream: report the actual cost of a completed federated call. Fans out to the cost-tracker bus (via the integrator-wired SpendReporter) and the breaker service (so its in-memory rolling buffer is fed). Both targets are optional; calling without either configured is a silent no-op.',
      pluginName: '@claude-flow/plugin-agent-federation',
      version: FEDERATION_PLUGIN_VERSION,
      inputSchema: {
        type: 'object',
        properties: {
          peerId: { type: 'string', description: 'Peer this cost was incurred against' },
          taskId: { type: 'string', description: 'Optional task correlation key' },
          tokensUsed: { type: 'number', description: 'Tokens consumed (input + output)' },
          usdSpent: { type: 'number', description: 'USD spent' },
          success: { type: 'boolean', description: 'Whether the underlying send succeeded (drives breaker failure-ratio)' },
          ts: { type: 'string', description: 'ISO 8601 timestamp; auto-filled if omitted' },
        },
        required: ['peerId', 'tokensUsed', 'usdSpent', 'success'],
      },
      handler: async (params) => {
        const coordinator = requireCoordinator();
        await coordinator.reportSpend({
          peerId: params['peerId'] as string,
          taskId: params['taskId'] as string | undefined,
          tokensUsed: params['tokensUsed'] as number,
          usdSpent: params['usdSpent'] as number,
          success: params['success'] as boolean,
          ts: params['ts'] as string | undefined,
        });
        return textResult('Spend reported');
      },
    },
    {
      name: 'federation_consensus',
      description: 'Propose a federated consensus operation across all active peers',
      pluginName: '@claude-flow/plugin-agent-federation',
      version: FEDERATION_PLUGIN_VERSION,
      inputSchema: {
        type: 'object',
        properties: {
          messageType: { type: 'string', description: 'Consensus message type (trust-change, topology-change, agent-spawn)' },
          payload: { type: 'object', description: 'Consensus proposal payload' },
          quorumFraction: { type: 'number', description: 'Required quorum fraction (default 2/3)' },
        },
        required: ['messageType', 'payload'],
      },
      handler: async (params) => {
        const context = getContext();
        if (!context) return textResult('Plugin not initialized', true);
        const routing = context.services.get<import('./domain/services/routing-service.js').RoutingService>('federation:routing');
        if (!routing) return textResult('Routing service not found', true);

        const proposal = await routing.propose(
          params['messageType'] as FederationMessageType,
          params['payload'],
          (params['quorumFraction'] as number) ?? 2 / 3,
        );
        return textResult(JSON.stringify({
          proposalId: proposal.proposalId,
          messageType: proposal.messageType,
          quorumRequired: proposal.quorumRequired,
          expiresAt: proposal.expiresAt.toISOString(),
        }, null, 2));
      },
    },
    {
      name: 'federation_wg_status',
      description: 'ADR-111 Phase 6: WG mesh state — per-peer trust level, mesh IP, suspended/evicted flags, and the AllowedIPs slice each peer currently has. Use to inspect what the breaker has propagated to the L3 layer.',
      pluginName: '@claude-flow/plugin-agent-federation',
      version: FEDERATION_PLUGIN_VERSION,
      inputSchema: {
        type: 'object',
        properties: {
          nodeId: { type: 'string', description: 'Optional: filter to a single peer' },
        },
      },
      handler: async (params) => {
        const wg = requireWgMesh();
        const coordinator = requireCoordinator();
        const peers = coordinator.listPeers();
        const summary = wg.summarize(peers);
        const filter = params['nodeId'] as string | undefined;
        const filtered = filter ? summary.filter(s => s.nodeId === filter) : summary;
        return textResult(JSON.stringify({
          interfaceName: wg.getInterfaceName(),
          meshSubnet: wg.getMeshSubnet(),
          peers: filtered,
        }, null, 2));
      },
    },
    {
      name: 'federation_wg_attest',
      description: 'ADR-111 Phase 6 (witness chain): emit an operator-signed attestation entry for a coordination change. Returns the canonical bytes the operator signs + the witness entry; operator appends it to .claude-flow/federation/wg-changes.log. Idempotent — re-attesting the same change just appends another entry.',
      pluginName: '@claude-flow/plugin-agent-federation',
      version: FEDERATION_PLUGIN_VERSION,
      inputSchema: {
        type: 'object',
        properties: {
          eventType: { type: 'string', description: 'peer-added | peer-removed-suspended | peer-restored | peer-evicted | key-rotated | interface-config-applied' },
          peerPublicKey: { type: 'string', description: 'Optional: peer pubkey (omit for interface-level events)' },
          meshIP: { type: 'string', description: 'Optional: peer mesh IP' },
          wgCommand: { type: 'string', description: 'Optional: wg command that was emitted' },
          rationale: { type: 'string', description: 'Human-readable rationale for the audit log' },
        },
        required: ['eventType', 'rationale'],
      },
      handler: async () => {
        // Phase 6 v1 stub — the WgWitnessService is the canonical signer. This
        // MCP tool returns instructions until plugin.ts wires the service.
        // Tracked alongside #1879 follow-up: integrate WgWitnessService into
        // plugin lifecycle so this handler can call attestWgCommand directly.
        return textResult(
          'federation_wg_attest: wire WgWitnessService in plugin.ts (Phase 6 follow-up). Until then, use the WgWitnessService class directly from the federation package.',
          true,
        );
      },
    },
    {
      name: 'federation_wg_keyrotate',
      description: 'ADR-111 Phase 6: rotate the local WG keypair. Returns the new public key + recommended next steps (republish manifest, peers regenerate their wg-quick config, grace-period destruction of old key). DESTRUCTIVE — the old private key is overwritten on disk; existing tunnels are dropped until peers update.',
      pluginName: '@claude-flow/plugin-agent-federation',
      version: FEDERATION_PLUGIN_VERSION,
      inputSchema: {
        type: 'object',
        properties: {
          confirm: { type: 'boolean', description: 'Must be true. Destructive: drops existing tunnels until all peers update their config.' },
        },
        required: ['confirm'],
      },
      handler: async (params) => {
        if (params['confirm'] !== true) {
          return textResult('Refusing rotate: confirm must be true. This drops existing tunnels until peers fetch the new manifest.', true);
        }
        // Phase 6 v1: emits a fresh keypair + the upgrade checklist. plugin.ts
        // is responsible for the actual disk write + manifest republish; this
        // returns the new public key for the operator to coordinate.
        const newKey = generateWgKeyPair();
        return textResult(JSON.stringify({
          publicKey: newKey.publicKey,
          createdAt: newKey.createdAt,
          nextSteps: [
            'Write the new private key to .claude-flow/federation/wg-key-<nodeId>.json (mode 0600)',
            'Republish federation manifest with the new wg.publicKey',
            'Peers regenerate their wg-quick config from the updated manifest',
            'Operator removes the old [Peer] block from /etc/wireguard/<iface>.conf after the grace period (default 1h)',
            'Run federation_wg_attest with eventType=key-rotated',
          ],
          warning: 'Private key NOT returned via MCP. The operator wires the actual disk persistence.',
        }, null, 2));
      },
    },
  ];
}
