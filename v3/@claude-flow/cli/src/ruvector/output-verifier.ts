/**
 * output-verifier.ts — Confidence-gated tier escalation (post-generation).
 *
 * ADR-026/143 route tasks to a tier BEFORE generation. 2026 SOTA cascade
 * routing adds a post-generation gate: attempt the cheap tier, run a CHEAP
 * verifier over the produced output, and escalate to the next tier only when
 * the verifier is not confident. This module is that verifier.
 *
 * Design constraints (load-bearing):
 * - $0 by default — NO LLM call. Every signal is a structural / lexical
 *   check: emptiness, refusal patterns, truncation, delimiter balance,
 *   degenerate repetition, and (for code tasks) a real syntax parse via the
 *   TypeScript compiler (lazy-imported; degrades to delimiter checks when
 *   typescript is not installed) or JSON.parse for JSON output.
 * - Pure with respect to router state — recording the verdict into the
 *   bandit's learning stream is the CALLER's job (the hooks_model-verify
 *   MCP tool does it via ModelRouter.recordOutcome), keeping this module
 *   trivially unit-testable.
 * - Escalation ladder mirrors the tier table: tier 2 (haiku) → tier 3
 *   (sonnet), sonnet → opus, opus has no bump (escalate=false even when the
 *   verdict is not confident — the caller should retry or surface instead).
 *
 * Verdict semantics: `confident=false` means "cheap signals say this output
 * is likely unusable"; it is NOT a semantic-quality judgment. False
 * negatives (bad output that parses fine) are expected — this gate trades
 * recall for being free.
 *
 * @module ruvector/output-verifier
 */

export type VerifyTier = 1 | 2 | 3;
export type VerifyModel = 'haiku' | 'sonnet' | 'opus';
export type VerifyTaskKind = 'code' | 'json' | 'text' | 'auto';

export interface VerifyInput {
  /** The task the output was generated for. */
  task: string;
  /** The generated output to verify. */
  output: string;
  /** Model that produced the output (drives the escalation ladder). */
  model?: VerifyModel;
  /** Tier that produced the output; derived from `model` when absent. */
  tierUsed?: VerifyTier;
  /** Force the task kind; 'auto' (default) detects from task + output. */
  taskKind?: VerifyTaskKind;
  /** Minimum trimmed output length considered plausible (default 20). */
  minLength?: number;
}

export interface VerifySignal {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface VerifyVerdict {
  confident: boolean;
  /** Fraction of signals that passed (0..1). */
  score: number;
  /** Human-readable failure reasons; empty when confident. */
  reasons: string[];
  /** Every signal evaluated, pass or fail. */
  signals: VerifySignal[];
  /** Tier the caller should use next: unchanged when confident, bumped 2→3 on failure. */
  suggestedTier: VerifyTier;
  /** Concrete next model on the ladder (haiku→sonnet→opus); null when no bump exists. */
  suggestedModel: VerifyModel | null;
  /** True when not confident AND a higher tier exists to escalate to. */
  escalate: boolean;
  /** Detected task kind after 'auto' resolution. */
  taskKind: Exclude<VerifyTaskKind, 'auto'>;
}

const MODEL_TIER: Record<VerifyModel, VerifyTier> = { haiku: 2, sonnet: 3, opus: 3 };
const NEXT_MODEL: Record<VerifyModel, VerifyModel | null> = {
  haiku: 'sonnet',
  sonnet: 'opus',
  opus: null,
};

// Refusal phrasings scanned near the start of the output. Anchored to the
// head so a legitimate answer that *discusses* refusals doesn't trip it.
const REFUSAL_HEAD_CHARS = 240;
const REFUSAL_PATTERNS: RegExp[] = [
  /\bI\s+(?:can(?:no|')t|cannot)\s+(?:help|assist|do|provide|comply|fulfill|complete|write|generate)\b/i,
  /\bI(?:'m| am)\s+(?:sorry|afraid)\b[\s\S]{0,60}\b(?:can(?:no|')t|cannot|unable)\b/i,
  /\bI(?:'m| am)\s+(?:unable|not able)\s+to\b/i,
  /\bI\s+(?:must|have to)\s+(?:decline|refuse)\b/i,
  /\bI\s+won'?t\s+be\s+able\s+to\b/i,
  /\bas an AI(?:\s+(?:language\s+)?model)?[,\s]+I\b/i,
];

// A trailing dangling operator / opener strongly suggests a mid-expression cutoff.
const TRUNCATION_TAIL = /(?:,|&&|\|\||=>|[+*/%=]|\(|\[|\{|\bconst|\blet|\bvar|\bfunction|\breturn|:)\s*$/;

interface ExtractedCode {
  lang: string;
  code: string;
}

/** Pull fenced code blocks out of markdown-ish output. */
export function extractCodeBlocks(output: string): ExtractedCode[] {
  const blocks: ExtractedCode[] = [];
  const re = /```([A-Za-z0-9_-]*)\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(output)) !== null) {
    blocks.push({ lang: (m[1] || '').toLowerCase(), code: m[2] });
  }
  return blocks;
}

/** Cheap stack-based bracket balance check that skips string/comment-ish content. */
export function bracketsBalanced(code: string): boolean {
  const stack: string[] = [];
  const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
  let inString: string | null = null;
  let inLineComment = false;
  let inBlockComment = false;
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    const next = code[i + 1];
    if (inLineComment) { if (c === '\n') inLineComment = false; continue; }
    if (inBlockComment) { if (c === '*' && next === '/') { inBlockComment = false; i++; } continue; }
    if (inString) {
      if (c === '\\') { i++; continue; }
      if (c === inString) inString = null;
      continue;
    }
    if (c === '/' && next === '/') { inLineComment = true; i++; continue; }
    if (c === '/' && next === '*') { inBlockComment = true; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { inString = c; continue; }
    if (c === '(' || c === '[' || c === '{') stack.push(c);
    else if (c === ')' || c === ']' || c === '}') {
      if (stack.pop() !== pairs[c]) return false;
    }
  }
  return stack.length === 0;
}

const CODE_TASK_HINT = /\b(?:code|function|class|implement|refactor|typescript|javascript|python|script|method|api endpoint|unit test)\b/i;
const CODE_OUTPUT_HINT = /(?:^|\n)\s*(?:import\s|export\s|function\s|class\s|const\s|let\s|def\s|return\s)/;

function detectTaskKind(input: VerifyInput): Exclude<VerifyTaskKind, 'auto'> {
  if (input.taskKind && input.taskKind !== 'auto') return input.taskKind;
  if (/\bjson\b/i.test(input.task) && /^[\s]*[[{]/.test(input.output.trim())) return 'json';
  if (extractCodeBlocks(input.output).length > 0) return 'code';
  if (CODE_TASK_HINT.test(input.task) && CODE_OUTPUT_HINT.test(input.output)) return 'code';
  return 'text';
}

/**
 * Syntax-check a JS/TS snippet. Uses the TypeScript compiler when available
 * (transpileModule with reportDiagnostics catches syntactic errors without
 * type-checking — cheap, no program construction). Falls back to bracket
 * balance when typescript is not installed.
 */
async function checkCodeParses(code: string, lang: string): Promise<{ ok: boolean; detail?: string }> {
  if (lang === 'json') {
    try { JSON.parse(code); return { ok: true }; }
    catch (e) { return { ok: false, detail: `JSON.parse failed: ${e instanceof Error ? e.message : String(e)}` }; }
  }
  const jsLike = ['', 'js', 'jsx', 'ts', 'tsx', 'javascript', 'typescript', 'mjs', 'cjs'].includes(lang);
  if (!jsLike) {
    // Non-JS languages: bracket balance is the best free proxy we have.
    return bracketsBalanced(code)
      ? { ok: true, detail: `no parser for lang="${lang}"; delimiter check only` }
      : { ok: false, detail: `unbalanced delimiters in ${lang} block` };
  }
  try {
    const ts = (await import('typescript')).default;
    const result = ts.transpileModule(code, {
      reportDiagnostics: true,
      compilerOptions: { jsx: ts.JsxEmit.Preserve, allowJs: true },
    });
    const syntaxErrors = (result.diagnostics ?? []).filter(d => d.category === ts.DiagnosticCategory.Error);
    if (syntaxErrors.length > 0) {
      const first = syntaxErrors[0];
      const msg = ts.flattenDiagnosticMessageText(first.messageText, ' ');
      return { ok: false, detail: `syntax error: ${msg}` };
    }
    return { ok: true };
  } catch {
    // typescript not installed — graceful degradation, delimiter check only.
    return bracketsBalanced(code)
      ? { ok: true, detail: 'typescript unavailable; delimiter check only' }
      : { ok: false, detail: 'typescript unavailable; unbalanced delimiters' };
  }
}

/** Detect degenerate repetition (same non-trivial line repeated many times in a row). */
function isDegenerate(output: string): boolean {
  const lines = output.split('\n').map(l => l.trim()).filter(l => l.length > 8);
  let run = 1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === lines[i - 1]) {
      run++;
      if (run >= 5) return true;
    } else {
      run = 1;
    }
  }
  return false;
}

/**
 * Compute a confidence verdict for `output` from cheap structural signals,
 * and suggest an escalation target when not confident.
 */
export async function verifyAndEscalate(input: VerifyInput): Promise<VerifyVerdict> {
  const output = input.output ?? '';
  const trimmed = output.trim();
  const minLength = input.minLength ?? 20;
  const taskKind = detectTaskKind(input);
  const model: VerifyModel = input.model ?? 'haiku';
  const tierUsed: VerifyTier = input.tierUsed ?? MODEL_TIER[model] ?? 2;

  const signals: VerifySignal[] = [];
  const reasons: string[] = [];
  const fail = (name: string, detail: string) => {
    signals.push({ name, ok: false, detail });
    reasons.push(`${name}: ${detail}`);
  };
  const pass = (name: string, detail?: string) => signals.push({ name, ok: true, detail });

  // 1. Emptiness
  if (trimmed.length === 0) fail('empty-output', 'output is empty or whitespace-only');
  else pass('empty-output');

  // 2. Plausible length (skip when already flagged empty)
  if (trimmed.length > 0 && trimmed.length < minLength) {
    fail('too-short', `output is ${trimmed.length} chars (< ${minLength})`);
  } else if (trimmed.length > 0) {
    pass('too-short');
  }

  // 3. Refusal patterns near the head
  const head = trimmed.slice(0, REFUSAL_HEAD_CHARS);
  const refusal = REFUSAL_PATTERNS.find(p => p.test(head));
  if (refusal) fail('refusal', `refusal pattern near start of output (${refusal.source.slice(0, 40)}…)`);
  else pass('refusal');

  // 4. Truncation: unclosed code fence, or dangling operator/opener at the tail
  const fenceCount = (output.match(/```/g) ?? []).length;
  if (fenceCount % 2 !== 0) {
    fail('truncation', 'unclosed code fence (odd number of ``` markers)');
  } else if (trimmed.length > 0 && TRUNCATION_TAIL.test(trimmed)) {
    fail('truncation', `output ends mid-expression ("…${trimmed.slice(-24).replace(/\n/g, '\\n')}")`);
  } else {
    pass('truncation');
  }

  // 5. Degenerate repetition
  if (isDegenerate(trimmed)) fail('degenerate-repetition', 'same line repeated 5+ times consecutively');
  else pass('degenerate-repetition');

  // 6. Code / JSON parse checks
  if (taskKind === 'code' || taskKind === 'json') {
    const blocks = extractCodeBlocks(output);
    const targets: ExtractedCode[] = blocks.length > 0
      ? blocks
      : [{ lang: taskKind === 'json' ? 'json' : '', code: output }];
    let allOk = true;
    const details: string[] = [];
    for (const block of targets) {
      const check = await checkCodeParses(block.code, taskKind === 'json' ? 'json' : block.lang);
      if (!check.ok) {
        allOk = false;
        details.push(check.detail ?? 'parse failed');
      } else if (check.detail) {
        details.push(check.detail);
      }
    }
    if (allOk) pass('code-parses', details.join('; ') || undefined);
    else fail('code-parses', details.join('; '));
  }

  const passed = signals.filter(s => s.ok).length;
  const score = signals.length > 0 ? passed / signals.length : 0;
  const confident = reasons.length === 0;

  const nextModel = NEXT_MODEL[model] ?? null;
  const suggestedModel = confident ? null : nextModel;
  const suggestedTier: VerifyTier = confident
    ? tierUsed
    : (nextModel !== null ? (Math.min(3, tierUsed + 1) as VerifyTier) : tierUsed);
  const escalate = !confident && nextModel !== null;

  if (!confident && nextModel === null) {
    reasons.push('already-at-top-tier: no higher tier to escalate to — retry or surface to the user');
  }

  return { confident, score, reasons, signals, suggestedTier, suggestedModel, escalate, taskKind };
}

export default verifyAndEscalate;
