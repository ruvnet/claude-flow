#!/usr/bin/env node
/**
 * Host-agnostic Agent Teams bus (ADR-402) — filesystem store.
 *
 * Works from any host (Grok, Claude, Codex) without proprietary SendMessage.
 * The team_* MCP tools and the SubagentStop hook import this file, and
 * `init --grok` copies it (with grok-team-store.mjs, the storage layer) into a
 * project as a zero-dependency CLI:
 *
 *   node scripts/grok-team-bus.mjs <create|spawn|send|inbox|status|plan|on-stop|shutdown> --team <team> …
 *
 * Run with no arguments for the full usage. `spawn` prints the plan that Grok
 * maps to spawn_subagent.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  NAME_RE,
  assertActive,
  ensureRealDir,
  loadTeam,
  mailboxDir,
  nowIso,
  readJson,
  realDirExists,
  safeName,
  teamDir,
  teamFile,
  teamsRoot,
  updateTeam,
  withTeamLock,
  writeJsonAtomic,
} from './grok-team-store.mjs';

export const GROK_CONTRACT = 'grok-build-1.0.41';
export const MAX_PRIORITY = 999;
export const DEFAULT_PRIORITY = 2;


const ROLE_DEFAULTS = {
  researcher: { capability_mode: 'read-only', isolation: 'none', subagent_type: 'explore', claudeTaskType: 'researcher' },
  architect: { capability_mode: 'read-only', isolation: 'none', subagent_type: 'plan', claudeTaskType: 'system-architect' },
  developer: { capability_mode: 'all', isolation: 'worktree', subagent_type: 'general-purpose', claudeTaskType: 'coder' },
  coder: { capability_mode: 'all', isolation: 'worktree', subagent_type: 'general-purpose', claudeTaskType: 'coder' },
  tester: { capability_mode: 'all', isolation: 'worktree', subagent_type: 'general-purpose', claudeTaskType: 'tester' },
  reviewer: { capability_mode: 'read-only', isolation: 'none', subagent_type: 'general-purpose', claudeTaskType: 'reviewer' },
  security: { capability_mode: 'read-only', isolation: 'none', subagent_type: 'general-purpose', claudeTaskType: 'security-auditor' },
  coordinator: { capability_mode: 'all', isolation: 'none', subagent_type: 'general-purpose', claudeTaskType: 'coordinator' },
};

// ---------------------------------------------------------------------------
// Spawn plan
// ---------------------------------------------------------------------------

/**
 * The spawn description carries role, agent, and team so the SubagentStop
 * hook can resolve which plan step finished: `<role>:<agent>@<team>`.
 */
export function spawnDescription(role, agent, team) {
  return `${role}:${agent}@${team}`;
}

/** Inverse of spawnDescription. Also accepts a bare agent name. */
export function parseSpawnDescription(desc) {
  if (typeof desc !== 'string') return null;
  const m = /^\s*(?:([A-Za-z0-9_-]+):)?([A-Za-z0-9][A-Za-z0-9_-]{0,63})(?:@([A-Za-z0-9][A-Za-z0-9_-]{0,63}))?\s*$/.exec(desc);
  if (!m) return null;
  return { role: m[1] || null, agent: m[2], team: m[3] || null };
}

function roleConstraint(mode, isolation) {
  if (mode === 'read-only') {
    return 'Constraint: do not create, edit, delete, or move files, and do not run commands that change the repo. Read, search, and report.';
  }
  if (isolation === 'worktree') {
    return 'Constraint: Grok isolates your edits in a git worktree. Stay inside that worktree and report its path when you finish.';
  }
  return 'Constraint: report results to the team lead. Stay inside the files this task names.';
}

function buildSpawnPlan(t, agent, role, prompt, next) {
  const defaults = ROLE_DEFAULTS[role] || ROLE_DEFAULTS.coder;
  const spawn = {
    description: spawnDescription(role, agent, t.name),
    background: true,
    isolation: defaults.isolation,
  };
  const protocol = [
    `You are "${agent}" (role: ${role}) on team "${t.name}".`,
    'Grok Build 1.0.41 runs you as a general-purpose subagent. Nesting depth is 1: do not call spawn_subagent.',
    roleConstraint(defaults.capability_mode, defaults.isolation),
    'Host-agnostic Agent Teams bus (ADR-402). There is no Claude SendMessage tool.',
    `Read your inbox first: team_inbox (team=${t.name}, agent=${agent}).`,
    'Hand off with team_send. Without the Ruflo MCP server, use the CLI:',
    `  node scripts/grok-team-bus.mjs inbox --team ${t.name} --agent ${agent}`,
    `  node scripts/grok-team-bus.mjs send --team ${t.name} --from ${agent} --to <next> --summary "<short>" --message "<handoff>"`,
    next.length
      ? `Primary next agent(s): ${next.join(', ')}`
      : 'Report completion to the team lead (parent session).',
    '',
    'Task:',
    prompt || `(No task body — wait for inbox / lead instructions for role ${role}.)`,
  ].join('\n');

  return {
    teamId: t.id,
    name: agent,
    role,
    prompt: protocol,
    next,
    host: {
      grok: {
        // Pass `spawn` to spawn_subagent together with top-level `prompt`.
        contract: GROK_CONTRACT,
        spawn,
        advisory: {
          capability_mode: defaults.capability_mode,
          subagent_type: defaults.subagent_type,
          note: 'Grok Build 1.0.41 does not take capability_mode or subagent_type on spawn_subagent. The child is general-purpose; the prompt carries the constraint. isolation is the enforced knob. .grok/agents/*.md are session profiles (grok --agent-profile), not spawn types.',
        },
      },
      claude: {
        taskType: defaults.claudeTaskType || role,
        note: 'optional back-compat path via Task tool',
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Operations (throw Error on failure; return plain objects)
// ---------------------------------------------------------------------------

export async function createTeam(projectRoot, opts) {
  const name = safeName(opts.name, 'name');
  const dir = teamDir(projectRoot, name);
  ensureRealDir(projectRoot, dir);
  const maxAgents = Math.min(Math.max(Math.trunc(Number(opts.maxAgents)) || 8, 1), 50);
  const t = {
    id: name,
    name,
    topology: opts.topology || 'hierarchical',
    maxAgents,
    status: 'active',
    createdAt: nowIso(),
    host: opts.host || 'grok',
    members: {},
    plan: { steps: [], index: 0 },
  };
  return withTeamLock(projectRoot, name, () => {
    const existed = fs.existsSync(teamFile(projectRoot, name));
    if (existed && !opts.force) {
      throw new Error(`Team "${name}" already exists (pass force to overwrite its metadata)`);
    }
    if (existed && opts.force) {
      // Recreating an existing team must not leak the old incarnation's
      // mailboxes (pending or archived messages) into the fresh one — wipe
      // them along with the metadata (ADR-402 round-2 review, N4).
      const mailbox = path.join(dir, 'mailbox');
      if (realDirExists(mailbox)) fs.rmSync(mailbox, { recursive: true, force: true });
    }
    writeJsonAtomic(teamFile(projectRoot, name), t);
    ensureRealDir(projectRoot, path.join(dir, 'mailbox'));
    return { action: 'create', team: t };
  });
}

function parseNext(next) {
  const list = Array.isArray(next)
    ? next.map(String)
    : typeof next === 'string' ? next.split(',') : [];
  return list.map((s) => s.trim()).filter(Boolean).map((s) => safeName(s, 'next'));
}

export async function spawnMember(projectRoot, opts) {
  const agent = safeName(opts.agent, 'agent');
  const role = safeName(opts.role || agent, 'role');
  const next = parseNext(opts.next);
  const prompt = typeof opts.prompt === 'string' ? opts.prompt : '';
  const result = await updateTeam(projectRoot, opts.team, (t) => {
    assertActive(t);
    const members = t.members || (t.members = {});
    if (!members[agent] && Object.keys(members).length >= t.maxAgents) {
      throw new Error(`Team "${t.name}" is full (maxAgents=${t.maxAgents})`);
    }
    const plan = buildSpawnPlan(t, agent, role, prompt, next);
    members[agent] = {
      name: agent,
      role,
      status: 'registered',
      registeredAt: nowIso(),
      next,
      spawn: plan.host,
    };
    return { action: 'spawn', spawnPlan: plan, teamId: t.id };
  });
  ensureRealDir(projectRoot, mailboxDir(projectRoot, opts.team, agent));
  return result;
}

/**
 * Priority must be a plain base-10 integer literal 0-MAX_PRIORITY. A string
 * value is checked against that shape directly, rejecting anything
 * `Number()` would otherwise happily coerce — scientific notation ("1e2")
 * and hex/octal/binary prefixes ("0x10", "0o20", "0b101") all parse to an
 * in-range integer but are not the small plain integer this field is meant
 * to be (ADR-402 round-2 review, N5, minor item 5).
 */
export function parsePriority(value) {
  if (value === undefined || value === null || value === '') return DEFAULT_PRIORITY;
  let n;
  if (typeof value === 'number') {
    n = value;
  } else {
    const s = String(value).trim();
    if (!/^-?\d+$/.test(s)) {
      throw new Error(`priority must be an integer 0-${MAX_PRIORITY} (lower is read first), got "${value}"`);
    }
    n = Number(s);
  }
  if (!Number.isInteger(n) || n < 0 || n > MAX_PRIORITY) {
    throw new Error(`priority must be an integer 0-${MAX_PRIORITY} (lower is read first), got "${value}"`);
  }
  return n;
}

const messageFileName = (msg) => `${String(msg.priority).padStart(3, '0')}_${msg.id}.json`;

export function sendMessage(projectRoot, opts) {
  const to = opts.to || '*';
  if (to !== '*') safeName(to, 'to');
  const from = safeName(opts.from || 'lead', 'from');
  const content = String(opts.message ?? opts.content ?? '');
  if (!content.trim()) throw new Error('message is required');
  const priority = parsePriority(opts.priority);

  // Hold the lock so a concurrent shutdown or spawn cannot interleave.
  return withTeamLock(projectRoot, opts.team, () => {
    const t = loadTeam(projectRoot, opts.team);
    assertActive(t);
    const recipients = to === '*' ? Object.keys(t.members || {}) : [to];
    if (recipients.length === 0) {
      throw new Error(`Team "${t.name}" has no members to broadcast to — team_spawn them first, or send to a named agent`);
    }
    const msg = {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
      teamId: t.id,
      from,
      to,
      summary: String(opts.summary || ''),
      content,
      type: String(opts.type || 'handoff'),
      priority,
      timestamp: nowIso(),
    };
    for (const r of recipients) {
      const dir = mailboxDir(projectRoot, t.name, r);
      ensureRealDir(projectRoot, dir);
      // wx: never write through a pre-existing file or symlink of that name.
      fs.writeFileSync(path.join(dir, messageFileName(msg)), JSON.stringify(msg, null, 2) + '\n', {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      });
    }
    return { action: 'send', message: msg, recipients };
  });
}

function pendingFiles(dir) {
  if (!realDirExists(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
}

/**
 * Drain (default) or peek one agent's mailbox on one team. A drain claims each
 * file by renaming it into archive/ first, so two concurrent drains each get a
 * disjoint set of messages and neither throws.
 */
export function readInbox(projectRoot, opts) {
  const agent = safeName(opts.agent, 'agent');
  loadTeam(projectRoot, opts.team);
  const dir = mailboxDir(projectRoot, opts.team, agent);
  const peek = opts.peek === true;
  const messages = [];
  const files = pendingFiles(dir);
  if (files.length && !peek) ensureRealDir(projectRoot, path.join(dir, 'archive'));
  for (const f of files) {
    let file = path.join(dir, f);
    if (!peek) {
      const archived = path.join(dir, 'archive', f);
      try {
        fs.renameSync(file, archived);
      } catch (err) {
        if (err.code === 'ENOENT') continue; // another reader claimed it
        throw err;
      }
      file = archived;
    }
    const msg = readJson(file);
    if (msg) messages.push(msg);
  }
  return { action: 'inbox', team: opts.team, agent, messages, peek };
}

export function teamStatus(projectRoot, opts) {
  const t = loadTeam(projectRoot, opts.team);
  const names = new Set(Object.keys(t.members || {}));
  const box = path.join(teamDir(projectRoot, opts.team), 'mailbox');
  if (realDirExists(box)) {
    for (const ent of fs.readdirSync(box, { withFileTypes: true })) {
      if (ent.isDirectory() && NAME_RE.test(ent.name)) names.add(ent.name);
    }
  }
  const pendingMail = {};
  for (const name of [...names].sort()) {
    pendingMail[name] = pendingFiles(mailboxDir(projectRoot, opts.team, name)).length;
  }
  return { action: 'status', team: t, pendingMail };
}

function normalizeSteps(steps) {
  let list = steps;
  if (typeof list === 'string') {
    try {
      list = JSON.parse(list);
    } catch {
      list = list.split(',').map((s) => s.trim()).filter(Boolean);
    }
  }
  if (!Array.isArray(list) || list.length === 0) throw new Error('steps must be a non-empty list');
  return list.map((s, i) => {
    const agent = typeof s === 'string' ? s : s && (s.agent || s.id);
    const id = typeof s === 'string' ? s : s && (s.id || s.agent);
    return {
      id: safeName(String(id), 'step id'),
      agent: safeName(String(agent), 'step agent'),
      status: i === 0 ? 'ready' : 'pending',
    };
  });
}

export function setPlan(projectRoot, opts) {
  const steps = normalizeSteps(opts.steps);
  return updateTeam(projectRoot, opts.team, (t) => {
    assertActive(t);
    t.plan = { steps, index: 0, updatedAt: nowIso() };
    return { action: 'plan', plan: t.plan };
  });
}

export function onStop(projectRoot, opts) {
  const agent = safeName(opts.agent, 'agent');
  return updateTeam(projectRoot, opts.team, (t) => {
    assertActive(t);
    const member = t.members?.[agent];
    if (member) {
      member.status = 'idle';
      member.lastStopAt = nowIso();
    }
    const plan = t.plan || (t.plan = { steps: [], index: 0 });
    const cur = plan.steps[plan.index];
    const advanced = Boolean(cur && (cur.agent === agent || cur.id === agent));
    if (advanced) {
      cur.status = 'done';
      plan.index = Math.min(plan.index + 1, plan.steps.length);
      const nxt = plan.steps[plan.index];
      if (nxt) nxt.status = 'ready';
      plan.updatedAt = nowIso();
    }
    const nextStep = plan.steps[plan.index] || null;
    return {
      action: 'on-stop',
      agent,
      member: Boolean(member),
      advanced,
      next: nextStep,
      assign: nextStep
        ? { hint: `Spawn or resume agent "${nextStep.agent}" for the next plan step`, agent: nextStep.agent }
        : { hint: 'Plan complete — lead should synthesize' },
    };
  });
}

export function shutdownTeam(projectRoot, opts) {
  return updateTeam(projectRoot, opts.team, (t) => {
    t.status = 'shutdown';
    t.shutdownAt = nowIso();
    for (const m of Object.values(t.members || {})) m.status = 'shutdown';
    return { action: 'shutdown', teamId: t.id };
  });
}

/**
 * Active teams that list `agent` as a member. The SubagentStop hook uses this
 * when the spawn description carries no @team: exactly one match is used,
 * several matches are reported as ambiguous.
 */
export function teamsWithMember(projectRoot, agent) {
  const root = teamsRoot(projectRoot);
  if (!realDirExists(root)) return [];
  const out = [];
  for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
    if (!ent.isDirectory() || !NAME_RE.test(ent.name)) continue;
    const t = readJson(path.join(root, ent.name, 'team.json'));
    if (t && t.status === 'active' && t.members && t.members[agent]) out.push(ent.name);
  }
  return out.sort();
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        out[key] = true;
      } else {
        out[key] = next;
        i++;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

const print = (obj) => process.stdout.write(JSON.stringify(obj, null, 2) + '\n');

const USAGE = [
  'create --name <team> [--topology hierarchical] [--max-agents 8] [--force]',
  'spawn --team <team> --agent <name> [--role <role>] [--prompt "..."] [--next a,b]',
  'send --team <team> --to <agent|*> --message "..." [--summary s] [--from lead] [--priority 0-999]',
  'inbox --team <team> --agent <name> [--peek]',
  'status --team <team>',
  'plan --team <team> --steps \'["architect","developer","tester"]\'',
  'on-stop --team <team> --agent <name>',
  'shutdown --team <team>',
];

export async function runCli(argv, env = process.env) {
  const args = parseArgs(argv);
  const cmd = args._[0];
  const projectRoot = path.resolve(
    typeof args.root === 'string' ? args.root : env.CLAUDE_PROJECT_DIR || env.GROK_WORKSPACE_ROOT || process.cwd(),
  );
  const team = args.team || args.name;
  switch (cmd) {
    case 'create':
      return createTeam(projectRoot, {
        name: team,
        topology: args.topology,
        maxAgents: args['max-agents'] ?? args.maxAgents,
        host: args.host,
        force: args.force === true,
      });
    case 'spawn':
      return spawnMember(projectRoot, {
        team,
        agent: args.agent || args.member,
        role: args.role,
        prompt: args.prompt || args.message,
        next: args.next,
      });
    case 'send':
      return sendMessage(projectRoot, {
        team,
        to: args.to,
        from: args.from,
        summary: args.summary,
        message: args.message ?? args.content,
        type: args.type,
        priority: args.priority,
      });
    case 'inbox':
      return readInbox(projectRoot, { team, agent: args.agent || args.to, peek: args.peek === true });
    case 'status':
      return teamStatus(projectRoot, { team });
    case 'plan':
      return setPlan(projectRoot, { team, steps: args.steps });
    case 'on-stop':
      return onStop(projectRoot, { team, agent: args.agent });
    case 'shutdown':
      return shutdownTeam(projectRoot, { team });
    default:
      return null;
  }
}

async function main() {
  let result;
  try {
    result = await runCli(process.argv.slice(2));
  } catch (err) {
    print({ ok: false, error: err.message || String(err) });
    process.exit(1);
    return;
  }
  if (result === null) {
    print({ ok: false, error: 'usage', commands: USAGE });
    process.exit(process.argv[2] ? 1 : 0);
    return;
  }
  print({ ok: true, ...result });
}

function invokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

if (invokedDirectly()) main();
