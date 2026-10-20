#!/usr/bin/env node
/**
 * probe-host-live.mjs — one Ruflo host check, several CLIs.
 *
 * The contract is the same on every host:
 *   discover  did this process load rules, agents, skills, hooks, and an MCP server?
 *   connect   does the server that host is configured to start expose the Ruflo tools?
 *   execute   does one headless turn run?                           (--execute)
 *   live      grok/claude: store and retrieve a memory value;
 *             codex/command: a team round trip through `ruflo team run`  (--live)
 *
 * Model turns are opt-in. Without --execute or --live no host process that
 * calls a model is started. --live implies --execute. --no-execute is
 * accepted and ignored (it is the default).
 *
 * What each CLI cannot answer is a SKIP, not a pass.
 *
 *   node scripts/probe-host-live.mjs --host all
 *   node scripts/probe-host-live.mjs --host grok --execute
 *   node scripts/probe-host-live.mjs --host codex --execute
 *   node scripts/probe-host-live.mjs --host codex --live
 *   node scripts/probe-host-live.mjs --host command --command-label myagent --live [--project <dir>]
 *
 * --host defaults to grok. probe-grok-host-live.mjs is that default.
 * The Grok checks read this checkout's .grok/ — generate it with
 * `node v3/@claude-flow/cli/bin/cli.js init --grok` (it is not committed).
 * EXIT  0 no critical failures (skips and warnings allowed)  1 critical fail  2 runner error
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const args = process.argv.slice(2);
const JSON_OUT = args.includes('--json');
const LIVE = args.includes('--live');
const EXECUTE = LIVE || args.includes('--execute');

function flag(name) {
  const i = args.indexOf(name);
  if (i < 0 || i + 1 >= args.length) return null;
  return args[i + 1];
}

const HOST_ARG = (flag('--host') || 'grok').toLowerCase();
const CLI = resolve(flag('--cli') || join(REPO_ROOT, 'v3/@claude-flow/cli/bin/cli.js'));
const PROJECT = resolve(flag('--project') || process.cwd());
const COMMAND_LABEL = flag('--command-label');
const RUN_ID = `probe-${Date.now().toString(36)}`;
const MCP_NAMES = ['ruflo', 'claude-flow'];
const REQUIRED_TOOLS = [
  'team_create',
  'memory_store',
  'memory_retrieve',
  'hooks_route',
  'swarm_init',
  'neural_status',
];
const GROK_AGENTS = ['ruflo-architect', 'ruflo-coder', 'ruflo-tester', 'ruflo-reviewer'];
const GROK_SKILLS = ['agent-teams-grok'];

/** @type {{ host: string, id: string, domain: string, level: 'critical'|'warn'|'skip', ok: boolean, ms: number, detail: string }[]} */
const results = [];

function record(host, id, domain, level, ok, ms, detail) {
  results.push({ host, id, domain, level, ok, ms, detail });
  if (JSON_OUT) return;
  const mark = ok ? 'PASS' : level === 'skip' ? 'SKIP' : level === 'warn' ? 'WARN' : 'FAIL';
  console.log(`${mark}\t${host}\t${domain}\t${id}\t${detail}`);
}

function run(cmd, cmdArgs, timeoutMs, opts = {}) {
  const start = Date.now();
  const r = spawnSync(cmd, cmdArgs, {
    cwd: opts.cwd || REPO_ROOT,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 20 * 1024 * 1024,
    env: { ...process.env, RUFLO_DAEMON_AUTOSTART: '0', ...opts.env },
    input: opts.input,
  });
  return {
    code: r.status,
    stdout: r.stdout || '',
    stderr: r.stderr || '',
    error: r.error ? String(r.error.message || r.error) : '',
    ms: Date.now() - start,
  };
}

function which(bin) {
  const direct = spawnSync('/bin/sh', ['-c', `command -v ${bin}`], { encoding: 'utf8' });
  const path = (direct.stdout || '').trim();
  return path || null;
}

function parseJson(text) {
  const src = String(text || '');
  for (const open of ['{', '[']) {
    const start = src.indexOf(open);
    if (start < 0) continue;
    const close = open === '{' ? '}' : ']';
    const end = src.lastIndexOf(close);
    if (end <= start) continue;
    try {
      return JSON.parse(src.slice(start, end + 1));
    } catch {
      /* try the other bracket */
    }
  }
  return null;
}

function toolNamesFromCli(cliPath) {
  const listed = run(process.execPath, [cliPath, 'mcp', 'tools'], 60_000);
  const names = new Set();
  for (const line of `${listed.stdout}\n${listed.stderr}`.split('\n')) {
    const m = line.match(/^\s{2}([a-z][a-z0-9_-]+)\s{2,}/);
    if (m) names.add(m[1]);
  }
  return names;
}

function recordTools(host, names, filterNote) {
  for (const tool of REQUIRED_TOOLS) {
    if (names.has(tool)) {
      record(host, `server-tool:${tool}`, 'connect', 'critical', true, 0, filterNote || 'exposed by the configured server command');
      continue;
    }
    record(
      host,
      `server-tool:${tool}`,
      'connect',
      'critical',
      false,
      0,
      filterNote ? `${filterNote}; ${tool} not listed` : 'missing from mcp tools',
    );
  }
}

function hookCommand(receipt) {
  return `${process.execPath} -e ${JSON.stringify(
    `require('fs').writeFileSync(${JSON.stringify(receipt)}, 'fired\\n')`,
  )}`;
}

function livePrompt(host, key) {
  const task = [
    `Store then retrieve one Ruflo memory value.`,
    `key ${JSON.stringify(key)}, value "probe-ok", namespace "host-probe".`,
    'Do not edit files. Do not spawn a subagent.',
    'Reply with exactly: PROBE_OK probe-ok',
  ];
  if (host === 'grok') {
    return [
      'Use the ruflo MCP server through search_tool and use_tool.',
      `1. search_tool for memory_store.`,
      `2. use_tool ruflo__memory_store with key ${JSON.stringify(key)}, value "probe-ok", namespace "host-probe".`,
      '3. use_tool ruflo__memory_retrieve with the same key and namespace.',
      'Reply with exactly: PROBE_OK probe-ok',
      'Do not edit files. Do not spawn a subagent.',
    ].join('\n');
  }
  return task.join('\n');
}

function finishHeadless(host, r, receipt) {
  const fired = existsSync(receipt);
  record(
    host,
    'hook:session-start',
    'execute',
    'critical',
    fired,
    r.ms,
    fired ? 'SessionStart hook wrote a receipt' : 'hook did not fire, or the session never started',
  );
  const out = parseJson(r.stdout);
  const text = String(out?.text || out?.message || r.stdout || '');
  if (!LIVE) {
    record(
      host,
      'session:ping',
      'execute',
      'critical',
      r.code === 0 && /PING/.test(text),
      0,
      r.code === 0 ? 'headless session answered' : `exit=${r.code} ${(r.error || r.stderr).slice(0, 200)}`,
    );
  } else {
    record(
      host,
      'live:memory-roundtrip',
      'execute',
      'critical',
      r.code === 0 && /PROBE_OK probe-ok/.test(text),
      0,
      r.code === 0 ? text.trim().slice(0, 240) : `exit=${r.code} ${(r.error || r.stderr).slice(0, 240)}`,
    );
  }
}

const adapters = {
  grok: {
    binary: 'grok',
    discover() {
      if (!existsSync(join(REPO_ROOT, '.grok', 'config.toml'))) {
        record('grok', 'surface', 'discover', 'critical', false, 0, 'no .grok/ in this checkout — run `node v3/@claude-flow/cli/bin/cli.js init --grok` first');
        return;
      }
      const r = run('grok', ['--cwd', REPO_ROOT, 'inspect', '--json'], 60_000);
      const data = parseJson(r.stdout);
      if (!data) {
        record('grok', 'inspect', 'discover', 'critical', false, r.ms, r.error || `exit=${r.code} no json`);
        return;
      }
      record('grok', 'inspect:version', 'discover', 'critical', Boolean(data.grokVersion), r.ms, data.grokVersion || 'missing');
      record('grok', 'inspect:trusted', 'discover', 'critical', data.projectTrusted === true, 0, data.projectTrusted ? 'folder trusted' : 'folder not trusted');
      const instructions = Array.isArray(data.projectInstructions) ? data.projectInstructions : [];
      const rule = instructions.find((i) => String(i.path || '').endsWith('.grok/rules/ruflo-grok.md'));
      record('grok', 'inspect:rules', 'discover', 'critical', Boolean(rule), 0, rule ? rule.path : 'ruflo-grok.md not loaded');
      const agents = Array.isArray(data.agents) ? data.agents : [];
      for (const name of GROK_AGENTS) {
        const hit = agents.find((a) => a.name === name && String(a.source?.path || '').includes(`${join('.grok', 'agents', name)}.md`));
        record('grok', `inspect:agent:${name}`, 'discover', 'critical', Boolean(hit), 0, hit ? hit.source.path : 'not a project agent');
      }
      const skills = Array.isArray(data.skills) ? data.skills : [];
      for (const name of GROK_SKILLS) {
        const hit = skills.find((s) => s.name === name && String(s.source?.path || '').includes(join('.grok', 'skills')));
        record('grok', `inspect:skill:${name}`, 'discover', 'critical', Boolean(hit), 0, hit ? hit.source.path : 'not loaded from .grok/skills');
      }
      const hooks = Array.isArray(data.hooks) ? data.hooks : [];
      const teamHook = hooks.find((h) => h.event === 'subagent_stop' && String(h.target || '').includes('grok-subagent-stop-hook.mjs'));
      record('grok', 'inspect:hook:subagent-stop', 'discover', 'critical', Boolean(teamHook), 0, teamHook ? teamHook.target : 'team SubagentStop hook not loaded');
      const servers = Array.isArray(data.mcpServers) ? data.mcpServers : [];
      const found = MCP_NAMES.map((name) => servers.find((s) => s.name === name)).filter(Boolean);
      const mcp = found[0];
      record('grok', 'inspect:mcp', 'discover', 'critical', Boolean(mcp), 0, mcp ? `${mcp.name} via ${mcp.source?.path || 'unknown'}` : `no ${MCP_NAMES.join(' or ')}`);
      if (found.length > 1) {
        record('grok', 'inspect:mcp:extra', 'discover', 'warn', false, 0, `also loaded: ${found.slice(1).map((s) => `${s.name} via ${s.source?.path || 'unknown'}`).join('; ')}`);
      }
    },
    connect() {
      const r = run('grok', ['--cwd', REPO_ROOT, 'mcp', 'doctor', 'ruflo', '--json'], 180_000);
      const data = parseJson(r.stdout);
      const server = data?.servers?.find((s) => MCP_NAMES.includes(s.name));
      if (!server) {
        record('grok', 'doctor', 'connect', 'critical', false, r.ms, r.error || r.stderr.slice(0, 240) || 'no ruflo/claude-flow server');
        return;
      }
      const failed = (server.checks || []).filter((c) => !c.passed);
      const tools = (server.checks || []).find((c) => /tools discovered/i.test(c.label));
      record('grok', 'doctor:handshake', 'connect', 'critical', server.healthy === true && failed.length === 0, r.ms, failed.length ? failed.map((c) => c.label).join(', ') : `${server.target}; ${tools?.label || 'healthy'}`);
      const target = String(server.target || '');
      const cli = target.startsWith('node ') ? target.split(/\s+/)[1] : '';
      if (!cli || !existsSync(cli)) {
        record('grok', 'doctor:tool-names', 'connect', 'skip', false, 0, `host did not give a local node entry: ${target}`);
        return;
      }
      recordTools('grok', toolNamesFromCli(cli));
    },
    execute() {
      const receipt = join(tmpdir(), `${RUN_ID}-grok.receipt`);
      const dir = join(REPO_ROOT, '.grok', 'hooks');
      mkdirSync(dir, { recursive: true });
      const hookPath = join(dir, `${RUN_ID}.json`);
      const promptPath = join(tmpdir(), `${RUN_ID}-grok.prompt.txt`);
      writeFileSync(hookPath, JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: hookCommand(receipt), timeout: 10 }] }] } }, null, 2) + '\n');
      writeFileSync(promptPath, LIVE ? livePrompt('grok', `${RUN_ID}-memory`) : 'Reply with exactly: PING');
      try {
        const r = run('grok', ['--cwd', REPO_ROOT, '--prompt-file', promptPath, '--verbatim', '--output-format', 'json', '--max-turns', LIVE ? '8' : '1', '--always-approve'], LIVE ? 300_000 : 180_000);
        finishHeadless('grok', r, receipt);
      } finally {
        rmSync(hookPath, { force: true });
        rmSync(receipt, { force: true });
        rmSync(promptPath, { force: true });
      }
    },
  },

  claude: {
    binary: 'claude',
    discover() {
      record('claude', 'inspect', 'discover', 'skip', false, 0, 'Claude Code has no inspect --json. File presence is not evidence a session loaded rules, agents, skills, or hooks.');
    },
    connect() {
      const r = run('claude', ['mcp', 'get', 'claude-flow'], 90_000);
      const text = `${r.stdout}\n${r.stderr}`;
      const missing = /No MCP server named/i.test(text);
      if (missing || r.code !== 0) {
        record('claude', 'mcp:claude-flow', 'connect', 'warn', false, r.ms, missing ? 'no server named claude-flow or ruflo in Claude MCP config' : text.slice(0, 240));
        return;
      }
      record('claude', 'mcp:claude-flow', 'connect', 'critical', true, r.ms, text.replace(/\s+/g, ' ').slice(0, 240));
      record('claude', 'server-tools', 'connect', 'skip', false, 0, 'claude mcp get does not report the tool list or the spawned command reliably enough to assert tool names');
    },
    execute() {
      const receipt = join(tmpdir(), `${RUN_ID}-claude.receipt`);
      const settingsPath = join(tmpdir(), `${RUN_ID}-claude-settings.json`);
      const promptPath = join(tmpdir(), `${RUN_ID}-claude.prompt.txt`);
      writeFileSync(settingsPath, JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: hookCommand(receipt), timeout: 10 }] }] } }));
      writeFileSync(promptPath, LIVE ? livePrompt('claude', `${RUN_ID}-memory`) : 'Reply with exactly: PING');
      try {
        const r = run('claude', ['-p', '--output-format', 'json', '--settings', settingsPath, '--dangerously-skip-permissions', '--', readPrompt(promptPath)], LIVE ? 300_000 : 180_000);
        finishHeadless('claude', r, receipt);
      } finally {
        rmSync(settingsPath, { force: true });
        rmSync(receipt, { force: true });
        rmSync(promptPath, { force: true });
      }
    },
  },

  codex: {
    binary: 'codex',
    discover() {
      record('codex', 'inspect', 'discover', 'skip', false, 0, 'Codex CLI has no inspect --json for rules, agents, skills, or hooks.');
      if (!existsSync(join(REPO_ROOT, '.agents')) && !existsSync(join(REPO_ROOT, 'AGENTS.md'))) {
        record('codex', 'init:agent-teams', 'discover', 'skip', false, 0, 'project not initialized for Codex (ruflo init --codex)');
        return;
      }
      const skill = join(REPO_ROOT, '.agents', 'skills', 'agent-teams', 'SKILL.md');
      // A project initialized by an older Ruflo has no agent-teams skill yet: warn, not fail.
      record('codex', 'init:skill:agent-teams', 'discover', 'warn', existsSync(skill), 0,
        existsSync(skill) ? '.agents/skills/agent-teams/SKILL.md' : 'agent-teams skill missing; re-run ruflo init --codex');
      let hooks = null;
      try { hooks = JSON.parse(readFileSync(join(REPO_ROOT, '.codex', 'hooks.json'), 'utf8')); } catch { /* none */ }
      const entry = JSON.stringify(hooks?.hooks?.SubagentStop ?? []).includes('team hook-stop');
      if (entry) record('codex', 'init:hook:subagent-stop', 'discover', 'critical', true, 0, '.codex/hooks.json → team hook-stop (trust it in /hooks)');
      else record('codex', 'init:hook:subagent-stop', 'discover', 'warn', false, 0, 'no team hook-stop entry: init --codex adds it unless --no-team-hooks; ruflo team run does not need it');
    },
    connect() {
      const r = run('codex', ['mcp', 'list', '--json'], 30_000);
      const data = parseJson(r.stdout);
      if (!Array.isArray(data)) {
        record('codex', 'mcp:list', 'connect', 'critical', false, r.ms, r.error || `exit=${r.code} no json`);
        return;
      }
      const server = data.find((s) => MCP_NAMES.includes(s.name) && s.enabled !== false);
      if (!server) {
        record('codex', 'mcp:ruflo', 'connect', 'warn', false, r.ms, `no enabled ${MCP_NAMES.join(' or ')} in Codex MCP config`);
        return;
      }
      const cmd = server.transport?.command;
      const argv = Array.isArray(server.transport?.args) ? server.transport.args : [];
      const filter = server.transport?.env?.CLAUDE_FLOW_MCP_TOOLS || '';
      record('codex', 'mcp:configured', 'connect', 'critical', true, r.ms, `${server.name}: ${cmd || server.transport?.type} ${argv[0] || ''}`.trim());
      record('codex', 'mcp:handshake', 'connect', 'skip', false, 0, 'codex mcp list shows configuration, not a live handshake');
      const cli = argv.find((a) => String(a).endsWith('cli.js'));
      if (!cli || !existsSync(cli)) {
        record('codex', 'server-tools', 'connect', 'skip', false, 0, 'configured command is not a local cli.js, so tool names were not listed');
        return;
      }
      const names = toolNamesFromCli(cli);
      const groups = new Set(String(filter).split(',').map((s) => s.trim()).filter(Boolean));
      const groupOf = {
        team_create: 'team',
        memory_store: 'memory',
        memory_retrieve: 'memory',
        hooks_route: 'hooks',
        swarm_init: 'swarm',
        neural_status: 'neural',
      };
      for (const tool of REQUIRED_TOOLS) {
        const group = groupOf[tool];
        if (groups.size && !groups.has(group)) {
          record('codex', `server-tool:${tool}`, 'connect', 'skip', false, 0, `host filter CLAUDE_FLOW_MCP_TOOLS=${filter} does not include ${group}`);
          continue;
        }
        record('codex', `server-tool:${tool}`, 'connect', 'critical', names.has(tool), 0, names.has(tool) ? 'present on the configured CLI' : 'missing');
      }
    },
    execute() {
      record('codex', 'hook:session-start', 'execute', 'skip', false, 0, 'The exec path needs no hook; the stop signal is the --json stream and the exit code.');
      if (LIVE) {
        teamRoundTrip('codex', ['codex']);
        return;
      }
      // One read-only, ephemeral turn. The prompt goes over stdin and stdin is closed.
      const r = run('codex', ['exec', '--ephemeral', '--sandbox', 'read-only', '--skip-git-repo-check', '--json', '-'], 180_000,
        { cwd: tmpdir(), input: 'Reply with exactly: PING' });
      const events = r.stdout.split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      const done = events.some((e) => e.type === 'turn.completed');
      const failed = events.find((e) => e.type === 'turn.failed');
      record('codex', 'session:ping', 'execute', 'critical', r.code === 0 && done && !failed, r.ms,
        done ? 'turn.completed' : failed ? `turn.failed: ${failed.error?.message || ''}` : `exit=${r.code} ${(r.error || r.stderr).slice(0, 200)}`);
    },
  },
};

/** Ruflo team CLI call against a project root. */
function teamCli(verb, params, root) {
  const r = run(process.execPath, [CLI, 'team', verb, '--params', JSON.stringify(params)], 60_000,
    { cwd: root, env: { CLAUDE_FLOW_CWD: root } });
  return { ...r, json: parseJson(r.stdout) };
}

/**
 * Team round trip through the exec runner: a one-step plan, team_spawn for
 * the host, `ruflo team run`, then check the run file, the lead's inbox and
 * the plan index. Spends one model turn on the host.
 */
function teamRoundTrip(host, hosts, root = mkdtempSync(join(tmpdir(), `${RUN_ID}-team-`))) {
  const team = `${RUN_ID}-${host}`.replace(/[^A-Za-z0-9_-]/g, '-');
  const setup = [
    teamCli('create', { name: team, host: hosts[0] }, root),
    teamCli('plan', { team, steps: ['child'] }, root),
    teamCli('spawn', {
      team, agent: 'child', role: 'reviewer', hosts,
      prompt: 'Do not edit files. Reply with exactly: TEAM_OK',
    }, root),
  ];
  const bad = setup.find((s) => s.json?.success !== true);
  if (bad) {
    record(host, 'live:team-setup', 'execute', 'critical', false, bad.ms, String(bad.json?.error || bad.stderr).slice(0, 240));
    return;
  }
  const r = run(process.execPath, [CLI, 'team', 'run', '--team', team, '--agent', 'child', '--json', '--timeout', '300000'], 330_000,
    { cwd: root, env: { CLAUDE_FLOW_CWD: root } });
  const res = parseJson(r.stdout);
  record(host, 'live:team-run', 'execute', 'critical', r.code === 0 && res?.outcome === 'done', r.ms,
    r.code === 0 ? `${res?.runFile}` : `exit=${r.code} ${String(res?.reason || res?.error || r.stderr).slice(0, 240)}`);
  let runFile = null;
  try { runFile = JSON.parse(readFileSync(join(root, res?.runFile || '-'), 'utf8')); } catch { /* reported */ }
  record(host, 'live:run-file', 'execute', 'critical', runFile?.code === 0, 0, runFile ? `code=${runFile.code} ms=${runFile.ms}` : 'missing');
  const inbox = teamCli('inbox', { team, agent: 'lead', peek: true }, root);
  const result = (inbox.json?.messages || []).find((m) => m.type === 'result' && m.from === 'child');
  record(host, 'live:lead-result', 'execute', 'critical', Boolean(result), 0, result ? result.content.slice(0, 120).replace(/\s+/g, ' ') : 'no result message in the lead inbox');
  const status = teamCli('status', { team }, root);
  const idx = status.json?.team?.plan?.index;
  record(host, 'live:plan-advanced', 'execute', 'critical', idx === 1, 0, `plan index=${idx}`);
  if (runFile && Array.isArray(runFile.mcpTools)) {
    const teamCalls = runFile.mcpTools.filter((t) => /team_/.test(t));
    record(host, 'live:child-called-team-tools', 'execute', 'warn', teamCalls.length > 0, 0,
      teamCalls.length ? teamCalls.join(', ') : 'child made no team_* MCP call (the runner delivered the handoff)');
  }
  teamCli('shutdown', { team }, root);
}

const commandAdapter = {
  binary: 'node',
  discover() {
    const file = join(PROJECT, '.claude-flow', 'team-hosts.json');
    let doc = null;
    try { doc = JSON.parse(readFileSync(file, 'utf8')); } catch { /* none */ }
    if (!doc) {
      record('command', 'team-hosts.json', 'discover', 'skip', false, 0, `no ${file}`);
      return false;
    }
    const labels = Object.keys(doc.hosts || {});
    const label = COMMAND_LABEL || labels[0];
    const cfg = doc.hosts?.[label];
    record('command', `host:${label}`, 'discover', 'critical', Boolean(cfg), 0, cfg ? `${cfg.command} ${cfg.args?.join(' ')}` : `label not in ${labels.join(', ') || '(none)'}`);
    if (!cfg) return false;
    const bin = which(cfg.command);
    record('command', `binary:${cfg.command}`, 'discover', 'critical', Boolean(bin), 0, bin || 'not on PATH');
    return Boolean(bin);
  },
  connect() {
    record('command', 'mcp', 'connect', 'skip', false, 0, 'command hosts are checked through the runner, not an MCP handshake');
  },
  execute() {
    const label = COMMAND_LABEL || Object.keys(JSON.parse(readFileSync(join(PROJECT, '.claude-flow', 'team-hosts.json'), 'utf8')).hosts)[0];
    teamRoundTrip('command', [label], PROJECT);
  },
};

function readPrompt(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

function runHost(id) {
  if (id === 'command') {
    const ready = commandAdapter.discover();
    commandAdapter.connect();
    if (EXECUTE && ready) commandAdapter.execute();
    return;
  }
  const adapter = adapters[id];
  const bin = which(adapter.binary);
  if (!bin) {
    record(id, 'binary', 'discover', 'skip', false, 0, `${adapter.binary} is not on PATH`);
    return;
  }
  record(id, 'binary', 'discover', 'critical', true, 0, bin);
  adapter.discover();
  adapter.connect();
  statusCheck(id);
  if (EXECUTE) adapter.execute();
  else record(id, 'execute', 'execute', 'skip', false, 0, 'model turns are opt-in: pass --execute or --live');
}

function statusCheck(id) {
  const script = join(REPO_ROOT, 'scripts', 'host-statusline.mjs');
  if (!existsSync(script)) {
    record(id, 'statusline', 'status', 'skip', false, 0, 'scripts/host-statusline.mjs is not in this checkout');
    return;
  }
  const r = run(process.execPath, [script, '--host', id, '--json'], 15_000);
  const data = parseJson(r.stdout);
  if (!data?.line) {
    record(id, 'statusline', 'status', 'warn', false, r.ms, 'status snapshot produced no line');
    return;
  }
  if (id === 'codex' || data.surface == null) {
    record(id, 'statusline', 'status', 'skip', false, r.ms, `${data.line} — this host has no status row`);
    return;
  }
  const loaded = String(data.line).startsWith('RuFlo loaded');
  record(id, 'statusline', 'status', loaded ? 'critical' : 'warn', loaded, r.ms, data.line);
  if (id === 'grok') {
    const homeCfg = join(process.env.HOME || '', '.grok', 'config.toml');
    let wired = false;
    try {
      // Header, [ ui."status_line" ], dotted key, or inline table.
      wired = existsSync(homeCfg)
        && /^\s*\[\s*ui\s*\.\s*["']?status_line["']?\s*\]|^\s*(ui\s*\.\s*)?status_line\s*[.=]/m.test(readFileSync(homeCfg, 'utf8'));
    } catch {
      wired = false;
    }
    record(
      id,
      'statusline:wired',
      'status',
      wired ? 'critical' : 'warn',
      wired,
      0,
      wired
        ? 'user ~/.grok/config.toml has [ui.status_line] (project config cannot set this)'
        : 'row stays hidden until ~/.grok/config.toml has [ui.status_line]; project .grok/config.toml cannot enable it',
    );
  }
}

function main() {
  const known = [...Object.keys(adapters), 'command'];
  if (HOST_ARG !== 'all' && !known.includes(HOST_ARG)) {
    console.error(`Unknown --host ${HOST_ARG}. Use ${known.join(', ')}, or all.`);
    process.exit(2);
  }
  const hosts = HOST_ARG === 'all' ? known : [HOST_ARG];
  if (!JSON_OUT) console.log(`Host probe  run=${RUN_ID}  hosts=${hosts.join(',')}  live=${LIVE}  execute=${EXECUTE}`);
  for (const id of hosts) runHost(id);
  const critical = results.filter((r) => r.level === 'critical' && !r.ok);
  const skips = results.filter((r) => r.level === 'skip');
  const warns = results.filter((r) => r.level === 'warn' && !r.ok);
  const report = {
    id: RUN_ID,
    when: new Date().toISOString(),
    hosts,
    live: LIVE,
    execute: EXECUTE,
    pass: results.filter((r) => r.ok).length,
    fail: critical.length,
    skip: skips.length,
    warn: warns.length,
    results,
  };
  const outDir = join(REPO_ROOT, 'docs', 'benchmarks');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'host-live-latest.json'), JSON.stringify(report, null, 2) + '\n');
  const lines = [
    `# Host probe — ${RUN_ID}`,
    '',
    `**When:** ${report.when}`,
    `**Hosts:** ${hosts.join(', ')}`,
    `**Live model turn:** ${LIVE}`,
    `**Result:** ${critical.length ? 'FAIL' : 'PASS'} — ${report.pass} passed, ${critical.length} failed, ${warns.length} warnings, ${skips.length} skipped`,
    '',
    'Skips are surfaces that host does not expose. They are not passes.',
    '',
    '| Status | Host | Domain | Id | Detail |',
    '|--------|------|--------|----|--------|',
  ];
  for (const r of results) {
    const status = r.ok ? 'PASS' : r.level === 'skip' ? 'SKIP' : r.level === 'warn' ? 'WARN' : 'FAIL';
    lines.push(`| ${status} | ${r.host} | ${r.domain} | \`${r.id}\` | ${r.detail.replace(/\|/g, '/')} |`);
  }
  lines.push('');
  writeFileSync(join(outDir, 'host-live-latest.md'), lines.join('\n'));
  if (JSON_OUT) console.log(JSON.stringify(report, null, 2));
  else console.log(`\n${critical.length ? 'FAIL' : 'PASS'}  ${report.pass} passed, ${critical.length} failed, ${warns.length} warnings, ${skips.length} skipped`);
  process.exit(critical.length ? 1 : 0);
}

main();
