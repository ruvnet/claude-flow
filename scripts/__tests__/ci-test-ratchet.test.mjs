import { describe, expect, it } from 'vitest';
import { evaluateTestReport } from '../ci-test-ratchet.mjs';

const root = '/repo';

describe('CI test failure ratchet (#3030)', () => {
  it('permits only failures already named by the baseline', () => {
    const result = evaluateTestReport({
      success: false,
      testResults: [
        { name: '/repo/tests/known.test.ts', status: 'failed' },
        { name: '/repo/tests/green.test.ts', status: 'passed' },
      ],
    }, ['tests/known.test.ts'], root);

    expect(result.ok).toBe(true);
    expect(result.unexpected).toEqual([]);
  });

  it('fails when a new file starts failing even if the total count is unchanged', () => {
    const result = evaluateTestReport({
      success: false,
      testResults: [{ name: '/repo/tests/new-regression.test.ts', status: 'failed' }],
    }, ['tests/old-debt.test.ts'], root);

    expect(result.ok).toBe(false);
    expect(result.unexpected).toEqual(['tests/new-regression.test.ts']);
    expect(result.fixed).toEqual(['tests/old-debt.test.ts']);
  });

  it('fails closed when Vitest fails without a file-level result', () => {
    const result = evaluateTestReport({ success: false, testResults: [] }, [], root);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/without identifying/);
  });

  it('fails closed for an empty or malformed report', () => {
    expect(evaluateTestReport({ success: true, testResults: [] }, [], root).ok).toBe(false);
    expect(evaluateTestReport({}, [], root).ok).toBe(false);
  });
});
