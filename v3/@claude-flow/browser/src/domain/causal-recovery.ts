/**
 * @claude-flow/browser - Causal Recovery Types (ADR-122 Phase 2)
 *
 * When a selector fails to resolve (element-ref vanished, fill target moved,
 * click target changed role), we don't just retry — we record a causal edge
 * in AgentDB: "selector X at URL Y broke because DOM mutation M observed
 * between T1..T2." Future sessions query the graph BEFORE attempting a
 * known-brittle locator family.
 *
 * No SOTA web agent (Surfer-H, Browser Use, Stagehand, Operator, Skyvern)
 * surfaces WHY a selector broke — they retry silently. This is the wedge.
 */

import { z } from 'zod';

/** Why a selector resolution failed — taxonomy for causal-edge labels. */
export const SelectorBreakKindSchema = z.enum([
  'element-not-found',
  'element-not-visible',
  'element-not-enabled',
  'element-detached',
  'ref-stale',
  'timeout',
  'navigation-during-action',
  'unknown',
]);
export type SelectorBreakKind = z.infer<typeof SelectorBreakKindSchema>;

export const SelectorBreakEventSchema = z.object({
  /** Globally-unique event ID. */
  id: z.string().min(1),
  /** Domain origin (e.g. `https://example.com`) — used as causal-graph isolation key. */
  origin: z.string().min(1),
  /** Path component of the URL where the break occurred. */
  path: z.string(),
  /** The failing selector — either an element-ref (`@e3`) or CSS / text= / role=. */
  selector: z.string().min(1),
  /** Action that triggered the failure (click/fill/wait/...). */
  action: z.string().min(1),
  /** What kind of break this is. */
  kind: SelectorBreakKindSchema,
  /** When the break was first observed. */
  timestamp: z.string(),
  /** Human-readable reason from the adapter, if any. */
  reason: z.string().optional(),
  /** Element-ref's ROLE and NAME at last successful resolution, if known — used for fuzzy match. */
  lastKnownRole: z.string().optional(),
  lastKnownName: z.string().optional(),
  /** Session ID where the break was observed (for cross-trajectory queries). */
  sessionId: z.string().optional(),
});
export type SelectorBreakEvent = z.infer<typeof SelectorBreakEventSchema>;

/**
 * Risk annotation surfaced on snapshot element-refs based on prior break history.
 *
 * A ref with a non-zero `riskScore` should be treated as a known-brittle locator
 * — callers may prefer to switch strategies (`find role=button --name "Submit"`
 * instead of `@e3`) BEFORE attempting the action.
 */
export const CausalRiskAnnotationSchema = z.object({
  /** The element-ref or selector being annotated. */
  selector: z.string(),
  /** [0, 1] — fraction of prior attempts on this origin+selector that broke. */
  riskScore: z.number().min(0).max(1),
  /** Count of break events behind this score. */
  breakCount: z.number().int().nonnegative(),
  /** Most recent break event ID, if any. */
  lastBreakId: z.string().optional(),
  /** Most recent break kind, for callers that want to choose recovery strategy. */
  lastBreakKind: SelectorBreakKindSchema.optional(),
});
export type CausalRiskAnnotation = z.infer<typeof CausalRiskAnnotationSchema>;

/**
 * Result returned by the recovery-explainer when a selector fails.
 *
 * Unlike SOTA "auto-heal silently and hope" recovery, this surfaces the
 * CAUSAL CHAIN: prior break events, their structural ancestor, and
 * suggested alternative locator strategies.
 */
export interface RecoveryExplanation {
  origin: string;
  failingSelector: string;
  /** Prior break events for the same origin + selector family. */
  priorBreaks: SelectorBreakEvent[];
  /** Suggested alternative locator strategies, in priority order. */
  suggestions: Array<{
    strategy: 'find-role' | 'find-text' | 'find-testid' | 'find-label' | 'find-placeholder';
    value: string;
    confidence: number;
    rationale: string;
  }>;
}
