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

export type FunnelMessageClass = 'educational' | 'promotional';

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
  kind: 'disclosure' | FunnelMessageClass;
  url?: string;
}

// ─── ADR-302: consent domains ───────────────────────────────────────────────

export type ConsentDomain =
  | 'account'
  | 'proxy-install'
  | 'telemetry'
  | 'cloud-routing'
  | 'hosted-memory';

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
  | 'disclosure_shown'
  | 'funnel_disabled'
  | 'signup_opened'
  | 'account_created'
  | 'proxy_activated';

export type FunnelSurface = 'statusline' | 'init' | 'credit_exhaustion';

export interface FunnelEvent {
  schemaVersion: 1;
  event: FunnelEventName;
  surface: FunnelSurface;
  release: string;
  region?: string;
  pseudonymousId?: string;
  /** Daily bucket ("2026-07-10") — full timestamps are never recorded. */
  timestampBucket: string;
}
