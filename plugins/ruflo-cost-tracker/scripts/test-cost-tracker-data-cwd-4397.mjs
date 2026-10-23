#!/usr/bin/env node
/**
 * Regression guard for ruvnet/ruflo#4397 part 2 — track.mjs must run the
 * `memory store` child in CLAUDE_FLOW_CWD (the store the MCP server uses),
 * not in the project directory the Stop hook fired from. Without it the CLI
 * creates a stray .swarm/memory.db in the session project.
 *
 * Hermetic: a fake POSIX `ruflo` on PATH records its working directory.
 * Skipped on win32 (the fake CLI is a sh script).
 *
 * Usage: node plugins/ruflo-cost-tracker/scripts/test-cost-tracker-data-cwd-4397.mjs
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeProjectPath } from './_encode-project-path.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TRACK_SCRIPT = join(HERE, 'track.mjs');

if (process.platform === 'win32') {
  console.log('# SKIPPED on win32 (fake CLI is a POSIX sh script)');
  process.exit(0);
}

let failed = 0;
const assert = (cond, label, detail = '') => {
  if (cond) console.log(`ok: ${label}`);
  else { failed++; console.error(`FAIL: ${label}${detail ? `\n     ${detail}` : ''}`); }
};

const TMP = realpathSync(mkdtempSync(join(tmpdir(), 'ruflo-cost-tracker-cwd-')));
const BIN = join(TMP, 'bin');
mkdirSync(BIN, { recursive: true });
const MARK = join(TMP, 'cwd-mark');
writeFileSync(join(BIN, 'ruflo'), `#!/bin/sh\npwd -P > "${MARK}"\nexit 0\n`);
chmodSync(join(BIN, 'ruflo'), 0o755);

function run(name, extraEnv) {
  const home = join(TMP, `home-${name}`);
  const project = join(TMP, `project-${name}`);
  mkdirSync(project, { recursive: true });
  const dir = join(home, '.claude', 'projects', encodeProjectPath(project));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 's.jsonl'), [
    { sessionId: 's', cwd: project, timestamp: '2026-10-11T00:00:00.000Z', type: 'user' },
    { sessionId: 's', cwd: project, timestamp: '2026-10-11T00:00:05.000Z', type: 'assistant',
      message: { model: 'claude-opus-5-5', usage: { input_tokens: 1, output_tokens: 1 } } },
  ].map((l) => JSON.stringify(l)).join('\n') + '\n');
  const env = { ...process.env, PATH: BIN, RUFLO_PLUGIN_SKIP_LOCAL_CLI: '1', HOME: home, USERPROFILE: home, TRACK_CWD: project, ...extraEnv };
  for (const k of ['RUFLO_PLUGIN_SKIP_PATH_CLI', 'TRACK_DRY_RUN', 'TRACK_SESSION', 'CLI_CORE', 'NODE_OPTIONS']) delete env[k];
  if (!extraEnv.CLAUDE_FLOW_CWD) delete env.CLAUDE_FLOW_CWD;
  const r = spawnSync(process.execPath, [TRACK_SCRIPT], { cwd: project, encoding: 'utf-8', timeout: 15_000, env });
  const seen = existsSync(MARK) ? readFileSync(MARK, 'utf-8').trim() : null;
  return { r, project, seen };
}

const DATA = join(TMP, 'data-root');
mkdirSync(DATA, { recursive: true });
const a = run('a', { CLAUDE_FLOW_CWD: DATA });
assert(a.r.status === 0, 'track.mjs exits 0', `status ${a.r.status}: ${a.r.stderr}`);
assert(a.seen === DATA, 'memory store runs in CLAUDE_FLOW_CWD', `saw ${a.seen}, wanted ${DATA}`);

writeFileSync(MARK, '');
const b = run('b', {});
assert(b.seen === b.project, 'without CLAUDE_FLOW_CWD it keeps the session cwd', `saw ${b.seen}, wanted ${b.project}`);

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
