/**
 * @claude-flow/browser - Workflow Compiler (ADR-122 Phase 7)
 *
 * Compile a winning MCTS branch (Phase 4) plus its parent chain into a
 * deterministic CompiledWorkflow:
 *   - Each step gets a primary selector + ordered fallback chain (`@eN` ⇒
 *     role+name ⇒ testid ⇒ CSS) derived from observed snapshot metadata.
 *   - Policy manifest filled from the source MCTS goal + Phase 6
 *     RiskClassifier.
 *   - YAML serialisation for human inspection / VCS check-in.
 *
 * The compiler is BROWSER-INDEPENDENT: it operates on trajectory step records
 * (the Phase 1 envelope's `payload.trajectory.steps`), so the same machinery
 * works for traces from any Phase 6 BrowserExecutionAdapter.
 */

import {
  type CompiledWorkflow,
  type WorkflowStep,
  type SelectorSpec,
  WORKFLOW_VERSION,
  CompiledWorkflowSchema,
} from '../domain/workflow.js';
import { RiskClassifier } from './session-capsule-service.js';
import type { McTsBranch } from '../domain/mcts-branch.js';
import type { SignedTrajectoryEnvelope } from '../domain/signed-trajectory.js';
import type { Snapshot } from '../domain/types.js';

/** Input for compile() — a single winning trace. */
export interface CompileInput {
  /** Slug identifier for the workflow. */
  id: string;
  goal: string;
  trajectoryEnvelope: SignedTrajectoryEnvelope;
  /** Optional MCTS provenance for the ADR trace fields. */
  source?: { runId?: string; branchId?: string; branch?: McTsBranch };
  /** Per-workflow replay defaults. */
  defaults?: { maxRetries?: number; timeoutMs?: number };
  /** Override classifier (tests). */
  classifier?: RiskClassifier;
  /** Override `compiledAt` (tests). */
  compiledAt?: string;
}

interface RawStep {
  action: string;
  input: Record<string, unknown>;
  snapshot?: Snapshot;
  result?: { success?: boolean };
}

export class WorkflowCompiler {
  constructor(private readonly classifier: RiskClassifier = new RiskClassifier()) {}

  compile(input: CompileInput): CompiledWorkflow {
    const classifier = input.classifier ?? this.classifier;
    const rawSteps = (input.trajectoryEnvelope.payload.trajectory.steps as RawStep[]) ?? [];

    const steps: WorkflowStep[] = [];
    const origins = new Set<string>();
    let highestRisk: ReturnType<RiskClassifier['classify']> = classifier.classify({ action: 'noop' });

    for (const raw of rawSteps) {
      const target = (raw.input as { url?: string; target?: string }).url
        ?? (raw.input as { target?: string }).target;
      const value = (raw.input as { value?: string; text?: string }).value
        ?? (raw.input as { text?: string }).text;

      // Collect origin from `open` steps for the requirements manifest.
      if (raw.action === 'open' && typeof target === 'string') {
        try {
          origins.add(new URL(target).origin);
        } catch { /* ignore non-URL targets */ }
      }

      const classification = classifier.classify({
        action: raw.action,
        target: typeof target === 'string' ? target : undefined,
        goal: input.goal,
      });
      if (riskRank(classification.class) > riskRank(highestRisk.class)) {
        highestRisk = classification;
      }

      const primary: SelectorSpec | string | undefined =
        raw.action === 'open' && typeof target === 'string'
          ? target
          : target && typeof target === 'string'
            ? primarySelectorSpec(target)
            : undefined;

      const fallback = buildFallbackChain(target, raw.snapshot);

      steps.push({
        action: raw.action,
        target: primary,
        fallback,
        value,
      });
    }

    const compiled: CompiledWorkflow = CompiledWorkflowSchema.parse({
      workflow: input.id,
      version: WORKFLOW_VERSION,
      goal: input.goal,
      sourceMctsRunId: input.source?.runId,
      sourceBranchId: input.source?.branchId,
      requirements: {
        sessionCapsule: highestRisk.class !== 'read-only',
        origins: [...origins],
        taskClass: highestRisk.class,
      },
      steps,
      guards: {
        irreversibleAction: ['financial', 'account-mutation', 'destructive'].includes(highestRisk.class),
        requiresUserConfirmation: !highestRisk.autonomousAllowed,
      },
      replay: {
        maxRetries: input.defaults?.maxRetries ?? 2,
        timeoutMs: input.defaults?.timeoutMs ?? 30_000,
      },
      compiledAt: input.compiledAt ?? new Date().toISOString(),
    });

    return compiled;
  }

  /** Render a compiled workflow as YAML (deterministic, no dynamic deps). */
  toYaml(workflow: CompiledWorkflow): string {
    const lines: string[] = [];
    lines.push(`workflow: ${workflow.workflow}`);
    lines.push(`version: ${workflow.version}`);
    lines.push(`goal: ${quoteYaml(workflow.goal)}`);
    if (workflow.sourceMctsRunId) lines.push(`sourceMctsRunId: ${workflow.sourceMctsRunId}`);
    if (workflow.sourceBranchId) lines.push(`sourceBranchId: ${workflow.sourceBranchId}`);
    lines.push(`compiledAt: ${workflow.compiledAt}`);
    lines.push(`requirements:`);
    lines.push(`  sessionCapsule: ${workflow.requirements.sessionCapsule}`);
    lines.push(`  taskClass: ${workflow.requirements.taskClass}`);
    lines.push(`  origins:`);
    for (const o of workflow.requirements.origins) lines.push(`    - ${o}`);
    lines.push(`guards:`);
    lines.push(`  irreversibleAction: ${workflow.guards.irreversibleAction}`);
    lines.push(`  requiresUserConfirmation: ${workflow.guards.requiresUserConfirmation}`);
    lines.push(`replay:`);
    lines.push(`  maxRetries: ${workflow.replay.maxRetries}`);
    lines.push(`  timeoutMs: ${workflow.replay.timeoutMs}`);
    lines.push(`steps:`);
    for (const step of workflow.steps) {
      lines.push(`  - action: ${step.action}`);
      if (typeof step.target === 'string') {
        lines.push(`    target: ${quoteYaml(step.target)}`);
      } else if (step.target) {
        lines.push(`    target:`);
        lines.push(`      strategy: ${step.target.strategy}`);
        lines.push(`      value: ${quoteYaml(step.target.value)}`);
        if (step.target.name) lines.push(`      name: ${quoteYaml(step.target.name)}`);
      }
      if (step.value !== undefined) lines.push(`    value: ${quoteYaml(step.value)}`);
      if (step.fallback.length > 0) {
        lines.push(`    fallback:`);
        for (const fb of step.fallback) {
          lines.push(`      - strategy: ${fb.strategy}`);
          lines.push(`        value: ${quoteYaml(fb.value)}`);
          if (fb.name) lines.push(`        name: ${quoteYaml(fb.name)}`);
        }
      }
    }
    return lines.join('\n') + '\n';
  }
}

/** Convert a `@eN` ref into a SelectorSpec for the primary slot. */
function primarySelectorSpec(target: string): SelectorSpec {
  if (/^@e\d+$/.test(target)) return { strategy: 'ref', value: target };
  if (target.startsWith('text=')) return { strategy: 'text', value: target.slice(5) };
  if (target.startsWith('role=')) return { strategy: 'role', value: target.slice(5) };
  if (target.startsWith('testid=')) return { strategy: 'testid', value: target.slice(7) };
  return { strategy: 'css', value: target };
}

/** Build the ordered fallback chain — testid > role+name > text > css > ref. */
function buildFallbackChain(target: string | undefined, snapshot?: Snapshot): SelectorSpec[] {
  if (!target || typeof target !== 'string') return [];
  const node = snapshot && /^@e\d+$/.test(target) ? snapshot.refs?.[target] : undefined;
  const out: SelectorSpec[] = [];

  // Most stable strategies first
  if (node) {
    if (node.role && node.name) out.push({ strategy: 'role', value: node.role, name: node.name });
    if (node.name) out.push({ strategy: 'text', value: node.name });
  }
  if (/^@e\d+$/.test(target)) {
    // ref already primary — no extra fallback needed
  } else {
    // Non-ref targets get the ref form as last-ditch (when re-snapshotted)
    out.push({ strategy: 'ref', value: target });
  }

  // Deduplicate (strategy, value) pairs
  const seen = new Set<string>();
  return out.filter(spec => {
    const key = `${spec.strategy}::${spec.value}::${spec.name ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function riskRank(c: string): number {
  switch (c) {
    case 'destructive': return 7;
    case 'account-mutation': return 6;
    case 'financial': return 5;
    case 'external-submission': return 4;
    case 'draft-write': return 3;
    case 'authenticated-read': return 2;
    case 'read-only': return 1;
    default: return 0;
  }
}

function quoteYaml(value: string): string {
  // Minimal YAML quoting — wrap in double quotes when value contains special chars.
  if (/^[A-Za-z0-9_./:-]+$/.test(value)) return value;
  return JSON.stringify(value);
}
