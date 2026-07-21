/**
 * #2661 root-fix — structured per-launch token telemetry.
 *
 * parseClaudePrintJsonEnvelope() is deliberately lenient: `claude --print
 * --output-format json`'s schema isn't a versioned public contract, so any
 * mismatch must degrade to "no usage captured" (null) rather than throw —
 * the caller then falls back to the raw stdout text, preserving today's
 * behavior for every existing worker.
 */

import { describe, it, expect } from 'vitest';
import { parseClaudePrintJsonEnvelope } from '../../src/services/headless-worker-executor.js';

describe('#2661 root-fix — parseClaudePrintJsonEnvelope', () => {
  it('extracts result text, usage, cost, and duration from a well-formed envelope', () => {
    const raw = JSON.stringify({
      type: 'result',
      is_error: false,
      result: 'the actual analysis text',
      total_cost_usd: 0.0031,
      duration_ms: 4521,
      usage: { input_tokens: 1200, output_tokens: 340 },
    });
    const parsed = parseClaudePrintJsonEnvelope(raw);
    expect(parsed).toEqual({
      result: 'the actual analysis text',
      inputTokens: 1200,
      outputTokens: 340,
      costUsd: 0.0031,
      durationMs: 4521,
    });
  });

  it('tolerates camelCase field-name variants', () => {
    const raw = JSON.stringify({
      result: 'text',
      totalCostUsd: 0.01,
      durationMs: 100,
      usage: { inputTokens: 10, outputTokens: 5 },
    });
    const parsed = parseClaudePrintJsonEnvelope(raw);
    expect(parsed).toEqual({ result: 'text', inputTokens: 10, outputTokens: 5, costUsd: 0.01, durationMs: 100 });
  });

  it('returns null for plain (non-JSON) text output — the common case before this feature existed', () => {
    expect(parseClaudePrintJsonEnvelope('Just a plain analysis report, no JSON here.')).toBeNull();
  });

  it('returns null for malformed JSON rather than throwing', () => {
    expect(parseClaudePrintJsonEnvelope('{not: valid, json')).toBeNull();
  });

  it('returns null when the parsed JSON has no `result` field (unexpected schema)', () => {
    expect(parseClaudePrintJsonEnvelope(JSON.stringify({ foo: 'bar' }))).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(parseClaudePrintJsonEnvelope('')).toBeNull();
    expect(parseClaudePrintJsonEnvelope('   ')).toBeNull();
  });

  it('still returns the result text even when usage/cost/duration are absent', () => {
    const parsed = parseClaudePrintJsonEnvelope(JSON.stringify({ result: 'text only' }));
    expect(parsed).toEqual({
      result: 'text only',
      inputTokens: undefined,
      outputTokens: undefined,
      costUsd: undefined,
      durationMs: undefined,
    });
  });

  it('ignores non-numeric usage fields instead of propagating garbage', () => {
    const raw = JSON.stringify({ result: 'text', usage: { input_tokens: 'not-a-number', output_tokens: null } });
    const parsed = parseClaudePrintJsonEnvelope(raw);
    expect(parsed?.inputTokens).toBeUndefined();
    expect(parsed?.outputTokens).toBeUndefined();
  });

  it('handles a JSON array (not an object) gracefully', () => {
    expect(parseClaudePrintJsonEnvelope('[1,2,3]')).toBeNull();
  });
});
