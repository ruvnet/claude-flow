/**
 * @claude-flow/browser - Workflow Types (ADR-122 Phase 7)
 *
 * Successful MCTS traces (Phase 4) compile into deterministic Workflow
 * artifacts. A Workflow is the runnable, replayable, distributable
 * primitive — the output of the substrate.
 *
 * Workflows ship with:
 *   - per-step selector fallback graph (degrade gracefully)
 *   - policy manifest (which capsules, which task class)
 *   - replay guards (max-retries, timeouts, irreversible-action flags)
 *   - ADR trace (which winning MCTS run produced this)
 */

import { z } from 'zod';

export const SelectorStrategySchema = z.enum([
  'ref',           // @e1 style — fastest, brittle
  'css',           // standard CSS — medium stability
  'role',          // ARIA role — stable across reflows
  'text',          // visible text — language-sensitive
  'label',         // form label — stable for forms
  'placeholder',   // input placeholder
  'testid',        // data-testid — gold standard
]);
export type SelectorStrategy = z.infer<typeof SelectorStrategySchema>;

export const SelectorSpecSchema = z.object({
  strategy: SelectorStrategySchema,
  value: z.string().min(1),
  /** Optional `--name` for role-based locators. */
  name: z.string().optional(),
});
export type SelectorSpec = z.infer<typeof SelectorSpecSchema>;

/** A step in a compiled workflow — primary locator + ordered fallbacks. */
export const WorkflowStepSchema = z.object({
  /** Action verb (open / click / fill / type / wait / screenshot / extract / ...). */
  action: z.string().min(1),
  /** For non-target verbs (open) this is the URL; for selector verbs it's the primary locator. */
  target: z.union([z.string(), SelectorSpecSchema]).optional(),
  /** Ordered fallback selectors — tried in sequence if primary fails. */
  fallback: z.array(SelectorSpecSchema).default([]),
  /** Value for fill/type actions. */
  value: z.string().optional(),
  /** Per-step max-retries; defaults to workflow-level. */
  maxRetries: z.number().int().nonnegative().optional(),
  /** Optional human-readable comment. */
  comment: z.string().optional(),
});
export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;

export const WorkflowRequirementsSchema = z.object({
  /** Whether this workflow requires a Session Capsule mount before running. */
  sessionCapsule: z.boolean().default(false),
  /** Allowed origins this workflow may touch. */
  origins: z.array(z.string()).default([]),
  /** Risk class — gates autonomous execution. */
  taskClass: z.string().default('read-only'),
});
export type WorkflowRequirements = z.infer<typeof WorkflowRequirementsSchema>;

export const WorkflowGuardsSchema = z.object({
  /** This workflow contains irreversible actions (financial/destructive). */
  irreversibleAction: z.boolean().default(false),
  /** Require human confirmation before live execution. */
  requiresUserConfirmation: z.boolean().default(false),
});
export type WorkflowGuards = z.infer<typeof WorkflowGuardsSchema>;

export const WorkflowReplaySchema = z.object({
  maxRetries: z.number().int().nonnegative().default(2),
  timeoutMs: z.number().int().positive().default(30_000),
});
export type WorkflowReplay = z.infer<typeof WorkflowReplaySchema>;

export const WORKFLOW_VERSION = 1;

export const CompiledWorkflowSchema = z.object({
  /** Slug-shaped identifier. */
  workflow: z.string().min(1).regex(/^[a-z0-9_-]+$/),
  version: z.number().int().positive(),
  /** Original goal that produced this workflow. */
  goal: z.string().min(1),
  /** Source MCTS run ID. */
  sourceMctsRunId: z.string().optional(),
  /** Source winning branch ID. */
  sourceBranchId: z.string().optional(),
  requirements: WorkflowRequirementsSchema,
  steps: z.array(WorkflowStepSchema),
  guards: WorkflowGuardsSchema,
  replay: WorkflowReplaySchema,
  /** When compiled (ISO timestamp). */
  compiledAt: z.string(),
});
export type CompiledWorkflow = z.infer<typeof CompiledWorkflowSchema>;

/** Cost / risk / auth signals consumed by production-aware UCT. */
export interface ProductionUctSignals {
  /** Q — accumulated task value from past visits. */
  qValue: number;
  /** Replayability score in [0,1]. Higher = more reusable. */
  replayability: number;
  /** Risk score in [0,1]. Higher = more irreversible. */
  risk: number;
  /** Cumulative token + browser-runtime cost in USD. */
  costUsd: number;
  /** Auth fragility in [0,1]. Higher = more likely to need re-auth. */
  authFragility: number;
}

export interface ProductionUctWeights {
  /** Exploration constant `C`. Default sqrt(2). */
  c: number;
  /** Replayability bonus weight. */
  replayBonus: number;
  /** Risk penalty weight. */
  riskPenalty: number;
  /** Cost penalty weight (USD → score units). */
  costPenalty: number;
  /** Auth fragility penalty weight. */
  authPenalty: number;
}

export const DEFAULT_PRODUCTION_UCT_WEIGHTS: ProductionUctWeights = {
  c: Math.SQRT2,
  replayBonus: 0.3,
  riskPenalty: 0.4,
  costPenalty: 2.0,    // strong penalty per dollar
  authPenalty: 0.25,
};
