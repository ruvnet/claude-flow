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

function sectionTrusted(text, folder) {
  const header = `[folders."${folder}"]`;
  const at = text.indexOf(header);
  if (at < 0) return false;
  const next = text.indexOf('\n[', at + header.length);
  const body = text.slice(at, next === -1 ? text.length : next);
  return /trusted\s*=\s*true/.test(body);
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

function configHasServer(file, name) {
  if (!existsSync(file)) return false;
  return readFileSync(file, 'utf8').includes(`[mcp_servers.${name}]`);
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
    const text = existsSync(homeCfg) ? readFileSync(homeCfg, 'utf8') : '';
    return {
      host,
      surface: null,
      loaded: {
        mcp: /\[mcp_servers\.(ruflo|claude-flow)\]/.test(text) || text.includes('claude-flow') || text.includes('ruflo'),
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
