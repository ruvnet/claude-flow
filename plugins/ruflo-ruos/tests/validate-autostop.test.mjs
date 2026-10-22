// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveDesktop, assertBudget, assertModel, newRunId, RUN_ID_RE } from '../scripts/lib/validate.mjs';
import { nextAutoStop, checkWindow } from '../scripts/lib/autostop.mjs';
import { RuosError } from '../scripts/lib/types.mjs';
import { desktop, DESKTOP_ID, FLY_ID, OTHER_ID } from './fakes.mjs';

const owned = [desktop(), desktop({ id: OTHER_ID, flyMachineId: '815601f9e17de8', name: 'ruos-4', displayName: 'Desktop 4' })];

test('desktop ids resolve only against the caller\'s own list', () => {
  assert.equal(resolveDesktop(owned, DESKTOP_ID).id, DESKTOP_ID);
  assert.equal(resolveDesktop(owned, FLY_ID).id, DESKTOP_ID);
  assert.equal(resolveDesktop(owned, 'Work Desktop').id, DESKTOP_ID);
  assert.equal(resolveDesktop(owned, 'ruos-4').id, OTHER_ID);
  for (const foreign of ['ffffffffffffffffffffffffffffffff', 'aaaaaaaaaaaaaa', 'other tenant', '../../x', '$(id)']) {
    assert.throws(() => resolveDesktop(owned, foreign), (e) => e instanceof RuosError && e.code === 'not-owned');
  }
  for (const bad of ['', 123, null, 'x'.repeat(200)]) {
    assert.throws(() => resolveDesktop(owned, bad), (e) => e instanceof RuosError && e.code === 'invalid-input');
  }
  const dup = [...owned, desktop({ id: 'b'.repeat(32), flyMachineId: null, displayName: 'Work Desktop' })];
  assert.throws(() => resolveDesktop(dup, 'Work Desktop'), (e) => e instanceof RuosError && e.code === 'ambiguous');
});

test('budget and model validation', () => {
  assert.equal(assertBudget('0.5'), 0.5);
  assert.equal(assertBudget(2.555), 2.56);
  for (const b of ['1e3', '-1', '0', 'NaN', 'Infinity', '1;id', 1001]) assert.throws(() => assertBudget(b), RuosError);
  assert.equal(assertModel(undefined), undefined);
  assert.equal(assertModel('opus'), 'opus');
  assert.throws(() => assertModel('gpt-5'), RuosError);
});

test('run ids are path-safe', () => {
  const id = newRunId((n) => Buffer.alloc(n, 0xab));
  assert.match(id, RUN_ID_RE);
  assert.equal(id, `r-${'ab'.repeat(16)}`, '128 random bits');
});

const iso = (/** @type {number} */ ms) => new Date(ms).toISOString();

test('auto-stop: weekday 23:00 America/Toronto, DST aware', () => {
  // Thu 2026-10-01 16:00 EDT → Thu 23:00 EDT = 03:00Z Fri
  assert.equal(iso(nextAutoStop(Date.parse('2026-10-01T20:00:00Z'))), '2026-10-02T03:00:00.000Z');
  // Friday evening before stop → Friday 23:00
  assert.equal(iso(nextAutoStop(Date.parse('2026-10-03T02:59:00Z'))), '2026-10-03T03:00:00.000Z');
  // Friday after stop → skips the weekend → Monday 23:00 EDT
  assert.equal(iso(nextAutoStop(Date.parse('2026-10-03T03:30:00Z'))), '2026-10-06T03:00:00.000Z');
  // Sunday 2026-11-01 (DST ends that day) → Monday 23:00 EST = 04:00Z
  assert.equal(iso(nextAutoStop(Date.parse('2026-11-01T12:00:00Z'))), '2026-11-03T04:00:00.000Z');
  // Sunday 2026-03-08 (DST starts) → Monday 23:00 EDT = 03:00Z
  assert.equal(iso(nextAutoStop(Date.parse('2026-03-08T12:00:00Z'))), '2026-03-10T03:00:00.000Z');
});

test('auto-stop window check', () => {
  const now = Date.parse('2026-10-02T02:30:00Z'); // Thu 22:30 EDT
  assert.equal(checkWindow(now, 600).ok, true);
  const w = checkWindow(now, 3600);
  assert.equal(w.ok, false);
  assert.equal(w.minutesUntilStop, 30);
});
