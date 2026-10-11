// _ledger.mjs — provider-agnostic usage rows from the logs agents already write.
//
// Every reader yields rows of ONE shape, so pricing, summaries and the advisor
// never care which tool produced them:
//   { provider, model, ts, session, project, input, cache_read, cache_write_5m,
//     cache_write_1h, output, reasoning, effort, sidechain }
// `input` is UNCACHED input only; cache reads/writes are their own buckets.
//
// Counting rules, each one a way trackers double-count (all verified against
// real local files, see docs/adrs/0004):
//   claude  one assistant message is logged once per content block / tool call,
//           so rows are de-duplicated by message.id + requestId.
//   codex   `total_token_usage` is a RUNNING total and `last_token_usage` the
//           latest turn; we take the delta between consecutive totals (never both),
//           skip events whose total did not move, and treat a total that goes
//           DOWN (compaction/reset) as a fresh base. Cached input is a SUBSET of
//           input_tokens, so uncached = input - cached. A forked rollout replays
//           its parent's events, so events are de-duplicated by owner+timestamp+totals.
//           Copied metadata identifies replayed usage; explicit thread markers
//           restore the helper's ownership without resetting the running total.
//           The model comes from the latest `turn_context`, not the token event.
//   grok    `~/.grok/sessions/<urlencoded-cwd>/<session-id>/usage.json` — one row
//           per turn when `turns[]` is present, else one row from `session`
//           totals. Cached input is a SUBSET of inputTokens (same as Codex).
//           Project path is decodeURIComponent of the parent folder, or
//           summary.json `info.cwd` when present. Override home with GROK_HOME.
//   Nothing is read that is not already on this machine; nothing is sent anywhere.

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const home = () => process.env.HOME || homedir();
export const claudeDir = () => join(process.env.CLAUDE_CONFIG_DIR || join(home(), '.claude'), 'projects');
export const codexDirs = () => (process.env.CODEX_HOME || join(home(), '.codex')).split(',').map(dir => dir.trim()).filter(Boolean);
export const grokDir = () => process.env.GROK_HOME || join(home(), '.grok');

/** .jsonl files under `root`, at most `depth` directories down, newer than `sinceMs` (by mtime). */
function walk(root, depth, sinceMs, filePrefix = '') {
  const out = [];
  if (!existsSync(root)) return out;
  const visit = (dir, left) => {
    let names;
    try { names = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of names) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) { if (left > 0) visit(path, left - 1); continue; }
      if (!entry.name.endsWith('.jsonl') || !entry.name.startsWith(filePrefix)) continue;
      try { if (statSync(path).mtimeMs >= sinceMs) out.push(path); } catch { /* vanished */ }
    }
  };
  visit(root, depth);

  return out;
}

const lines = path => { try { return readFileSync(path, 'utf-8').split('\n'); } catch { return []; } };
const parse = text => { if (!text) return null; try { return JSON.parse(text); } catch { return null; } };
const n = value => (Number.isFinite(value) ? value : 0);

/** Claude Code transcripts → rows, de-duplicated. */
export function* claudeRows({ sinceMs = 0 } = {}) {
  const seen = new Set();
  for (const file of walk(claudeDir(), 4, sinceMs)) {
    for (const text of lines(file)) {
      if (!text.includes('"usage"')) continue;
      const line = parse(text);
      const message = line?.message;
      const usage = message?.usage;
      if (usage === undefined || message?.role !== 'assistant' || !message.model || message.model === '<synthetic>') continue;
      const ts = Date.parse(line.timestamp);
      if (!Number.isFinite(ts) || ts < sinceMs) continue;
      const key = `${message.id ?? line.uuid}|${line.requestId ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const split = usage.cache_creation;
      const written = n(usage.cache_creation_input_tokens);
      // Without the TTL split every write is priced as the cheaper 5-minute write and the row says so via `unsplit`.
      const w1 = split ? n(split.ephemeral_1h_input_tokens) : 0;
      const w5 = split ? n(split.ephemeral_5m_input_tokens) : written;

      yield {
        provider: 'claude', model: message.model, ts, session: line.sessionId ?? file, project: line.cwd ?? '',
        input: n(usage.input_tokens), cache_read: n(usage.cache_read_input_tokens), cache_write_5m: w5, cache_write_1h: w1,
        output: n(usage.output_tokens), reasoning: n(usage.output_tokens_details?.thinking_tokens),
        effort: line.effort ?? '', sidechain: line.isSidechain === true, unsplit: !split && written > 0,
      };
    }
  }
}

const FIELDS = ['input_tokens', 'cached_input_tokens', 'cache_write_input_tokens', 'output_tokens', 'reasoning_output_tokens'];

/** Codex rollouts (sessions/ and archived_sessions/) → one row per token_count delta. */
export function* codexRows({ sinceMs = 0 } = {}) {
  const seenFiles = new Set();
  const seenEvents = new Set();
  for (const home of codexDirs()) {
    // sessions/ first: when a rollout exists in both places the active copy wins.
    for (const sub of ['sessions', 'archived_sessions']) {
      for (const file of walk(join(home, sub), 4, sinceMs, 'rollout-')) {
        const id = file.replace(/^.*rollout-/, '');
        if (seenFiles.has(id)) continue;
        seenFiles.add(id);
        let model = '';
        let effort = '';
        let session = id;
        let project = '';
        let own = null;
        let prev = null;
        for (const text of lines(file)) {
          if (!text.includes('"turn_context"') && !text.includes('"token_count"') && !text.includes('"session_meta"') && !text.includes('"thread_id"')) continue;
          const line = parse(text);
          const payload = line?.payload;
          if (line?.type === 'session_meta') {
            if ((payload?.id ?? session) !== session) { model = ''; effort = ''; }
            session = payload?.id ?? session;
            project = payload?.cwd ?? project;
            own ??= { session, project };
            continue;
          }
          const marker = line?.type === 'turn_context' || (line?.type === 'event_msg' &&
            ['task_started', 'thread_settings_applied'].includes(payload?.type));
          if (marker && typeof payload?.thread_id === 'string' && payload.thread_id && payload.thread_id !== session) {
            session = payload.thread_id;
            project = session === own?.session ? own.project : '';
            model = ''; effort = '';
          }
          if (line?.type === 'turn_context') { model = payload?.model ?? model; effort = payload?.effort ?? effort; project = payload?.cwd ?? project; continue; }
          if (payload?.type !== 'token_count' || !payload.info?.total_token_usage) continue;
          const total = payload.info.total_token_usage;
          const ts = Date.parse(line.timestamp);
          if (!Number.isFinite(ts)) continue;
          const delta = {};
          const reset = prev !== null && FIELDS.some(field => n(total[field]) < n(prev[field]));
          for (const field of FIELDS) delta[field] = n(total[field]) - (prev === null || reset ? 0 : n(prev[field]));
          prev = total;
          if (FIELDS.every(field => delta[field] === 0) || ts < sinceMs) continue;
          const key = JSON.stringify([session, line.timestamp, ...FIELDS.map(field => n(total[field]))]);
          if (seenEvents.has(key)) continue;
          seenEvents.add(key);
          const cached = delta.cached_input_tokens;
          const written = delta.cache_write_input_tokens;

          yield {
            provider: 'codex', model: model || 'unknown', ts, session, project,
            input: Math.max(0, delta.input_tokens - cached - written), cache_read: cached, cache_write_5m: written, cache_write_1h: 0,
            output: delta.output_tokens, reasoning: delta.reasoning_output_tokens, effort, sidechain: false,
          };
        }
      }
    }
  }
}

/** Decode the URL-encoded cwd folder Grok uses under sessions/, or '' on failure. */
function decodeGrokProject(encoded) {
  if (!encoded) return '';
  try { return decodeURIComponent(encoded); } catch { return ''; }
}

/** usage.json files under ~/.grok/sessions/<cwd>/<id>/, newer than sinceMs by mtime. */
function walkGrokUsage(root, sinceMs) {
  const out = [];
  const sessions = join(root, 'sessions');
  if (!existsSync(sessions)) return out;
  let projects;
  try { projects = readdirSync(sessions, { withFileTypes: true }); } catch { return out; }
  for (const project of projects) {
    if (!project.isDirectory()) continue;
    const projectPath = join(sessions, project.name);
    let ids;
    try { ids = readdirSync(projectPath, { withFileTypes: true }); } catch { continue; }
    for (const id of ids) {
      if (!id.isDirectory()) continue;
      const usagePath = join(projectPath, id.name, 'usage.json');
      try {
        if (statSync(usagePath).mtimeMs >= sinceMs) out.push({ usagePath, sessionDir: join(projectPath, id.name), encodedProject: project.name, sessionId: id.name });
      } catch { /* no usage.json or vanished */ }
    }
  }
  return out;
}

function grokProjectFor(sessionDir, encodedProject) {
  const fromFolder = decodeGrokProject(encodedProject);
  const summaryPath = join(sessionDir, 'summary.json');
  if (!existsSync(summaryPath)) return fromFolder;
  const summary = parse(readFileSync(summaryPath, 'utf-8'));
  const cwd = summary?.info?.cwd;
  return typeof cwd === 'string' && cwd ? cwd : fromFolder;
}

function grokRowFromUsage({ provider = 'grok', model, ts, session, project, inputTokens, cachedReadTokens, cacheCreationTokens, outputTokens, reasoningTokens }) {
  const cached = n(cachedReadTokens);
  const written = n(cacheCreationTokens);
  return {
    provider, model: model || 'unknown', ts, session, project,
    input: Math.max(0, n(inputTokens) - cached - written), cache_read: cached, cache_write_5m: written, cache_write_1h: 0,
    output: n(outputTokens), reasoning: n(reasoningTokens), effort: '', sidechain: false,
  };
}

/** Grok CLI sessions (~/.grok/sessions) → one row per turn, or session totals when turns[] is absent. */
export function* grokRows({ sinceMs = 0 } = {}) {
  for (const { usagePath, sessionDir, encodedProject, sessionId } of walkGrokUsage(grokDir(), sinceMs)) {
    const data = parse(readFileSync(usagePath, 'utf-8'));
    if (!data) continue;
    const project = grokProjectFor(sessionDir, encodedProject);
    const session = data.sessionId || sessionId;
    const turns = Array.isArray(data.turns) ? data.turns : null;
    if (turns && turns.length > 0) {
      for (const turn of turns) {
        const ts = Date.parse(turn?.endedAt || data.updatedAt || '');
        if (!Number.isFinite(ts) || ts < sinceMs) continue;
        const model = turn.primaryModelId || Object.keys(turn.modelUsage || {})[0] || data.session?.primaryModelId || '';
        yield grokRowFromUsage({
          model, ts, session, project,
          inputTokens: turn.inputTokens, cachedReadTokens: turn.cachedReadTokens,
          cacheCreationTokens: turn.cacheCreationTokens, outputTokens: turn.outputTokens,
          reasoningTokens: turn.reasoningTokens,
        });
      }
      continue;
    }
    const sess = data.session;
    if (!sess) continue;
    const ts = Date.parse(data.updatedAt || '');
    if (!Number.isFinite(ts) || ts < sinceMs) continue;
    const model = sess.primaryModelId || Object.keys(sess.modelUsage || {})[0] || '';
    yield grokRowFromUsage({
      model, ts, session, project,
      inputTokens: sess.inputTokens, cachedReadTokens: sess.cachedReadTokens,
      cacheCreationTokens: sess.cacheCreationTokens, outputTokens: sess.outputTokens,
      reasoningTokens: sess.reasoningTokens,
    });
  }
}

export const READERS = { claude: claudeRows, codex: codexRows, grok: grokRows };

/** True when `row.project` is `project` itself or a directory inside it (a trailing slash on `project` is ignored). */
export function inProject(row, project) {
  const root = project.length > 1 ? project.replace(/\/+$/, '') : project;
  const at = typeof row.project === 'string' ? row.project : '';

  return at === root || at.startsWith(`${root}/`);
}

/**
 * Rows for the chosen providers (default all), oldest first. `untilMs` (inclusive) and `project` narrow the window;
 * with neither, the result is exactly what it was before they existed.
 */
export function collect({ providers = Object.keys(READERS), sinceMs = 0, untilMs = Infinity, project = '' } = {}) {
  const rows = [];
  for (const name of providers) if (READERS[name]) rows.push(...READERS[name]({ sinceMs }));
  const kept = untilMs === Infinity && project === '' ? rows : rows.filter(row => row.ts <= untilMs && (project === '' || inProject(row, project)));

  return kept.sort((a, b) => a.ts - b.ts);
}
