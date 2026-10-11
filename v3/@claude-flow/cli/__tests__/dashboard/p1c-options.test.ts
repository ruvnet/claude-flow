import { describe, expect, it } from 'vitest';
import { checkOptionValue } from '../../src/dashboard/capabilities/options.js';
import type { CatalogOption } from '../../src/dashboard/capabilities/types.js';

const cap = (min = 0): CatalogOption => ({ key: 'costBudgetUsd', type: 'number', settable: true, rule: 'cap', min, max: 100000 } as CatalogOption);
describe('R-SEC-p1c-options-first-cap', () => {
  it('an unset current value ("" from the real CLI, undefined, whitespace) allows a first finite positive cap', () => {
    for (const cur of ['', '  ', undefined, null]) expect(checkOptionValue(cap(), 25, cur)).toEqual({ ok: true, value: 25 });
  });
  it('an unset cap still refuses zero, negative, NaN and non-finite values', () => {
    for (const v of [0, -1, NaN, Infinity]) expect(checkOptionValue(cap(), v, '').ok).toBe(false);
  });
  it('a garbled non-empty current value is still unreadable, never "no cap"', () => {
    expect(checkOptionValue(cap(), 5, 'abc')).toEqual({ ok: false, code: 'config_unreadable' });
  });
  it('once a cap exists, later changes only lower it', () => {
    expect(checkOptionValue(cap(), 10, '25').ok).toBe(true);
    expect(checkOptionValue(cap(), 30, '25')).toEqual({ ok: false, code: 'would-raise-cap' });
    expect(checkOptionValue(cap(), 0, '25')).toEqual({ ok: false, code: 'would-raise-cap' });
  });
});
