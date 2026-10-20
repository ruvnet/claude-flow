#!/usr/bin/env node
// check-status-forwarding — tripwire for ADR-450 T7 (cross-mod injection by forwarding).
// A mod hook module that attaches text to the model's input (`context:`, `instructions:`, `additionalContext`, `describe`)
// must not also read another mod's status file (`.claude-flow/<x>-mod/status.json`), or one mod's output reaches the next
// mod's prompt. Grep-level: a path built from pieces defeats it. It holds the line, it is not a proof.
//
//   node scripts/check-status-forwarding.mjs [--root <dir>]
//
// Allowlist: scripts/status-forwarding.allow.json, "<plugin>/hooks/<file>.ts" -> one-line reason.
// Exit: 0 clean · 1 violations · 3 scanned zero sink modules (fail loud, layout drift).

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SINK = /\b(?:context|instructions|additionalContext|describe)\s*:|\.describe\b/;
const READ = /\b(?:fs\.read|readFile\w*|readBounded|readJson\w*)\s*\(/;
const LITERAL = /-mod\/|\bstatus\.json\b/;
const IDENT = /\b[A-Z][A-Z_]*STATUS[A-Z_]*(?:PATH|FILE)\b/;
const OWN_IMPORT = /import\s*\{[^}]*\bSTATUS_\w+[^}]*\}\s*from\s*['"]\.\/status['"]/;

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) { if (n !== 'node_modules') walk(p, out); } else if (n.endsWith('.ts') && !n.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

/** Why `source` forwards a status file into model context, or null. Exported for tests. */
export function violation(source) {
  if (!SINK.test(source) || !READ.test(source)) return null;
  if (LITERAL.test(source)) return 'reads a status-file path';
  if (IDENT.test(source) && !OWN_IMPORT.test(source)) return 'reads a status-path constant it did not import from its own ./status';
  return null;
}

export function check(root, allow = {}) {
  const bad = []; let sinks = 0;
  const plugins = join(root, 'plugins');
  for (const plugin of existsSync(plugins) ? readdirSync(plugins) : []) {
    for (const file of walk(join(plugins, plugin, 'hooks'))) {
      const src = readFileSync(file, 'utf8');
      if (!SINK.test(src)) continue;
      sinks++;
      const why = violation(src);
      const rel = relative(plugins, file).split('\\').join('/');
      if (why && !allow[rel]) bad.push({ file: rel, why });
    }
  }
  return { bad, sinks };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const i = process.argv.indexOf('--root');
  const root = i > 0 ? process.argv[i + 1] : dirname(HERE);
  const allowPath = join(HERE, 'status-forwarding.allow.json');
  const allow = existsSync(allowPath) ? JSON.parse(readFileSync(allowPath, 'utf8')) : {};
  const { bad, sinks } = check(root, allow);
  if (!sinks) { console.error('check-status-forwarding: no sink modules found; the check is broken. Failing.'); process.exit(3); }
  for (const b of bad) console.error(`check-status-forwarding: ${b.file} ${b.why} while attaching model context (ADR-450 T7)`);
  if (bad.length) process.exit(1);
  console.log(`check-status-forwarding: ${sinks} context-bearing modules scanned, none forward a status file.`);
}
