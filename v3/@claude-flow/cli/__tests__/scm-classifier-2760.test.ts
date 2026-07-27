/**
 * Regression guard for #2760 dream-cycle SCM (Selective Context Memory)
 * query-intent classifier.
 *
 * v1 classifier is keyword-scored. Must correctly route the three canonical
 * intent classes (episodic / semantic / procedural), degrade gracefully to
 * `mixed` on ambiguous queries, and honor an explicit override.
 */

import { describe, it, expect } from 'vitest';
import { classifyQueryIntent, resolveIntent, INTENT_NAMESPACES } from '../src/memory/scm-classifier.js';

describe('#2760 SCM classifier', () => {
  it('classifies episodic recall ("when did we last …")', () => {
    const r = classifyQueryIntent('When did we last touch the auth module?');
    expect(r.intent).toBe('episodic');
    expect(r.namespaces).toEqual(expect.arrayContaining(['sessions', 'trajectory']));
    expect(r.confidence).toBeGreaterThan(0.35);
  });

  it('classifies semantic explanation ("how does X work" / "what is Y")', () => {
    const r = classifyQueryIntent('What is the design principle behind our AgentDB memory tiers?');
    expect(r.intent).toBe('semantic');
    expect(r.namespaces).toEqual(expect.arrayContaining(['patterns']));
  });

  it('classifies procedural how-to ("how do I …" / "steps to …")', () => {
    const r = classifyQueryIntent('How do I set up a new subagent role with workspace-scoped permissions?');
    expect(r.intent).toBe('procedural');
    expect(r.namespaces).toEqual(expect.arrayContaining(['skills']));
  });

  it('falls back to mixed on an ambiguous query with no intent keywords', () => {
    const r = classifyQueryIntent('auth');
    expect(r.intent).toBe('mixed');
    expect(r.namespaces).toEqual([]);
    expect(r.confidence).toBeLessThan(0.35);
  });

  it('resolveIntent respects an explicit override', () => {
    const r = resolveIntent('completely ambiguous three word query', 'procedural');
    expect(r.intent).toBe('procedural');
    expect(r.namespaces).toEqual([...INTENT_NAMESPACES.procedural]);
  });

  it('resolveIntent auto path delegates to the keyword classifier', () => {
    const auto = resolveIntent('How do I onboard a new coder subagent?', 'auto');
    const direct = classifyQueryIntent('How do I onboard a new coder subagent?');
    expect(auto.intent).toBe(direct.intent);
  });

  it('resolveIntent mixed explicit returns full namespaces empty', () => {
    const r = resolveIntent('anything', 'mixed');
    expect(r.intent).toBe('mixed');
    expect(r.namespaces).toEqual([]);
  });
});
