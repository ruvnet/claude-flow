import { policyHash, signPolicyHash, verifyPolicySignature } from './canonical.js';
import { evaluatePolicy } from './evaluator.js';
import type {
  BudgetLimit,
  BudgetUsage,
  PolicyApproval,
  PolicyDecision,
  PolicyEvidence,
  PolicyEngineOptions,
  PolicyReceipt,
  PolicyRequest,
  PolicyRule,
  PolicyState,
} from './types.js';
import { POLICY_STATE_VERSION } from './types.js';

function wildcard(pattern: string | undefined, value: string | undefined): boolean {
  if (!pattern) return true;
  if (!value) return false;
  return pattern === '*' || pattern === value || (pattern.endsWith('*') && value.startsWith(pattern.slice(0, -1)));
}

export class AgenticPolicyEngine {
  private readonly now: () => number;
  private readonly signingKey?: string | Buffer;
  private readonly keyId?: string;
  private readonly evidenceVerifier?: (evidence: PolicyEvidence, request: PolicyRequest) => boolean;
  private readonly approvalIssuerVerifier?: (issuer: string) => boolean;
  private state: PolicyState;

  constructor(options: PolicyEngineOptions = {}) {
    this.now = options.now ?? Date.now;
    this.signingKey = options.signingKey;
    this.keyId = options.keyId;
    this.evidenceVerifier = options.evidenceVerifier;
    this.approvalIssuerVerifier = options.approvalIssuerVerifier;
    this.state = {
      version: POLICY_STATE_VERSION,
      mode: options.mode ?? 'legacy',
      rules: [...(options.rules ?? [])],
      budgets: [...(options.budgets ?? [])],
      usage: [...(options.usage ?? [])],
      approvals: [...(options.approvals ?? [])],
      receipts: [...(options.receipts ?? [])],
    };
  }

  static fromState(state: PolicyState, options: Omit<PolicyEngineOptions, 'mode' | 'rules' | 'budgets' | 'usage' | 'approvals' | 'receipts'> = {}): AgenticPolicyEngine {
    const engine = new AgenticPolicyEngine({
      ...options,
      mode: state.mode,
      rules: state.rules,
      budgets: state.budgets,
      usage: state.usage,
      approvals: state.approvals,
      receipts: state.receipts,
    });
    engine.state.migratedAt = state.migratedAt;
    engine.state.migratedFrom = state.migratedFrom;
    engine.state.configuredMode = state.configuredMode;
    return engine;
  }

  exportState(): PolicyState {
    return structuredClone(this.state);
  }

  setMode(mode: PolicyState['mode']): void {
    this.state.mode = mode;
  }

  setConfiguredMode(mode: PolicyState['mode']): void {
    this.state.configuredMode = mode;
    const rank = { legacy: 0, observe: 1, enforce: 2 } as const;
    if (rank[mode] > rank[this.state.mode]) this.state.mode = mode;
  }

  upsertRule(rule: PolicyRule): void {
    if (!rule.id || !rule.actions.length) throw new Error('invalid-policy-rule');
    for (const value of [
      rule.constraints?.maxCostUsd,
      rule.constraints?.maxTokens,
      rule.constraints?.maxConcurrency,
    ]) {
      if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
        throw new Error('invalid-policy-rule-limit');
      }
    }
    const index = this.state.rules.findIndex((item) => item.id === rule.id);
    if (index >= 0) this.state.rules[index] = structuredClone(rule);
    else this.state.rules.push(structuredClone(rule));
  }

  setBudget(limit: BudgetLimit): void {
    if (limit.periodMs <= 0) throw new Error('invalid-budget-period');
    if (!Number.isFinite(limit.periodMs)
      || [limit.maxCostUsd, limit.maxTokens].some((value) => (
        value !== undefined && (!Number.isFinite(value) || value < 0)
      ))) throw new Error('invalid-budget-limit');
    const index = this.state.budgets.findIndex((item) => item.id === limit.id);
    if (index >= 0) this.state.budgets[index] = structuredClone(limit);
    else this.state.budgets.push(structuredClone(limit));
  }

  issueApproval(approval: Omit<PolicyApproval, 'uses' | 'issuedAt'> & { uses?: number; issuedAt?: number }): PolicyApproval {
    if (approval.issuedBy === approval.principal) throw new Error('self-approval-forbidden');
    if (this.approvalIssuerVerifier?.(approval.issuedBy) !== true) {
      throw new Error('untrusted-approval-issuer');
    }
    const issuedAt = approval.issuedAt ?? this.now();
    const record: PolicyApproval = { ...approval, issuedAt, uses: approval.uses ?? 0 };
    if (this.state.approvals.some((item) => item.id === record.id)) throw new Error('duplicate-approval-id');
    if (!record.id
      || record.expiresAt <= issuedAt
      || !Number.isInteger(record.maxUses)
      || record.maxUses <= 0
      || !Number.isInteger(record.uses)
      || record.uses < 0
      || record.uses > record.maxUses) throw new Error('invalid-approval');
    this.state.approvals.push(record);
    return structuredClone(record);
  }

  revokeApproval(id: string): boolean {
    const approval = this.state.approvals.find((item) => item.id === id);
    if (!approval || approval.revokedAt) return false;
    approval.revokedAt = this.now();
    return true;
  }

  evaluate(request: PolicyRequest): PolicyDecision {
    const normalized: PolicyRequest = {
      ...request,
      requestId: request.requestId ?? crypto.randomUUID(),
      // Caller time is evidence only; expiry, budgets, and receipts always use
      // the authority's clock.
      context: { ...request.context, now: this.now() },
    };
    this.validateRequest(normalized);
    const verifiedEvidenceIds = (normalized.context?.evidence ?? [])
      .filter((evidence) => evidence.id && this.evidenceVerifier?.(evidence, normalized) === true)
      .map((evidence) => evidence.id!);
    let decision = evaluatePolicy(normalized, this.state.rules, this.state.mode, verifiedEvidenceIds);
    decision = this.applyBudget(normalized, decision);
    decision = this.applyApproval(normalized, decision);
    const receipt = this.appendReceipt(normalized, decision);
    this.consumeBudget(normalized, decision);
    return { ...decision, receiptId: receipt.payload.receiptId };
  }

  verifyLedger(): { valid: boolean; length: number; error?: string } {
    let previous: string | null = null;
    for (let i = 0; i < this.state.receipts.length; i++) {
      const receipt = this.state.receipts[i]!;
      if (receipt.payload.sequence !== i || receipt.payload.previousReceiptHash !== previous) {
        return { valid: false, length: i, error: 'receipt-chain-mismatch' };
      }
      const hash = policyHash(receipt.payload);
      const { receiptId, ...unsignedIdPayload } = receipt.payload;
      if (hash !== receipt.hash || receiptId !== policyHash(unsignedIdPayload)) {
        return { valid: false, length: i, error: 'receipt-hash-mismatch' };
      }
      if (this.signingKey && !receipt.signature) {
        return { valid: false, length: i, error: 'receipt-signature-missing' };
      }
      if (receipt.signature && !this.signingKey) {
        return { valid: false, length: i, error: 'receipt-signing-key-required' };
      }
      if (receipt.signature && this.signingKey && !verifyPolicySignature(hash, receipt.signature, this.signingKey)) {
        return { valid: false, length: i, error: 'receipt-signature-invalid' };
      }
      previous = receipt.hash;
    }
    return { valid: true, length: this.state.receipts.length };
  }

  private applyBudget(request: PolicyRequest, decision: Omit<PolicyDecision, 'receiptId'>): Omit<PolicyDecision, 'receiptId'> {
    if (decision.outcome === 'denied') return decision;
    const now = request.context?.now ?? this.now();
    for (const limit of this.state.budgets) {
      if (!wildcard(limit.principal, request.identity.id)
        || !wildcard(limit.action, request.action.type)
        || !wildcard(limit.resource, request.action.resource)) continue;
      let usage = this.state.usage.find((item) => item.limitId === limit.id);
      if (!usage || now - usage.windowStartedAt >= limit.periodMs) {
        usage = { limitId: limit.id, windowStartedAt: now, costUsd: 0, tokens: 0 };
      }
      if (limit.maxCostUsd !== undefined && usage.costUsd + (request.action.costUsd ?? 0) > limit.maxCostUsd) {
        return { ...decision, outcome: 'denied', enforcedOutcome: this.state.mode === 'enforce' ? 'denied' : 'allowed', reason: `budget-exceeded:${limit.id}` };
      }
      if (limit.maxCostUsd !== undefined && request.action.costUsd === undefined) {
        return { ...decision, outcome: 'denied', enforcedOutcome: this.state.mode === 'enforce' ? 'denied' : 'allowed', reason: `budget-metering-required:${limit.id}:costUsd` };
      }
      if (limit.maxTokens !== undefined && request.action.tokens === undefined) {
        return { ...decision, outcome: 'denied', enforcedOutcome: this.state.mode === 'enforce' ? 'denied' : 'allowed', reason: `budget-metering-required:${limit.id}:tokens` };
      }
      if (limit.maxTokens !== undefined && usage.tokens + (request.action.tokens ?? 0) > limit.maxTokens) {
        return { ...decision, outcome: 'denied', enforcedOutcome: this.state.mode === 'enforce' ? 'denied' : 'allowed', reason: `budget-exceeded:${limit.id}` };
      }
    }
    return decision;
  }

  private applyApproval(request: PolicyRequest, decision: Omit<PolicyDecision, 'receiptId'>): Omit<PolicyDecision, 'receiptId'> {
    if (decision.outcome !== 'approval_required') return decision;
    const now = request.context?.now ?? this.now();
    const ids = new Set(request.context?.approvalIds ?? []);
    const approval = this.state.approvals.find((item) => (
      ids.has(item.id)
      && !item.revokedAt
      && item.expiresAt > now
      && item.uses < item.maxUses
      && wildcard(item.principal, request.identity.id)
      && item.actions.some((action) => wildcard(action, request.action.type))
      && (!item.resources?.length || item.resources.some((resource) => wildcard(resource, request.action.resource)))
    ));
    if (!approval) return decision;
    approval.uses += 1;
    return {
      ...decision,
      outcome: 'allowed',
      enforcedOutcome: 'allowed',
      reason: `approved-by:${approval.id}`,
      approvalId: approval.id,
      obligations: [],
    };
  }

  private consumeBudget(request: PolicyRequest, decision: Omit<PolicyDecision, 'receiptId'>): void {
    if (decision.enforcedOutcome !== 'allowed') return;
    const now = request.context?.now ?? this.now();
    for (const limit of this.state.budgets) {
      if (!wildcard(limit.principal, request.identity.id)
        || !wildcard(limit.action, request.action.type)
        || !wildcard(limit.resource, request.action.resource)) continue;
      let usage = this.state.usage.find((item) => item.limitId === limit.id);
      if (!usage || now - usage.windowStartedAt >= limit.periodMs) {
        usage = { limitId: limit.id, windowStartedAt: now, costUsd: 0, tokens: 0 };
        this.state.usage = this.state.usage.filter((item) => item.limitId !== limit.id);
        this.state.usage.push(usage);
      }
      usage.costUsd += request.action.costUsd ?? 0;
      usage.tokens += request.action.tokens ?? 0;
    }
  }

  private appendReceipt(request: PolicyRequest, decision: Omit<PolicyDecision, 'receiptId'>): PolicyReceipt {
    const previous = this.state.receipts.at(-1)?.hash ?? null;
    const sequence = this.state.receipts.length;
    const payloadWithoutId = {
      previousReceiptHash: previous,
      sequence,
      issuedAt: request.context?.now ?? this.now(),
      request,
      decision,
      policyHash: policyHash({ mode: this.state.mode, rules: this.state.rules, budgets: this.state.budgets }),
    };
    const receiptId = policyHash(payloadWithoutId);
    const payload = { receiptId, ...payloadWithoutId };
    const hash = policyHash(payload);
    const receipt: PolicyReceipt = {
      payload,
      hash,
      signature: this.signingKey ? signPolicyHash(hash, this.signingKey) : undefined,
      keyId: this.signingKey ? (this.keyId ?? 'local') : undefined,
    };
    this.state.receipts.push(receipt);
    return receipt;
  }

  private validateRequest(request: PolicyRequest): void {
    if (!request.identity?.id || !request.identity.type || !request.action?.type) {
      throw new Error('invalid-policy-request');
    }
    for (const [name, value] of [
      ['costUsd', request.action.costUsd],
      ['tokens', request.action.tokens],
      ['concurrency', request.action.concurrency],
    ] as const) {
      if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
        throw new Error(`invalid-policy-action-${name}`);
      }
    }
  }
}

export function createLegacyCompatibleState(source = 'pre-ADR-324'): PolicyState {
  return {
    version: POLICY_STATE_VERSION,
    mode: 'legacy',
    migratedFrom: source,
    migratedAt: Date.now(),
    rules: [],
    budgets: [],
    usage: [],
    approvals: [],
    receipts: [],
  };
}
