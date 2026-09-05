#!/usr/bin/env node
// audit-plugin-manifest — fleet-wide check on plugins/*/.claude-plugin/plugin.json.
//
// Each plugin's own smoke step 1 sentinel pins the EXPECTED version of
// its own plugin.json (e.g. cost-tracker hardcodes "expected 0.26.0").
// What no per-plugin smoke catches:
//   - A plugin.json with non-semver version (e.g. "1.0", "1.0.0-alpha",
//     "latest") — would break dist-tag publishing logic.
//   - name field doesn't match the enclosing directory (drift after rename).
//   - Required field empty (smoke 1 checks `"version"` presence via grep
//     but not that it has a value).
//   - A new plugin authored without ANY plugin.json (no smoke means no
//     coverage at all).
//
// USAGE
//   node scripts/audit-plugin-manifest.mjs                 # all plugins
//   node scripts/audit-plugin-manifest.mjs --format json   # CI-consumable
//   node scripts/audit-plugin-manifest.mjs --only ruflo-cost-tracker
//
// CHECKS per plugins/<name>/.claude-plugin/plugin.json
//   1. File exists and parses as JSON.
//   2. Required fields present and non-empty: name / version / description.
//   3. version matches semver (N.N.N optionally with +/- suffix).
//   4. name matches the enclosing directory name (drift after rename).
//   5. keywords is an array (may be empty, but must be present).
//
// EXIT CODES
//   0  all manifests clean
//   1  at least one violation
//   2  scan error (no plugins dir)

import { readdirSync, statSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(SCRIPTS_DIR);
const PLUGINS_DIR = join(REPO_ROOT, 'plugins');

const ARGS = (() => {
  const a = { format: 'table', only: null };
  for (let i = 2; i < process.argv.length; i++) {
    const v = process.argv[i];
    if (v === '--format') a.format = process.argv[++i];
    else if (v === '--only') {
      a.only = new Set((process.argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean));
    }
  }
  return a;
})();

const SEMVER_RE = /^\d+\.\d+\.\d+([+-][\w.-]+)?$/;

function existsSync(p) {
  try { statSync(p); return true; } catch { return false; }
}

function discoverManifests() {
  const out = [];
  let plugins;
  try { plugins = readdirSync(PLUGINS_DIR); } catch { return out; }
  for (const plugin of plugins) {
    if (ARGS.only && !ARGS.only.has(plugin)) continue;
    const dir = join(PLUGINS_DIR, plugin);
    let s;
    try { s = statSync(dir); } catch { continue; }
    if (!s.isDirectory()) continue;
    const manifest = join(dir, '.claude-plugin', 'plugin.json');
    // Only include plugins that opt into the SKILL convention (presence
    // of .claude-plugin/). TS-source plugins like ruflo-arena have
    // package.json instead — skip them silently.
    if (!existsSync(manifest)) continue;
    out.push({ plugin, path: manifest });
  }
  return out.sort((a, b) => a.plugin.localeCompare(b.plugin));
}

function auditManifest(entry) {
  const violations = [];
  let raw;
  try { raw = readFileSync(entry.path, 'utf-8'); }
  catch (e) {
    violations.push({ check: 'readable', detail: e.message });
    return violations;
  }
  let json;
  try { json = JSON.parse(raw); }
  catch (e) {
    violations.push({ check: 'valid JSON', detail: e.message.slice(0, 120) });
    return violations;
  }

  if (!json.name) violations.push({ check: 'name field', detail: 'missing or empty' });
  if (json.name && json.name !== entry.plugin) {
    violations.push({
      check: 'name matches directory',
      detail: `manifest name="${json.name}" but plugin dir is "${entry.plugin}"`,
    });
  }

  if (!json.version) violations.push({ check: 'version field', detail: 'missing or empty' });
  else if (!SEMVER_RE.test(json.version)) {
    violations.push({
      check: 'version semver',
      detail: `"${json.version}" doesn't match X.Y.Z[±suffix]`,
    });
  }

  if (!json.description) violations.push({ check: 'description field', detail: 'missing or empty' });
  if (json.description && json.description.length < 10) {
    violations.push({
      check: 'description meaningful',
      detail: `"${json.description}" is suspiciously short (< 10 chars)`,
    });
  }

  if (!Array.isArray(json.keywords)) {
    violations.push({ check: 'keywords is array', detail: `got ${typeof json.keywords}` });
  }

  return violations;
}

function main() {
  const manifests = discoverManifests();
  if (manifests.length === 0) {
    console.error('audit-plugin-manifest: no plugins/*/.claude-plugin/plugin.json found');
    process.exit(2);
  }

  const findings = [];
  for (const m of manifests) {
    const v = auditManifest(m);
    if (v.length > 0) {
      findings.push({
        plugin: m.plugin,
        file: m.path.replace(REPO_ROOT + '/', ''),
        violations: v,
      });
    }
  }

  if (ARGS.format === 'json') {
    console.log(JSON.stringify({
      manifestsScanned: manifests.length,
      filesWithViolations: findings.length,
      findings,
      generatedAt: new Date().toISOString(),
    }, null, 2));
  } else {
    console.log('# audit-plugin-manifest');
    console.log('');
    console.log(`Scanned **${manifests.length}** plugin manifests.`);
    console.log('');
    if (findings.length === 0) {
      console.log('✓ Every plugin.json:');
      console.log('  - parses as JSON');
      console.log('  - has name / version / description / keywords[]');
      console.log('  - name matches the enclosing directory');
      console.log('  - version matches semver X.Y.Z[±suffix]');
    } else {
      console.log(`⚠ Found ${findings.length} manifest(s) with violations:`);
      console.log('');
      for (const f of findings) {
        console.log(`## ${f.file}`);
        for (const v of f.violations) {
          console.log(`  - ${v.check}: ${v.detail}`);
        }
        console.log('');
      }
    }
    console.log('');
  }
  process.exit(findings.length > 0 ? 1 : 0);
}

main();
