/**
 * Domain-affinity routing policy — ADR-164 §3.4.
 *
 * Surfaces a deterministic routing decision for `@metaharness/router` to use
 * before its KRR cost-optimal step. The policy is intentionally tiny —
 * three branches over `preferLocalExecution` and `budgetUsdMonthly` — so the
 * decision is auditable from the pod template alone, no learned-weight side
 * effects.
 *
 * Rules (per the Phase-3 brief):
 *   1. `preferLocalExecution === true`                                  → 'local-stdio'
 *   2. `preferLocalExecution === false` AND `budgetUsdMonthly >= 50`    → 'cloud-managed'
 *   3. otherwise                                                        → 'remote-peer'
 *
 * The boundary `>= 50` matches the Phase-2 sales template (budget 50/month) —
 * it routes the canonical reference pod to the cloud-managed backend. Pods
 * below the threshold default to the federation peer-node backend.
 *
 * Wire point: `@metaharness/router` reads the result and supplies it as a
 * routing hint *before* its KRR step. The router is free to override on
 * latency/cost grounds — domain affinity is a policy floor, not a hard gate.
 *
 * @module @claude-flow/cli/business-pods/domain-affinity-policy
 */

import type { PodTemplate } from './pod-schema.js';

/** Three backends @metaharness/router can target for a pod tick. */
export type AgentBackend = 'local-stdio' | 'remote-peer' | 'cloud-managed';

/** Threshold for `cloud-managed` routing. Pods at or above this monthly
 *  spend default to cloud-managed when they are *not* local-pinned. */
export const CLOUD_BUDGET_THRESHOLD_USD = 50;

/** Structured routing decision. `reason` is rendered into the routing
 *  rationale via `hooks_explain` so operators can see why each pod was
 *  routed where it was. */
export interface BackendDecision {
  backend: AgentBackend;
  reason: string;
}

/**
 * Decide which backend `@metaharness/router` should prefer for a pod tick.
 *
 * @param pod  A validated PodTemplate. Validation is the caller's
 *             responsibility; this function will throw on malformed input
 *             (specifically on missing `preferLocalExecution` or
 *             `budgetUsdMonthly`).
 */
export function selectAgentBackend(pod: PodTemplate): BackendDecision {
  if (pod === null || typeof pod !== 'object') {
    throw new TypeError('selectAgentBackend: pod must be a validated PodTemplate object');
  }
  if (typeof pod.preferLocalExecution !== 'boolean') {
    throw new TypeError(
      'selectAgentBackend: pod.preferLocalExecution must be boolean (validate via pod-schema first)',
    );
  }
  if (typeof pod.budgetUsdMonthly !== 'number' || !Number.isFinite(pod.budgetUsdMonthly)) {
    throw new TypeError(
      'selectAgentBackend: pod.budgetUsdMonthly must be a finite number (validate via pod-schema first)',
    );
  }

  if (pod.preferLocalExecution) {
    return {
      backend: 'local-stdio',
      reason: `pod "${pod.name}" preferLocalExecution=true — domain-affinity policy pins to local stdio`,
    };
  }
  if (pod.budgetUsdMonthly >= CLOUD_BUDGET_THRESHOLD_USD) {
    return {
      backend: 'cloud-managed',
      reason:
        `pod "${pod.name}" preferLocalExecution=false and budgetUsdMonthly=${pod.budgetUsdMonthly} ` +
        `>= ${CLOUD_BUDGET_THRESHOLD_USD} — routes to cloud Managed Agents`,
    };
  }
  return {
    backend: 'remote-peer',
    reason:
      `pod "${pod.name}" preferLocalExecution=false and budgetUsdMonthly=${pod.budgetUsdMonthly} ` +
      `< ${CLOUD_BUDGET_THRESHOLD_USD} — routes to federation peer node`,
  };
}
