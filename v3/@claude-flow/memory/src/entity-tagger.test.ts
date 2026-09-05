/**
 * Tests for the regex entity tagger (ADR-147 P2, ruvnet/ruflo#2317).
 *
 * Goal of the tagger: a conservative third signal for hybridSearch.
 * False negatives are fine (dense + sparse cover the rest); false
 * positives would dilute the RRF score by adding noise rows. These
 * tests pin the conservatism — generic prose returns nothing, and
 * concrete structured tokens (email, URL, path, quote, proper-noun
 * bigram) round-trip cleanly.
 */

import { describe, it, expect } from 'vitest';
import { extractEntities } from './entity-tagger.js';

describe('extractEntities', () => {
  it('returns empty for empty / nullish input', () => {
    expect(extractEntities('')).toEqual([]);
    expect(extractEntities(undefined as unknown as string)).toEqual([]);
  });

  it('returns empty for plain prose with no entities', () => {
    expect(extractEntities('how do i debug this very slow query')).toEqual([]);
  });

  it('extracts email addresses', () => {
    const got = extractEntities('contact alice@example.com or bob+ops@team.io');
    expect(got).toContain('alice@example.com');
    expect(got).toContain('bob+ops@team.io');
  });

  it('extracts URLs', () => {
    const got = extractEntities('see https://example.com/path?x=1 and http://internal');
    expect(got).toContain('https://example.com/path?x=1');
    expect(got).toContain('http://internal');
  });

  it('extracts POSIX file paths', () => {
    const got = extractEntities('open src/foo/bar.ts and ./scripts/build.mjs');
    expect(got).toContain('src/foo/bar.ts');
    expect(got).toContain('./scripts/build.mjs');
  });

  it('extracts Windows file paths', () => {
    const got = extractEntities(String.raw`look at C:\Users\ruv\repo\file.ts`);
    expect(got.some((e) => e.includes(String.raw`C:\Users\ruv\repo\file.ts`))).toBe(true);
  });

  it('does not pick up "and/or" style false positives', () => {
    expect(extractEntities('proceed and/or stop')).not.toContain('and/or');
  });

  it('extracts quoted phrases (both quote styles)', () => {
    const got = extractEntities(`open "config alpha" then 'session beta'`);
    expect(got).toContain('config alpha');
    expect(got).toContain('session beta');
  });

  it('extracts proper-noun 2-grams', () => {
    const got = extractEntities('hand off to Alice Smith and notify Acme Corp');
    expect(got).toContain('Alice Smith');
    expect(got).toContain('Acme Corp');
  });

  it('does not extract single capitalized words (too noisy)', () => {
    expect(extractEntities('Reset the database now')).toEqual([]);
  });

  it('deduplicates repeats while preserving first-seen order', () => {
    const got = extractEntities(
      'Alice Smith filed Alice Smith again at alice@x.io. Alice Smith.'
    );
    // 'Alice Smith' should appear exactly once even though the source
    // mentions it three times.
    expect(got.filter((e) => e === 'Alice Smith').length).toBe(1);
    // Both entity types are present.
    expect(got).toContain('Alice Smith');
    expect(got).toContain('alice@x.io');
  });

  it('drops trimmed-to-shorter-than-2 fragments', () => {
    // Quoted single-char phrase ("a") should be filtered by the min-length guard.
    expect(extractEntities(`prefer "a" over "b"`)).toEqual([]);
  });
});
