// #2566 — isAnswerCorrect() reverse-substring collision. A fragmentary model
// answer must NOT score correct just because it's a substring of the expected
// answer (the ADR-169 R1 normalization-collision / Berkeley-RDI vector).
import { describe, it, expect } from 'vitest';
import { isAnswerCorrect } from '../src/benchmarks/gaia-agent.js';

describe('#2566 — isAnswerCorrect reverse-substring collision is closed', () => {
  it('rejects fragment-of-expected collisions (must be false)', () => {
    expect(isAnswerCorrect('a', 'Paris, France')).toBe(false);
    expect(isAnswerCorrect('5', '1985')).toBe(false);
    expect(isAnswerCorrect('e', 'George Washington')).toBe(false);
    expect(isAnswerCorrect('the', 'the quick brown fox')).toBe(false);
  });

  it('still accepts legitimate matches', () => {
    expect(isAnswerCorrect('Paris', 'Paris')).toBe(true);              // exact
    expect(isAnswerCorrect('The answer is Paris', 'Paris')).toBe(true); // forward-substring (model ⊇ expected)
    expect(isAnswerCorrect('42.0', '42')).toBe(true);                  // numeric tolerance
  });

  it('empty model answer is false', () => {
    expect(isAnswerCorrect('', 'anything')).toBe(false);
  });
});
