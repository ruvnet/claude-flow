// @ts-check
/**
 * Parity: plugins/ruflo-ruos/types/index.d.ts vendors the `$.ruflo.segment`
 * contract from plugins/ruflo-mods/types/index.d.ts (ADR-404). If the source
 * changes shape, this fails instead of the mod silently drawing nothing.
 * Skips while ruflo-mods is not in the tree (its PR merges first).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const VENDORED = join(here, '../types/index.d.ts');
const SOURCE = join(here, '../../ruflo-mods/types/index.d.ts');

/** @param {string} text */
const norm = (text) => text.replace(/\s+/g, ' ').trim();

/**
 * @param {string} text
 * @param {RegExp} re
 */
const pick = (text, re) => norm(re.exec(text)?.[0] ?? '');

test('vendored $.ruflo.segment matches ruflo-mods', { skip: !existsSync(SOURCE) && 'ruflo-mods not in tree' }, () => {
  const vendored = readFileSync(VENDORED, 'utf8');
  const source = readFileSync(SOURCE, 'utf8');
  const typeRe = /export type RufloSegment = [^\n]+/;
  const methodRe = /segment: \(input: RufloSegment\) => Promise<void>/;
  assert.ok(pick(source, typeRe), 'source still exports RufloSegment');
  assert.equal(pick(vendored, typeRe), pick(source, typeRe));
  assert.equal(pick(vendored, methodRe), pick(source, methodRe));
  assert.match(source, /interface EngineInterface \{[\s\S]*ruflo: Ruflo/);
});

test('vendored types declare only what ruflo-ruos uses', () => {
  const vendored = readFileSync(VENDORED, 'utf8');
  assert.match(vendored, /segment: \(input: RufloSegment\) => Promise<void>/);
  assert.ok(!/lastRoute|snapshot/.test(vendored.replace(/\/\*\*[\s\S]*?\*\//g, '')), 'no unused surface');
});
