/**
 * CI regression guard for #2566.
 *
 * isAnswerCorrect() in src/benchmarks/gaia-agent.ts originally had two
 * substring checks: forward (`normModel.includes(normExpected)`) and
 * reverse (`normExpected.includes(normModel)`). The reverse check scored
 * a fragmentary model answer as correct whenever its normalized form was
 * any substring of the expected answer — e.g. model `"a"` vs expected
 * `"Paris, France"` → true — inflating GAIA scores via a
 * normalization-collision (the exact vector ADR-167/169 R1 forbid).
 *
 * The fix removes the reverse-substring branch; only the forward
 * substring + numeric-tolerance paths remain.
 *
 * This test locks in the correct behavior so the reverse branch cannot
 * silently return. It FAILS on the original bug and PASSES on the fix.
 */

import { describe, expect, it } from 'vitest';
import { isAnswerCorrect } from '../src/benchmarks/gaia-agent.js';

describe('#2566 — isAnswerCorrect reverse-substring collision', () => {
  it('rejects a fragmentary single-letter model answer against a longer expected answer', () => {
    // The canonical regression case from the issue: model returned "a", the
    // expected answer is "Paris, France". Under the original reverse-substring
    // rule, "paris, france".includes("a") was true → false positive.
    expect(isAnswerCorrect('a', 'Paris, France')).toBe(false);
  });

  it('rejects other fragmentary substrings that would collide under the reverse rule', () => {
    // Every one of these would have returned true under the old reverse rule
    // because they normalize to a substring of the expected answer.
    expect(isAnswerCorrect('e', 'Eiffel Tower')).toBe(false);
    expect(isAnswerCorrect('the', 'the quick brown fox')).toBe(false);
    expect(isAnswerCorrect('19', '1969')).toBe(false);
    expect(isAnswerCorrect('.', '3.14159')).toBe(false);
  });

  it('still accepts exact matches (case + whitespace insensitive)', () => {
    expect(isAnswerCorrect('Paris', 'paris')).toBe(true);
    expect(isAnswerCorrect('  Paris  ', 'Paris')).toBe(true);
  });

  it('still accepts forward-substring matches (model contains expected)', () => {
    // The forward direction is the legitimate GAIA case:
    // model responded with extra context, expected is a substring of it.
    expect(isAnswerCorrect('Paris, France', 'Paris')).toBe(true);
    expect(isAnswerCorrect('The answer is 42.', '42')).toBe(true);
  });

  it('still accepts numeric answers within ±1% tolerance', () => {
    expect(isAnswerCorrect('3.14', '3.14159')).toBe(true);
    expect(isAnswerCorrect('100', '100.5')).toBe(true);
  });

  it('rejects numeric answers outside ±1% tolerance', () => {
    expect(isAnswerCorrect('50', '100')).toBe(false);
  });
});
