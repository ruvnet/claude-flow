#!/usr/bin/env node
/**
 * Grok SubagentStop → team bus on-stop (ADR-402).
 *
 * Reads the hook JSON from stdin (Grok / Claude compatible fields) and marks
 * the stopped teammate idle, advancing its team's plan.
 *
 * Which teammate: team_spawn sets the spawn description to
 * `<role>:<agent>@<team>`. The hook parses that; TEAM_NAME / SUBAGENT_NAME
 * env vars or explicit `team` / `agentName` fields override it.
 *
 * Which team, when the description has no @team: the one active team that
 * lists the agent as a member. Several matches are reported as ambiguous and
 * nothing is advanced.
 *
 * Exit codes: 0 done, or the subagent is not a team member (nothing to do);
 * 1 a team subagent could not be recorded (reason on stderr, non-blocking).
 */
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const bus = await import(pathToFileURL(join(here, 'grok-team-bus.mjs')).href);

const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.env.GROK_WORKSPACE_ROOT || process.cwd();

function readStdin() {
  if (process.stdin.isTTY) return Promise.resolve('');
  return new Promise((resolve) => {
    let data = '';
    const t = setTimeout(() => resolve(data), 1000);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { data += c; });
    process.stdin.on('end', () => { clearTimeout(t); resolve(data); });
    process.stdin.on('error', () => { clearTimeout(t); resolve(data); });
  });
}

function fail(reason) {
  process.stderr.write(`ruflo team hook: ${reason}\n`);
  process.exit(1);
}

let input = {};
const raw = await readStdin();
try {
  input = raw.trim() ? JSON.parse(raw) : {};
} catch {
  input = {};
}

const description = input.description ?? input.toolInput?.description ?? input.tool_input?.description;
const parsed = bus.parseSpawnDescription(description) || {};
const agent =
  process.env.SUBAGENT_NAME
  || input.subagentName
  || input.agentName
  || input.agent
  || parsed.agent;
const explicitTeam = process.env.TEAM_NAME || input.teamName || input.team || parsed.team;

if (!agent) {
  // Not a team spawn (no description in <role>:<agent>@<team> form).
  process.exit(0);
}

let team = explicitTeam;
if (!team) {
  let matches;
  try {
    matches = bus.teamsWithMember(projectRoot, String(agent));
  } catch (err) {
    fail(err.message);
  }
  if (matches.length === 0) process.exit(0);
  if (matches.length > 1) {
    fail(`agent "${agent}" is on several active teams (${matches.join(', ')}); spawn with the description from team_spawn (<role>:<agent>@<team>) or set TEAM_NAME`);
  }
  team = matches[0];
}

try {
  const r = await bus.onStop(projectRoot, { team: String(team), agent: String(agent) });
  if (!r.member && !r.advanced) {
    fail(`agent "${agent}" is not a member of team "${team}" and is not its current plan step`);
  }
} catch (err) {
  fail(err.message || String(err));
}
process.exit(0);
