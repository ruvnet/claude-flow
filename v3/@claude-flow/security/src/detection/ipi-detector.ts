/**
 * IpiDetector — tool-call-layer detection of Indirect Prompt Injection (IPI).
 *
 * Implements Primitive 2 of ADR-178 (arXiv:2604.03870, ruvnet/ruflo#2630):
 * pattern-classifier detection of injected instructions hiding inside a
 * pending tool call's *input* — before the call executes. Registered as a
 * `HookEvent.PreToolUse` handler in `@claude-flow/hooks` (see
 * `registerIpiDetectionHook` in that package) so every tool call is screened
 * ahead of dispatch, not just after the fact.
 *
 * Threat model
 * ------------
 * Indirect Prompt Injection hides malicious instructions inside data an
 * agent will read and then act on — a skill file, a memory record, a file
 * the agent is asked to summarize — rather than in the user's own prompt.
 * Once the agent has "absorbed" the injected instruction, it can surface as
 * an anomalous tool call: parameters that carry embedded role-play framing,
 * fake system/assistant turns, or instruction-override language instead of
 * the plain structured value the tool schema expects. RepE research
 * (arXiv:2604.03870) shows this is detectable either from the model's
 * internal decision entropy at the tool-input position, or from a
 * lightweight classifier over the serialized tool input alone — IPI defeats
 * prompt-level filters but leaves a footprint in *what gets typed into the
 * tool call*.
 *
 * Scope (this file)
 * ------------------
 * - Pattern-classifier path ONLY over `JSON.stringify(toolCall.parameters)`.
 *   Reuses `ToolOutputGuardrail`'s pattern library (ADR-131) — the same
 *   instruction-override / role-hijack / embedded-system / jailbreak
 *   categories are exactly what shows up in injected tool-input text, so we
 *   compose rather than duplicate the regex set.
 * - Adds one IPI-specific heuristic on top: oversized free-text values in
 *   fields a tool schema would normally expect to be short/structured
 *   (an id, a path, a flag) — a common shape when an injected instruction
 *   gets stuffed into an unrelated parameter.
 * - Synchronous, pure, no I/O — safe to run on every `PreToolUse` hook
 *   invocation without adding meaningful latency.
 *
 * Non-goals / future work
 * ------------------------
 * - RepE logit-distribution sampling (the *other* half of ADR-178's
 *   Primitive 2 prose: "the model's output logit distribution"). This
 *   codebase has no hook anywhere in the MCP/CLI surface that exposes
 *   Claude's internal hidden states or logits to a tool-call interceptor,
 *   so that path is not implementable here. If a logit/entropy signal ever
 *   becomes available, it should feed into `assess()` as an additional,
 *   optional input alongside the serialized-parameter scan below — not
 *   replace it.
 * - Wiring ADR-321 P2's `seal:propagation-detected` event (AgentDBAdapter)
 *   into this detector's risk assessment. That cross-package connection
 *   (`@claude-flow/memory` → `@claude-flow/security`) is a deliberate,
 *   separate follow-up — see the coordinator's task breakdown. Nothing in
 *   this file assumes or depends on that event existing.
 *
 * Reference: ADR-178, arXiv:2604.03870 (RepE/IPI), ADR-131
 * (`tool-output-guardrail.ts`, whose pattern library this composes).
 */

import { ToolOutputGuardrail, type InjectionSeverity } from '../tool-output-guardrail.js';

/** Overall IPI risk level for a single tool call. */
export type IpiRiskLevel = 'none' | 'low' | 'medium' | 'high';

/** Result of assessing one tool call for indirect prompt injection. */
export interface IpiRisk {
  readonly risk: IpiRiskLevel;
  /** Human-readable reasons the call was scored this way; stable-ish for logs/tests. */
  readonly reasons: string[];
  /** Confidence in the assessment, 0 (no signal) to 1 (very confident). */
  readonly confidence: number;
}

/** Shape of the intercepted tool call, matching `HookContext.tool` in `@claude-flow/hooks`. */
export interface DetectableToolCall {
  readonly name: string;
  readonly parameters: Record<string, unknown>;
}

export interface IpiDetectorConfig {
  /** Guardrail instance to reuse for pattern scanning. Default: fresh instance. */
  readonly guardrail?: ToolOutputGuardrail;
  /**
   * String values longer than this (chars) in a field not in
   * `expectedLongFieldKeys` are flagged as "oversized free-text in an
   * unexpected field". Default: 500.
   */
  readonly oversizedFieldThreshold?: number;
  /** Field name substrings expected to legitimately hold long free text. */
  readonly expectedLongFieldKeys?: ReadonlyArray<string>;
}

const DEFAULT_OVERSIZED_THRESHOLD = 500;

const DEFAULT_EXPECTED_LONG_FIELD_KEYS: ReadonlyArray<string> = [
  'content', 'body', 'text', 'message', 'prompt', 'description', 'notes',
  'code', 'diff', 'patch', 'html', 'markdown', 'query', 'command', 'script',
];

const SEVERITY_TO_RISK: Record<InjectionSeverity, IpiRiskLevel> = {
  critical: 'high',
  high: 'high',
  medium: 'medium',
  low: 'low',
};

const BASE_CONFIDENCE: Record<IpiRiskLevel, number> = {
  none: 0.05,
  low: 0.35,
  medium: 0.6,
  high: 0.85,
};

const RISK_ORDER: Record<IpiRiskLevel, number> = { none: 0, low: 1, medium: 2, high: 3 };

function maxRisk(a: IpiRiskLevel, b: IpiRiskLevel): IpiRiskLevel {
  return RISK_ORDER[a] >= RISK_ORDER[b] ? a : b;
}

/** Serialize tool-call parameters for scanning. Never throws (circular refs, BigInt, etc). */
function serializeParameters(parameters: Record<string, unknown>): string {
  try {
    return JSON.stringify(parameters) ?? '';
  } catch {
    // Fall back to a best-effort per-key stringification so the scan can
    // still run on the values that ARE serializable.
    const parts: string[] = [];
    for (const [key, value] of Object.entries(parameters)) {
      try {
        parts.push(`${key}:${JSON.stringify(value)}`);
      } catch {
        parts.push(`${key}:[unserializable]`);
      }
    }
    return parts.join(',');
  }
}

/**
 * Walk parameter values (one level of array/object nesting) looking for
 * unexpectedly long free-text strings in fields whose name doesn't suggest
 * they should hold prose. Returns human-readable reasons, one per hit.
 */
function findOversizedFields(
  parameters: Record<string, unknown>,
  threshold: number,
  expectedKeys: ReadonlyArray<string>,
): string[] {
  const reasons: string[] = [];
  const isExpected = (key: string): boolean => {
    const lower = key.toLowerCase();
    return expectedKeys.some((k) => lower.includes(k));
  };
  const visit = (key: string, value: unknown): void => {
    if (typeof value === 'string' && value.length > threshold && !isExpected(key)) {
      reasons.push(
        `oversized free-text in field "${key}" (${value.length} chars; expected a short/structured value)`,
      );
    } else if (Array.isArray(value)) {
      for (const item of value) visit(key, item);
    } else if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) visit(k, v);
    }
  };
  for (const [key, value] of Object.entries(parameters)) visit(key, value);
  return reasons;
}

/**
 * `IpiDetector` — pattern-classifier baseline for indirect prompt injection
 * detection over a pending tool call's serialized parameters.
 *
 * Construction is cheap and holds no per-call mutable state; safe to share
 * a single instance across all `PreToolUse` invocations.
 */
export class IpiDetector {
  private readonly guardrail: ToolOutputGuardrail;
  private readonly oversizedFieldThreshold: number;
  private readonly expectedLongFieldKeys: ReadonlyArray<string>;

  constructor(config: IpiDetectorConfig = {}) {
    this.guardrail = config.guardrail ?? new ToolOutputGuardrail();
    this.oversizedFieldThreshold = config.oversizedFieldThreshold ?? DEFAULT_OVERSIZED_THRESHOLD;
    this.expectedLongFieldKeys = config.expectedLongFieldKeys ?? DEFAULT_EXPECTED_LONG_FIELD_KEYS;
  }

  /**
   * Assess a pending tool call for IPI risk. Pure; never throws — a
   * malformed/unserializable `parameters` object degrades to a lower-quality
   * scan rather than an error, since callers run this on the hot path of
   * every tool call.
   */
  assess(toolCall: DetectableToolCall): IpiRisk {
    const serialized = serializeParameters(toolCall.parameters ?? {});
    const scan = this.guardrail.scan(serialized);
    const oversized = findOversizedFields(
      toolCall.parameters ?? {},
      this.oversizedFieldThreshold,
      this.expectedLongFieldKeys,
    );

    const reasons: string[] = scan.findings.map(
      (f) => `matched pattern "${f.pattern}" (${f.category}, ${f.severity}) in tool "${toolCall.name}" parameters`,
    );
    reasons.push(...oversized.map((r) => `${r} in tool "${toolCall.name}" parameters`));

    let risk: IpiRiskLevel = scan.highest === 'none' ? 'none' : SEVERITY_TO_RISK[scan.highest];
    if (oversized.length > 0) risk = maxRisk(risk, 'low');

    const hitCount = scan.findings.length + oversized.length;
    const confidence =
      hitCount === 0 ? BASE_CONFIDENCE.none : Math.min(1, BASE_CONFIDENCE[risk] + 0.05 * (hitCount - 1));

    return { risk, reasons, confidence };
  }
}

/** Convenience factory mirroring other detectors in this package. */
export function createIpiDetector(config?: IpiDetectorConfig): IpiDetector {
  return new IpiDetector(config);
}
