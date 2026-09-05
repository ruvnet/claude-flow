import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { applyCodemod } from '../src/ruvector/codemods/engine.js';

const here = dirname(fileURLToPath(import.meta.url));
const corpus = JSON.parse(readFileSync(join(here, '..', 'bench', 'codemod-corpus.json'), 'utf-8'));

describe('codemod golden corpus (ADR-143 #4)', () => {
  it('has a non-empty versioned corpus', () => {
    expect(corpus.version).toBeGreaterThanOrEqual(1);
    expect(corpus.cases.length).toBeGreaterThan(0);
  });

  for (const c of corpus.cases) {
    it(`${c.id} (${c.intent}) matches golden output`, () => {
      const r = applyCodemod(c.intent, c.code, { language: c.language });
      expect(r.success).toBe(true);
      expect(r.output).toBe(c.expected);
    });
  }
});
