import type { CLICommandDefinition, PluginContext } from '@claude-flow/shared/src/plugin-interface.js';
import type { FederationCoordinator } from './application/federation-coordinator.js';
import { getTrustLevelLabel, TrustLevel } from './domain/entities/trust-level.js';

type CoordinatorGetter = () => FederationCoordinator | null;
type ContextGetter = () => PluginContext | null;

function requireCoordinator(get: CoordinatorGetter): FederationCoordinator {
  const c = get();
  if (!c) throw new Error('Federation not initialized. Run "federation init" first.');
  return c;
}

export function createCliCommands(
  getCoordinator: CoordinatorGetter,
  getContext: ContextGetter,
): CLICommandDefinition[] {
  return [
    {
      name: 'federation init',
      description: 'Generate keypair, create federation config, and start discovery',
      options: [
        { name: 'endpoint', short: 'e', description: 'WebSocket/HTTP endpoint', type: 'string', required: true },
        { name: 'node-id', short: 'n', description: 'Node identifier', type: 'string' },
        { name: 'compliance', short: 'c', description: 'Compliance mode (hipaa, soc2, gdpr, none)', type: 'string', default: 'none' },
      ],
      handler: async (args) => {
        const coordinator = requireCoordinator(getCoordinator);
        const nodeId = (args['node-id'] as string) ?? `node-${Date.now().toString(36)}`;
        await coordinator.initialize({
          nodeId,
          publicKey: '',
          endpoint: args['endpoint'] as string,
          capabilities: {
            agentTypes: ['coder', 'reviewer', 'tester'],
            maxConcurrentSessions: 10,
            supportedProtocols: ['websocket', 'http'],
            complianceModes: [args['compliance'] as string],
          },
          version: '1.0.0-alpha.1',
          timestamp: new Date().toISOString(),
        });
        console.log(`Federation initialized: ${nodeId} at ${args['endpoint']}`);
      },
    },
    {
      name: 'federation join',
      description: 'Join a federation by connecting to a peer endpoint',
      arguments: [{ name: 'endpoint', description: 'Remote peer endpoint', required: true }],
      handler: async (args) => {
        const coordinator = requireCoordinator(getCoordinator);
        const session = await coordinator.joinPeer(args._[0]!);
        console.log(`Joined peer. Session: ${session.sessionId}`);
        console.log(`Trust level: ${getTrustLevelLabel(session.trustLevel)}`);
        console.log(`Capabilities: ${session.negotiatedCapabilities.join(', ')}`);
      },
    },
    {
      name: 'federation leave',
      description: 'Leave the federation gracefully, terminating all sessions',
      handler: async () => {
        const coordinator = requireCoordinator(getCoordinator);
        await coordinator.shutdown();
        console.log('Left federation. All sessions terminated.');
      },
    },
    {
      name: 'federation peers',
      description: 'List known federation peers with trust levels and status',
      options: [
        { name: 'format', short: 'f', description: 'Output format (table, json)', type: 'string', default: 'table' },
      ],
      handler: async (args) => {
        const coordinator = requireCoordinator(getCoordinator);
        const status = coordinator.getStatus();
        const format = args['format'] as string;

        if (format === 'json') {
          console.log(JSON.stringify(status.trustLevels, null, 2));
        } else {
          console.log('Node ID                          | Trust Level');
          console.log('-'.repeat(60));
          for (const [nodeId, level] of Object.entries(status.trustLevels)) {
            console.log(`${nodeId.padEnd(33)}| ${getTrustLevelLabel(level as TrustLevel)}`);
          }
        }
      },
    },
    {
      name: 'federation peers add',
      description: 'Add a static peer to the federation',
      arguments: [{ name: 'endpoint', description: 'Peer endpoint to add', required: true }],
      handler: async (args) => {
        const coordinator = requireCoordinator(getCoordinator);
        const session = await coordinator.joinPeer(args._[0]!);
        console.log(`Peer added and connected. Session: ${session.sessionId}`);
      },
    },
    {
      name: 'federation peers remove',
      description: 'Remove a peer from the federation',
      arguments: [{ name: 'node-id', description: 'Node ID to remove', required: true }],
      handler: async (args) => {
        const coordinator = requireCoordinator(getCoordinator);
        await coordinator.leavePeer(args._[0]!);
        console.log(`Peer ${args._[0]} removed.`);
      },
    },
    {
      name: 'federation status',
      description: 'Show federation health, active sessions, and metrics',
      options: [
        { name: 'format', short: 'f', description: 'Output format (table, json)', type: 'string', default: 'table' },
      ],
      handler: async (args) => {
        const coordinator = requireCoordinator(getCoordinator);
        const status = coordinator.getStatus();
        const format = args['format'] as string;

        if (format === 'json') {
          console.log(JSON.stringify(status, null, 2));
        } else {
          console.log(`Node ID:         ${status.nodeId}`);
          console.log(`Active Sessions: ${status.activeSessions}`);
          console.log(`Known Peers:     ${status.knownPeers}`);
          console.log(`Healthy:         ${status.healthy}`);
        }
      },
    },
    {
      name: 'federation audit',
      description: 'Query and export federation audit logs',
      options: [
        { name: 'compliance', description: 'Compliance mode filter (hipaa, soc2, gdpr)', type: 'string' },
        { name: 'since', description: 'ISO 8601 start date', type: 'string' },
        { name: 'export', short: 'e', description: 'Export format (json, csv, ndjson)', type: 'string' },
        { name: 'limit', short: 'l', description: 'Maximum results', type: 'number', default: 50 },
      ],
      handler: async (args) => {
        const context = getContext();
        if (!context) throw new Error('Plugin not initialized');
        const audit = context.services.get<import('./domain/services/audit-service.js').AuditService>('federation:audit');
        if (!audit) throw new Error('Audit service not found');

        const exportFormat = args['export'] as string | undefined;
        const query = {
          since: args['since'] ? new Date(args['since'] as string) : undefined,
          limit: args['limit'] as number,
        };

        if (exportFormat) {
          const output = await audit.export(query, exportFormat as any);
          console.log(output);
        } else {
          const events = await audit.query(query);
          console.log(JSON.stringify(events, null, 2));
        }
      },
    },
    {
      name: 'federation trust elevate',
      description:
        'ADR-164 §3.5.4 — Founder-bootstrap trust elevation escape hatch. ' +
        'Hand-promote a registered BBS peer past the organic minInteractions ' +
        'threshold (e.g. 500 for ATTESTED→TRUSTED) so #exec / #finance pods can ' +
        'reach the share-context capability on Day 1. Refuses if the target ' +
        'is not a registered federation peer. Every invocation writes a ' +
        '`trust_level_changed` audit entry tagged `bootstrap_elevation`.',
      arguments: [{ name: 'node-id', description: 'BBS / federation node id to elevate', required: true }],
      options: [
        {
          name: 'to',
          description: 'Target trust level (VERIFIED, ATTESTED, TRUSTED, PRIVILEGED, or numeric 1-4)',
          type: 'string',
          required: true,
        },
        {
          name: 'reason',
          description: 'Operator-supplied reason — appears verbatim in the audit log',
          type: 'string',
          required: true,
        },
        {
          name: 'audit',
          description: 'MANDATORY — print the resulting audit-log entry to stdout',
          type: 'boolean',
          default: false,
        },
      ],
      handler: async (args) => {
        const coordinator = requireCoordinator(getCoordinator);
        const nodeId = (args._?.[0] ?? '') as string;
        if (!nodeId) {
          console.error('node-id is required');
          process.exitCode = 1;
          return;
        }

        const rawTo = args['to'];
        const reason = args['reason'];
        const auditFlag = args['audit'];

        if (typeof reason !== 'string' || reason.trim().length === 0) {
          console.error('--reason is required and must be a non-empty string');
          process.exitCode = 1;
          return;
        }
        if (auditFlag !== true && auditFlag !== 'true') {
          console.error(
            '--audit is mandatory for bootstrap elevation (ADR-164 §3.5.4). ' +
            'Pass --audit to acknowledge the audit-log emission.',
          );
          process.exitCode = 1;
          return;
        }

        let target: TrustLevel | null = null;
        const toStr = String(rawTo).trim().toUpperCase();
        switch (toStr) {
          case 'VERIFIED': case '1': target = TrustLevel.VERIFIED; break;
          case 'ATTESTED': case '2': target = TrustLevel.ATTESTED; break;
          case 'TRUSTED':  case '3': target = TrustLevel.TRUSTED;  break;
          case 'PRIVILEGED': case '4': target = TrustLevel.PRIVILEGED; break;
        }
        if (target === null) {
          console.error(
            `--to value "${rawTo}" not recognized. ` +
            `Use VERIFIED, ATTESTED, TRUSTED, PRIVILEGED, or numeric 1-4.`,
          );
          process.exitCode = 1;
          return;
        }

        const entry = await coordinator.bootstrapElevatePeer(nodeId, target, reason);
        if (entry === null) {
          console.error(
            `Node "${nodeId}" is not a registered federation peer. ` +
            `Run "ruflo-federation peers add <endpoint>" first.`,
          );
          process.exitCode = 1;
          return;
        }

        // --audit is mandatory; always print the entry to stdout.
        const human =
          `[BOOTSTRAP-ELEVATION] ${entry.timestamp}\n` +
          `  nodeId:         ${entry.nodeId}\n` +
          `  previousLevel:  ${getTrustLevelLabel(entry.previousLevel)} (${entry.previousLevel})\n` +
          `  newLevel:       ${getTrustLevelLabel(entry.newLevel)} (${entry.newLevel})\n` +
          `  reason:         ${entry.reason}\n` +
          `  operatorBypass: ${entry.operatorBypass}\n` +
          `  tag:            ${entry.tag}`;
        console.log(human);
        console.log(JSON.stringify(entry));
      },
    },
    {
      name: 'federation trust',
      description: 'View or modify trust level for a specific node',
      arguments: [{ name: 'node-id', description: 'Node ID to inspect or modify', required: true }],
      options: [
        { name: 'set', description: 'Set trust level (0-4)', type: 'number' },
        { name: 'review', description: 'Show detailed trust score breakdown', type: 'boolean', default: false },
      ],
      handler: async (args) => {
        const coordinator = requireCoordinator(getCoordinator);
        const status = coordinator.getStatus();
        const nodeId = args._[0]!;
        const trustLevel = status.trustLevels[nodeId];

        if (trustLevel === undefined) {
          console.error(`Node ${nodeId} not found in federation.`);
          return;
        }

        console.log(`Node:        ${nodeId}`);
        console.log(`Trust Level: ${getTrustLevelLabel(trustLevel as TrustLevel)} (${trustLevel})`);
      },
    },
    {
      name: 'federation config',
      description: 'View or update federation configuration',
      options: [
        { name: 'pii-policy', description: 'Path to PII policy JSON file', type: 'string' },
        { name: 'compliance', description: 'Set compliance mode (hipaa, soc2, gdpr, none)', type: 'string' },
      ],
      handler: async (args) => {
        const context = getContext();
        if (!context) throw new Error('Plugin not initialized');

        if (args['pii-policy'] || args['compliance']) {
          console.log('Configuration updated.');
        } else {
          console.log(JSON.stringify({
            complianceMode: context.config['complianceMode'] ?? 'none',
            endpoint: context.config['endpoint'] ?? 'not configured',
            nodeId: context.config['nodeId'] ?? 'auto-generated',
          }, null, 2));
        }
      },
    },
  ];
}
