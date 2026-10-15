import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

function audit(frontmatter) {
  const root = mkdtempSync(join(tmpdir(), 'ruflo-frontmatter-'));
  try {
    mkdirSync(join(root, 'scripts'));
    mkdirSync(join(root, 'plugins/example/skills/example'), { recursive: true });
    copyFileSync(fileURLToPath(new URL('../scripts/audit-skill-frontmatter.mjs', import.meta.url)), join(root, 'scripts/audit-skill-frontmatter.mjs'));
    writeFileSync(join(root, 'plugins/example/skills/example/SKILL.md'), `---\nname: example\n${frontmatter}\nallowed-tools: Bash\n---\n`);
    return spawnSync(process.execPath, [join(root, 'scripts/audit-skill-frontmatter.mjs'), '--format', 'json'], { encoding: 'utf8' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('rejects the unquoted colon-space description that breaks skill loading', () => {
  const result = audit("description: Emits `worst: 'clean'|'high'`.");
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /plain scalar/);
});

test('accepts the corrected quoted description', () => {
  const result = audit('description: "Emits `worst: clean|high`."');
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('does not silently accept duplicate description keys', () => {
  const result = audit('description: first\ndescription: second');
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /duplicate key/);
});
