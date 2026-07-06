/**
 * parseMemoryDir must not title entries "---".
 *
 * Per-fact memory files (Claude Code auto-memory) open with a YAML
 * frontmatter block: `---\nname: ...\ndescription: ...\n---\n<body>`. The
 * section splitter in parseMemoryDir treats `##`/`#` headers as section
 * boundaries and takes the first line of a section as its title — for a
 * frontmatter-only file with no leading header, that first line is the
 * literal string "---", so every bootstrapped entry from such a file
 * summarized as "---" in [INTELLIGENCE] output. A real-world scan of 512
 * bootstrapped entries found 152 with this junk title before the fix.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const intelligence = require('../.claude/helpers/intelligence.cjs');

function makeMemoryDir(): string {
  return mkdtempSync(join(tmpdir(), 'intelligence-frontmatter-'));
}

describe('parseMemoryDir — frontmatter titles', () => {
  it('uses the frontmatter description as the title, not the literal "---"', () => {
    const dir = makeMemoryDir();
    writeFileSync(
      join(dir, 'feedback_example.md'),
      [
        '---',
        'name: feedback_example',
        'description: Example fact used to prove frontmatter titles are extracted',
        'metadata:',
        '  type: feedback',
        '---',
        '',
        'The actual fact body, long enough to clear the 10-char minimum.',
        '',
      ].join('\n'),
    );

    const entries: any[] = [];
    intelligence.parseMemoryDir(dir, entries);

    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry.summary).not.toBe('---');
      expect(entry.key).not.toBe('---');
    }
    expect(entries[0].summary).toBe(
      'Example fact used to prove frontmatter titles are extracted',
    );
    expect(entries[0].content).toContain('The actual fact body');
  });

  it('falls back to `name:` when a file has no `description:`', () => {
    const dir = makeMemoryDir();
    writeFileSync(
      join(dir, 'project_example.md'),
      ['---', 'name: project_example_slug', '---', '', 'Body text long enough to pass the length check.'].join('\n'),
    );

    const entries: any[] = [];
    intelligence.parseMemoryDir(dir, entries);

    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0].summary).toBe('project_example_slug');
  });

  it('still parses ## sections normally for files without frontmatter', () => {
    const dir = makeMemoryDir();
    writeFileSync(
      join(dir, 'MEMORY.md'),
      ['## A heading title', 'Body text long enough to pass the length check.'].join('\n'),
    );

    const entries: any[] = [];
    intelligence.parseMemoryDir(dir, entries);

    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0].summary).toBe('A heading title');
  });
});
