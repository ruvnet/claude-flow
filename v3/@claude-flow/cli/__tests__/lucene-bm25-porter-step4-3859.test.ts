import { describe, it, expect } from 'vitest';
import {
  porterStem,
  luceneTokenize,
  buildLuceneCorpusStats,
  luceneBM25,
} from '../src/memory/lucene-bm25.js';

describe('#3859 — Porter step 4 uses the longest matching suffix once', () => {
  it('does not fall through to a shorter suffix when the longest fails its measure condition', () => {
    // "ment" matches (stem "argu", m=1 -> condition fails); "ent" must NOT then be tried.
    expect(porterStem('argument')).toBe('argument');
    expect(porterStem('agreement')).toBe('agreement');
    expect(porterStem('arguments')).toBe('argument');
  });

  it('still strips suffixes whose longest match satisfies the condition', () => {
    expect(porterStem('adjustment')).toBe('adjust');
    expect(porterStem('replacement')).toBe('replac');
    expect(porterStem('adoption')).toBe('adopt');
    expect(porterStem('homologous')).toBe('homolog');
    expect(porterStem('communism')).toBe('commun');
  });

  it('does not collapse distinct words onto one BM25 token', () => {
    const docs = ['argument', 'arguments', 'argum'].map(luceneTokenize);
    expect(docs[0]).toEqual(docs[1]);
    expect(docs[2]).not.toEqual(docs[0]);
    const stats = buildLuceneCorpusStats(docs);
    const q = luceneTokenize('argument');
    expect(luceneBM25(q, docs[0], stats)).toBeGreaterThan(0);
    expect(luceneBM25(q, docs[2], stats)).toBe(0);
  });
});
