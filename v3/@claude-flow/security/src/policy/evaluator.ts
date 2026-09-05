import { checkCapabilityEnvelope } from './envelope.js';
import type {
  PolicyConstraints,
  PolicyDecision,
  PolicyMode,
  PolicyRequest,
  PolicyRule,
} from './types.js';

function matches(patterns: readonly string[] | undefined, value: string | undefined): boolean {
  if (!patterns?.length) return true;
  if (!value) return false;
  return patterns.some((pattern) => (
    pattern === '*'
    || pattern === value
    || (pattern.endsWith('*') && value.startsWith(pattern.slice(0, -1)))
  ));
}

function constraintsPass(request: PolicyRequest, constraints: PolicyConstraints | undefined): boolean {
  if (!constraints) return true;
  const { action } = request;
  const evidence = request.context?.evidence ?? [];
  const verifiedIds = new Set(
    request.context?.metadata?.verifiedEvidenceIds instanceof Array
      ? request.context.metadata.verifiedEvidenceIds
      : [],
  );
  const verifiedEvidence = evidence.filter((item) => item.id && verifiedIds.has(item.id));
  if (constraints.maxCostUsd !== undefined
    && (action.costUsd === undefined || action.costUsd > constraints.maxCostUsd)) return false;
  if (constraints.maxTokens !== undefined
    && (action.tokens === undefined || action.tokens > constraints.maxTokens)) return false;
  if (constraints.maxConcurrency !== undefined
    && (action.concurrency === undefined || action.concurrency > constraints.maxConcurrency)) return false;
  if (constraints.network === false && action.network === true) return false;
  if (constraints.destructive === false && action.destructive === true) return false;
  if (constraints.allowedNamespaces?.length && !matches(constraints.allowedNamespaces, action.namespace)) return false;
  // Signature verification is performed by the engine's trusted verifier.
  // A caller-authored `signed: true` flag is deliberately ignored.
  if (constraints.requireSignedEvidence && verifiedEvidence.length === 0) return false;
  if (constraints.requiredProvenance?.length) {
    const relevant = constraints.requireSignedEvidence ? verifiedEvidence : evidence;
    const available = new Set(relevant.map((item) => item.provenance));
    if (!constraints.requiredProvenance.every((type) => available.has(type))) return false;
  }
  return true;
}

export function ruleMatches(rule: PolicyRule, request: PolicyRequest): boolean {
  if (rule.enabled === false) return false;
  const { identity, action } = request;
  return matches(rule.actions, action.type)
    && matches(rule.resources, action.resource)
    && matches(rule.principals, identity.id)
    && (!rule.identityTypes?.length || rule.identityTypes.includes(identity.type))
    && (!rule.roles?.length || rule.roles.some((role) => identity.roles?.includes(role)))
    && matches(rule.environments, action.environment)
    && constraintsPass(request, rule.constraints);
}

export function evaluatePolicy(
  request: PolicyRequest,
  rules: readonly PolicyRule[],
  mode: PolicyMode,
  verifiedEvidenceIds: readonly string[] = [],
): Omit<PolicyDecision, 'receiptId'> {
  const requestId = request.requestId ?? crypto.randomUUID();
  const envelope = checkCapabilityEnvelope(
    request.action,
    request.context?.envelope,
    request.context?.now,
  );
  if (!envelope.allowed) {
    return {
      requestId,
      outcome: 'denied',
      // A capability envelope is delegated authority, not an observation-mode
      // rule. Crossing it is always blocked, including legacy installations.
      enforcedOutcome: 'denied',
      mode,
      reason: envelope.reason ?? 'capability-envelope-denied',
      matchedRules: [],
      obligations: [],
    };
  }

  const verifiedRequest: PolicyRequest = {
    ...request,
    context: {
      ...request.context,
      metadata: {
        ...request.context?.metadata,
        verifiedEvidenceIds: [...verifiedEvidenceIds],
      },
    },
  };
  const matched = rules
    .filter((rule) => ruleMatches(rule, verifiedRequest))
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.id.localeCompare(b.id));
  const deny = matched.find((rule) => rule.effect === 'deny');
  const approval = matched.find((rule) => rule.effect === 'require_approval');
  const allow = matched.find((rule) => rule.effect === 'allow');

  let outcome: PolicyDecision['outcome'];
  let reason: string;
  if (deny) {
    outcome = 'denied';
    reason = `denied-by:${deny.id}`;
  } else if (approval) {
    outcome = 'approval_required';
    reason = `approval-required-by:${approval.id}`;
  } else if (allow) {
    outcome = 'allowed';
    reason = `allowed-by:${allow.id}`;
  } else {
    outcome = mode === 'legacy' ? 'allowed' : 'denied';
    reason = mode === 'legacy' ? 'legacy-default-allow' : 'default-deny';
  }

  return {
    requestId,
    outcome,
    enforcedOutcome: mode === 'enforce' ? outcome : 'allowed',
    mode,
    reason,
    matchedRules: matched.map((rule) => rule.id),
    obligations: approval ? ['valid-human-approval'] : [],
  };
}
