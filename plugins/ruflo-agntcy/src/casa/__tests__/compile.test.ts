/**
 * Tests for the deterministic CASA intent compiler (ADR-380 §3 / ADR-240 §4).
 */

import { describe, it, expect } from 'vitest';
import {
  compileIntentToEnvelope,
  DANGEROUS_SCOPES,
  DEFAULT_BUDGET_USD,
  DEFAULT_TTL_MINUTES,
} from '../compile.js';
import { CasaEnvelopeSchema } from '../schema.js';

const FIXED_NOW = new Date('2026-07-30T21:00:00.000Z');

describe('compileIntentToEnvelope', () => {
  it('compiles a plain read/audit objective to repository.read + tests.execute, no dangerous scopes', () => {
    const envelope = compileIntentToEnvelope('review repository security', { now: () => FIXED_NOW });

    expect(envelope.allow).toContain('repository.read');
    expect(envelope.allow).toContain('tests.execute');
    for (const scope of DANGEROUS_SCOPES) {
      expect(envelope.allow).not.toContain(scope);
      expect(envelope.deny).toContain(scope);
    }
  });

  it('produces output that validates against CasaEnvelopeSchema', () => {
    const envelope = compileIntentToEnvelope('audit the codebase for vulnerabilities', { now: () => FIXED_NOW });
    expect(() => CasaEnvelopeSchema.parse(envelope)).not.toThrow();
  });

  it('defaults budget_usd and expires_at when opts are omitted', () => {
    const envelope = compileIntentToEnvelope('inspect the auth module', { now: () => FIXED_NOW });
    expect(envelope.budget_usd).toBe(DEFAULT_BUDGET_USD);
    expect(envelope.expires_at).toBe(
      new Date(FIXED_NOW.getTime() + DEFAULT_TTL_MINUTES * 60_000).toISOString(),
    );
  });

  it('honors defaultBudgetUsd and defaultTtlMinutes overrides', () => {
    const envelope = compileIntentToEnvelope('review the repo', {
      now: () => FIXED_NOW,
      defaultBudgetUsd: 8,
      defaultTtlMinutes: 15,
    });
    expect(envelope.budget_usd).toBe(8);
    expect(envelope.expires_at).toBe(new Date(FIXED_NOW.getTime() + 15 * 60_000).toISOString());
  });

  it('never puts a dangerous scope in allow unless the objective explicitly names it', () => {
    const neutralObjectives = [
      'review repository security',
      'run the test suite',
      'audit dependencies for CVEs',
      'inspect the codebase',
      'analyze recent commits',
    ];
    for (const objective of neutralObjectives) {
      const envelope = compileIntentToEnvelope(objective, { now: () => FIXED_NOW });
      for (const scope of DANGEROUS_SCOPES) {
        expect(envelope.allow).not.toContain(scope);
      }
    }
  });

  it('grants git.push only when the objective explicitly says push', () => {
    const envelope = compileIntentToEnvelope('push the latest commits to the branch', { now: () => FIXED_NOW });
    expect(envelope.allow).toContain('git.push');
    expect(envelope.deny).not.toContain('git.push');
    // Other dangerous scopes remain denied since they were not named.
    expect(envelope.allow).not.toContain('secret.export');
    expect(envelope.allow).not.toContain('deployment.create');
  });

  it('grants deployment.create only when the objective explicitly says deploy/publish/release', () => {
    for (const objective of ['deploy the service to production', 'publish the new version', 'release v2.0']) {
      const envelope = compileIntentToEnvelope(objective, { now: () => FIXED_NOW });
      expect(envelope.allow).toContain('deployment.create');
      expect(envelope.deny).not.toContain('deployment.create');
    }
  });

  it('does not grant git.push for objectives that merely contain the bare word "push" in an unrelated sense', () => {
    const falsePositives = [
      'push notification integration for mobile app',
      'push back on the proposed schema change',
      'please push through this urgent bug fix',
    ];
    for (const objective of falsePositives) {
      const envelope = compileIntentToEnvelope(objective, { now: () => FIXED_NOW });
      expect(envelope.allow).not.toContain('git.push');
      expect(envelope.deny).toContain('git.push');
    }
  });

  it('does not grant deployment.create for objectives that merely contain "publish"/"release"/"deploy" in an unrelated sense', () => {
    const falsePositives = [
      'review the release notes for security issues',
      'check for a new release of the dependency',
      'publish a blog post about our roadmap',
      'audit the changelog before we publish it',
    ];
    for (const objective of falsePositives) {
      const envelope = compileIntentToEnvelope(objective, { now: () => FIXED_NOW });
      expect(envelope.allow).not.toContain('deployment.create');
      expect(envelope.deny).toContain('deployment.create');
    }
  });

  it('grants secret.export only when the objective explicitly says export secrets', () => {
    const envelope = compileIntentToEnvelope('export secrets for the migration', { now: () => FIXED_NOW });
    expect(envelope.allow).toContain('secret.export');
    expect(envelope.deny).not.toContain('secret.export');
  });

  it('never allows a scope to appear in both allow and deny simultaneously', () => {
    const objectives = [
      'review repository security',
      'push the release branch',
      'deploy the service to production',
      'export secrets for the migration',
      'do absolutely nothing recognizable',
    ];
    for (const objective of objectives) {
      const envelope = compileIntentToEnvelope(objective, { now: () => FIXED_NOW });
      const overlap = envelope.allow.filter((scope) => envelope.deny.includes(scope));
      expect(overlap).toEqual([]);
    }
  });

  it('an objective matching no keywords yields an empty allow list and full dangerous deny list', () => {
    const envelope = compileIntentToEnvelope('do absolutely nothing recognizable', { now: () => FIXED_NOW });
    expect(envelope.allow).toEqual([]);
    expect([...envelope.deny].sort()).toEqual([...DANGEROUS_SCOPES].sort());
  });

  it('never calls an LLM/network: is synchronous and returns a plain object, not a Promise', () => {
    const result = compileIntentToEnvelope('review repository security', { now: () => FIXED_NOW });
    expect(result).not.toBeInstanceOf(Promise);
    expect(typeof result).toBe('object');
  });

  it('is deterministic — same objective + same clock yields byte-identical output', () => {
    const a = compileIntentToEnvelope('review repository security', { now: () => FIXED_NOW });
    const b = compileIntentToEnvelope('review repository security', { now: () => FIXED_NOW });
    expect(a).toEqual(b);
  });

  it('supports the documented translator extension point without calling it internally by default', () => {
    let called = false;
    const envelope = compileIntentToEnvelope('review repository security', {
      now: () => FIXED_NOW,
      translator: (objective) => {
        called = true;
        return { allow: ['custom.scope'] };
      },
    });
    expect(called).toBe(true);
    expect(envelope.allow).toContain('custom.scope');
    expect(envelope.allow).toContain('repository.read');
  });

  it('translator-added scope is removed from deny if it was a dangerous default', () => {
    const envelope = compileIntentToEnvelope('review repository security', {
      now: () => FIXED_NOW,
      translator: () => ({ allow: ['git.push'] }),
    });
    expect(envelope.allow).toContain('git.push');
    expect(envelope.deny).not.toContain('git.push');
  });

  it('translator output is re-validated and cannot produce a structurally invalid envelope', () => {
    // Type-valid (budget_usd is a number) but runtime-invalid (not positive) —
    // proves the translator patch is re-validated by CasaEnvelopeSchema, not
    // trusted blindly.
    expect(() =>
      compileIntentToEnvelope('review repository security', {
        now: () => FIXED_NOW,
        translator: () => ({ budget_usd: -5 }),
      }),
    ).toThrow();
  });
});
