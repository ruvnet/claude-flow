/**
 * Funnel type definitions — ADR-301..310.
 *
 * The funnel is the ruflo → Cognitum lifecycle system: promotional status
 * surface (ADR-301), post-init enrollment (ADR-302), credit-exhaustion
 * recovery (ADR-303), governed by consent receipts (ADR-302), control
 * precedence (ADR-305), and the governance/privacy rules of ADR-309.
 *
 * Everything in this module is local-only: no code path here performs
 * network I/O. Events are queued locally and only when telemetry consent
 * is granted (ADR-308 failure policy: telemetry never blocks the CLI).
 */

// ─── ADR-301: disclosure ────────────────────────────────────────────────────

export type FunnelDisclosureState =
  | 'never_seen'
  | 'disclosed_enabled'
  | 'disclosed_disabled';

export interface DisclosureRecord {
  state: FunnelDisclosureState;
  /** ISO timestamp of the first render of the disclosure text. */
  firstShownAt: string | null;
}

// ─── ADR-301: messages ──────────────────────────────────────────────────────

// 'disclosure' is a server-sourced message class (ADR-311 amendment) — the
// existing-install disclosure notice is now fetched from the same remote
// message feed as tips/promos, not hardcoded in the CLI. This keeps the
// "zero local promo content" guarantee: nothing about WHAT is shown ships
// in the package, only the mechanism for showing it (state tracking,
// content pipeline, host allowlist).
export type FunnelMessageClass = 'educational' | 'promotional' | 'disclosure';

export interface FunnelMessage {
  id: string;
  schemaVersion: 1;
  text: string;
  /** Optional link; must pass the in-code host allowlist or the message is dropped. */
  url?: string;
  class: FunnelMessageClass;
  /** ISO timestamp; expired messages leave the rotation immediately. */
  expiresAt?: string;
}

export interface PromoRow {
  text: string;
  // 'insight' is deliberately NOT part of FunnelMessageClass — insights are
  // computed locally from environment/task state (CVEs, git, swarm), never
  // remote-served, never run through the remote-content validation pipeline
  // (messages.ts's isValidMessage()). Keeping it a separate literal here
  // means "every FunnelMessageClass came from the remote/in-code content
  // pipeline" stays a true invariant elsewhere in the codebase.
  kind: 'disclosure' | FunnelMessageClass | 'insight';
  url?: string;
}

// ─── ADR-302: consent domains ───────────────────────────────────────────────

export type ConsentDomain =
  | 'account'
  | 'proxy-install'
  | 'telemetry'
  | 'cloud-routing'
  | 'hosted-memory'
  // ADR-313: separate from cloud-routing — sponsored capacity is Cognitum's
  // own model traffic, billed to Cognitum, not the user's cloud config.
  | 'sponsored-downtime'
  // ADR-314: separate from both — power saver routes through the user's OWN
  // Cognitum account (Cloud plane), not sponsored/free capacity, but it's
  // still a distinct decision from generic cloud-routing (auto-rewrites the
  // model to cognitum-auto, which cloud-routing consent alone doesn't imply).
  | 'power-saver'
  // ADR-315 Tier 2: separate from sponsored-downtime — using free/sponsored
  // capacity must never implicitly mean donating prompt content for model
  // training. This is the one consent domain in the whole family that
  // gates raw interaction CONTENT leaving the client, not just a routing
  // decision, so it is never bundled with anything else.
  | 'training-data-sharing'
  // ADR-316: separate again — a periodic, budget-capped `claude -p` call to
  // a headless Fable model for a proactive statusline tip. The payload is
  // structural signals only (never raw prompt/command/file content, unlike
  // the concern training-data-sharing gates), but it's still a real, opt-in
  // network call with a real cost, and gets its own never-bundled decision
  // like every other domain in this family.
  | 'advisor-tips';

export interface ConsentReceipt {
  granted: boolean;
  policyVersion: number;
  /** ISO timestamp of the decision; null = never asked. */
  at: string | null;
  surface: string | null;
}

export type ConsentFile = Partial<Record<ConsentDomain, ConsentReceipt>>;

/** Bump when the meaning of a consent domain changes materially (ADR-302). */
export const CONSENT_POLICY_VERSION = 1;

// ─── ADR-305: control precedence ────────────────────────────────────────────

export type FunnelDecisionSource =
  | 'env'                // RUFLO_FUNNEL=0
  | 'enterprise-policy'
  | 'user-config'
  | 'project-config'
  | 'package-default'
  | 'remote-policy'
  | 'disclosure-declined';

export interface FunnelEnabledDecision {
  enabled: boolean;
  decidedBy: FunnelDecisionSource;
}

// ─── ADR-303: credit error taxonomy ─────────────────────────────────────────

export enum CreditErrorCode {
  /** Cognitum ledger says balance is spent — the ONLY funnel trigger. */
  COGNITUM_CREDIT_EXHAUSTED = 'COGNITUM_CREDIT_EXHAUSTED',
  /** Upstream provider's own quota, not Cognitum credits. */
  PROVIDER_QUOTA_EXHAUSTED = 'PROVIDER_QUOTA_EXHAUSTED',
  PROVIDER_RATE_LIMITED = 'PROVIDER_RATE_LIMITED',
  AUTHENTICATION_FAILED = 'AUTHENTICATION_FAILED',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
}

export interface NormalizedCreditError {
  code: CreditErrorCode | null;
  /** 1 only when an explicit machine-readable provider code mapped; else 0. */
  confidence: 0 | 1;
  retryable: boolean;
  /** Original provider error, preserved verbatim for --verbose paths. */
  cause?: unknown;
}

// ─── ADR-309: funnel events (closed set, constrained schema) ────────────────

export type FunnelEventName =
  // ADR-305 core lifecycle events
  | 'disclosure_shown'
  | 'funnel_disabled'
  | 'signup_opened'
  | 'account_created'
  | 'proxy_activated'
  // ADR-311 impression + click tracking (server-side click-redirect fires
  // 'promo_open' after the client has fired 'promo_impression' on render).
  | 'promo_impression'
  | 'promo_open'
  // ADR-313 sponsored downtime mode
  | 'sponsor_mode_enabled'
  | 'sponsor_mode_disabled'
  | 'sponsor_capacity_exhausted'
  // ADR-314 power saver mode + anti-abuse
  | 'power_saver_enabled'
  | 'power_saver_disabled'
  | 'toggle_cooldown_blocked'
  // ADR-315 Tier 2 training-data-sharing consent
  | 'training_share_enabled'
  | 'training_share_disabled'
  // ADR-316 advisor co-pilot tip consent
  | 'advisor_tip_enabled'
  | 'advisor_tip_disabled';

export type FunnelSurface = 'statusline' | 'init' | 'credit_exhaustion';

export interface FunnelEvent {
  schemaVersion: 1;
  event: FunnelEventName;
  surface: FunnelSurface;
  release: string;
  region?: string;
  pseudonymousId?: string;
  /**
   * Message id for promo_impression / promo_open — lets the analyst
   * attribute clicks + impressions to a specific rotation entry without
   * carrying prompt/URL/PII data.
   */
  messageId?: string;
  /** Daily bucket ("2026-07-10") — full timestamps are never recorded. */
  timestampBucket: string;
}
