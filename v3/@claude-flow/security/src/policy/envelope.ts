import type { CapabilityEnvelope, PolicyAction } from './types.js';

export interface EnvelopeCheck {
  allowed: boolean;
  reason?: string;
}

function matches(patterns: readonly string[] | undefined, value: string | undefined): boolean {
  if (!patterns?.length) return true;
  if (!value) return false;
  return patterns.some((pattern) => (
    pattern === '*'
    || pattern === value
    || (pattern.endsWith('*') && value.startsWith(pattern.slice(0, -1)))
  ));
}

function subset(child: readonly string[] | undefined, parent: readonly string[] | undefined): boolean {
  if (!parent?.length) return true;
  if (!child?.length) return false;
  return child.every((value) => matches(parent, value));
}

export function checkCapabilityEnvelope(
  action: PolicyAction,
  envelope: CapabilityEnvelope | undefined,
  now = Date.now(),
): EnvelopeCheck {
  if (!envelope) return { allowed: true };
  if (envelope.expiresAt !== undefined && envelope.expiresAt <= now) {
    return { allowed: false, reason: 'capability-envelope-expired' };
  }
  const checks: Array<[boolean, string]> = [
    [matches(envelope.actions, action.type), 'action-outside-envelope'],
    [matches(envelope.resources, action.resource), 'resource-outside-envelope'],
    [matches(envelope.tools, action.tool), 'tool-outside-envelope'],
    [matches(envelope.servers, action.server), 'server-outside-envelope'],
    [matches(envelope.environments, action.environment), 'environment-outside-envelope'],
  ];
  if (action.namespace) {
    const namespaces = action.type.includes('read')
      ? envelope.readNamespaces
      : envelope.writeNamespaces;
    checks.push([matches(namespaces, action.namespace), 'namespace-outside-envelope']);
  }
  if (action.costUsd !== undefined && envelope.maxCostUsd !== undefined) {
    checks.push([action.costUsd <= envelope.maxCostUsd, 'cost-outside-envelope']);
  }
  if (action.tokens !== undefined && envelope.maxTokens !== undefined) {
    checks.push([action.tokens <= envelope.maxTokens, 'tokens-outside-envelope']);
  }
  if (action.concurrency !== undefined && envelope.maxConcurrency !== undefined) {
    checks.push([action.concurrency <= envelope.maxConcurrency, 'concurrency-outside-envelope']);
  }
  if (action.network === true) checks.push([envelope.network === true, 'network-outside-envelope']);
  if (action.destructive === true) checks.push([envelope.destructive === true, 'destructive-outside-envelope']);
  const failed = checks.find(([allowed]) => !allowed);
  return failed ? { allowed: false, reason: failed[1] } : { allowed: true };
}

export function isEnvelopeReduction(parent: CapabilityEnvelope, child: CapabilityEnvelope): boolean {
  const listChecks = [
    subset(child.actions, parent.actions),
    subset(child.resources, parent.resources),
    subset(child.tools, parent.tools),
    subset(child.servers, parent.servers),
    subset(child.readNamespaces, parent.readNamespaces),
    subset(child.writeNamespaces, parent.writeNamespaces),
    subset(child.environments, parent.environments),
  ];
  const numericChecks: Array<[number | undefined, number | undefined]> = [
    [child.maxCostUsd, parent.maxCostUsd],
    [child.maxTokens, parent.maxTokens],
    [child.maxConcurrency, parent.maxConcurrency],
    [child.delegationDepth, parent.delegationDepth],
    [child.expiresAt, parent.expiresAt],
  ];
  return listChecks.every(Boolean)
    && numericChecks.every(([next, current]) => (
      current === undefined
        ? true
        : next !== undefined && next <= current
    ))
    && !(child.network === true && parent.network !== true)
    && !(child.destructive === true && parent.destructive !== true);
}

export function delegateEnvelope(
  parent: CapabilityEnvelope,
  child: CapabilityEnvelope,
): CapabilityEnvelope {
  if ((parent.delegationDepth ?? 0) <= 0) {
    throw new Error('delegation-depth-exhausted');
  }
  const reduced = {
    ...parent,
    ...child,
    delegationDepth: Math.min(
      child.delegationDepth ?? Number.MAX_SAFE_INTEGER,
      (parent.delegationDepth ?? 0) - 1,
    ),
    expiresAt: Math.min(
      child.expiresAt ?? Number.MAX_SAFE_INTEGER,
      parent.expiresAt ?? Number.MAX_SAFE_INTEGER,
    ),
  };
  if (!isEnvelopeReduction(parent, reduced)) throw new Error('capability-envelope-cannot-grow');
  return reduced;
}
