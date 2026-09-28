/**
 * Pure helpers for `ruflo team run` (ADR-402): prompt assembly, placeholder
 * filling, the Codex event stream, plan readiness, and bounded result reads.
 */

import { spawnSync } from 'node:child_process';
import { closeSync, lstatSync, openSync, readSync, renameSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import type { ExecSpec } from './team-hosts/index.js';
import type { BusMessage, StoreMember, StoreTeam } from './team-bus.js';

/**
 * Put queued messages in a delimited block before the task. The task body
 * starts at the last "Task:" line of the protocol; without one the block is
 * appended.
 */
export function withMessages(prompt: string, messages: BusMessage[]): string {
  if (!messages.length) return prompt;
  const lines = [`=== Messages for you (${messages.length}, oldest first; already removed from your inbox) ===`];
  for (const m of messages) {
    lines.push(`--- from ${m.from} · ${m.type}${m.summary ? ` · ${m.summary}` : ''} ---`, m.content);
  }
  lines.push('=== End of messages ===');
  const block = lines.join('\n');
  const at = prompt.lastIndexOf('\nTask:\n');
  return at < 0 ? `${prompt}\n\n${block}` : `${prompt.slice(0, at)}\n${block}\n${prompt.slice(at)}`;
}

export interface ExecPlanEntry {
  kind: 'exec';
  exec: ExecSpec;
  prompt?: string;
  events?: string;
}

export function isExecEntry(v: unknown): v is ExecPlanEntry {
  const e = v as ExecPlanEntry;
  return !!e && typeof e === 'object' && e.kind === 'exec' && !!e.exec
    && typeof e.exec.command === 'string' && Array.isArray(e.exec.args);
}

/** First enabled `ruflo` or `claude-flow` server in `codex mcp list --json`. */
export function codexMcpServer(): string | undefined {
  try {
    const r = spawnSync('codex', ['mcp', 'list', '--json'], { encoding: 'utf-8', timeout: 15_000 });
    if (r.status !== 0 || !r.stdout) return undefined;
    const list = JSON.parse(r.stdout) as Array<{ name?: string; enabled?: boolean }>;
    for (const want of ['ruflo', 'claude-flow']) {
      if (list.some((s) => s.name === want && s.enabled !== false)) return want;
    }
  } catch {
    /* codex missing or output not JSON */
  }
  return undefined;
}

/**
 * Fill placeholders in one argument in a single pass, so text substituted
 * from the prompt is never rescanned. A placeholder written as "{name}"
 * inside a larger argument gets a JSON-quoted value (valid TOML for
 * `codex -c key="value"`, including Windows paths).
 */
export function fillPlaceholders(arg: string, vars: Record<string, string>): string {
  return arg.replace(/"\{([A-Za-z]+)\}"|\{([A-Za-z]+)\}/g, (m, quoted: string, bare: string) => {
    const key = quoted || bare;
    if (!(key in vars)) return m;
    return quoted ? JSON.stringify(vars[key]) : vars[key];
  });
}

interface CodexEvents {
  threadId?: string;
  terminal?: 'turn.completed' | 'turn.failed';
  failure?: string;
  lastMessage?: string;
  /** `server.tool` names of MCP calls the child made. */
  mcpTools?: string[];
}

/** Read the `codex exec --json` stream. Lines that are not JSON are ignored. */
export function parseCodexEvents(stdout: string): CodexEvents {
  const out: CodexEvents = {};
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    let ev: Record<string, any>;
    try {
      ev = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (ev.type === 'thread.started' && typeof ev.thread_id === 'string') out.threadId = ev.thread_id;
    if (ev.type === 'turn.completed') out.terminal = 'turn.completed';
    if (ev.type === 'turn.failed') {
      out.terminal = 'turn.failed';
      out.failure = String(ev.error?.message ?? 'turn.failed');
    }
    if (ev.type === 'item.completed' && ev.item?.type === 'agent_message' && typeof ev.item.text === 'string') {
      out.lastMessage = ev.item.text;
    }
    if (ev.type === 'item.completed' && ev.item?.type === 'mcp_tool_call' && typeof ev.item.tool === 'string') {
      (out.mcpTools ??= []).push(`${ev.item.server ?? '?'}.${ev.item.tool}`);
    }
  }
  return out;
}

/**
 * Why `agent` may not run now given the team plan, or undefined when it may.
 * A member with no plan step runs ad hoc; a member that owns steps runs only
 * when one of them is the current step.
 */
export function planBlock(team: StoreTeam, agent: string): string | undefined {
  const { steps, index } = team.plan;
  const owned = steps.map((s, i) => ({ s, i })).filter(({ s }) => s.agent === agent || s.id === agent);
  if (!owned.length) return undefined;
  const cur = steps[index];
  if (cur && (cur.agent === agent || cur.id === agent)) return undefined;
  const later = owned.find(({ i }) => i > index);
  if (later) {
    return `step "${later.s.id}" for "${agent}" is not ready: the current step is "${cur?.id}" (agent "${cur?.agent}")`;
  }
  return `every plan step for "${agent}" is done; set a new plan with team_plan to run it again`;
}

/** True when the member's recorded run may still be alive. */
export function runLooksLive(m: StoreMember): boolean {
  if (m.status !== 'running' || !m.runId) return false;
  const pid = typeof m.runPid === 'number' ? m.runPid : undefined;
  // Another machine, or a runner from before runPid was recorded: assume live.
  if (pid === undefined || m.runHost !== hostname()) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Read at most `max` bytes of a regular file. Symlinks and devices are refused. */
export function readResultFile(file: string, max: number): { text: string; truncated: boolean; refused?: string } {
  let st;
  try {
    st = lstatSync(file);
  } catch {
    return { text: '', truncated: false };
  }
  if (!st.isFile()) return { text: '', truncated: false, refused: st.isSymbolicLink() ? 'symlink' : 'not a regular file' };
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(Math.min(st.size, max));
    const n = readSync(fd, buf, 0, buf.length, 0);
    let text = buf.subarray(0, n).toString('utf8');
    // A cut inside a multi-byte character decodes to U+FFFD; drop it.
    if (st.size > max) text = text.replace(/�+$/, '');
    return { text, truncated: st.size > max };
  } finally {
    closeSync(fd);
  }
}

/** Model for a Codex plan: recorded at team_spawn, or `-m` from a plan stored before that. */
export function memberModel(member: StoreMember, entry: ExecPlanEntry): string | undefined {
  if (typeof member.model === 'string' && member.model) return member.model;
  const i = entry.exec.args.indexOf('-m');
  const v = i >= 0 ? entry.exec.args[i + 1] : undefined;
  return v && /^[A-Za-z0-9._:/-]+$/.test(v) ? v : undefined;
}

/** Write a run record through a temp file and rename. */
export function writeRunFile(file: string, data: unknown): void {
  const tmp = `${file}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  renameSync(tmp, file);
}
