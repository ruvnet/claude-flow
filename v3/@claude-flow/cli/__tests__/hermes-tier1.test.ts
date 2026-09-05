/**
 * Hermes-Agent Tier-1 adoptions (see docs/reviews/intelligence-system-audit-2026-05-29.md
 * → Hermes capability map):
 *   #14 — reasoning-tag scrubbing keeps extended-thinking blocks out of the
 *         learning trajectory (so DISTILL doesn't embed reasoning tokens).
 *   #6  — tool-loop circuit breaker warns/blocks on repeated consecutive
 *         failures of the same command.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { scrubReasoningBlocks } from '../src/mcp-tools/hooks-tools.js';
import {
  checkCommandLoop,
  recordCommandOutcome,
  _resetLoopHistory,
} from '../src/mcp-tools/tool-loop-guardrail.js';

describe('#14 — reasoning-tag scrubbing', () => {
  it('strips paired thinking/reasoning blocks', () => {
    expect(scrubReasoningBlocks('did it <think>secret CoT</think> ok')).toBe('did it  ok');
    expect(scrubReasoningBlocks('a<thinking>x</thinking>b')).toBe('ab');
    expect(scrubReasoningBlocks('a<reasoning>y</reasoning>b')).toBe('ab');
    expect(scrubReasoningBlocks('a<REASONING_SCRATCHPAD>z</REASONING_SCRATCHPAD>b')).toBe('ab');
  });
  it('leaves prose that merely mentions the tag untouched (boundary-gated)', () => {
    expect(scrubReasoningBlocks('We document the <think> tag here')).toBe('We document the <think> tag here');
  });
  it('is a no-op on tag-free text and non-strings', () => {
    expect(scrubReasoningBlocks('plain output')).toBe('plain output');
    expect(scrubReasoningBlocks(undefined as unknown as string)).toBe(undefined);
  });
});

describe('#6 — tool-loop circuit breaker', () => {
  beforeEach(() => _resetLoopHistory());

  it('allows until the warn threshold, then warns, then blocks', () => {
    const cmd = 'npm run flaky';
    expect(checkCommandLoop(cmd).verdict).toBe('allow');
    recordCommandOutcome(cmd, false);
    recordCommandOutcome(cmd, false);
    expect(checkCommandLoop(cmd).verdict).toBe('allow'); // 2 fails
    recordCommandOutcome(cmd, false);
    expect(checkCommandLoop(cmd).verdict).toBe('warn');  // 3 fails
    recordCommandOutcome(cmd, false);
    recordCommandOutcome(cmd, false);
    const v = checkCommandLoop(cmd);
    expect(v.verdict).toBe('block'); // 5 fails
    expect(v.consecutiveFailures).toBe(5);
    expect(v.hint).toMatch(/failed 5/);
  });

  it('a success resets the streak', () => {
    const cmd = 'pytest';
    for (let i = 0; i < 5; i++) recordCommandOutcome(cmd, false);
    expect(checkCommandLoop(cmd).verdict).toBe('block');
    recordCommandOutcome(cmd, true);
    expect(checkCommandLoop(cmd).verdict).toBe('allow');
  });

  it('interleaved other commands do not break the streak (exact-match only)', () => {
    recordCommandOutcome('build', false);
    recordCommandOutcome('ls', true);     // different command
    recordCommandOutcome('build', false);
    recordCommandOutcome('git status', true);
    recordCommandOutcome('build', false);
    expect(checkCommandLoop('build').verdict).toBe('warn'); // 3 build failures, ls/git ignored
    expect(checkCommandLoop('ls').verdict).toBe('allow');
  });
});
