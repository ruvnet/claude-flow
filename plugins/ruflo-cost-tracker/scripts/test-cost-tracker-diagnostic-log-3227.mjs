#!/usr/bin/env node
/**
 * Regression guard for ruvnet/ruflo#3227 — a cost-tracker write failure must
 * leave a trace instead of vanishing silently behind the Stop hook's
 * TRACK_QUIET / stdio:'ignore' best-effort contract.
 *
 * Covers (all hermetic — fake `ruflo` CLI on PATH, isolated HOME, no network):
 *   1. track.mjs: a real persistToMemory() failure appends one line to the
 *      shared diagnostic log, before the TRACK_QUIET early-return.
 *   1b. TRACK_DRY_RUN=1 is an intentional skip, not a failure — no log line.
 *   2. ruflo-hook.cjs: a spawned track.mjs that exits non-zero appends its
 *      own line to the same log, and the hook still exits 0.
 *   3. The log is capped/rotated, not left to grow unboundedly.
 *   4. Neither script ever throws or exits non-zero even when the log WRITE
 *      itself fails (HOME pointed at a location the log directory can't be
 *      created under).
 *   5. logFailure() itself never throws even when called with no argument at
 *      all (destructuring a bad argument must happen inside its own try).
 *
 * Technique follows test-cli-resolution-3558.mjs: a fake POSIX `ruflo` shell
 * script on PATH stands in for the real CLI, so persistToMemory()'s
 * underlying `memory store` subprocess call fails deterministically without
 * touching the network or a real AgentDB.
 *
 * NOT exercised here (POSIX-only; flag for Windows verification):
 *   - The fake `ruflo` CLI is a `#!/bin/sh` script, so scenarios 1/1b/4a are
 *     skipped on win32 (same restriction test-cli-resolution-3558.mjs
 *     documents for its end-to-end cases). Scenarios 2, 3, and 4b run
 *     everywhere since they exercise ruflo-hook.cjs/_diagnostic-log.cjs
 *     directly with a `node`-only fixture, no shell script involved.
 *   - Windows path separators (`\`) in reason strings, and
 *     USERPROFILE-vs-HOME resolution for homedir(), are not separately
 *     verified — only exercised incidentally via the env override below.
 *
 * Usage (from repo root):
 *   node plugins/ruflo-cost-tracker/scripts/test-cost-tracker-diagnostic-log-3227.mjs
 */

import { spawnSync } from 'node:child_process';
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const TRACK_SCRIPT = join(HERE, 'track.mjs');
const HOOK_SCRIPT = join(HERE, 'ruflo-hook.cjs');
const DIAG_LOG_MODULE = join(HERE, '_diagnostic-log.cjs');

let passed = 0, failed = 0;
function assert(cond, label, detail = '') {
  if (cond) { passed++; console.log(`ok: ${label}`); return; }
  failed++;
  console.error(`FAIL: ${label}${detail ? `\n     ${detail}` : ''}`);
}

const write = (file, body, mode) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, body);
  if (mode) chmodSync(file, mode);
};

// macOS tmpdir() is /var/… while resolved paths come back as /private/var/…
const TMP = realpathSync(mkdtempSync(join(tmpdir(), 'ruflo-cost-tracker-diag-log-')));

const encodeProjectPath = (cwd) => cwd.replace(/[/\\:]/g, '-');

/** Writes a minimal Stop-hook-sized session jsonl track.mjs can summarize. */
function seedSession(home, project, sessionId) {
  const sessionDir = join(home, '.claude', 'projects', encodeProjectPath(project));
  mkdirSync(project, { recursive: true });
  write(join(sessionDir, `${sessionId}.jsonl`), [
    { sessionId, cwd: project, timestamp: '2026-10-11T00:00:00.000Z', type: 'user' },
    { sessionId, cwd: project, timestamp: '2026-10-11T00:00:05.000Z', type: 'assistant',
      message: { model: 'claude-opus-5-5', usage: { input_tokens: 10, output_tokens: 20 } } },
  ].map((l) => JSON.stringify(l)).join('\n') + '\n');
}

const logPathFor = (home) => join(home, '.claude-flow', 'logs', 'cost-tracker-failures.log');
const readLogLines = (home) => {
  const p = logPathFor(home);
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf-8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
};

try {
  if (process.platform === 'win32') {
    console.log('# scenarios 1 / 1b / 4a SKIPPED on win32 (fake CLI is a POSIX sh script) — see header note');
  } else {
    // ── fixture: a `ruflo` on PATH that always fails `memory store` ───────
    const FAILING_RUFLO = join(TMP, 'bin-failing-ruflo');
    write(join(FAILING_RUFLO, 'ruflo'),
      '#!/bin/sh\ncase "$*" in\n"memory store"*) echo "simulated persistToMemory failure" >&2; exit 1 ;;\n*) echo "[OK] done" ;;\nesac\n',
      0o755);

    const commonEnv = (home) => {
      const env = { ...process.env, PATH: FAILING_RUFLO, RUFLO_PLUGIN_SKIP_LOCAL_CLI: '1', HOME: home, USERPROFILE: home };
      for (const k of ['RUFLO_PLUGIN_SKIP_PATH_CLI', 'TRACK_DRY_RUN', 'TRACK_SESSION', 'CLI_CORE', 'NODE_OPTIONS']) delete env[k];
      return env;
    };

    // ── 1. track.mjs: a real persistToMemory() failure logs one line ──────
    const HOME1 = join(TMP, 'home-1');
    const PROJECT1 = join(TMP, 'project-1');
    seedSession(HOME1, PROJECT1, 'sess-1');
    const r1 = spawnSync(process.execPath, [TRACK_SCRIPT], {
      cwd: PROJECT1, encoding: 'utf-8', timeout: 15_000,
      env: { ...commonEnv(HOME1), TRACK_CWD: PROJECT1 },
    });
    assert(r1.status === 0, 'track.mjs still exits 0 on a real persist failure', `status ${r1.status}: ${r1.stderr}`);
    const lines1 = readLogLines(HOME1);
    assert(lines1.length === 1, 'track.mjs failure appends exactly one diagnostic log line', JSON.stringify(lines1));
    assert(lines1[0]?.source === 'track.mjs', 'logged line source is track.mjs', JSON.stringify(lines1[0]));
    assert(typeof lines1[0]?.reason === 'string' && lines1[0].reason.includes('simulated persistToMemory failure'),
      'logged reason carries the real stderr failure text', JSON.stringify(lines1[0]));
    assert(lines1[0]?.sessionId === 'sess-1', 'logged line carries the session id', JSON.stringify(lines1[0]));

    // ── 1b. TRACK_DRY_RUN=1 is a skip, not a failure — no log line ────────
    const HOME1B = join(TMP, 'home-1b');
    const PROJECT1B = join(TMP, 'project-1b');
    seedSession(HOME1B, PROJECT1B, 'sess-1b');
    const r1b = spawnSync(process.execPath, [TRACK_SCRIPT], {
      cwd: PROJECT1B, encoding: 'utf-8', timeout: 15_000,
      env: { ...commonEnv(HOME1B), TRACK_CWD: PROJECT1B, TRACK_DRY_RUN: '1' },
    });
    assert(r1b.status === 0, 'track.mjs exits 0 under TRACK_DRY_RUN=1', `status ${r1b.status}: ${r1b.stderr}`);
    assert(readLogLines(HOME1B).length === 0, 'TRACK_DRY_RUN=1 does not write a diagnostic log line', JSON.stringify(readLogLines(HOME1B)));

    // ── 4a. the log WRITE itself failing must not break "never block" ─────
    const HOME4A = join(TMP, 'home-4a');
    const PROJECT4A = join(TMP, 'project-4a');
    seedSession(HOME4A, PROJECT4A, 'sess-4a');
    mkdirSync(HOME4A, { recursive: true });
    write(join(HOME4A, '.claude-flow'), 'not a directory'); // blocks mkdirSync(LOG_DIR, {recursive:true})
    const r4a = spawnSync(process.execPath, [TRACK_SCRIPT], {
      cwd: PROJECT4A, encoding: 'utf-8', timeout: 15_000,
      env: { ...commonEnv(HOME4A), TRACK_CWD: PROJECT4A },
    });
    assert(r4a.status === 0 && r4a.signal === null, 'track.mjs still exits 0 when the diagnostic log write itself fails',
      `status ${r4a.status} signal ${r4a.signal}: ${r4a.stderr}`);
  }

  // ── 2. ruflo-hook.cjs: a spawned track.mjs exiting non-zero logs it ─────
  const HOME2 = join(TMP, 'home-2');
  const FAKE_PLUGIN_2 = join(TMP, 'fake-plugin-2');
  write(join(FAKE_PLUGIN_2, 'scripts', 'track.mjs'), 'process.exit(1);\n');
  mkdirSync(HOME2, { recursive: true });
  const r2 = spawnSync(process.execPath, [HOOK_SCRIPT], {
    input: JSON.stringify({ session_id: 'sess-2', hook_event_name: 'Stop', stop_hook_active: false }),
    encoding: 'utf-8', timeout: 15_000,
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: FAKE_PLUGIN_2, HOME: HOME2, USERPROFILE: HOME2 },
  });
  assert(r2.status === 0, 'ruflo-hook.cjs exits 0 even though the spawned track.mjs exited non-zero',
    `status ${r2.status}: ${r2.stderr}`);
  const lines2 = readLogLines(HOME2);
  assert(lines2.length === 1, 'ruflo-hook.cjs appends exactly one diagnostic log line', JSON.stringify(lines2));
  assert(lines2[0]?.source === 'ruflo-hook.cjs', 'logged line source is ruflo-hook.cjs', JSON.stringify(lines2[0]));
  assert(typeof lines2[0]?.reason === 'string' && lines2[0].reason.includes('exit 1'),
    'logged reason reflects the non-zero exit code', JSON.stringify(lines2[0]));

  // ── 4b. same "never block" guarantee for ruflo-hook.cjs's own log write ─
  const HOME4B = join(TMP, 'home-4b');
  const FAKE_PLUGIN_4B = join(TMP, 'fake-plugin-4b');
  write(join(FAKE_PLUGIN_4B, 'scripts', 'track.mjs'), 'process.exit(1);\n');
  mkdirSync(HOME4B, { recursive: true });
  write(join(HOME4B, '.claude-flow'), 'not a directory');
  const r4b = spawnSync(process.execPath, [HOOK_SCRIPT], {
    input: JSON.stringify({ session_id: 'sess-4b' }), encoding: 'utf-8', timeout: 15_000,
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: FAKE_PLUGIN_4B, HOME: HOME4B, USERPROFILE: HOME4B },
  });
  assert(r4b.status === 0 && r4b.signal === null, 'ruflo-hook.cjs still exits 0 when its own diagnostic log write fails',
    `status ${r4b.status} signal ${r4b.signal}: ${r4b.stderr}`);

  // ── 3. cap / rotation — runs _diagnostic-log.cjs directly, fresh process ─
  const HOME3 = join(TMP, 'home-3');
  mkdirSync(HOME3, { recursive: true });
  const rotationScript = join(TMP, 'rotation-check.mjs');
  write(rotationScript, [
    "import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';",
    "import { dirname } from 'node:path';",
    `const { logFailure, LOG_PATH } = await import(${JSON.stringify(pathToFileURL(DIAG_LOG_MODULE).href)});`,
    'mkdirSync(dirname(LOG_PATH), { recursive: true });',
    'const seedLines = [];',
    'for (let i = 0; i < 6000; i++) seedLines.push(JSON.stringify({ ts: "t", source: "seed", reason: `line-${i}-` + "x".repeat(80) }));',
    'writeFileSync(LOG_PATH, seedLines.join("\\n") + "\\n");',
    'logFailure({ source: "test", reason: "trigger-rotation" });',
    'const finalLines = readFileSync(LOG_PATH, "utf-8").split("\\n").filter(Boolean);',
    'console.log(JSON.stringify({ count: finalLines.length, last: finalLines[finalLines.length - 1], first: finalLines[0] }));',
  ].join('\n'));
  const r3 = spawnSync(process.execPath, [rotationScript], {
    encoding: 'utf-8', timeout: 15_000,
    env: { ...process.env, HOME: HOME3, USERPROFILE: HOME3 },
  });
  assert(r3.status === 0, 'rotation check script runs cleanly', `status ${r3.status}: ${r3.stderr}`);
  let rot = null;
  try { rot = JSON.parse(r3.stdout.trim()); } catch { /* reported below */ }
  assert(rot != null, 'rotation check produced parseable output', r3.stdout + r3.stderr);
  if (rot) {
    assert(rot.count <= 201, 'log is truncated to the keep-cap (not left to grow unboundedly)', JSON.stringify(rot));
    assert(JSON.parse(rot.last).reason === 'trigger-rotation', 'the newest line survives truncation', JSON.stringify(rot));
    assert(!JSON.parse(rot.first).reason.startsWith('line-0-'), 'the oldest seeded lines are dropped, not the newest', JSON.stringify(rot));
  }

  // ── 5. logFailure() must never throw, even with a missing/null argument ─
  // Isolate HOME before this first (and only) in-process import, so a throw
  // here can't also write into the real developer/CI machine's home dir.
  const HOME5 = join(TMP, 'home-5');
  mkdirSync(HOME5, { recursive: true });
  process.env.HOME = HOME5;
  process.env.USERPROFILE = HOME5;
  const { logFailure } = await import(pathToFileURL(DIAG_LOG_MODULE).href);
  let threw = false;
  try { logFailure(); } catch { threw = true; }
  assert(!threw, 'logFailure() with no argument at all does not throw');
  threw = false;
  try { logFailure(null); } catch { threw = true; }
  assert(!threw, 'logFailure(null) does not throw');
  threw = false;
  try { logFailure(undefined); } catch { threw = true; }
  assert(!threw, 'logFailure(undefined) does not throw');
} finally {
  rmSync(TMP, { recursive: true, force: true });
}

console.log(`\n${passed}/${passed + failed} passed`);
process.exit(failed === 0 ? 0 : 1);
