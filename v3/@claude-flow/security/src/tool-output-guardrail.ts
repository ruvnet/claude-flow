/**
 * ToolOutputGuardrail — semantic screening of content returned by MCP tool
 * calls, memory reads, and external API responses before that content enters
 * agent reasoning. Closes the OWASP ASI01 (Agent Goal Hijacking) gap
 * identified in ruvnet/ruflo#2149 / ADR-131.
 *
 * Threat model
 * ------------
 * Attackers embed malicious instructions in content the agent retrieves
 * autonomously (web page, MCP tool response, memory entry). An LLM cannot
 * reliably distinguish instructions from data once both are in the prompt.
 * System-level per-boundary guardrails are the only category with
 * sub-millisecond latency and no model dependency (arXiv:2601.17548,
 * Jan 2026 systematic review).
 *
 * Scope
 * -----
 * - Detection only — does NOT modify the running prompt; callers decide
 *   what action to take (allow, flag, redact, reject) via `scanAndEnforce`.
 * - Synchronous pattern match — designed for <1ms p99 on typical tool
 *   responses (≤32KB). Large content is capped at `maxScanBytes` and the
 *   truncation itself is reported as a low-severity finding.
 * - Pure-function shape — no I/O, no async, no model calls. Safe to invoke
 *   in hot paths (every MCP tool result, every memory read).
 *
 * Non-goals
 * ---------
 * - Not a replacement for input validation at HTTP/CLI boundaries
 *   (InputValidator handles that). This is the *content* boundary.
 * - Not a model-based classifier. False-positive rate is bounded by
 *   pattern specificity; tune via `customPatterns` and `policy`.
 *
 * Reference: ADR-131, OpenAI Agents SDK ToolGuardrail API (March 2025).
 */

export type InjectionSeverity = 'low' | 'medium' | 'high' | 'critical';

export type InjectionCategory =
  | 'instruction-override'
  | 'role-hijack'
  | 'exfiltration'
  | 'jailbreak'
  | 'hidden-unicode'
  | 'embedded-system'
  | 'tool-spoofing'
  | 'truncation';

export interface InjectionFinding {
  /** Short label for the matched pattern (stable identifier for telemetry). */
  pattern: string;
  /** Risk weight assigned to this pattern. */
  severity: InjectionSeverity;
  /** Category for downstream classification + OWASP mapping. */
  category: InjectionCategory;
  /** Char offset of the first match in the scanned content. */
  position: number;
  /** Up to 80 chars of surrounding context for human triage (redacted in `sanitized`). */
  context: string;
}

export interface GuardrailResult {
  /** True iff no findings, or all findings under the `flag` policy threshold. */
  safe: boolean;
  /** Findings in the order they were detected. */
  findings: InjectionFinding[];
  /** Highest severity observed; `none` if findings is empty. */
  highest: InjectionSeverity | 'none';
}

export type GuardrailAction = 'allow' | 'flag' | 'redact' | 'reject';

export interface GuardrailConfig {
  /**
   * Per-severity action.
   * Defaults:
   *   low      → allow
   *   medium   → flag
   *   high     → redact
   *   critical → reject
   *
   * `allow`  — content passes through unchanged, no logging required.
   * `flag`   — content passes through; caller SHOULD log + monitor.
   * `redact` — matched substrings replaced with `[REDACTED:<pattern>]`.
   * `reject` — caller MUST drop the content and treat the tool call
   *            as failed (signal the agent that the tool returned an
   *            unsafe payload rather than letting the payload through).
   */
  policy?: Partial<Record<InjectionSeverity, GuardrailAction>>;

  /** Add domain-specific patterns without subclassing. */
  customPatterns?: Array<{
    label: string;
    regex: RegExp;
    severity: InjectionSeverity;
    category: InjectionCategory;
  }>;

  /**
   * Maximum bytes of content to scan. Beyond this, the tail is ignored and
   * a `truncation` finding is added at `medium`. Default: 1 MiB.
   * Set to 0 to disable truncation (scan everything; slower on huge blobs).
   */
  maxScanBytes?: number;
}

const DEFAULT_POLICY: Required<NonNullable<GuardrailConfig['policy']>> = {
  low: 'allow',
  medium: 'flag',
  high: 'redact',
  critical: 'reject',
};

const DEFAULT_MAX_SCAN_BYTES = 1024 * 1024;

/**
 * Built-in pattern library. Ordered by severity (critical first) so the
 * `highest` field reflects the worst category. Patterns are intentionally
 * conservative — they target the explicit instruction-override / role-hijack
 * shapes that show up in published indirect-injection corpora rather than
 * general "suspicious looking" text.
 */
const BUILTIN_PATTERNS: ReadonlyArray<{
  label: string;
  regex: RegExp;
  severity: InjectionSeverity;
  category: InjectionCategory;
}> = [
  // ── critical: instruction override + embedded system frames ──
  {
    label: 'ignore-previous-instructions',
    // Allow optional filler words between the verb and the temporal keyword
    // ("ignore the above", "disregard your earlier", "forget all prior").
    regex: /\b(?:ignore|disregard|forget)\s+(?:all\s+|any\s+|the\s+|my\s+|your\s+|these\s+|those\s+)?(?:previous|prior|above|earlier|preceding|aforementioned)\s+(?:instructions?|prompts?|rules?|directives?)\b/gi,
    severity: 'critical',
    category: 'instruction-override',
  },
  {
    label: 'chatml-frame',
    regex: /<\|(?:im_start|im_end|system|assistant|user|endoftext)\|>/gi,
    severity: 'critical',
    category: 'embedded-system',
  },
  {
    label: 'llama-inst-frame',
    regex: /\[\/?INST\]/g,
    severity: 'critical',
    category: 'embedded-system',
  },
  {
    label: 'exfiltrate-secret',
    regex: /\b(?:exfiltrate|leak|send|post|upload|transmit)\b[^.\n]{0,80}\b(?:secret|token|api[-_\s]?keys?|password|credential|env\s+vars?)\b/gi,
    severity: 'critical',
    category: 'exfiltration',
  },

  // ── high: role hijack + jailbreak + system tags + bidi unicode ──
  {
    label: 'system-tag-injection',
    regex: /<\/?system>/gi,
    severity: 'high',
    category: 'embedded-system',
  },
  {
    label: 'role-hijack-you-are-now',
    regex: /\byou\s+are\s+(?:now|actually|secretly)\s+(?:a|an|the)\s+/gi,
    severity: 'high',
    category: 'role-hijack',
  },
  {
    label: 'jailbreak-dan',
    regex: /\b(?:DAN(?:\s+mode)?|developer\s+mode|jailbreak\s+mode|do\s+anything\s+now)\b/gi,
    severity: 'high',
    category: 'jailbreak',
  },
  {
    label: 'new-instructions-directive',
    regex: /\b(?:new|updated|revised|additional)\s+(?:instructions?|task|directives?|objectives?)\s*[:.]/gi,
    severity: 'high',
    category: 'instruction-override',
  },
  {
    label: 'bidi-override',
    regex: /[‪-‮⁦-⁩]/g,
    severity: 'high',
    category: 'hidden-unicode',
  },

  // ── medium: softer role manipulation + tool spoofing ──
  {
    label: 'role-hijack-act-as',
    regex: /\b(?:act|behave|pretend|role[-\s]?play)\s+as\s+(?:if\s+)?(?:a|an|the)\s+/gi,
    severity: 'medium',
    category: 'role-hijack',
  },
  {
    label: 'tool-call-spoof',
    regex: /\b(?:tool_call|function_call|mcp_tool)\s*[:=]\s*["'{]/gi,
    severity: 'medium',
    category: 'tool-spoofing',
  },

  // ── low: zero-width whitespace (common in copy-paste attacks) ──
  {
    label: 'zero-width-char',
    regex: /[​-‍﻿]/g,
    severity: 'low',
    category: 'hidden-unicode',
  },
];

const SEVERITY_ORDER: Record<InjectionSeverity | 'none', number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

function snippet(text: string, idx: number, len: number): string {
  const start = Math.max(0, idx - 24);
  const end = Math.min(text.length, idx + len + 24);
  const head = start > 0 ? '…' : '';
  const tail = end < text.length ? '…' : '';
  return head + text.slice(start, end).replace(/\s+/g, ' ') + tail;
}

function maxSeverity(a: InjectionSeverity | 'none', b: InjectionSeverity): InjectionSeverity {
  return SEVERITY_ORDER[a] >= SEVERITY_ORDER[b]
    ? (a === 'none' ? b : a)
    : b;
}

export class ToolOutputGuardrail {
  private readonly patterns: ReadonlyArray<typeof BUILTIN_PATTERNS[number]>;
  private readonly policy: Required<NonNullable<GuardrailConfig['policy']>>;
  private readonly maxScanBytes: number;

  constructor(config: GuardrailConfig = {}) {
    this.patterns = [...BUILTIN_PATTERNS, ...(config.customPatterns ?? [])];
    this.policy = { ...DEFAULT_POLICY, ...(config.policy ?? {}) };
    this.maxScanBytes = config.maxScanBytes ?? DEFAULT_MAX_SCAN_BYTES;
  }

  /**
   * Pure scan — no side effects, no content modification. Useful when the
   * caller wants to log findings but cannot drop the content (e.g. read-only
   * audit mode).
   */
  scan(content: string): GuardrailResult {
    if (typeof content !== 'string') {
      return { safe: true, findings: [], highest: 'none' };
    }

    let scanned = content;
    const findings: InjectionFinding[] = [];

    if (this.maxScanBytes > 0 && content.length > this.maxScanBytes) {
      scanned = content.slice(0, this.maxScanBytes);
      findings.push({
        pattern: 'content-truncated',
        severity: 'medium',
        category: 'truncation',
        position: this.maxScanBytes,
        context: `(content truncated at ${this.maxScanBytes} bytes; ${content.length - this.maxScanBytes} bytes unscanned)`,
      });
    }

    for (const { label, regex, severity, category } of this.patterns) {
      // Clone the RegExp so that the global-flag lastIndex state doesn't
      // leak between calls. Built-in patterns are immutable; user-supplied
      // patterns are also defensively cloned.
      const re = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : regex.flags + 'g');
      let match: RegExpExecArray | null;
      while ((match = re.exec(scanned)) !== null) {
        findings.push({
          pattern: label,
          severity,
          category,
          position: match.index,
          context: snippet(scanned, match.index, match[0].length),
        });
        // Defensive: zero-length match would loop forever
        if (match[0].length === 0) re.lastIndex++;
      }
    }

    let highest: InjectionSeverity | 'none' = 'none';
    for (const f of findings) highest = maxSeverity(highest, f.severity);

    const action = highest === 'none' ? 'allow' : this.policy[highest];
    const safe = action === 'allow' || action === 'flag';

    return { safe, findings, highest };
  }

  /**
   * Scan + enforce policy. Returns the content to pass forward (possibly
   * redacted or empty) plus the scan result and the action that was taken.
   * Callers should treat `reject` as "drop the tool result and signal an
   * error" — do NOT silently substitute empty content.
   */
  scanAndEnforce(content: string): {
    content: string;
    result: GuardrailResult;
    action: GuardrailAction;
  } {
    const result = this.scan(content);

    const action: GuardrailAction =
      result.highest === 'none' ? 'allow' : this.policy[result.highest];

    let outgoing = content;
    if (action === 'redact') {
      outgoing = this.redact(content, result.findings);
    } else if (action === 'reject') {
      outgoing = '';
    }

    return { content: outgoing, result, action };
  }

  /**
   * Replace each non-truncation finding's matched substring with
   * `[REDACTED:<pattern>]`. Truncation findings have no substring to redact
   * (their `position` is a length, not an offset into the content) and are
   * skipped. Idempotent for already-redacted strings.
   */
  private redact(content: string, findings: InjectionFinding[]): string {
    if (findings.length === 0) return content;

    // Build a single combined regex per pattern label to avoid replacing
    // overlapping matches multiple times.
    const labels = new Set(
      findings
        .filter((f) => f.category !== 'truncation')
        .map((f) => f.pattern)
    );

    let out = content;
    for (const { label, regex } of this.patterns) {
      if (!labels.has(label)) continue;
      const re = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : regex.flags + 'g');
      out = out.replace(re, `[REDACTED:${label}]`);
    }
    return out;
  }
}

/** Convenience factory that returns a guardrail with the default policy. */
export function createToolOutputGuardrail(config?: GuardrailConfig): ToolOutputGuardrail {
  return new ToolOutputGuardrail(config);
}

/**
 * One-shot helper for callers that just want a yes/no answer without
 * constructing a guardrail. Uses the default policy.
 */
export function isToolOutputSafe(content: string): boolean {
  return createToolOutputGuardrail().scan(content).safe;
}
