/**
 * AGNTCY OTel semantic-convention span attributes — RuFlo's runtime-owned
 * half (ADR-380 §5).
 *
 * AGNTCY (Cisco Outshift) defines ten OTel span-attribute extensions for
 * agent observability across the identity/execution/coordination lifecycle.
 * Per ADR-380 §5, RuFlo and the companion metaharness ADR-240 split
 * ownership of those ten attributes by *when* the value is knowable:
 *
 *   - MetaHarness (build/manifest time, companion ADR-240 §2.3) owns the
 *     eight attributes that exist once an agent is compiled/described:
 *       `agent.identity`      — AGNTCY-issued agent identity
 *       `agent.capability`    — declared tool/capability surface
 *       `agent.intent`        — compiled objective (OASF manifest field)
 *       `agent.parent`        — lineage / parent-agent reference
 *       `model.route`         — which model tier served the invocation
 *       `memory.provenance`   — RuVector/AgentDB provenance pointer
 *       `evaluation.score`    — harness scorecard / GEPA evaluation result
 *       `receipt.hash`        — content hash of the signed run receipt
 *
 *   - RuFlo (runtime, this file) owns the two attributes that only exist
 *     once SLIM transport and/or CASA enforcement are active at runtime —
 *     they describe *this* coordination episode and *this* authorization
 *     decision, neither of which can be known at build time:
 *       `coordination.episode`   — see AGNTCY_SPAN_ATTR_COORDINATION_EPISODE
 *       `authorization.decision` — see AGNTCY_SPAN_ATTR_AUTHORIZATION_DECISION
 *
 * Deliberately NOT re-exported here: the eight metaharness-owned names
 * above. Defining them in both places would let the two ADRs drift out of
 * sync; the companion ADR-240 package is the single source of truth for
 * those constants. This module only defines the two RuFlo owns.
 *
 * Wire these attribute names through the existing `ruflo-observability`
 * plugin (`observe-trace`/`observe-metrics` skills) — ADR-380 §5 is
 * explicit that this must not become a second tracing pipeline.
 *
 * @see v3/docs/adr/ADR-380-agntcy-outshift-runtime-integration.md §5
 * @see AGNTCY Observe — https://github.com/agntcy/observe
 */

/**
 * OTel span attribute name for the SLIM/hive-mind coordination episode a
 * span belongs to (e.g. a swarm run, a hive-mind consensus round, a
 * `ruflo swarm join <namespace>` session). Only meaningful once SLIM
 * transport (ADR-380 §2) is active — a span emitted under the default
 * local/in-process transport has no coordination episode to report.
 */
export const AGNTCY_SPAN_ATTR_COORDINATION_EPISODE = 'coordination.episode';

/**
 * OTel span attribute name for the outcome of a CASA intent-scoped
 * authorization check (ADR-380 §3) gating the tool invocation the span
 * covers. Set for every span produced by a CASA-enforced dispatch,
 * whether the decision was `allow` or `deny` — a denied span still needs
 * the attribute so the trace shows *why* the invocation didn't proceed.
 */
export const AGNTCY_SPAN_ATTR_AUTHORIZATION_DECISION = 'authorization.decision';

/**
 * All AGNTCY OTel span attributes RuFlo defines and is responsible for
 * emitting, per ADR-380 §5. Convenience array for callers that want to
 * enumerate rather than reference the individual constants (e.g. an
 * `observe-trace` schema validator or an attribute allow-list).
 */
export const AGNTCY_RUFLO_OWNED_SPAN_ATTRS = [
  AGNTCY_SPAN_ATTR_COORDINATION_EPISODE,
  AGNTCY_SPAN_ATTR_AUTHORIZATION_DECISION,
] as const;

/** Union type of the span attribute names RuFlo owns. */
export type AgntcyRufloOwnedSpanAttr =
  (typeof AGNTCY_RUFLO_OWNED_SPAN_ATTRS)[number];
