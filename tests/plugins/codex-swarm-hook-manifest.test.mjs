import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Regression test for ruvnet/ruflo#3688: Codex's native app-server rejects
// ruflo-swarm's hooks.json with `unknown field 'modules', expected
// 'description' or 'hooks'` because that manifest declares a Claude Code
// function-hook module Codex cannot load. The fix ships a Codex-specific
// no-op manifest via the native `.codex-plugin/plugin.json` override (the
// same convention already used by ruflo-adr/ruflo-ddd/ruflo-sparc), so the
// Claude Code module keeps loading unchanged while Codex sees a manifest it
// can parse.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PLUGIN = 'ruflo-swarm';

test('ruflo-swarm: Codex gets a host-specific no-op manifest instead of the Claude function-hook one', () => {
  const codexManifestPath = path.join(root, `plugins/${PLUGIN}/.codex-plugin/plugin.json`);
  assert.ok(
    fs.existsSync(codexManifestPath),
    `${codexManifestPath} must exist so Codex's native plugin loader prefers it over .claude-plugin/plugin.json (see #3688)`,
  );

  const codexManifest = JSON.parse(fs.readFileSync(codexManifestPath, 'utf8'));
  const claudeManifest = JSON.parse(
    fs.readFileSync(path.join(root, `plugins/${PLUGIN}/.claude-plugin/plugin.json`), 'utf8'),
  );
  assert.equal(codexManifest.name, claudeManifest.name);
  assert.equal(codexManifest.version, claudeManifest.version);
  assert.equal(codexManifest.hooks, './hooks/codex-hooks.json');

  const codexHooksPath = path.join(root, `plugins/${PLUGIN}/hooks/codex-hooks.json`);
  assert.ok(fs.existsSync(codexHooksPath), `${codexHooksPath} must exist`);
  const codexHooks = JSON.parse(fs.readFileSync(codexHooksPath, 'utf8'));

  // Codex's native plugin hook-manifest loader accepts only `description`
  // and `hooks` at the top level (#2855 / #3688) — anything else is a hard
  // parse failure that drops the whole plugin.
  const allowed = new Set(['description', 'hooks']);
  const unknown = Object.keys(codexHooks).filter((key) => !allowed.has(key));
  assert.deepEqual(
    unknown,
    [],
    `codex-hooks.json must only use ${[...allowed].join('/')} at the top level, found: ${unknown.join(', ')}`,
  );
  assert.equal(typeof codexHooks.description, 'string');
  assert.deepEqual(
    codexHooks.hooks,
    {},
    'ruflo-swarm has no Codex-portable guard logic (pure UI pane) — Codex gets an explicit no-op, not invented command hooks',
  );

  // The Claude Code function-hook manifest and its module must remain
  // intact — this fix must not touch the Claude Code behaviour.
  const claudeHooks = JSON.parse(
    fs.readFileSync(path.join(root, `plugins/${PLUGIN}/hooks/hooks.json`), 'utf8'),
  );
  assert.deepEqual(claudeHooks.modules, ['./register.ts']);
  assert.ok(fs.existsSync(path.join(root, `plugins/${PLUGIN}/hooks/register.ts`)));
});
