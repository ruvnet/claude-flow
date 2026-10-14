import { describe, expect, it } from 'vitest';
import {
  AgenticPolicyEngine,
  checkCapabilityEnvelope,
  createLegacyCompatibleState,
  delegateEnvelope,
  isEnvelopeReduction,
  type PolicyRequest,
  type PolicyRule,
} from '../src/policy/index.js';

const request = (overrides: Partial<PolicyRequest> = {}): PolicyRequest => ({
  identity: { id: 'agent:coder', type: 'agent', roles: ['developer'] },
  action: { type: 'code.write', resource: 'src/app.ts', environment: 'development' },
  ...overrides,
});

describe('AgenticPolicyEngine', () => {
  it('preserves existing installations in legacy mode', () => {
    const engine = AgenticPolicyEngine.fromState(createLegacyCompatibleState());
    const decision = engine.evaluate(request());
    expect(decision.outcome).toBe('allowed');
    expect(decision.enforcedOutcome).toBe('allowed');
    expect(decision.reason).toBe('legacy-default-allow');
  });

  it('observes default deny without breaking the action', () => {
    const engine = new AgenticPolicyEngine({ mode: 'observe' });
    const decision = engine.evaluate(request());
    expect(decision.outcome).toBe('denied');
    expect(decision.enforcedOutcome).toBe('allowed');
  });

  it('enforces default deny and deny-overrides', () => {
    const rules: PolicyRule[] = [
      { id: 'allow-code', effect: 'allow', actions: ['code.*'] },
      { id: 'deny-production', effect: 'deny', actions: ['code.write'], environments: ['production'], priority: 10 },
    ];
    const engine = new AgenticPolicyEngine({ mode: 'enforce', rules });
    expect(engine.evaluate(request()).enforcedOutcome).toBe('allowed');
    expect(engine.evaluate(request({
      action: { type: 'code.write', resource: 'src/app.ts', environment: 'production' },
    })).enforcedOutcome).toBe('denied');
  });

  it('requires signed tool evidence when a rule asks for it', () => {
    const engine = new AgenticPolicyEngine({
      mode: 'enforce',
      evidenceVerifier: (evidence) => evidence.signature === 'valid-test-signature',
      rules: [{
        id: 'verified-deploy',
        effect: 'allow',
        actions: ['deployment.promote'],
        constraints: { requireSignedEvidence: true, requiredProvenance: ['tool_result'] },
      }],
    });
    const base = request({ action: { type: 'deployment.promote', environment: 'production' } });
    expect(engine.evaluate(base).enforcedOutcome).toBe('denied');
    expect(engine.evaluate({
      ...base,
      context: { evidence: [{
        id: 'evidence-1',
        provenance: 'tool_result',
        signed: true,
        signature: 'valid-test-signature',
      }] },
    }).enforcedOutcome).toBe('allowed');
    expect(engine.evaluate({
      ...base,
      context: { evidence: [{ id: 'fake', provenance: 'tool_result', signed: true }] },
    }).enforcedOutcome).toBe('denied');
    expect(engine.evaluate({
      ...base,
      context: {
        evidence: [
          { id: 'verified-wrong-type', provenance: 'user_claim', signature: 'valid-test-signature' },
          { id: 'unsigned-right-type', provenance: 'tool_result' },
        ],
      },
    }).enforcedOutcome).toBe('denied');
  });

  it('requires a scoped human approval and forbids self approval', () => {
    const engine = new AgenticPolicyEngine({
      mode: 'enforce',
      now: () => 1_000,
      approvalIssuerVerifier: (issuer) => issuer === 'user:release-manager',
      rules: [{ id: 'prod-approval', effect: 'require_approval', actions: ['deployment.promote'] }],
    });
    expect(() => engine.issueApproval({
      id: 'self',
      principal: 'agent:coder',
      actions: ['deployment.promote'],
      issuedBy: 'agent:coder',
      expiresAt: 2_000,
      maxUses: 2,
    })).toThrow('self-approval-forbidden');
    engine.issueApproval({
      id: 'human-1',
      principal: 'agent:coder',
      actions: ['deployment.promote'],
      issuedBy: 'user:release-manager',
      expiresAt: 2_000,
      maxUses: 1,
    });
    const deploy = request({
      action: { type: 'deployment.promote', resource: 'prod' },
      context: { approvalIds: ['human-1'], now: 1_100 },
    });
    expect(engine.evaluate(deploy).reason).toBe('approved-by:human-1');
    expect(engine.evaluate(deploy).enforcedOutcome).toBe('approval_required');
  });

  it('uses authority time and rejects ambiguous approval accounting', () => {
    let authorityNow = 2_000;
    const engine = new AgenticPolicyEngine({
      mode: 'enforce',
      now: () => authorityNow,
      approvalIssuerVerifier: () => true,
      rules: [{ id: 'approval', effect: 'require_approval', actions: ['deploy'] }],
    });
    engine.issueApproval({
      id: 'approval-1',
      principal: 'agent:coder',
      actions: ['deploy'],
      issuedBy: 'user:admin',
      issuedAt: 1_000,
      expiresAt: 3_000,
      maxUses: 1,
    });
    expect(() => engine.issueApproval({
      id: 'approval-1',
      principal: 'agent:coder',
      actions: ['deploy'],
      issuedBy: 'user:admin',
      issuedAt: 1_000,
      expiresAt: 3_000,
      maxUses: 1,
    })).toThrow('duplicate-approval-id');
    expect(() => engine.issueApproval({
      id: 'bad-uses',
      principal: 'agent:coder',
      actions: ['deploy'],
      issuedBy: 'user:admin',
      issuedAt: 1_000,
      expiresAt: 3_000,
      maxUses: 1,
      uses: -1,
    })).toThrow('invalid-approval');
    expect(engine.evaluate(request({
      action: { type: 'deploy' },
      context: { approvalIds: ['approval-1'], now: 0 },
    })).enforcedOutcome).toBe('allowed');
    authorityNow = 4_000;
    expect(engine.evaluate(request({
      action: { type: 'deploy' },
      context: { approvalIds: ['approval-1'], now: 0 },
    })).enforcedOutcome).toBe('approval_required');
  });

  it('atomically accounts budget usage', () => {
    const engine = new AgenticPolicyEngine({
      mode: 'enforce',
      now: () => 10,
      rules: [{ id: 'allow-model', effect: 'allow', actions: ['model.call'] }],
      budgets: [{ id: 'daily', principal: 'agent:*', action: 'model.call', maxCostUsd: 1, periodMs: 86_400_000 }],
    });
    const call = request({
      action: { type: 'model.call', resource: 'openrouter', costUsd: 0.6 },
    });
    expect(engine.evaluate(call).enforcedOutcome).toBe('allowed');
    expect(engine.evaluate(call).reason).toBe('budget-exceeded:daily');
  });

  it('creates and verifies a tamper-evident receipt chain', () => {
    const engine = new AgenticPolicyEngine({ mode: 'legacy', signingKey: 'test-secret' });
    engine.evaluate(request());
    engine.evaluate(request({ action: { type: 'code.read', resource: 'README.md' } }));
    expect(engine.verifyLedger()).toEqual({ valid: true, length: 2 });

    const state = engine.exportState();
    state.receipts[0]!.payload.decision.reason = 'tampered';
    const tampered = AgenticPolicyEngine.fromState(state, { signingKey: 'test-secret' });
    expect(tampered.verifyLedger().valid).toBe(false);
  });

  it('requires configured receipt authentication in both directions', () => {
    const signed = new AgenticPolicyEngine({ mode: 'legacy', signingKey: 'test-secret' });
    signed.evaluate(request());
    const strippedState = signed.exportState();
    delete strippedState.receipts[0]!.signature;
    expect(AgenticPolicyEngine.fromState(strippedState, { signingKey: 'test-secret' }).verifyLedger().error)
      .toBe('receipt-signature-missing');

    const signedState = signed.exportState();
    expect(AgenticPolicyEngine.fromState(signedState).verifyLedger().error)
      .toBe('receipt-signing-key-required');
  });

  it('rejects negative and non-finite resource accounting', () => {
    const engine = new AgenticPolicyEngine({ mode: 'legacy' });
    expect(() => engine.evaluate(request({
      action: { type: 'model.call', costUsd: -1 },
    }))).toThrow('invalid-policy-action-costUsd');
    expect(() => engine.evaluate(request({
      action: { type: 'model.call', tokens: Number.POSITIVE_INFINITY },
    }))).toThrow('invalid-policy-action-tokens');
  });

  it('prunes receipts below the retain count, keeping full historical length (#3164)', () => {
    const engine = new AgenticPolicyEngine({ mode: 'legacy' });
    for (let i = 0; i < 5; i++) engine.evaluate(request({ action: { type: 'code.read', resource: `f${i}.ts` } }));
    expect(engine.verifyLedger()).toEqual({ valid: true, length: 5 });

    const removed = engine.pruneReceipts(2);
    expect(removed).toHaveLength(3);
    expect(removed.map((r) => r.payload.sequence)).toEqual([0, 1, 2]);

    const state = engine.exportState();
    expect(state.receipts).toHaveLength(2);
    expect(state.retainedFrom).toBe(3);
    expect(state.prunedHead).toBe(removed[2]!.hash);
    expect((state.retainedFrom ?? 0) + state.receipts.length).toBe(state.ledgerLength);

    const verification = engine.verifyLedger();
    expect(verification).toEqual({ valid: true, length: 5 });
  });

  it('is a no-op when retain is at or above the current receipt count', () => {
    const engine = new AgenticPolicyEngine({ mode: 'legacy' });
    engine.evaluate(request());
    engine.evaluate(request({ action: { type: 'code.read', resource: 'b.ts' } }));
    expect(engine.pruneReceipts(5)).toEqual([]);
    expect(engine.pruneReceipts(2)).toEqual([]);
    expect(engine.exportState().receipts).toHaveLength(2);
    expect(engine.exportState().retainedFrom).toBeUndefined();
  });

  it('rejects an invalid retain count', () => {
    const engine = new AgenticPolicyEngine({ mode: 'legacy' });
    engine.evaluate(request());
    expect(() => engine.pruneReceipts(-1)).toThrow('invalid-prune-retention');
    expect(() => engine.pruneReceipts(1.5)).toThrow('invalid-prune-retention');
  });

  it('refuses to prune a ledger with no established anchor', () => {
    const engine = new AgenticPolicyEngine({ mode: 'legacy' });
    engine.evaluate(request());
    const unanchored = AgenticPolicyEngine.fromState({ ...engine.exportState(), ledgerLength: undefined, ledgerHead: undefined });
    expect(() => unanchored.pruneReceipts(0)).toThrow('policy-ledger-anchor-missing');
  });

  it('continues the chain and sequence numbers correctly after pruning', () => {
    const engine = new AgenticPolicyEngine({ mode: 'legacy', signingKey: 'test-secret' });
    for (let i = 0; i < 4; i++) engine.evaluate(request({ action: { type: 'code.read', resource: `f${i}.ts` } }));
    engine.pruneReceipts(1);
    engine.evaluate(request({ action: { type: 'code.read', resource: 'f4.ts' } }));
    const state = engine.exportState();
    expect(state.receipts.map((r) => r.payload.sequence)).toEqual([3, 4]);
    expect(state.ledgerLength).toBe(5);
    expect(engine.verifyLedger()).toEqual({ valid: true, length: 5 });
  });

  it('still detects hash and sequence tampering in the retained tail after pruning', () => {
    const engine = new AgenticPolicyEngine({ mode: 'legacy' });
    for (let i = 0; i < 5; i++) engine.evaluate(request({ action: { type: 'code.read', resource: `f${i}.ts` } }));
    engine.pruneReceipts(2);
    const tamperedState = engine.exportState();
    tamperedState.receipts[0]!.payload.decision.reason = 'tampered';
    const tampered = AgenticPolicyEngine.fromState(tamperedState);
    const result = tampered.verifyLedger();
    expect(result.valid).toBe(false);
    expect(result.error).toBe('receipt-hash-mismatch');
    // length reflects position within the FULL historical ledger, not the hot array
    expect(result.length).toBe(3);
  });

  it('fails closed when retainedFrom is set but prunedHead is missing', () => {
    const engine = new AgenticPolicyEngine({ mode: 'legacy' });
    for (let i = 0; i < 3; i++) engine.evaluate(request({ action: { type: 'code.read', resource: `f${i}.ts` } }));
    engine.pruneReceipts(1);
    const corrupted = engine.exportState();
    delete corrupted.prunedHead;
    const reloaded = AgenticPolicyEngine.fromState(corrupted);
    expect(reloaded.verifyLedger().error).toBe('policy-ledger-prune-state-missing');
  });

  it('fails closed when a constrained action omits required metering', () => {
    const engine = new AgenticPolicyEngine({
      mode: 'enforce',
      rules: [{
        id: 'bounded-model',
        effect: 'allow',
        actions: ['model.call'],
        constraints: { maxCostUsd: 1, maxTokens: 1_000, maxConcurrency: 1 },
      }],
    });
    expect(engine.evaluate(request({ action: { type: 'model.call' } })).enforcedOutcome).toBe('denied');
    expect(engine.evaluate(request({
      action: { type: 'model.call', costUsd: 0.5, tokens: 500, concurrency: 1 },
    })).enforcedOutcome).toBe('allowed');
  });
});

describe('CapabilityEnvelope', () => {
  const parent = {
    actions: ['code.*'],
    resources: ['src/*'],
    tools: ['exec_command', 'apply_patch'],
    maxCostUsd: 10,
    maxConcurrency: 4,
    network: false,
    destructive: false,
    delegationDepth: 2,
    expiresAt: 2_000,
  };

  it('allows only monotonic reductions', () => {
    const child = delegateEnvelope(parent, {
      actions: ['code.write'],
      resources: ['src/app.ts'],
      tools: ['apply_patch'],
      maxCostUsd: 2,
      maxConcurrency: 2,
      network: false,
      destructive: false,
    });
    expect(isEnvelopeReduction(parent, child)).toBe(true);
    expect(child.delegationDepth).toBe(1);
    expect(() => delegateEnvelope(parent, { tools: ['github_push'] })).toThrow('capability-envelope-cannot-grow');
    const inherited = delegateEnvelope(parent, {});
    expect(inherited.actions).toEqual(parent.actions);
    expect(inherited.tools).toEqual(parent.tools);
    expect(inherited.maxCostUsd).toBe(parent.maxCostUsd);
    expect(checkCapabilityEnvelope({
      type: 'deployment.promote',
      tool: 'github_push',
    }, inherited, 1_000).allowed).toBe(false);
  });

  it('blocks actions outside the envelope before execution', () => {
    expect(checkCapabilityEnvelope({
      type: 'code.write',
      resource: 'src/app.ts',
      tool: 'apply_patch',
      concurrency: 2,
      costUsd: 0,
    }, parent, 1_000).allowed).toBe(true);
    expect(checkCapabilityEnvelope({
      type: 'code.write',
      resource: 'src/app.ts',
      tool: 'apply_patch',
      network: true,
      costUsd: 0,
      concurrency: 1,
    }, parent, 1_000)).toEqual({ allowed: false, reason: 'network-outside-envelope' });
  });

  it('enforces delegated envelope boundaries even in legacy mode', () => {
    const engine = new AgenticPolicyEngine({ mode: 'legacy', now: () => 1_000 });
    const decision = engine.evaluate(request({
      action: { type: 'code.write', resource: 'src/app.ts', tool: 'apply_patch', network: true, costUsd: 0, concurrency: 1 },
      context: { envelope: parent },
    }));
    expect(decision.outcome).toBe('denied');
    expect(decision.enforcedOutcome).toBe('denied');
    expect(decision.reason).toBe('network-outside-envelope');
  });
});


it('creates request IDs without the optional global WebCrypto API (Node 18)', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  try {
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
    const engine = new AgenticPolicyEngine({ mode: 'legacy' });
    engine.evaluate({ identity: { id: 'node18-agent', type: 'agent' }, action: { type: 'code.read' } });
    expect(engine.exportState().receipts[0].payload.request.requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor);
    else Reflect.deleteProperty(globalThis, 'crypto');
  }
});
