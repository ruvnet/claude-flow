import { describe, expect, it } from 'vitest';
import {
  buildLearnedRoutingPatterns,
  type LearnedRoutingOutcome,
} from '../src/services/learned-routing.js';

const outcome = (
  agent: string,
  keywords: string[],
  quality = 0.9,
  success = true,
): LearnedRoutingOutcome => ({
  task: keywords.join(' '),
  agent,
  success,
  quality,
  keywords,
  timestamp: '2026-07-29T00:00:00.000Z',
});

describe('buildLearnedRoutingPatterns', () => {
  it('ranks supported agent-specific terms and removes shared noise (#2839)', () => {
    const patterns = buildLearnedRoutingPatterns([
      outcome('coder', ['implement', 'dashboard', 'shared', 'using']),
      outcome('coder', ['implement', 'component', 'shared', 'using']),
      outcome('tester', ['test', 'coverage', 'shared', 'using']),
      outcome('tester', ['test', 'regression', 'shared', 'using']),
    ]);
    expect(patterns['learned-coder'].keywords).toContain('implement');
    expect(patterns['learned-tester'].keywords).toContain('test');
    expect(patterns['learned-coder'].keywords).not.toContain('shared');
    expect(patterns['learned-tester'].keywords).not.toContain('using');
  });

  it('does not learn from one-off, failed, or low-quality outcomes', () => {
    const patterns = buildLearnedRoutingPatterns([
      outcome('researcher', ['research'], 0.95),
      outcome('coder', ['implement'], 0.2),
      outcome('tester', ['test'], 0.95, false),
    ]);
    expect(patterns).toEqual({});
  });

  it('allows later repeated evidence to displace early insertion noise', () => {
    const patterns = buildLearnedRoutingPatterns([
      outcome('reviewer', ['early-noise', 'security']),
      outcome('reviewer', ['security', 'audit']),
      outcome('reviewer', ['security', 'review']),
      outcome('reviewer', ['security', 'vulnerability']),
    ], { maxKeywords: 2 });
    expect(patterns['learned-reviewer'].keywords[0]).toBe('security');
    expect(patterns['learned-reviewer'].keywords).not.toContain('early-noise');
  });
});
