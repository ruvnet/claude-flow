import { afterEach, describe, expect, it } from 'vitest';
import { FederationCoordinator } from '../../src/application/federation-coordinator.js';
import { PolicyEngine } from '../../src/application/policy-engine.js';
import { TrustEvaluator } from '../../src/application/trust-evaluator.js';
import { DiscoveryService, type FederationManifest } from '../../src/domain/services/discovery-service.js';
import { HandshakeService } from '../../src/domain/services/handshake-service.js';
import { RoutingService } from '../../src/domain/services/routing-service.js';
import { AuditService } from '../../src/domain/services/audit-service.js';
import { PIIPipelineService } from '../../src/domain/services/pii-pipeline-service.js';
import { TrustLevel } from '../../src/domain/entities/trust-level.js';
import type { FederationEnvelope, FederationMessageType } from '../../src/domain/entities/federation-envelope.js';

const coordinators: FederationCoordinator[] = [];
afterEach(async () => { for (const coordinator of coordinators.splice(0)) await coordinator.shutdown(); });

function manifest(nodeId: string): FederationManifest {
  return { nodeId, publicKey: `${nodeId}-key`, endpoint: `ws://${nodeId}.example:9100`,
    capabilities: { agentTypes: [], maxConcurrentSessions: 4, supportedProtocols: ['websocket'], complianceModes: [] },
    version: '1.0.0', signature: 'fixture-signature', timestamp: new Date().toISOString() };
}

async function fixture(resolveTrust = true) {
  let counter = 0;
  // Deterministic signing adapters isolate trust authorization from cryptography and transport.
  const discovery = new DiscoveryService({ signManifest: async () => 'fixture-signature', verifyManifest: async () => true });
  const handshake = new HandshakeService({ generateSessionId: () => `session-${++counter}`,
    generateSessionToken: () => `token-${++counter}`, generateNonce: () => `nonce-${++counter}`,
    signChallenge: async () => 'signature', verifySignature: async () => true,
    getLocalNodeId: () => 'local', getLocalPublicKey: () => 'local-key', getLocalCapabilities: () => ['send'] });
  const pii = new PIIPipelineService({ hashFunction: () => 'fixture-hash' });
  const scans: number[] = [];
  const sent: FederationEnvelope[] = [];
  let coordinator: FederationCoordinator;
  const routing = new RoutingService({ generateEnvelopeId: () => `envelope-${++counter}`, generateNonce: () => `nonce-${++counter}`,
    signEnvelope: () => 'fixture-hmac', verifyEnvelope: () => true,
    getLocalNodeId: () => 'local', getActiveSessions: () => coordinator.getActiveSessions(),
    getPeerTrustLevel: resolveTrust ? nodeId => discovery.getPeer(nodeId)?.trustLevel : undefined,
    scanPii: (text, trustLevel) => {
      scans.push(trustLevel);
      const result = pii.transform(text, trustLevel);
      return { transformedText: result.transformedText, scanResult: { scanned: true, piiFound: result.detections.length > 0,
        detections: result.detections.map(d => ({ type: d.type, confidence: d.confidence,
          action: result.actionsApplied.find(a => a.type === d.type)?.action ?? 'pass' })),
        actionsApplied: result.actionsApplied.map(a => a.action), scanDurationMs: 0 } };
    }, sendToNode: async (_nodeId, envelope) => { sent.push(envelope); } });
  const audit = new AuditService({ generateEventId: () => `audit-${++counter}`, getLocalNodeId: () => 'local',
    persistEvent: async () => {}, queryEvents: async () => [] });
  coordinator = new FederationCoordinator({ nodeId: 'local', publicKey: 'local-key', endpoint: manifest('local').endpoint, capabilities: [] },
    discovery, handshake, routing, audit, pii, new TrustEvaluator(), new PolicyEngine({ checkClaim: () => true }));
  await coordinator.initialize(manifest('local'));
  coordinators.push(coordinator);
  const peerManifest = manifest('remote');
  const session = await coordinator.joinPeer(peerManifest.endpoint, peerManifest);
  return { coordinator, discovery, routing, scans, sent, session, peerManifest };
}

describe('outbound current peer trust (#3561)', () => {
  it.each(['task-assignment', 'memory-query', 'context-share'] as FederationMessageType[])(
    'uses bootstrap elevation for %s while preserving the handshake snapshot', async messageType => {
      const f = await fixture();
      expect(f.session.trustLevel).toBe(TrustLevel.VERIFIED);
      await f.coordinator.bootstrapElevatePeer('remote', TrustLevel.TRUSTED, 'test operator approval');
      expect((await f.coordinator.sendMessage('remote', messageType, { task: 'fixture' })).success).toBe(true);
      expect(f.scans).toEqual([TrustLevel.TRUSTED]);
      expect(f.sent).toHaveLength(1);
      expect(f.session.trustLevel).toBe(TrustLevel.VERIFIED);
    });

  it('uses current trust for the real PII transformation, including later downgrades', async () => {
    const f = await fixture();
    await f.coordinator.bootstrapElevatePeer('remote', TrustLevel.ATTESTED, 'test operator approval');
    expect((await f.coordinator.sendMessage('remote', 'task-assignment', { email: 'fixture@example.com' })).success).toBe(true);
    expect(f.sent[0].payload).toEqual({ email: '[REDACTED:email]' });
    f.discovery.getPeer('remote')!.updateTrustLevel(TrustLevel.VERIFIED);
    expect((await f.routing.send(f.session, 'status-broadcast', { email: 'fixture@example.com' })).success).toBe(false);
    expect(f.scans).toEqual([TrustLevel.ATTESTED, TrustLevel.VERIFIED]);
    expect(f.sent).toHaveLength(1);
  });

  it('rejects an untrusted peer after threat downgrade and a verified-manifest rejoin', async () => {
    const f = await fixture();
    f.coordinator.handleThreatDetection('remote'); f.coordinator.handleThreatDetection('remote');
    expect(f.session.active).toBe(false);
    expect(f.discovery.getPeer('remote')!.trustLevel).toBe(TrustLevel.UNTRUSTED);
    const reopened = await f.coordinator.joinPeer(f.peerManifest.endpoint, f.peerManifest);
    expect(reopened.trustLevel).toBe(TrustLevel.VERIFIED);
    const result = await f.coordinator.sendMessage('remote', 'status-broadcast', { status: 'ready' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Trust level 0');
    expect(f.sent).toHaveLength(0); expect(f.scans).toHaveLength(0);
  });

  it('uses untrusted PII policy when a custom routing adapter has no peer resolver', async () => {
    const f = await fixture(false);
    await f.coordinator.bootstrapElevatePeer('remote', TrustLevel.PRIVILEGED, 'test operator approval');
    expect((await f.routing.send(f.session, 'status-broadcast', { email: 'fixture@example.com' })).success).toBe(false);
    expect(f.scans).toEqual([TrustLevel.UNTRUSTED]);
    expect(f.sent).toHaveLength(0);
  });

  it('uses current trust for broadcast recipients through the shared send path', async () => {
    const f = await fixture();
    await f.coordinator.bootstrapElevatePeer('remote', TrustLevel.PRIVILEGED, 'test operator approval');
    expect((await f.routing.broadcast('status-broadcast', { email: 'fixture@example.com' }))[0].success).toBe(true);
    expect(f.scans).toEqual([TrustLevel.PRIVILEGED]);
    expect(f.sent[0].payload).toEqual({ email: 'fixture@example.com' });
  });

  it('fails closed if an active session has no current discovery peer', async () => {
    const f = await fixture();
    f.discovery.removePeer('remote');
    expect((await f.coordinator.sendMessage('remote', 'status-broadcast', { status: 'ready' })).success).toBe(false);
    expect(f.sent).toHaveLength(0);
    expect((await f.routing.send(f.session, 'status-broadcast', { email: 'fixture@example.com' })).success).toBe(false);
    expect(f.scans).toEqual([TrustLevel.UNTRUSTED]);
  });
});
