// Hybrid retrieval — pure-function tests (ADR-078).
//
// These tests do not touch the neural store, embeddings, or any I/O. They
// pin the behaviour of the building blocks so the wiring in neural-tools.ts
// can rely on them.

import { describe, it, expect } from 'vitest';
import {
  tokenize,
  buildCorpusStats,
  bm25Score,
  normalise,
  hybridScores,
  cosineSim,
  mmrRerank,
  multiFieldBM25,
  typePenalty,
  META_COMMIT_REGEX,
} from '../src/memory/hybrid-retrieval.js';

describe('tokenize', () => {
  it('lowercases + splits on non-alphanumeric', () => {
    const t = tokenize('Refactor src/Auth/middleware.ts to use jwt-verify!');
    // Keeps '/' '-' '.' for paths/identifiers; drops punctuation.
    expect(t).toContain('refactor');
    expect(t).toContain('src/auth/middleware.ts');
    expect(t).toContain('jwt-verify');
  });

  it('drops stopwords and tokens shorter than 3 chars', () => {
    const t = tokenize('the cat is on a mat');
    // 'the','is','on','a' are stopwords; 'cat'/'mat' length 3 stay.
    expect(t).not.toContain('the');
    expect(t).not.toContain('is');
    expect(t).toContain('cat');
    expect(t).toContain('mat');
  });

  it('handles empty / null-ish input', () => {
    expect(tokenize('')).toEqual([]);
  });
});

describe('buildCorpusStats + bm25Score', () => {
  const docs = [
    tokenize('refactor authentication middleware src/auth.ts'),
    tokenize('add unit tests for src/auth.ts middleware'),
    tokenize('bump release version chore'),
    tokenize('fix sql injection in src/db/migrate.ts'),
  ];
  const stats = buildCorpusStats(docs);

  it('counts documents and averages doc length', () => {
    expect(stats.N).toBe(4);
    expect(stats.avgDocLen).toBeGreaterThan(0);
  });

  it('builds IDF — rare tokens score higher than common ones', () => {
    // 'src/auth.ts' appears in 2/4 docs; 'sql' appears in 1/4 — 'sql' is rarer.
    const idfSql = stats.idf.get('sql') ?? 0;
    const idfAuth = stats.idf.get('src/auth.ts') ?? 0;
    expect(idfSql).toBeGreaterThan(idfAuth);
  });

  it('ranks the relevant doc highest for an exact-token query', () => {
    const q = tokenize('sql injection migrate');
    const scores = docs.map((d) => bm25Score(q, d, stats));
    const top = scores.indexOf(Math.max(...scores));
    expect(top).toBe(3); // The "fix sql injection" doc
  });

  it('returns 0 when there is no token overlap', () => {
    const q = tokenize('quantum computing breakthrough');
    const scores = docs.map((d) => bm25Score(q, d, stats));
    expect(Math.max(...scores)).toBe(0);
  });
});

describe('normalise', () => {
  it('maps to [0,1] preserving relative order', () => {
    const out = normalise([1, 3, 5, 7]);
    expect(out[0]).toBe(0);
    expect(out[3]).toBe(1);
    expect(out[1]).toBeLessThan(out[2]);
  });

  it('handles constant vectors without divide-by-zero', () => {
    const out = normalise([0.5, 0.5, 0.5]);
    expect(out).toEqual([0.5, 0.5, 0.5]);
  });

  it('handles empty input', () => {
    expect(normalise([])).toEqual([]);
  });
});

describe('hybridScores', () => {
  it('linearly combines cosine and BM25 on normalised scales', () => {
    const cosine = [0.1, 0.5, 0.9];
    const bm25 = [3.0, 1.0, 0.0];
    const hybrid = hybridScores(cosine, bm25, 0.5);
    // index 0 has low cosine but high BM25 → should beat index 1's middling both.
    expect(hybrid[0]).toBeGreaterThan(hybrid[1]);
    // index 2 has high cosine but 0 BM25 → roughly comparable to index 0.
    expect(hybrid[2]).toBeGreaterThan(0);
  });

  it('alpha=1 collapses to cosine ordering', () => {
    const cosine = [0.1, 0.9, 0.5];
    const bm25 = [10, 0, 5];
    const hybrid = hybridScores(cosine, bm25, 1.0);
    const order = hybrid.map((s, i) => [i, s]).sort((a, b) => (b[1] as number) - (a[1] as number)).map((x) => x[0]);
    expect(order[0]).toBe(1); // highest cosine wins
  });

  it('alpha=0 collapses to BM25 ordering', () => {
    const cosine = [0.9, 0.1, 0.5];
    const bm25 = [0, 10, 5];
    const hybrid = hybridScores(cosine, bm25, 0.0);
    const order = hybrid.map((s, i) => [i, s]).sort((a, b) => (b[1] as number) - (a[1] as number)).map((x) => x[0]);
    expect(order[0]).toBe(1); // highest BM25 wins
  });

  it('throws on mismatched lengths', () => {
    expect(() => hybridScores([0.1], [0.2, 0.3], 0.5)).toThrow();
  });
});

describe('cosineSim', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosineSim([1, 0, 0], [1, 0, 0])).toBeCloseTo(1, 6);
  });
  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSim([1, 0], [0, 1])).toBe(0);
  });
  it('returns 0 on zero-norm input', () => {
    expect(cosineSim([0, 0, 0], [1, 1, 1])).toBe(0);
  });
});

describe('mmrRerank', () => {
  it('picks the top-relevance candidate first', () => {
    const cands = [
      { id: 'a', embedding: [1, 0, 0], relevance: 0.5 },
      { id: 'b', embedding: [0, 1, 0], relevance: 0.9 },
      { id: 'c', embedding: [0, 0, 1], relevance: 0.3 },
    ];
    const out = mmrRerank(cands, 3, 0.5);
    expect(out[0].id).toBe('b');
  });

  it('suppresses near-duplicates when lambda<1', () => {
    // Two near-identical embeddings with high relevance, one distinct lower one.
    const cands = [
      { id: 'dup1', embedding: [1.0, 0.0, 0.0], relevance: 0.95 },
      { id: 'dup2', embedding: [0.99, 0.01, 0.0], relevance: 0.93 },
      { id: 'diverse', embedding: [0.0, 0.0, 1.0], relevance: 0.6 },
    ];
    const out = mmrRerank(cands, 2, 0.3); // bias hard toward diversity
    expect(out[0].id).toBe('dup1');
    // With strong diversity bias the second pick should be the diverse one,
    // not the near-duplicate.
    expect(out[1].id).toBe('diverse');
  });

  it('lambda=1.0 ignores diversity (pure relevance ordering)', () => {
    const cands = [
      { id: 'dup1', embedding: [1.0, 0.0], relevance: 0.95 },
      { id: 'dup2', embedding: [0.99, 0.01], relevance: 0.93 },
      { id: 'diverse', embedding: [0.0, 1.0], relevance: 0.6 },
    ];
    const out = mmrRerank(cands, 2, 1.0);
    expect(out.map((o) => o.id)).toEqual(['dup1', 'dup2']);
  });

  it('handles empty and k=0', () => {
    expect(mmrRerank([], 3, 0.5)).toEqual([]);
    expect(mmrRerank([{ id: 'x', embedding: [1], relevance: 1 }], 0, 0.5)).toEqual([]);
  });
});

describe('multiFieldBM25 — subject-weighted BM25 (ADR-079)', () => {
  // 4 docs with subject + body, body intentionally noisy.
  const subjects = [
    tokenize('fix sql injection in migrate.ts'),
    tokenize('feat structured distillation 4-field schema'),
    tokenize('chore release bump 3.10.18'),
    tokenize('docs update README'),
  ];
  const bodies = [
    tokenize('Adds validateSqlIdentifier and a regression test'),
    tokenize('Per arXiv:2603.13017. labels and paths lead the embedding'),
    tokenize('Routine version bump; no functional changes. Lots of generic words bump release version'),
    tokenize('Generic README updates everywhere'),
  ];
  const subjectStats = buildCorpusStats(subjects);
  const bodyStats = buildCorpusStats(bodies);

  it('ranks the doc whose SUBJECT contains query tokens highest', () => {
    const q = tokenize('structured distillation schema');
    const scores = subjects.map((_, i) =>
      multiFieldBM25(q, subjects[i], bodies[i], subjectStats, bodyStats, 3.0, 1.0),
    );
    const top = scores.indexOf(Math.max(...scores));
    expect(top).toBe(1);
  });

  it('subjectWeight=0 collapses to body-only', () => {
    const q = tokenize('validateSqlIdentifier');
    const scoresBodyOnly = subjects.map((_, i) =>
      multiFieldBM25(q, subjects[i], bodies[i], subjectStats, bodyStats, 0, 1.0),
    );
    const scoresBalanced = subjects.map((_, i) =>
      multiFieldBM25(q, subjects[i], bodies[i], subjectStats, bodyStats, 3.0, 1.0),
    );
    // Body-only should match doc 0 (sql fix has validateSqlIdentifier in body).
    // Balanced should still match doc 0 since subject also helps via "sql"...
    // but specifically: body-only score for doc 0 should be >0.
    expect(scoresBodyOnly[0]).toBeGreaterThan(0);
    expect(scoresBalanced[0]).toBeGreaterThan(0);
  });

  it('subject 3× over body avoids losing to body-noise', () => {
    // Query "release" appears in doc 2's subject AND doc 2's body multiple times.
    // doc 2 should dominate.
    const q = tokenize('release bump');
    const scores = subjects.map((_, i) =>
      multiFieldBM25(q, subjects[i], bodies[i], subjectStats, bodyStats, 3.0, 1.0),
    );
    expect(scores.indexOf(Math.max(...scores))).toBe(2);
  });
});

describe('typePenalty — meta-commit downweighting (ADR-079)', () => {
  it('matches chore(release) commits', () => {
    expect(typePenalty('chore(release): bump 3.10.18 → 3.10.19')).toBe(0.5);
    expect(typePenalty('chore(release): publish 3.10.19')).toBe(0.5);
  });

  it('matches Merge commits', () => {
    expect(typePenalty('Merge pull request #2227 from fix/2245')).toBe(0.5);
    expect(typePenalty('Merge feat/hybrid-retrieval: ADR-078 work')).toBe(0.5);
  });

  it('matches bump and publish lines', () => {
    expect(typePenalty('bump 3.10.18 → 3.10.19')).toBe(0.5);
    expect(typePenalty('publish 3.10.19 to npm')).toBe(0.5);
  });

  it('matches Dream Cycle scans', () => {
    expect(typePenalty('[Dream Cycle 2026-05-30] intelligence findings')).toBe(0.5);
  });

  it('does NOT penalise real work commits', () => {
    expect(typePenalty('feat(intelligence): structured distillation (ADR-076)')).toBe(1.0);
    expect(typePenalty('fix(security): SQL injection in migrate.ts')).toBe(1.0);
    expect(typePenalty('docs(adr): ADR-078 hybrid retrieval')).toBe(1.0);
  });

  it('handles undefined name safely', () => {
    expect(typePenalty(undefined)).toBe(1.0);
    expect(typePenalty('')).toBe(1.0);
  });

  it('respects custom factor', () => {
    expect(typePenalty('chore(release): bump', 0.0)).toBe(0.0);
    expect(typePenalty('chore(release): bump', 0.25)).toBe(0.25);
  });

  it('regex covers the documented meta-commit patterns', () => {
    expect(META_COMMIT_REGEX.test('chore(release): x')).toBe(true);
    expect(META_COMMIT_REGEX.test('Merge x')).toBe(true);
    expect(META_COMMIT_REGEX.test('bump x')).toBe(true);
    expect(META_COMMIT_REGEX.test('feat: x')).toBe(false);
    expect(META_COMMIT_REGEX.test('fix: x')).toBe(false);
  });
});
