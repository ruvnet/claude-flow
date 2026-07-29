import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('adr-create documents the live AgentDB key/value/tier and causal-edge schema', () => {
  const skill = readFileSync(
    new URL('../../skills/adr-create/SKILL.md', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(skill, /^\s*-\s+path:/m);
  assert.match(skill, /^\s*-\s+key:\s+`mem:ADR-NNN`/m);
  assert.match(skill, /^\s*-\s+tier:\s+`semantic`/m);
  assert.match(skill, /value: a JSON-encoded string:/);
  assert.match(skill, /^\s*-\s+sourceId:\s+`mem:ADR-NNN`/m);
  assert.match(skill, /^\s*-\s+targetId:\s+`mem:ADR-RELATED`/m);

  for (const relative of [
    '../../REFERENCE.md',
    '../../commands/adr.md',
  ]) {
    const companion = readFileSync(new URL(relative, import.meta.url), 'utf8');
    assert.doesNotMatch(companion, /(?:--path|\bat path)[^\n]*adr\/ADR-/i);
  }
});
