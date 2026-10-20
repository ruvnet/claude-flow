#!/usr/bin/env node
/**
 * Unit tests for scripts/audit-leaf-versions-published.mjs's pure decision
 * logic (evaluateLeaf, collectLeaves). These run against fixture data, not
 * the live npm registry, so they're deterministic and need no network.
 *
 * The regression this guards against is ruvnet/ruflo#4303: a leaf's pin and
 * its own workspace version agreed with each other, but neither was ever
 * actually published — so the guard must fail even when "internal
 * consistency" checks (audit-wrapper-dep-ranges, audit-leaf-package-publish)
 * would pass.
 *
 * Run via: node scripts/__tests__/audit-leaf-versions-published.test.mjs
 */

import assert from 'node:assert/strict';
import { evaluateLeaf, collectLeaves } from '../audit-leaf-versions-published.mjs';

console.log('test: exact pin that is NOT published is a violation (the #4303 shape)');
{
  const leaf = { name: '@claude-flow/memory', range: '3.0.6', workspaceVersion: '3.0.6' };
  const result = evaluateLeaf(leaf, ['3.0.4', '3.0.5']); // 3.0.6 never published
  assert.equal(result.ok, false);
  assert.match(result.violation, /pins the exact version "3\.0\.6"/);
  assert.match(result.violation, /NOT on the npm registry/);
  console.log('  pass');
}

console.log('test: exact pin that IS published is ok');
{
  const leaf = { name: '@claude-flow/memory', range: '3.0.6', workspaceVersion: '3.0.6' };
  const result = evaluateLeaf(leaf, ['3.0.4', '3.0.5', '3.0.6']);
  assert.equal(result.ok, true);
  assert.equal(result.resolvedVersion, '3.0.6');
  assert.equal(result.violation, null);
  console.log('  pass');
}

console.log('test: range with a satisfying published version is ok');
{
  const leaf = { name: '@claude-flow/cli-core', range: '^3.7.0', workspaceVersion: '3.7.5' };
  const result = evaluateLeaf(leaf, ['3.7.0', '3.7.4', '3.7.5']);
  assert.equal(result.ok, true);
  assert.equal(result.resolvedVersion, '3.7.5');
  console.log('  pass');
}

console.log('test: range with NO satisfying published version is a violation');
{
  const leaf = { name: '@claude-flow/cli-core', range: '^3.8.0', workspaceVersion: '3.8.0' };
  const result = evaluateLeaf(leaf, ['3.7.0', '3.7.4', '3.7.5']); // nothing in the 3.8.x line published
  assert.equal(result.ok, false);
  assert.match(result.violation, /no published version .* satisfies/);
  console.log('  pass');
}

console.log('test: package entirely missing from the registry is a violation');
{
  const leaf = { name: '@claude-flow/does-not-exist', range: '1.0.0', workspaceVersion: '1.0.0' };
  const result = evaluateLeaf(leaf, null); // fetchPublishedVersions returns null on 404
  assert.equal(result.ok, false);
  assert.match(result.violation, /does not exist on the npm registry at all/);
  console.log('  pass');
}

console.log('test: collectLeaves skips bundled deps and deps with no workspace package.json');
{
  const cliPkg = {
    dependencies: {
      '@claude-flow/memory': '3.0.6',
      '@claude-flow/mcp': '3.1.1', // bundled — must be skipped
      'not-a-claude-flow-dep': '1.0.0', // wrong prefix — must be skipped
    },
    optionalDependencies: {
      '@claude-flow/neural': '^3.0.0',
      '@claude-flow/no-workspace-copy': '1.0.0', // no local package.json — must be skipped
    },
  };
  const bundled = new Set(['@claude-flow/mcp']);
  const workspace = {
    '@claude-flow/memory': { version: '3.0.6' },
    '@claude-flow/neural': { version: '3.0.1' },
  };
  const leaves = collectLeaves(cliPkg, bundled, (name) => workspace[name] ?? null);

  assert.equal(leaves.length, 2);
  const names = leaves.map((l) => l.name).sort();
  assert.deepEqual(names, ['@claude-flow/memory', '@claude-flow/neural']);
  const memory = leaves.find((l) => l.name === '@claude-flow/memory');
  assert.equal(memory.range, '3.0.6');
  assert.equal(memory.workspaceVersion, '3.0.6');
  console.log('  pass');
}

console.log('\nall audit-leaf-versions-published tests passed');
