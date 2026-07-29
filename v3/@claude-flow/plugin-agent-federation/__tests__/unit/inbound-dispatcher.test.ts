/**
 * Tests for ADR-109 — inbound dispatcher.
 *
 * Pins the security gates the receive path enforces:
 *   1. PEER_UNKNOWN — sender not in discovery → reject, no event
 *   2. PEER_SUSPENDED — defense-in-depth (outbound short-circuit
 *      already prevents this in normal flow, but receive enforces too)
 *   3. PEER_EVICTED — same
 *   4. MISSING_METADATA — no sourceNodeId → reject
 *   5. Happy path — known ACTIVE peer → audit `message_received`,
 *      typed event emitted, peer.markSeen() called
 *   6. EventBus throw doesn't crash the dispatcher
 */

import { describe, it, expect, vi } from 'vitest';
import {
  dispatchInbound,
  FEDERATION_INBOUND_EVENT_PREFIX,
  type InboundDispatchDeps,
} from '../../src/application/inbound-dispatcher.js';
import { FederationNode } from '../../src/domain/entities/federation-node.js';
import { FederationNodeState } from '../../src/domain/value-objects/federation-node-state.js';
import type { AgentMessage } from 'agentic-flow/transport/loader';

function mkPeer(nodeId: string, state?: FederationNodeState) {
  return FederationNode.create({
    nodeId,
    publicKey: `pk-${nodeId}`,
    endpoint: `ws://${nodeId}:9100`,
    capabilities: {
      agentTypes: [],
      maxConcurrentSessions: 1,
      supportedProtocols: [],
      complianceModes: [],
    },
    metadata: {},
    state,
  });
}

function mkDeps(peers: FederationNode[] = []): {
  deps: InboundDispatchDeps;
  audits: { eventType: string; data: unknown }[];
  events: { event: string; data: unknown }[];
} {
  const peerMap = new Map(peers.map((p) => [p.nodeId, p]));
  const audits: { eventType: string; data: unknown }[] = [];
  const events: { event: string; data: unknown }[] = [];
  return {
    audits,
    events,
    deps: {
      discovery: { getPeer: (id: string) => peerMap.get(id) },
      audit: {
        log: (async (eventType: string, data: unknown) => {
          audits.push({ eventType, data });
        }) as InboundDispatchDeps['audit']['log'],
      },
      eventBus: {
        emit: (event, data) => {
          events.push({ event, data });
        },
      },
      logger: { debug: vi.fn(), warn: vi.fn() },
    },
  };
}

function withVerifier(
  peers: FederationNode[],
  verify: (canon: string, sig: string | null, pk: string) => boolean,
) {
  const base = mkDeps(peers);
  return {
    ...base,
    deps: { ...base.deps, verifyEnvelope: verify },
  };
}

const baseMsg = (sourceNodeId: string | undefined, type = 'heartbeat'): AgentMessage => ({
  id: 'msg-1',
  type,
  payload: { test: true },
  metadata: sourceNodeId ? { sourceNodeId } : undefined,
});

describe('dispatchInbound — security gates (ADR-109)', () => {
  it('rejects MISSING_METADATA when no sourceNodeId in metadata', async () => {
    const { deps, audits, events } = mkDeps();
    const r = await dispatchInbound('1.2.3.4:55555', baseMsg(undefined), deps);
    expect(r).toEqual({ accepted: false, reason: 'MISSING_METADATA' });
    expect(audits[0].eventType).toBe('message_rejected');
    expect(events).toEqual([]);
  });

  it('rejects PEER_UNKNOWN when sender not in discovery', async () => {
    const { deps, audits, events } = mkDeps([]);
    const r = await dispatchInbound('1.2.3.4:55555', baseMsg('ghost-node'), deps);
    expect(r).toEqual({ accepted: false, reason: 'PEER_UNKNOWN' });
    expect(audits[0].eventType).toBe('message_rejected');
    expect((audits[0].data as { metadata: { reason: string } }).metadata.reason).toBe('PEER_UNKNOWN');
    expect(events).toEqual([]);
  });

  it('rejects PEER_SUSPENDED (defense-in-depth)', async () => {
    const peer = mkPeer('alpha', FederationNodeState.SUSPENDED);
    const { deps, audits, events } = mkDeps([peer]);
    const r = await dispatchInbound('1.2.3.4:55555', baseMsg('alpha'), deps);
    expect(r).toEqual({ accepted: false, reason: 'PEER_SUSPENDED' });
    expect(audits[0].eventType).toBe('message_rejected');
    expect(events).toEqual([]);
  });

  it('rejects PEER_EVICTED (defense-in-depth)', async () => {
    const peer = mkPeer('alpha', FederationNodeState.EVICTED);
    const { deps, audits, events } = mkDeps([peer]);
    const r = await dispatchInbound('1.2.3.4:55555', baseMsg('alpha'), deps);
    expect(r).toEqual({ accepted: false, reason: 'PEER_EVICTED' });
    expect(events).toEqual([]);
  });
});

describe('dispatchInbound — happy path', () => {
  it('accepts ACTIVE peer, audits message_received, emits typed event', async () => {
    const peer = mkPeer('alpha');
    const { deps, audits, events } = mkDeps([peer]);
    const r = await dispatchInbound('1.2.3.4:55555', baseMsg('alpha'), deps);
    expect(r).toEqual({ accepted: true, sourceNodeId: 'alpha', messageType: 'heartbeat' });
    expect(audits[0].eventType).toBe('message_received');
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe(`${FEDERATION_INBOUND_EVENT_PREFIX}:heartbeat`);
  });

  it('event payload includes address, sourceNodeId, message, peer', async () => {
    const peer = mkPeer('alpha');
    const { deps, events } = mkDeps([peer]);
    await dispatchInbound('1.2.3.4:55555', baseMsg('alpha'), deps);
    const data = events[0].data as Record<string, unknown>;
    expect(data.address).toBe('1.2.3.4:55555');
    expect(data.sourceNodeId).toBe('alpha');
    expect(data.peer).toBe(peer);
    expect((data.message as AgentMessage).id).toBe('msg-1');
  });

  it('different messageTypes produce different event names', async () => {
    const peer = mkPeer('alpha');
    const { deps, events } = withVerifier([peer], () => true);
    const jcs = (type: string): AgentMessage => ({
      ...baseMsg('alpha', type),
      metadata: {
        sourceNodeId: 'alpha',
        signature: 'valid',
        signatureVersion: 'jcs-v1',
      },
    });
    await dispatchInbound('a', jcs('task-assignment'), deps);
    await dispatchInbound('a', jcs('memory-query'), deps);
    await dispatchInbound('a', jcs('context-share'), deps);
    expect(events.map((e) => e.event)).toEqual([
      'federation:inbound:task-assignment',
      'federation:inbound:memory-query',
      'federation:inbound:context-share',
    ]);
  });

  it('marks peer as seen on accepted delivery (drives stale detection)', async () => {
    const peer = mkPeer('alpha');
    const t0 = peer.lastSeen;
    await new Promise((r) => setTimeout(r, 5));
    const { deps } = mkDeps([peer]);
    await dispatchInbound('a', baseMsg('alpha'), deps);
    expect(peer.lastSeen.getTime()).toBeGreaterThan(t0.getTime());
  });
});

describe('dispatchInbound — robustness', () => {
  it('eventBus.emit throw does not crash the dispatcher', async () => {
    const peer = mkPeer('alpha');
    const { deps, audits } = mkDeps([peer]);
    deps.eventBus.emit = () => {
      throw new Error('eventBus is down');
    };
    // Must not throw
    const r = await dispatchInbound('a', baseMsg('alpha'), deps);
    // Audit STILL recorded — only the emit failed
    expect(r.accepted).toBe(true);
    expect(audits[0].eventType).toBe('message_received');
  });
});

describe('dispatchInbound — signature verification', () => {
  it('rejects INVALID_SIGNATURE when verifier returns false', async () => {
    const peer = mkPeer('alpha');
    const { deps, audits, events } = withVerifier([peer], () => false);
    const msg = {
      ...baseMsg('alpha'),
      metadata: { sourceNodeId: 'alpha', signature: 'fake-sig' },
    };
    const r = await dispatchInbound('1.2.3.4:9999', msg, deps);
    expect(r).toEqual({ accepted: false, reason: 'INVALID_SIGNATURE' });
    expect(audits[0].eventType).toBe('message_rejected');
    expect((audits[0].data as { metadata: { reason: string } }).metadata.reason).toBe(
      'INVALID_SIGNATURE',
    );
    expect(events).toEqual([]);
  });

  it('rejects when signature is missing from metadata (verifier called with null)', async () => {
    const peer = mkPeer('alpha');
    let calledWith: { sig: string | null } | null = null;
    const { deps, audits } = withVerifier([peer], (_canon, sig) => {
      calledWith = { sig };
      return false;
    });
    // Message has sourceNodeId but no signature — verifier sees sig=null
    const r = await dispatchInbound('a', baseMsg('alpha'), deps);
    expect(r).toEqual({ accepted: false, reason: 'INVALID_SIGNATURE' });
    expect(calledWith).toEqual({ sig: null });
    expect(audits[0].eventType).toBe('message_rejected');
  });

  it('accepts when verifier returns true', async () => {
    const peer = mkPeer('alpha');
    const { deps, audits, events } = withVerifier([peer], () => true);
    const msg = {
      ...baseMsg('alpha'),
      metadata: { sourceNodeId: 'alpha', signature: 'valid-sig' },
    };
    const r = await dispatchInbound('a', msg, deps);
    expect(r).toEqual({ accepted: true, sourceNodeId: 'alpha', messageType: 'heartbeat' });
    expect(audits[0].eventType).toBe('message_received');
    expect(events).toHaveLength(1);
  });

  it('verifier is called with peer publicKey (not attacker-supplied)', async () => {
    const peer = mkPeer('alpha');
    let receivedPk = '';
    const { deps } = withVerifier([peer], (_c, _s, pk) => {
      receivedPk = pk;
      return true;
    });
    await dispatchInbound('a', { ...baseMsg('alpha'), metadata: { sourceNodeId: 'alpha', signature: 's' } }, deps);
    // pk-alpha is set in mkPeer, NOT something the attacker can spoof
    expect(receivedPk).toBe('pk-alpha');
  });

  it('peer-state checks fire BEFORE signature check (cheaper rejections first)', async () => {
    const peer = mkPeer('alpha', FederationNodeState.SUSPENDED);
    let verifyCalled = false;
    const { deps } = withVerifier([peer], () => {
      verifyCalled = true;
      return true;
    });
    const r = await dispatchInbound('a', baseMsg('alpha'), deps);
    expect(r.accepted).toBe(false);
    if (!r.accepted) expect(r.reason).toBe('PEER_SUSPENDED');
    // SUSPENDED rejection short-circuits BEFORE the (expensive) sig check
    expect(verifyCalled).toBe(false);
  });

  it('rejects non-canonical payloads without invoking the verifier', async () => {
    const peer = mkPeer('alpha');
    let verifyCalled = false;
    const { deps } = withVerifier([peer], () => {
      verifyCalled = true;
      return true;
    });
    const r = await dispatchInbound(
      'a',
      {
        ...baseMsg('alpha'),
        payload: { unsafe: Number.NaN },
        metadata: { sourceNodeId: 'alpha', signature: 's', signatureVersion: 'jcs-v1' },
      },
      deps,
    );
    expect(r).toEqual({ accepted: false, reason: 'INVALID_PAYLOAD' });
    expect(verifyCalled).toBe(false);
  });

  it('legacy mode (no verifier injected) accepts without sig check — backward compat', async () => {
    const peer = mkPeer('alpha');
    const { deps, events } = mkDeps([peer]); // no verifyEnvelope
    const r = await dispatchInbound('a', baseMsg('alpha'), deps);
    expect(r.accepted).toBe(true);
    expect(events).toHaveLength(1);
  });
});

describe('dispatchInbound — legacy-v1 containment', () => {
  it.each([
    'claim-event',
    'agent-handoff',
    'task-assignment',
    'task_assignment',
    'context-share',
    'memory-response',
    'memory_response',
    'trust-change',
    'topology-change',
    'agent-spawn',
    'spawn-agent',
    'unknown-extension',
  ])('rejects consequential or unknown legacy-v1 type %s', async (type) => {
    const peer = mkPeer('alpha');
    const { deps, events } = withVerifier([peer], () => true);
    const authorizeInbound = vi.fn(() => ({ allowed: true }));
    const result = await dispatchInbound(
      'a',
      {
        ...baseMsg('alpha', type),
        metadata: { sourceNodeId: 'alpha', signature: 'valid' },
      },
      { ...deps, authorizeInbound },
    );

    expect(result).toEqual({ accepted: false, reason: 'LEGACY_SIGNATURE_TYPE_REJECTED' });
    expect(authorizeInbound).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it.each(['heartbeat', 'status-broadcast'])(
    'retains legacy connectivity for explicit low-risk type %s',
    async (type) => {
      const peer = mkPeer('alpha');
      const { deps, events } = withVerifier([peer], () => true);
      const result = await dispatchInbound(
        'a',
        {
          ...baseMsg('alpha', type),
          metadata: { sourceNodeId: 'alpha', signature: 'valid' },
        },
        deps,
      );
      expect(result.accepted).toBe(true);
      expect(events).toHaveLength(1);
    },
  );
});

describe('dispatchInbound — inbound authorization', () => {
  const jcsMessage = (type = 'task-assignment'): AgentMessage => ({
    ...baseMsg('alpha', type),
    metadata: {
      sourceNodeId: 'alpha',
      signature: 'valid',
      signatureVersion: 'jcs-v1',
    },
  });

  it('enforce denies before markSeen, audit acceptance, and emit', async () => {
    const peer = mkPeer('alpha');
    const lastSeen = peer.lastSeen;
    const { deps, audits, events } = withVerifier([peer], () => true);
    const result = await dispatchInbound('a', jcsMessage(), {
      ...deps,
      authorizationMode: 'enforce',
      authorizeInbound: () => ({ allowed: false, reason: 'missing federation:write' }),
    });

    expect(result).toEqual({ accepted: false, reason: 'AUTHORIZATION_DENIED' });
    expect(peer.lastSeen).toBe(lastSeen);
    expect(audits).toHaveLength(1);
    expect(audits[0].eventType).toBe('message_rejected');
    expect(events).toEqual([]);
  });

  it('enforce fails closed when no evaluator is injected', async () => {
    const peer = mkPeer('alpha');
    const { deps, events } = withVerifier([peer], () => true);
    const result = await dispatchInbound('a', jcsMessage(), {
      ...deps,
      authorizationMode: 'enforce',
    });
    expect(result).toEqual({ accepted: false, reason: 'AUTHORIZATION_ERROR' });
    expect(events).toEqual([]);
  });

  it('enforce fails closed when the evaluator throws', async () => {
    const peer = mkPeer('alpha');
    const { deps, events } = withVerifier([peer], () => true);
    const result = await dispatchInbound('a', jcsMessage(), {
      ...deps,
      authorizationMode: 'enforce',
      authorizeInbound: () => {
        throw new Error('policy backend unavailable');
      },
    });
    expect(result).toEqual({ accepted: false, reason: 'AUTHORIZATION_ERROR' });
    expect(events).toEqual([]);
  });

  it('enforce fails closed on a malformed evaluator decision', async () => {
    const peer = mkPeer('alpha');
    const { deps, events } = withVerifier([peer], () => true);
    const result = await dispatchInbound('a', jcsMessage(), {
      ...deps,
      authorizationMode: 'enforce',
      authorizeInbound: (() => ({ reason: 'missing allowed boolean' })) as InboundDispatchDeps['authorizeInbound'],
    });
    expect(result).toEqual({ accepted: false, reason: 'AUTHORIZATION_ERROR' });
    expect(events).toEqual([]);
  });

  it('observe evaluates and reports denial without blocking', async () => {
    const peer = mkPeer('alpha');
    const { deps, events } = withVerifier([peer], () => true);
    const authorizeInbound = vi.fn(() => ({ allowed: false, reason: 'would deny' }));
    const result = await dispatchInbound('a', jcsMessage(), {
      ...deps,
      authorizationMode: 'observe',
      authorizeInbound,
    });

    expect(result.accepted).toBe(true);
    expect(authorizeInbound).toHaveBeenCalledOnce();
    expect(events).toHaveLength(1);
    expect(deps.logger.warn).toHaveBeenCalledWith(expect.stringContaining('mode=observe'));
  });

  it('legacy evaluates but preserves compatible low-risk delivery', async () => {
    const peer = mkPeer('alpha');
    const { deps, events } = withVerifier([peer], () => true);
    const authorizeInbound = vi.fn(() => ({ allowed: false, reason: 'would deny' }));
    const result = await dispatchInbound(
      'a',
      {
        ...baseMsg('alpha'),
        metadata: { sourceNodeId: 'alpha', signature: 'valid' },
      },
      {
        ...deps,
        authorizationMode: 'legacy',
        authorizeInbound,
      },
    );

    expect(result.accepted).toBe(true);
    expect(authorizeInbound).toHaveBeenCalledOnce();
    expect(events).toHaveLength(1);
  });

  it('runs signature, authorization, and emit in that order', async () => {
    const peer = mkPeer('alpha');
    const calls: string[] = [];
    const { deps } = withVerifier([peer], () => {
      calls.push('verify');
      return true;
    });
    deps.eventBus.emit = () => {
      calls.push('emit');
    };

    const result = await dispatchInbound('a', jcsMessage(), {
      ...deps,
      authorizationMode: 'enforce',
      authorizeInbound: () => {
        calls.push('authorize');
        return { allowed: true };
      },
    });
    expect(result.accepted).toBe(true);
    expect(calls).toEqual(['verify', 'authorize', 'emit']);
  });
});

describe('canonicalizeEnvelopeForVerify', () => {
  it('strips signature from metadata before canonicalization', async () => {
    const { canonicalizeEnvelopeForVerify } = await import(
      '../../src/application/inbound-dispatcher.js'
    );
    const withSig = canonicalizeEnvelopeForVerify({
      id: 'm',
      type: 't',
      payload: { x: 1 },
      metadata: { sourceNodeId: 'a', signature: 'XXX' },
    });
    const withoutSig = canonicalizeEnvelopeForVerify({
      id: 'm',
      type: 't',
      payload: { x: 1 },
      metadata: { sourceNodeId: 'a' },
    });
    expect(withSig).toBe(withoutSig);
  });

  it('produces deterministic output (same fields → same string)', async () => {
    const { canonicalizeEnvelopeForVerify } = await import(
      '../../src/application/inbound-dispatcher.js'
    );
    const a = canonicalizeEnvelopeForVerify({
      id: 'm',
      type: 't',
      payload: { x: 1 },
      metadata: { sourceNodeId: 'a' },
    });
    const b = canonicalizeEnvelopeForVerify({
      // same inputs, different construction order
      metadata: { sourceNodeId: 'a' },
      payload: { x: 1 },
      type: 't',
      id: 'm',
    });
    expect(a).toBe(b);
  });

  it('recursively covers nested payload and metadata values', async () => {
    const { canonicalizeEnvelopeForVerify } = await import(
      '../../src/application/inbound-dispatcher.js'
    );
    const original = canonicalizeEnvelopeForVerify({
      id: 'm',
      type: 'claim-event',
      payload: { claim: { owner: 'agent-a', epoch: 7 }, steps: ['read', 'write'] },
      metadata: {
        sourceNodeId: 'a',
        signatureVersion: 'jcs-v1',
        grant: { actions: ['work.handoff'] },
      },
    });
    const reordered = canonicalizeEnvelopeForVerify({
      metadata: {
        grant: { actions: ['work.handoff'] },
        signatureVersion: 'jcs-v1',
        sourceNodeId: 'a',
      },
      payload: { steps: ['read', 'write'], claim: { epoch: 7, owner: 'agent-a' } },
      type: 'claim-event',
      id: 'm',
    });
    const mutated = canonicalizeEnvelopeForVerify({
      id: 'm',
      type: 'claim-event',
      payload: { claim: { owner: 'agent-b', epoch: 7 }, steps: ['read', 'write'] },
      metadata: {
        sourceNodeId: 'a',
        signatureVersion: 'jcs-v1',
        grant: { actions: ['work.handoff'] },
      },
    });

    expect(reordered).toBe(original);
    expect(mutated).not.toBe(original);
    expect(original).toContain('"claim":{"epoch":7,"owner":"agent-a"}');
  });

  it.each([
    { value: Number.NaN, label: 'non-finite number' },
    { value: -0, label: 'negative zero' },
    { value: Number.MAX_SAFE_INTEGER + 1, label: 'unsafe integer' },
    { value: undefined, label: 'undefined' },
  ])('rejects $label instead of signing ambiguous JSON', async ({ value }) => {
    const { canonicalizeEnvelopeForVerify } = await import(
      '../../src/application/inbound-dispatcher.js'
    );
    expect(() =>
      canonicalizeEnvelopeForVerify({
        id: 'm',
        type: 't',
        payload: { value },
        metadata: { sourceNodeId: 'a', signatureVersion: 'jcs-v1' },
      }),
    ).toThrow(/Federation canonicalization rejects/);
  });

  it('keeps historical bytes for a message without a version marker', async () => {
    const { canonicalizeEnvelopeForVerify } = await import(
      '../../src/application/inbound-dispatcher.js'
    );
    const message = {
      id: 'm',
      type: 'claim-event',
      payload: { claim: { owner: 'agent-a' } },
      metadata: { sourceNodeId: 'a' },
    };
    const historical = JSON.stringify(
      {
        id: message.id,
        type: message.type,
        payload: message.payload,
        metadata: message.metadata,
      },
      ['id', 'metadata', 'payload', 'type'],
    );
    const legacy = canonicalizeEnvelopeForVerify(message);
    expect(legacy).toBe(historical);
    expect(legacy).not.toContain('owner');
  });

  it('selects JCS only for an advertised peer and fails closed when required', async () => {
    const {
      DEFAULT_ENVELOPE_SIGNATURE_MODE,
      JCS_SIGNATURE_PROTOCOL,
      selectEnvelopeSignatureVersion,
    } = await import('../../src/application/inbound-dispatcher.js');
    expect(DEFAULT_ENVELOPE_SIGNATURE_MODE).toBe('prefer-jcs');
    expect(selectEnvelopeSignatureVersion('legacy', [JCS_SIGNATURE_PROTOCOL])).toBe('legacy-v1');
    expect(selectEnvelopeSignatureVersion('prefer-jcs', [])).toBe('legacy-v1');
    expect(selectEnvelopeSignatureVersion('prefer-jcs', [JCS_SIGNATURE_PROTOCOL])).toBe('jcs-v1');
    expect(selectEnvelopeSignatureVersion('prefer-jcs', [], 'heartbeat')).toBe('legacy-v1');
    expect(() => selectEnvelopeSignatureVersion('prefer-jcs', [], 'task-assignment')).toThrow(
      'PEER_SIGNATURE_PROTOCOL_UNSUPPORTED_FOR_MESSAGE',
    );
    expect(() => selectEnvelopeSignatureVersion('require-jcs', [])).toThrow(
      'PEER_SIGNATURE_PROTOCOL_UNSUPPORTED',
    );
  });

  it('does not downgrade a failed JCS signature to legacy bytes', async () => {
    const peer = mkPeer('alpha');
    const seen: string[] = [];
    const { deps } = withVerifier([peer], (canonical) => {
      seen.push(canonical);
      return false;
    });
    const result = await dispatchInbound(
      'a',
      {
        ...baseMsg('alpha'),
        metadata: {
          sourceNodeId: 'alpha',
          signature: 'bad',
          signatureVersion: 'jcs-v1',
        },
      },
      deps,
    );
    expect(result).toEqual({ accepted: false, reason: 'INVALID_SIGNATURE' });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain('"test":true');
  });

  it('rejects a nested payload mutation against the signed JCS bytes', async () => {
    const peer = mkPeer('alpha');
    const original: AgentMessage = {
      id: 'claim-1',
      type: 'claim-event',
      payload: { claim: { owner: 'agent-a', epoch: 3 } },
      metadata: {
        sourceNodeId: 'alpha',
        signature: 'valid',
        signatureVersion: 'jcs-v1',
      },
    };
    const { canonicalizeEnvelopeForVerify } = await import(
      '../../src/application/inbound-dispatcher.js'
    );
    const signedBytes = canonicalizeEnvelopeForVerify(original);
    const { deps, events } = withVerifier([peer], (canonical) => canonical === signedBytes);
    const tampered: AgentMessage = {
      ...original,
      payload: { claim: { owner: 'agent-b', epoch: 3 } },
    };

    const result = await dispatchInbound('a', tampered, deps);
    expect(result).toEqual({ accepted: false, reason: 'INVALID_SIGNATURE' });
    expect(events).toEqual([]);
  });

  it('can disable legacy verification after enforcement migration', async () => {
    const peer = mkPeer('alpha');
    const base = withVerifier([peer], () => true);
    const result = await dispatchInbound('a', baseMsg('alpha'), {
      ...base.deps,
      acceptedSignatureVersions: ['jcs-v1'],
    });
    expect(result).toEqual({ accepted: false, reason: 'INVALID_PAYLOAD' });
  });
});
