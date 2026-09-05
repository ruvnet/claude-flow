// Structured Distillation regression tests (#2241 §SOTA, arXiv:2603.13017).
//
// Asserts the 4-field schema extractor behaves deterministically and the
// serialised form lands high-signal tokens (labels, paths) at the front.

import { describe, it, expect } from 'vitest';
import {
  distillTrajectoryContent,
  serialiseDistilled,
  distillAndSerialise,
  compressionRatio,
} from '../src/memory/structured-distill.js';

describe('distillTrajectoryContent — 4-field schema', () => {
  it('returns the four documented fields', () => {
    const d = distillTrajectoryContent('Refactored src/auth/middleware.ts to use jwt-verify helper.');
    expect(d.summary).toBeDefined();
    expect(d.detail).toBeDefined();
    expect(d.labels).toBeDefined();
    expect(d.paths).toBeDefined();
    expect(Array.isArray(d.labels)).toBe(true);
    expect(Array.isArray(d.paths)).toBe(true);
  });

  it('extracts file paths and file:line refs', () => {
    const d = distillTrajectoryContent(
      'Fix at src/auth/middleware.ts:45 — also touched __tests__/auth.test.ts and docs/auth.md.',
    );
    expect(d.paths).toContain('src/auth/middleware.ts:45');
    expect(d.paths).toContain('__tests__/auth.test.ts');
    expect(d.paths).toContain('docs/auth.md');
  });

  it('extracts action labels from the verb vocabulary', () => {
    const d = distillTrajectoryContent(
      'Refactor the authentication module. Add tests. Remove the dead branch.',
    );
    expect(d.labels).toContain('refactor');
    expect(d.labels).toContain('add');
    expect(d.labels).toContain('test');
    expect(d.labels).toContain('remove');
  });

  it('summary is the first sentence (capped)', () => {
    const d = distillTrajectoryContent(
      'Fixed the SQL injection bug. Wrapped the table identifier with validateSqlIdentifier. Added a regression test.',
    );
    expect(d.summary).toBe('Fixed the SQL injection bug.');
    expect(d.detail).toMatch(/Wrapped the table identifier/);
  });

  it('is deterministic — same input produces same output', () => {
    const text = 'Refactor src/foo.ts and add tests at __tests__/foo.test.ts:10';
    const a = distillTrajectoryContent(text);
    const b = distillTrajectoryContent(text);
    expect(a).toEqual(b);
  });

  it('handles empty input gracefully', () => {
    const d = distillTrajectoryContent('');
    expect(d.summary).toBe('');
    expect(d.detail).toBe('');
    expect(d.labels).toEqual([]);
    expect(d.paths).toEqual([]);
  });
});

describe('serialiseDistilled — embedding-ready format', () => {
  it('starts with the labels block (high-signal tokens lead)', () => {
    const d = distillTrajectoryContent(
      'Refactor src/middleware.ts to use jwt-verify. Updated docs/auth.md.',
    );
    const s = serialiseDistilled(d);
    expect(s.startsWith('[')).toBe(true);
  });

  it('includes a paths block when source contains file refs', () => {
    const d = distillTrajectoryContent(
      'Fix in src/auth.ts:45 plus a docs/auth.md update.',
    );
    const s = serialiseDistilled(d);
    expect(s.indexOf('paths:')).toBeGreaterThanOrEqual(0);
    expect(s).toContain('src/auth.ts:45');
  });
});

describe('compressionRatio — honest about the rule-based limit', () => {
  // The arXiv paper's 11× compression comes from a LEARNED distiller. Our
  // rule-based version preserves the full detail (paths + labels prepended),
  // so it does NOT compress in bytes — the schema is about *structure for
  // retrieval*, not size. A future round can plug in a learned compressor.
  it('does not bloat raw content beyond ~2× — rule-based preservation', () => {
    const raw = 'I refactored the authentication middleware in src/auth/middleware.ts. ' +
      'Replaced the manual JWT parsing logic with the jwt-verify helper from @claude-flow/security. ' +
      'This removes ~80 lines of duplicated code and centralises the token-validation contract. ' +
      'Touched src/auth/middleware.ts:45-128 and added a regression test at __tests__/auth-middleware.test.ts. ' +
      'Verified the change passes existing integration tests at __tests__/integration/auth.test.ts.';
    const r = compressionRatio(raw);
    // ratio > 1 means distilled is smaller; ratio < 1 means it grew.
    // Acceptable band: not larger than 2× (i.e. ratio >= 0.5).
    expect(r).toBeGreaterThanOrEqual(0.5);
  });
});
