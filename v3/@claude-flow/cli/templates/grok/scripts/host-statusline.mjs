#!/usr/bin/env node
/**
 * One "what is loaded" line for every host.
 *
 *   grok    ~/.grok/config.toml [ui.status_line] command. Project config
 *           cannot set this (Grok 1.0.41 reads [ui] from the user file only).
 *           SessionStart stdout is ignored, so a hook cannot print the line.
 *           `ruflo init --grok --grok-statusline` installs a copy of this
 *           script at ~/.grok/ruflo/host-statusline.mjs and points the row at
 *           that absolute path; it reports on whichever repo Grok is in.
 *   claude  .claude/settings.json statusLine → .claude/helpers/statusline.cjs
 *           (the rich row). This script is the same facts, not a replacement.
 *   codex   no status row. `node scripts/host-statusline.mjs --host codex`
 *           prints the line; nothing in Codex displays it for you.
 *
 * Grok pipes a JSON payload on stdin. A tty (a manual run) is left alone.
 *   node scripts/host-statusline.mjs
 *   node scripts/host-statusline.mjs --json
 *   node scripts/host-statusline.mjs --host claude
 */

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const JSON_OUT = args.includes('--json');
const hostFlag = args.indexOf('--host');
const HOST = (hostFlag >= 0 ? args[hostFlag + 1] : 'grok').toLowerCase();
const ROOT = resolve(process.env.RUFLO_HOST_ROOT || process.cwd());

export const HOST_STATUS = {
  grok: {
    surface: 'ui.status_line',
    scope: 'user',
    command: 'node "<home>/.grok/ruflo/host-statusline.mjs"',
  },
  claude: {
    surface: 'statusLine',
    scope: 'project',
    command: 'node .claude/helpers/statusline.cjs',
  },
  codex: {
    surface: null,
    scope: null,
    command: 'node scripts/host-statusline.mjs --host codex',
  },
};

function has(rel) {
  return existsSync(join(ROOT, rel));
}

// ---------------------------------------------------------------------------
// Minimal, comment-aware TOML table reader.
//
// This script is a zero-dependency copy: `init --grok --grok-statusline`
// writes it to ~/.grok/ruflo/host-statusline.mjs, and `init --grok` also
// copies it to <project>/scripts/host-statusline.mjs — both live outside any
// node_modules tree, so (unlike grok-generator.ts, which is part of the
// installed @claude-flow/cli package) it can't `import '@iarna/toml'`
// without risking "Cannot find package" at the exact moment Grok tries to
// render the status line. The previous version matched `trusted = true` /
// `[mcp_servers.name]` via substring/regex on the raw file text, which
// happily matched inside a `#` comment and never noticed a sibling
// `enabled = false` key. This walks real `[section]` boundaries and strips
// comments outside of string literals first, instead (ADR-402 round-2
// review, minor item 3). It is not a general TOML parser — only enough of
// one for the two shapes this file actually reads: table headers (with
// quoted or bare dotted keys) and simple `key = true|false` booleans.
// ---------------------------------------------------------------------------

function stripComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === '\\' && quote === '"') { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '#') return line.slice(0, i);
  }
  return line;
}

/** Splits a dotted TOML key on top-level dots only (not dots inside quotes), then dequotes each part. */
function splitDottedKey(raw) {
  const parts = [];
  let cur = '';
  let quote = null;
  for (const c of raw) {
    if (quote) {
      cur += c;
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; cur += c; continue; }
    if (c === '.') { parts.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  parts.push(cur.trim());
  return parts.map((p) => p.replace(/^["']|["']$/g, ''));
}

/** '[a."b.c"]' or '[a.b]' → normalized key 'a.b.c' (dequoted parts joined by '.'), or null if not a table header. */
function sectionHeaderKey(line) {
  const trimmed = line.trim();
  if (trimmed.startsWith('[[')) return null; // array-of-tables: not modeled, not needed here
  const m = /^\[\s*([^\]]+?)\s*\]$/.exec(trimmed);
  if (!m) return null;
  return splitDottedKey(m[1]).join('.');
}

/** { normalizedSectionPath -> { key -> rawValueText } } for every `[table]` in the file. */
function parseTomlTables(text) {
  const tables = new Map([['', {}]]);
  let current = '';
  for (const rawLine of text.split('\n')) {
    const line = stripComment(rawLine).trim();
    if (!line) continue;
    const header = sectionHeaderKey(line);
    if (header !== null) {
      current = header;
      if (!tables.has(current)) tables.set(current, {});
      continue;
    }
    const kv = /^([^=]+?)\s*=\s*(.+)$/.exec(line);
    if (!kv) continue;
    tables.get(current)[kv[1].trim().replace(/^["']|["']$/g, '')] = kv[2].trim();
  }
  return tables;
}

function tomlBool(raw) {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return undefined;
}

function sectionTrusted(text, folder) {
  const tables = parseTomlTables(text);
  const table = tables.get(sectionHeaderKey(`[folders."${folder}"]`));
  return table ? tomlBool(table.trusted) === true : false;
}

function grokTrusted() {
  const file = join(homedir(), '.grok', 'trusted_folders.toml');
  if (!existsSync(file)) return false;
  try {
    return sectionTrusted(readFileSync(file, 'utf8'), ROOT);
  } catch {
    return false;
  }
}

/** A `[mcp_servers.<name>]` table exists and is not explicitly `enabled = false`. */
function configHasServer(file, name) {
  if (!existsSync(file)) return false;
  let tables;
  try {
    tables = parseTomlTables(readFileSync(file, 'utf8'));
  } catch {
    return false;
  }
  const table = tables.get(sectionHeaderKey(`[mcp_servers.${name}]`));
  if (!table) return false;
  return tomlBool(table.enabled) !== false;
}

function readStdinPayload() {
  if (process.stdin.isTTY) return null;
  try {
    const raw = readFileSync(0, 'utf8');
    if (!raw.trim().startsWith('{')) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function snapshot(host) {
  if (host === 'claude') {
    const settings = join(ROOT, '.claude', 'settings.json');
    let wired = false;
    if (existsSync(settings)) {
      try {
        wired = Boolean(JSON.parse(readFileSync(settings, 'utf8')).statusLine?.command);
      } catch {
        wired = false;
      }
    }
    return {
      host,
      surface: HOST_STATUS.claude.surface,
      loaded: {
        statusLine: wired,
        helper: has('.claude/helpers/statusline.cjs'),
      },
    };
  }
  if (host === 'codex') {
    const homeCfg = join(homedir(), '.codex', 'config.toml');
    return {
      host,
      surface: null,
      loaded: {
        mcp: configHasServer(homeCfg, 'ruflo') || configHasServer(homeCfg, 'claude-flow'),
      },
    };
  }
  const agents = ['ruflo-architect', 'ruflo-coder', 'ruflo-tester', 'ruflo-reviewer'].filter((name) =>
    has(join('.grok', 'agents', `${name}.md`)),
  );
  const skills = ['agent-teams-grok'].filter((name) =>
    has(join('.grok', 'skills', name, 'SKILL.md')),
  );
  const projectCfg = join(ROOT, '.grok', 'config.toml');
  const userCfg = join(homedir(), '.grok', 'config.toml');
  return {
    host: 'grok',
    surface: HOST_STATUS.grok.surface,
    loaded: {
      mcp: configHasServer(projectCfg, 'ruflo') || configHasServer(projectCfg, 'claude-flow') || configHasServer(userCfg, 'ruflo'),
      rules: has('.grok/rules/ruflo-grok.md'),
      agents: agents.length,
      skills: skills.length,
      hook: has('.grok/hooks/subagent-stop-team.json'),
      trusted: grokTrusted(),
    },
  };
}

function lineFor(snap, stdin) {
  if (snap.host === 'claude') {
    const ok = snap.loaded.statusLine && snap.loaded.helper;
    return ok ? 'RuFlo loaded │ claude statusLine' : 'RuFlo │ claude statusLine missing';
  }
  if (snap.host === 'codex') {
    return snap.loaded.mcp ? 'RuFlo │ codex mcp configured (no status row)' : 'RuFlo │ codex mcp not configured';
  }
  const L = snap.loaded;
  const gaps = [];
  if (!L.mcp) gaps.push('mcp');
  if (!L.rules) gaps.push('rules');
  if (L.agents < 4) gaps.push(`agents ${L.agents}/4`);
  if (L.skills < 1) gaps.push('skill agent-teams-grok');
  if (!L.hook) gaps.push('hook');
  if (!L.trusted) gaps.push('untrusted');
  const head = gaps.length ? `RuFlo │ missing ${gaps.join(', ')}` : 'RuFlo loaded │ ruflo │ rules │ 4 agents │ skill │ hook │ trusted';
  const model = stdin?.model?.display_name;
  const pct = stdin?.context_window?.used_percentage;
  const tail = [model, pct == null ? '' : `${pct}% ctx`].filter(Boolean).join(' │ ');
  return tail ? `${head} │ ${tail}` : head;
}

const snap = snapshot(HOST);
const text = lineFor(snap, readStdinPayload());
if (JSON_OUT) {
  process.stdout.write(JSON.stringify({ ...snap, line: text, map: HOST_STATUS }, null, 2) + '\n');
} else if (text) {
  process.stdout.write(`${text}\n`);
}
