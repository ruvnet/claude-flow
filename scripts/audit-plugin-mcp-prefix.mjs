#!/usr/bin/env node
// Prevent Claude plugin bundles from using the standalone MCP namespace.
// Marketplace-installed tools are exposed through the ruflo-core plugin as
// mcp__plugin_ruflo-core_ruflo__<tool>, not mcp__claude-flow__<tool>.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PLUGINS = join(ROOT, 'plugins');
const LEGACY_PREFIX = 'mcp__claude-flow__';
const CORRECT_PREFIX = 'mcp__plugin_ruflo-core_ruflo__';
const STANDALONE_AUDIT_ALLOW = 'audit-allow: standalone-mcp-prefix';
const TEXT_EXTENSIONS = new Set(['.md', '.mjs', '.js', '.cjs', '.ts', '.sh', '.json', '.yaml', '.yml']);

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.git') continue;
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) yield* walk(path);
    else if (TEXT_EXTENSIONS.has(extname(entry))) yield path;
  }
}

const violations = [];
let correctReferences = 0;

for (const path of walk(PLUGINS)) {
  const content = readFileSync(path, 'utf8');
  correctReferences += content.split(CORRECT_PREFIX).length - 1;
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    if (lines[index].includes(LEGACY_PREFIX)) {
      const explicitlyChecksStandaloneSurface =
        lines[index].includes(STANDALONE_AUDIT_ALLOW) ||
        (index > 0 && lines[index - 1].includes(STANDALONE_AUDIT_ALLOW));
      if (explicitlyChecksStandaloneSurface) continue;
      violations.push(`${relative(ROOT, path)}:${index + 1}`);
    }
  }
}

if (violations.length > 0) {
  console.error(`Found ${violations.length} standalone MCP namespace reference(s) in plugin bundles:`);
  for (const violation of violations) console.error(`  ${violation}`);
  process.exit(1);
}

if (correctReferences === 0) {
  console.error(`No ${CORRECT_PREFIX} references found; plugin tool permissions may be missing.`);
  process.exit(1);
}

console.log(`Plugin MCP namespace audit passed (${correctReferences} qualified references).`);
