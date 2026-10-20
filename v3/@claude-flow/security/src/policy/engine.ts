import { randomUUID } from 'node:crypto';
import { policyHash, signPolicyHash, verifyPolicySignature } from './canonical.js';
import { evaluatePolicy } from './evaluator.js';
import type {
  BudgetLimit,
  LedgerVerification,
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
    if (state.version !== 1 && state.version !== POLICY_STATE_VERSION) {
      throw new Error(`unsupported-policy-state-version:${String(state.version)}`);
    }
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
    if (typeof state.ledgerLength === 'number') {
      engine.state.ledgerLength = state.ledgerLength;
      engine.state.ledgerHead = state.ledgerHead ?? null;
    }
    if ((state.retainedFrom ?? 0) > 0) {
      engine.state.retainedFrom = state.retainedFrom;
      engine.state.prunedHead = state.prunedHead ?? null;
    }
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
      requestId: request.requestId ?? randomUUID(),
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

  /** Authenticate each physical record before callers deduplicate it.
   * Receipts use one configured key and key ID for this ledger. For existing
   * custom-ID history, restore the original CLAUDE_FLOW_POLICY_KEY_ID when
   * verifying; never rewrite or re-sign history to change its identity.
   * Key rotation/multi-key historical verification is not supported here. */
  verifyReceipt(receipt: unknown): string | undefined {
    if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return 'receipt-malformed';
    const r = receipt as PolicyReceipt;
    if (!r.payload || typeof r.payload !== 'object' || Array.isArray(r.payload)
      || !Number.isSafeInteger(r.payload.sequence) || r.payload.sequence < 0
      || typeof r.payload.receiptId !== 'string'
      || (r.payload.previousReceiptHash !== null && typeof r.payload.previousReceiptHash !== 'string')
      || !Number.isFinite(r.payload.issuedAt)
      || typeof r.payload.policyHash !== 'string'
      || !r.payload.request || typeof r.payload.request !== 'object' || Array.isArray(r.payload.request)
      || !r.payload.decision || typeof r.payload.decision !== 'object' || Array.isArray(r.payload.decision)
      || typeof r.hash !== 'string'
      || (r.signature !== undefined && typeof r.signature !== 'string')
      || (r.keyId !== undefined && typeof r.keyId !== 'string')) return 'receipt-malformed';
    let hash: string;
    try {
      hash = policyHash(r.payload);
      const { receiptId, ...unsignedIdPayload } = r.payload;
      if (hash !== r.hash || receiptId !== policyHash(unsignedIdPayload)) return 'receipt-hash-mismatch';
    } catch { return 'receipt-malformed'; }
    if (this.signingKey && !r.signature) return 'receipt-signature-missing';
    if (r.signature && !this.signingKey) return 'receipt-signing-key-required';
    if (r.signature && r.keyId !== (this.keyId ?? 'local')) return 'receipt-key-id-mismatch';
    if (!r.signature && r.keyId !== undefined) return 'receipt-key-id-mismatch';
    if (r.signature && this.signingKey && !verifyPolicySignature(hash, r.signature, this.signingKey)) return 'receipt-signature-invalid';
    return undefined;
  }

  /**
   * `establishAnchor` is the ONLY way to create an anchor over receipts that
   * already exist (#3602). A caller must have decided, outside the state file,
   * that this is legitimate (genesis, an authentic second anchor, or an
   * explicit operator action). Without it a ledger with receipts and no anchor
   * is `anchor-missing`, because deleting the anchor fields from the file the
   * anchor protects would otherwise let verify bless a truncated chain.
   */
  verifyLedger(options: { establishAnchor?: boolean } = {}): LedgerVerification {
    const retainedFrom = this.state.retainedFrom ?? 0;
    // #3164: pruning only ever removes a verified prefix, so the retained
    // tail's chain must start from the hash pruning recorded, not genesis.
    if (retainedFrom > 0 && this.state.prunedHead == null) {
      return { valid: false, length: retainedFrom + this.state.receipts.length, error: 'policy-ledger-prune-state-missing' };
    }
    let previous: string | null = retainedFrom > 0 ? (this.state.prunedHead ?? null) : null;
    for (let i = 0; i < this.state.receipts.length; i++) {
      const receipt = this.state.receipts[i]!;
      if (!receipt || typeof receipt !== 'object' || !receipt.payload || typeof receipt.payload !== 'object') {
        return { valid: false, length: i + retainedFrom, error: 'receipt-malformed' };
      }
      if (receipt.payload.sequence !== i + retainedFrom || receipt.payload.previousReceiptHash !== previous) {
        return { valid: false, length: i + retainedFrom, error: 'receipt-chain-mismatch' };
      }
      const error = this.verifyReceipt(receipt);
      if (error) return { valid: false, length: i + retainedFrom, error };
      previous = receipt.hash;
    }
    // The anchor's `length` means "total receipts ever issued", which stays
    // true of the hot tail plus whatever was pruned out from under it (#3164).
    const length = retainedFrom + this.state.receipts.length;
    // #3568: a prefix of a valid chain is itself a valid chain, so the chain
    // alone cannot tell "the last receipts were deleted" from "they were never
    // written". The anchor records how long the chain is and where it ends.
    if (typeof this.state.ledgerLength === 'number') {
      if (this.state.ledgerLength !== length || (this.state.ledgerHead ?? null) !== previous) {
        return {
          valid: false,
          length,
          error: length < this.state.ledgerLength ? 'policy-ledger-truncated' : 'policy-ledger-anchor-mismatch',
        };
      }
      return length === 0 ? { valid: true, length, state: 'empty' } : { valid: true, length };
    }
    if (length === 0) return { valid: true, length, state: 'empty' };
    // Receipts but no anchor: either written before anchors existed, or the
    // anchor fields were deleted (#3602). The two are indistinguishable from
    // this state alone, so never re-anchor silently.
    if (!options.establishAnchor) return { valid: false, length, error: 'anchor-missing' };
    this.state.ledgerHead = previous;
    this.state.ledgerLength = length;
    return { valid: true, length, anchor: 'established-now' };
  }

  /**
   * Removes the oldest receipts from the hot `receipts` array, keeping only
   * `retain` of the most recent ones in memory (#3164). Pure and in-memory —
   * this class stays side-effect-free; the runtime layer archives the
   * returned receipts to disk and persists the resulting state. Requires an
   * established anchor first: pruning a ledger whose historical length isn't
   * externally anchored would make a future `verifyLedger` unable to tell
   * truncation-by-attacker apart from legitimate pruning.
   */
  pruneReceipts(retain: number): PolicyReceipt[] {
    if (!Number.isInteger(retain) || retain < 0) throw new Error('invalid-prune-retention');
    if (this.state.receipts.length <= retain) return [];
    if (typeof this.state.ledgerLength !== 'number') throw new Error('policy-ledger-anchor-missing');
    const removedCount = this.state.receipts.length - retain;
    const removed = this.state.receipts.splice(0, removedCount);
    this.state.retainedFrom = (this.state.retainedFrom ?? 0) + removedCount;
    this.state.prunedHead = removed[removed.length - 1]!.hash;
    return structuredClone(removed);
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
    const retainedFrom = this.state.retainedFrom ?? 0;
    const previous = this.state.receipts.at(-1)?.hash ?? (retainedFrom > 0 ? this.state.prunedHead ?? null : null);
    const totalLength = retainedFrom + this.state.receipts.length;
    // #3602: appending to receipts that have no anchor would anchor them,
    // which is the silent re-establishment verify refuses to do.
    if (typeof this.state.ledgerLength !== 'number' && totalLength > 0) {
      throw new Error('policy-ledger-anchor-missing');
    }
    // Never extend a chain that no longer matches its anchor: appending would
    // re-anchor onto the truncated chain and erase the evidence of truncation.
    if (typeof this.state.ledgerLength === 'number'
      && (this.state.ledgerLength !== totalLength || (this.state.ledgerHead ?? null) !== previous)) {
      throw new Error(totalLength < this.state.ledgerLength
        ? 'policy-ledger-truncated'
        : 'policy-ledger-anchor-mismatch');
    }
    const sequence = totalLength;
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
    this.state.ledgerHead = hash;
    this.state.ledgerLength = retainedFrom + this.state.receipts.length;
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
