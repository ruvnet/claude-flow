import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseAdr } from '../plugins/ruflo-adr/scripts/lib/parse-adrs.mjs';
for (const [name, context, suffix] of [
  ['context at EOF', 'Keep persistent indexing consistent.', ''],
  ['literal Z inside context', 'Use Zero-copy storage for indexes.', '\n\n## Decision\nAccepted.'],
  ['first paragraph only', 'First paragraph.', '\n\nSecond paragraph.'],
]) {
  test(name, () => {
    const dir = mkdtempSync(join(tmpdir(), 'adr-context-'));
    try {
      const file = join(dir, '001-context.md');
      writeFileSync(file, `# ADR-001: Context\n\n## Context\n${context}${suffix}`);
      assert.equal(parseAdr(file, dir).context, context);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}
