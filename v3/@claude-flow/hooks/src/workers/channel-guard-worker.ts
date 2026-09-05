/**
 * ChannelGuard Worker — ADR-320 (this ADR; arXiv:2607.19430 "ChannelGuard").
 *
 * The finding: individually-safe agents still propagate prompt-injection
 * payloads to peers through inter-agent MESSAGE CHANNELS. Each hop's own
 * per-message safety check can pass, because the payload is a legitimate
 * output of that hop — the injection survives by riding along inside
 * otherwise-normal agent content. ChannelGuard closes that gap by
 * sanitizing message content at the routing boundary, before it reaches
 * the next agent.
 *
 * Relationship to prior art in this repo
 * ---------------------------------------
 * A CLI-only v1 already shipped directly to `main` (dream-cycle #2783,
 * commit 581cd2bf3) as `v3/@claude-flow/cli/src/security/channel-guard.ts`
 * — an on-demand `ruflo security channel-scan` command with its OWN
 * injection-phrase catalog (`src/security/injection-catalog.ts`). This ADR
 * specifically asks for the inter-agent gate to "reuse the REAL
 * InputValidator (don't reinvent it)" — the CLI v1 predates that
 * requirement and lives in a package (`@claude-flow/cli`) that doesn't
 * depend on `@claude-flow/security`'s InputValidator at all. This module
 * is the ADR-scope version: it imports `sanitizeString` from
 * `@claude-flow/security` (the same sanitizer `input-validator.ts` exposes
 * for system-boundary input) for the general-purpose stripping pass, and
 * layers channel-specific heuristics on top (role-shift, encoded-payload,
 * zero-width obfuscation) that address the message-channel threat model
 * specifically. It does not import or modify the CLI v1.
 *
 * Detection method (deterministic, no LLM call)
 * -----------------------------------------------
 * 1. Known injection-phrase catalog (role-override / exfiltration language).
 * 2. Mid-message role-shift: `system:` / `assistant:` / `user:` /
 *    `developer:` markers appearing INSIDE the message body. A marker at
 *    the very start of the message is allowed (legitimate preamble);
 *    one appearing later is a classic injection tell.
 * 3. Encoded-payload: long base64/hex runs that could hide an obfuscated
 *    instruction. Flagged, not decoded.
 * 4. Zero-width/bidi unicode obfuscation (U+200B-200D, U+FEFF, U+202A-E,
 *    U+2066-9) — no legitimate use in agent-to-agent text.
 *
 * Integration
 * ------------
 * `guardChannelMessage()` is wired directly into
 * `SwarmCommunication.sendMessage()` (`../swarm/index.ts`) — the one
 * concrete message-construction chokepoint that exists in this package.
 * NOTE (scope, verified before wiring): `@claude-flow/swarm`'s topology
 * coordinators (`queen-coordinator.ts`, `unified-coordinator.ts`,
 * mesh/hierarchical implementations) do NOT import `SwarmCommunication` —
 * they have their own, separate agent-communication code. Wiring here
 * therefore covers callers that route through the hooks package's
 * `SwarmCommunication` class (broadcastContext/queryAgents/handoff/etc, all
 * of which call `sendMessage` internally) but does NOT automatically cover
 * messages passed directly through `@claude-flow/swarm`'s coordinator
 * classes. That deeper wiring was judged too invasive to do safely without
 * a much closer read of each coordinator's message-passing internals — see
 * the ADR doc's "Deviations from proposal" section. `createChannelGuardHook`
 * below additionally exposes this as a registerable `HookEvent.PostTask`
 * handler (same registration shape as `ipi-detection-hook.ts`) for callers
 * who want to gate on that lifecycle event instead/also; it is NOT
 * eagerly registered on the default registry (unlike IPI's PreToolUse
 * hook) because `HookContext.data` semantics on PostTask vary by caller
 * and eager registration risked silently misfiring on non-message payloads.
 *
 * `CLAUDE_FLOW_SECURITY_CHANNEL_GATE=0` disables the gate entirely
 * (messages pass through unsanitized, no logging) — for trusted internal
 * environments per the ADR text.
 */

import { sanitizeString } from '@claude-flow/security';
import { HookEvent, HookPriority, type HookContext, type HookResult } from '../types.js';
import { HookRegistry, defaultRegistry } from '../registry/index.js';

// ============================================================================
// Types
// ============================================================================

export type ChannelFindingKind =
  | 'injection-phrase'
  | 'role-shift'
  | 'encoded-payload'
  | 'zero-width-obfuscation';

export interface ChannelFinding {
  kind: ChannelFindingKind;
  severity: 'low' | 'medium' | 'high';
  offset: number;
  span: string;
  reason: string;
}

export interface ChannelGuardOptions {
  minEncodedLen?: number;
  skipEncodedScan?: boolean;
}

export interface ChannelScanResult {
  safe: boolean;
  findings: ChannelFinding[];
  stats: { messageLength: number; scanTimeMs: number };
}

export interface ChannelGuardOutcome {
  /** Message content after sanitization (unchanged if the gate is disabled or the message was already safe). */
  content: string;
  /** Scan result, or null if the gate is disabled (`CLAUDE_FLOW_SECURITY_CHANNEL_GATE=0`). */
  result: ChannelScanResult | null;
}

// ============================================================================
// Detection catalog
// ============================================================================

const INJECTION_PHRASES = [
  'ignore previous instructions',
  'ignore all prior',
  'disregard the above',
  'you are now',
  'system prompt',
  'delete all',
  'rm -rf',
  'exfiltrate',
  'send me the',
  'reveal your',
  'reveal the',
  'override your',
  'jailbreak',
  'new instructions:',
  'do anything now',
] as const;

const ROLE_SHIFT_RE = /(^|\n)\s*(system|assistant|user|developer)\s*:\s*/gi;
const BASE64_RE = /\b[A-Za-z0-9+/]{80,}={0,2}/g;
const HEX_RE = /\b(?:0x)?[a-f0-9]{60,}\b/gi;
// Zero-width space/joiners, BOM, and bidi-override control characters.
// eslint-disable-next-line no-misleading-character-class
const ZWJ_RE = /[​-‍﻿‪-‮⁦-⁩]/g;

// ============================================================================
// Scan
// ============================================================================

export function scanChannelMessage(message: string, options: ChannelGuardOptions = {}): ChannelScanResult {
  const start = Date.now();
  const findings: ChannelFinding[] = [];
  const lower = message.toLowerCase();
  const minEncodedLen = options.minEncodedLen ?? 80;

  // 1) Known prompt-injection phrases
  for (const phrase of INJECTION_PHRASES) {
    let idx = lower.indexOf(phrase);
    while (idx >= 0) {
      findings.push({
        kind: 'injection-phrase',
        severity: 'high',
        offset: idx,
        span: message.slice(Math.max(0, idx - 8), idx + phrase.length + 24),
        reason: `Known injection phrase: "${phrase}"`,
      });
      idx = lower.indexOf(phrase, idx + phrase.length);
    }
  }

  // 2) Mid-message role-shift (a leading marker at offset 0 is a legitimate preamble)
  {
    ROLE_SHIFT_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    let seen = 0;
    while ((m = ROLE_SHIFT_RE.exec(message)) !== null) {
      seen++;
      if (seen === 1 && m.index === 0) continue;
      findings.push({
        kind: 'role-shift',
        severity: 'high',
        offset: m.index,
        span: m[0].trim(),
        reason: `Mid-message role marker (${m[2]}) — classic injection tell`,
      });
    }
  }

  // 3) Encoded-payload: suspiciously long base64/hex runs
  if (!options.skipEncodedScan) {
    BASE64_RE.lastIndex = 0;
    let b: RegExpExecArray | null;
    while ((b = BASE64_RE.exec(message)) !== null) {
      if (b[0].length < minEncodedLen) continue;
      findings.push({
        kind: 'encoded-payload',
        severity: 'medium',
        offset: b.index,
        span: `${b[0].slice(0, 40)}…`,
        reason: `Long base64 run (${b[0].length} chars) — may hide instructions`,
      });
    }
    HEX_RE.lastIndex = 0;
    let h: RegExpExecArray | null;
    while ((h = HEX_RE.exec(message)) !== null) {
      if (h[0].length < minEncodedLen) continue;
      findings.push({
        kind: 'encoded-payload',
        severity: 'medium',
        offset: h.index,
        span: `${h[0].slice(0, 40)}…`,
        reason: `Long hex run (${h[0].length} chars) — may hide instructions`,
      });
    }
  }

  // 4) Zero-width / bidi obfuscation
  {
    ZWJ_RE.lastIndex = 0;
    let z: RegExpExecArray | null;
    while ((z = ZWJ_RE.exec(message)) !== null) {
      findings.push({
        kind: 'zero-width-obfuscation',
        severity: 'high',
        offset: z.index,
        span: `U+${z[0].charCodeAt(0).toString(16).toUpperCase()}`,
        reason: 'Zero-width or bidi-override character — obfuscation attempt',
      });
    }
  }

  return {
    safe: findings.length === 0,
    findings,
    stats: { messageLength: message.length, scanTimeMs: Date.now() - start },
  };
}

// ============================================================================
// Sanitize
// ============================================================================

/**
 * Strips detected patterns from `message`. Reuses `sanitizeString`
 * (`@claude-flow/security`'s `input-validator.ts` — null bytes, HTML
 * brackets, `javascript:`/`data:` URIs) for the general-purpose pass, then
 * strips the channel-specific findings on top: zero-width/bidi characters
 * outright, and mid-message role-shift markers (the leading marker, if
 * any, is preserved — it's a legitimate preamble).
 *
 * This does not attempt to remove injection PHRASES or encoded-payload
 * runs from the text — rewriting natural language safely is unreliable;
 * those are reported via `findings` for the caller (and logged by
 * {@link guardChannelMessage}) rather than silently mutated.
 */
export function sanitizeChannelMessage(
  message: string,
  options: ChannelGuardOptions = {},
): { sanitized: string; result: ChannelScanResult } {
  const result = scanChannelMessage(message, options);

  let sanitized = sanitizeString(message);
  sanitized = sanitized.replace(ZWJ_RE, '');

  // Strip mid-message role-shift markers, preserving a legitimate leading one.
  let firstMatchSkipped = false;
  sanitized = sanitized.replace(ROLE_SHIFT_RE, (match, _leading, _role, offset) => {
    if (!firstMatchSkipped && offset === 0) {
      firstMatchSkipped = true;
      return match;
    }
    return match.startsWith('\n') ? '\n' : '';
  });

  return { sanitized, result };
}

// ============================================================================
// Gate (env-var controlled)
// ============================================================================

const CHANNEL_GATE_ENV = 'CLAUDE_FLOW_SECURITY_CHANNEL_GATE';

/** Reads `CLAUDE_FLOW_SECURITY_CHANNEL_GATE` fresh on every call. Only the literal value `'0'` disables the gate — everything else (including unset) keeps it enabled. */
export function isChannelGateEnabled(): boolean {
  return process.env[CHANNEL_GATE_ENV] !== '0';
}

/**
 * The gate itself: sanitizes `message` and logs a structured audit event
 * when findings are present, unless `CLAUDE_FLOW_SECURITY_CHANNEL_GATE=0`.
 * Call this at any point content is about to cross an inter-agent boundary.
 */
export function guardChannelMessage(message: string, options: ChannelGuardOptions = {}): ChannelGuardOutcome {
  if (!isChannelGateEnabled()) {
    return { content: message, result: null };
  }

  const { sanitized, result } = sanitizeChannelMessage(message, options);

  if (!result.safe) {
    console.warn(
      `[channel-guard] sanitized ${result.findings.length} finding(s) in inter-agent message ` +
        `(${result.stats.messageLength} chars, ${result.stats.scanTimeMs}ms scan)`,
    );
    for (const f of result.findings) {
      console.warn(`  - ${f.kind} (${f.severity}) @${f.offset}: ${f.reason}`);
    }
  }

  return { content: sanitized, result };
}

// ============================================================================
// Hook registration (HookEvent.PostTask) — opt-in, not eagerly registered
// ============================================================================

/**
 * Builds a `HookHandler` that reads `context.data` as the message body (when
 * it is a string), guards it, and surfaces any findings as `HookResult`
 * warnings plus the sanitized content in `HookResult.data.sanitizedContent`.
 * Never aborts — ChannelGuard is a sanitize+log gate, not a blocking one
 * (see the ADR: only the Composition Inspector has a block mode).
 */
export function createChannelGuardHandler() {
  return (context: HookContext): HookResult => {
    if (typeof context.data !== 'string') return { success: true };

    const outcome = guardChannelMessage(context.data);
    if (!outcome.result || outcome.result.safe) return { success: true };

    return {
      success: true,
      data: { sanitizedContent: outcome.content },
      warnings: outcome.result.findings.map((f) => `${f.kind}: ${f.reason}`),
    };
  };
}

/**
 * Registers the ChannelGuard handler on `HookEvent.PostTask` at
 * `HookPriority.Critical`. Returns the hook id (for `unregister`/tests).
 * Unlike `ipi-detection-hook.ts`'s `PreToolUse` handler, this is NOT
 * auto-registered on the default registry at module load — see the file
 * header for why. Callers opt in explicitly.
 */
export function registerChannelGuardHook(registry: HookRegistry = defaultRegistry): string {
  return registry.register(HookEvent.PostTask, createChannelGuardHandler(), HookPriority.Critical, {
    name: 'channel-guard',
    description: 'ADR-320 — ChannelGuard inter-agent message sanitization gate (arXiv:2607.19430)',
  });
}
