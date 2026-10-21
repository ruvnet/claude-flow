import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyzeDiff, assessFileRisk, classifyDiff, clearDiffCache, DiffClassifier, suggestReviewers, type DiffFile } from '../src/ruvector/diff-classifier.js';

const file = (path: string, additions = 1): DiffFile => ({
  path, status: 'modified', additions, deletions: 0, hunks: 1, binary: false,
});

describe('diff classification uses source-bound evidence', () => {
  afterEach(() => clearDiffCache());

  it('does not classify unrelated path substrings as bugfixes or tests', () => {
    for (const path of ['src/debug/logger.ts', 'src/dispatcher.ts', 'src/inspector.ts']) {
      expect(classifyDiff([file(path)]).primary, path).toBe('unknown');
    }
  });

  it('recognizes non-JavaScript test files', () => {
    expect(classifyDiff([file('tests/schema.test.sql')]).primary).toBe('test');
  });

  it('does not infer security, API, or config risk from substrings inside unrelated names', () => {
    for (const path of ['src/author/profile.ts', 'src/rapid-sort.ts', 'src/envelope.ts']) {
      const changed = file(path);
      expect(assessFileRisk(changed).risk, path).toBe('low');
      expect(suggestReviewers([changed], [assessFileRisk(changed)]), path).toEqual(['developer']);
    }
    expect(assessFileRisk(file('src/auth/profile.ts')).risk).toBe('high');
    expect(assessFileRisk(file('src/api/client.ts')).risk).toBe('low');
    expect(suggestReviewers([file('src/api/client.ts')], []).includes('api-owner')).toBe(true);
  });

  it('uses changed lines and the one-commit subject, without treating Error as a fix', () => {
    const patch = `diff --git a/src/debug/logger.ts b/src/debug/logger.ts
--- a/src/debug/logger.ts
+++ b/src/debug/logger.ts
@@ -0,0 +1 @@
+throw new Error('missing logger');
`;
    const files = [file('src/debug/logger.ts')];
    expect(classifyDiff(files, patch).primary).toBe('unknown');
    const result = classifyDiff(files, patch, 'feat(logger): add debug logger');
    expect(result.primary).toBe('feature');
    expect(result.confidence).toBeGreaterThanOrEqual(0.85);
    expect(classifyDiff(files, patch, 'fix(logger): implement rollback').primary).toBe('bugfix');
  });

  it('uses real added code and does not reuse a stale classification for the same hunk', () => {
    const additions = Array.from({ length: 12 }, (_, i) => `+export function helper${i}() { return ${i}; }`).join('\n');
    const featurePatch = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -0,0 +1,12 @@
${additions}
`;
    const bugfixPatch = featurePatch.replace(additions,
      Array.from({ length: 12 }, () => '+// fix bug in existing behavior').join('\n'));
    const files = [file('src/a.ts', 12)];
    expect(classifyDiff(files, featurePatch).primary).toBe('feature');
    expect(classifyDiff(files, bugfixPatch).primary).toBe('bugfix');
  });

  it('parses large path and malformed hunk headers without losing later hunks', () => {
    const path = `src/${'a/'.repeat(3000)}component.ts`;
    const malformedStart = '0'.repeat(3000);
    const patch = `diff --git a/${path} b/${path}
--- a/${path}
+++ b/${path}
@@ -${malformedStart}x +1 @@
+ignored
@@ -1 +1 @@
-before
+after
@@ -4 +4 @@
-old
+new
`;
    const parsed = new DiffClassifier().parseDiff(patch);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].path).toBe(path);
    expect(parsed[0].hunks).toHaveLength(2);
    expect(parsed[0].additions).toBe(2);
    expect(parsed[0].deletions).toBe(2);
  });

  it('uses the commit subject in the real async analysis path for a one-commit range', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'ruflo-diff-content-'));
    const originalCwd = process.cwd();
    const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe' });
    try {
      git('init', '-q');
      git('config', 'user.name', 'Ruflo Test');
      git('config', 'user.email', 'ruflo-test@example.invalid');
      mkdirSync(join(repo, 'src'));
      writeFileSync(join(repo, 'src', 'debug.ts'), 'export const before = true;\n');
      git('add', '.');
      git('commit', '-qm', 'initial');
      writeFileSync(join(repo, 'src', 'debug.ts'), "throw new Error('missing logger');\n");
      git('add', '.');
      git('commit', '-qm', 'feat(logger): add debug logger');
      const parent = git('rev-parse', 'HEAD^').toString().trim();
      const head = git('rev-parse', 'HEAD').toString().trim();
      process.chdir(repo);
      clearDiffCache();
      const result = await analyzeDiff({ ref: `${parent}..${head}`, skipCache: true });
      expect(result.files).toHaveLength(1);
      expect(result.classification.primary).toBe('feature');
    } finally {
      process.chdir(originalCwd);
      clearDiffCache();
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
