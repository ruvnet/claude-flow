/**
 * Regression guard for ruvnet/ruflo#1906 — model aliases must map to
 * current (Claude 4.x) model ids, not the deprecated Claude-3.x ids that
 * the Anthropic API now 404s.
 */
import { describe, it, expect } from 'vitest';
import { resolveAnthropicModel, DEFAULT_ANTHROPIC_MODEL } from '../src/mcp-tools/agent-execute-core.js';

describe('#1906 — agent_execute model aliases resolve to current Claude 4.x ids', () => {
  it('haiku → claude-haiku-4-5-20251001', () => {
    expect(resolveAnthropicModel('haiku')).toBe('claude-haiku-4-5-20251001');
  });
  it('sonnet → claude-sonnet-5 (bumped from 4-6)', () => {
    expect(resolveAnthropicModel('sonnet')).toBe('claude-sonnet-5');
  });
  it('sonnet-4.6 reaches the prior pin', () => {
    expect(resolveAnthropicModel('sonnet-4.6')).toBe('claude-sonnet-4-6');
  });
  it('opus → claude-opus-4-8 (#2232 alias bump)', () => {
    expect(resolveAnthropicModel('opus')).toBe('claude-opus-4-8');
  });
  it('opus-4.7 reaches the prior pin', () => {
    expect(resolveAnthropicModel('opus-4.7')).toBe('claude-opus-4-7');
  });
  it('inherit → the default (sonnet 5)', () => {
    expect(resolveAnthropicModel('inherit')).toBe('claude-sonnet-5');
    expect(DEFAULT_ANTHROPIC_MODEL).toBe('claude-sonnet-5');
  });
  it('undefined → the default', () => {
    expect(resolveAnthropicModel(undefined)).toBe(DEFAULT_ANTHROPIC_MODEL);
  });
  it('anthropic:<id> prefix is stripped', () => {
    expect(resolveAnthropicModel('anthropic:claude-opus-4-7')).toBe('claude-opus-4-7');
  });
  it('a bare model id passes through unchanged', () => {
    expect(resolveAnthropicModel('claude-sonnet-4-6')).toBe('claude-sonnet-4-6');
  });
  it('no alias resolves to a deprecated claude-3.x id (#1906 regression)', () => {
    for (const alias of ['haiku', 'sonnet', 'opus', 'inherit', undefined]) {
      expect(resolveAnthropicModel(alias as string | undefined)).not.toMatch(/^claude-3[.-]/);
    }
  });
});
