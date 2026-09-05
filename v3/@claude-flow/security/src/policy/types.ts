export const POLICY_STATE_VERSION = 1;

export type PolicyMode = 'legacy' | 'observe' | 'enforce';
export type PolicyEffect = 'allow' | 'deny' | 'require_approval';
export type PolicyOutcome = 'allowed' | 'denied' | 'approval_required';
export type ProvenanceType =
  | 'user_claim'
  | 'agent_output'
  | 'system_observation'
  | 'tool_result'
  | 'unknown';

export interface PolicyIdentity {
  id: string;
  type: 'user' | 'agent' | 'service' | 'plugin' | 'legacy';
  roles?: string[];
  tenantId?: string;
  parentId?: string;
}

export interface PolicyEvidence {
  id?: string;
  provenance: ProvenanceType;
  /** Legacy transport hint. Never sufficient for requireSignedEvidence. */
  signed?: boolean;
  attestor?: string;
  observedAt?: number;
  contentHash?: string;
  signature?: string;
  keyId?: string;
}

export interface PolicyAction {
  type: string;
  resource?: string;
  tool?: string;
  server?: string;
  namespace?: string;
  environment?: string;
  costUsd?: number;
  tokens?: number;
  concurrency?: number;
  network?: boolean;
  destructive?: boolean;
}

export interface CapabilityEnvelope {
  actions?: string[];
  resources?: string[];
  tools?: string[];
  servers?: string[];
  readNamespaces?: string[];
  writeNamespaces?: string[];
  environments?: string[];
  maxCostUsd?: number;
  maxTokens?: number;
  maxConcurrency?: number;
  network?: boolean;
  destructive?: boolean;
  delegationDepth?: number;
  expiresAt?: number;
}

export interface PolicyContext {
  now?: number;
  evidence?: PolicyEvidence[];
  envelope?: CapabilityEnvelope;
  approvalIds?: string[];
  metadata?: Record<string, unknown>;
}

export interface PolicyRequest {
  requestId?: string;
  identity: PolicyIdentity;
  action: PolicyAction;
  context?: PolicyContext;
}

export interface PolicyConstraints {
  maxCostUsd?: number;
  maxTokens?: number;
  maxConcurrency?: number;
  network?: boolean;
  destructive?: boolean;
  requireSignedEvidence?: boolean;
  requiredProvenance?: ProvenanceType[];
  allowedNamespaces?: string[];
}

export interface PolicyRule {
  id: string;
  description?: string;
  enabled?: boolean;
  priority?: number;
  effect: PolicyEffect;
  actions: string[];
  resources?: string[];
  principals?: string[];
  identityTypes?: PolicyIdentity['type'][];
  roles?: string[];
  environments?: string[];
  constraints?: PolicyConstraints;
  approvalTtlMs?: number;
}

export interface BudgetLimit {
  id: string;
  principal?: string;
  action?: string;
  resource?: string;
  maxCostUsd?: number;
  maxTokens?: number;
  periodMs: number;
}

export interface BudgetUsage {
  limitId: string;
  windowStartedAt: number;
  costUsd: number;
  tokens: number;
}

export interface PolicyApproval {
  id: string;
  principal: string;
  actions: string[];
  resources?: string[];
  issuedBy: string;
  issuedAt: number;
  expiresAt: number;
  maxUses: number;
  uses: number;
  revokedAt?: number;
}

export interface PolicyDecision {
  requestId: string;
  outcome: PolicyOutcome;
  enforcedOutcome: PolicyOutcome;
  mode: PolicyMode;
  reason: string;
  matchedRules: string[];
  obligations: string[];
  approvalId?: string;
  receiptId?: string;
}

export interface PolicyReceiptPayload {
  receiptId: string;
  previousReceiptHash: string | null;
  sequence: number;
  issuedAt: number;
  request: PolicyRequest;
  decision: Omit<PolicyDecision, 'receiptId'>;
  policyHash: string;
}

export interface PolicyReceipt {
  payload: PolicyReceiptPayload;
  hash: string;
  signature?: string;
  keyId?: string;
}

export interface PolicyState {
  version: number;
  mode: PolicyMode;
  migratedFrom?: string;
  migratedAt?: number;
  configuredMode?: PolicyMode;
  rules: PolicyRule[];
  budgets: BudgetLimit[];
  usage: BudgetUsage[];
  approvals: PolicyApproval[];
  receipts: PolicyReceipt[];
}

export interface PolicyEngineOptions {
  mode?: PolicyMode;
  rules?: PolicyRule[];
  budgets?: BudgetLimit[];
  usage?: BudgetUsage[];
  approvals?: PolicyApproval[];
  receipts?: PolicyReceipt[];
  signingKey?: string | Buffer;
  keyId?: string;
  now?: () => number;
  evidenceVerifier?: (evidence: PolicyEvidence, request: PolicyRequest) => boolean;
  approvalIssuerVerifier?: (issuer: string) => boolean;
}
