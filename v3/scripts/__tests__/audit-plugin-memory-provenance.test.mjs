import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  auditPluginMemoryProvenance,
  auditSource,
} from '../audit-plugin-memory-provenance.mjs';

test('accepts a top-level canonical provenance property', () => {
  const findings = auditSource(`
    await this.memory.store({
      content: JSON.stringify(pattern),
      provenance_type: 'agent_output',
      metadata: { nested: true },
    });
  `, 'plugin.ts');
  assert.deepEqual(findings, []);
});

test('accepts shorthand and quoted top-level provenance properties', () => {
  assert.deepEqual(auditSource(`
    const provenance_type = 'tool_result';
    memory.store({ content: 'a', provenance_type });
    services.memory.store({ content: 'b', 'provenance_type': 'system_observation' });
  `, 'plugin.ts'), []);
});

test('nested metadata provenance does not satisfy the write contract', () => {
  const findings = auditSource(`
    this.memory.store({
      content: 'value',
      metadata: { provenance_type: 'agent_output' },
    });
  `, 'plugin.ts');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, 'MISSING_PROVENANCE_TYPE');
  assert.equal(findings[0].line, 2);
});

test('methods and accessors cannot spoof a provenance value', () => {
  const findings = auditSource(`
    memory.store({ content: 'a', provenance_type() { return 'tool_result'; } });
    memory.store({ content: 'b', get provenance_type() { return 'agent_output'; } });
  `, 'plugin.ts');
  assert.deepEqual(findings.map((finding) => finding.code), [
    'MISSING_PROVENANCE_TYPE',
    'MISSING_PROVENANCE_TYPE',
  ]);
});

test('strings and comments cannot spoof provenance', () => {
  const findings = auditSource(`
    memory.store({
      content: 'provenance_type: tool_result',
      // provenance_type: 'agent_output'
      metadata: {},
    });
  `, 'plugin.ts');
  assert.equal(findings[0]?.code, 'MISSING_PROVENANCE_TYPE');
});

test('detects nested and optional memory receivers', () => {
  const findings = auditSource(`
    context.services.memory.store({ content: 'a' });
    this.memory?.store({ content: 'b' });
  `, 'plugin.ts');
  assert.deepEqual(findings.map((finding) => finding.code), [
    'MISSING_PROVENANCE_TYPE',
    'MISSING_PROVENANCE_TYPE',
  ]);
});

test('rejects non-literal store entries because provenance cannot be inspected', () => {
  const findings = auditSource(`
    const entry = { content: 'value', provenance_type: 'tool_result' };
    memory.store(entry);
  `, 'plugin.ts');
  assert.equal(findings[0]?.code, 'NON_LITERAL_STORE_ENTRY');
});

test('ignores unrelated store calls and memory reads', () => {
  assert.deepEqual(auditSource(`
    cache.store({ content: 'value' });
    someMemory.store({ content: 'value' });
    memory.search({ query: 'value' });
  `, 'plugin.ts'), []);
});

test('reports malformed source instead of silently skipping it', () => {
  const findings = auditSource('memory.store({ content: ;', 'broken.ts');
  assert.equal(findings[0]?.code, 'SOURCE_PARSE_ERROR');
});

test('repository audit scans plugin source and excludes tests', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'ruflo-plugin-provenance-'));
  try {
    const src = path.join(root, 'example', 'src');
    const tests = path.join(src, '__tests__');
    mkdirSync(tests, { recursive: true });

    writeFileSync(path.join(src, 'good.ts'), `
      memory.store({ content: 'ok', provenance_type: 'tool_result' });
    `);
    writeFileSync(path.join(src, 'bad.ts'), `
      this.memory.store({ content: 'missing' });
    `);
    writeFileSync(path.join(tests, 'fixture.test.ts'), `
      this.memory.store({ content: 'test fixture without provenance' });
    `);

    const result = auditPluginMemoryProvenance(root);
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].code, 'MISSING_PROVENANCE_TYPE');
    assert.match(result.findings[0].file, /bad\.ts$/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
