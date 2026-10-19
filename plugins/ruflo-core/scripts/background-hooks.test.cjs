'use strict';
/**
 * #4128 (telemetry off the tool path) and #4176 (CLI runs from the project root).
 * Drives the real shim exactly as hooks.json does, against a slow fake CLI.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SHIM = path.join(__dirname, 'ruflo-hook.cjs');
const SLOW = path.join(__dirname, 'fixtures', 'hook-cli-slow.cjs');
const dedupFreeEnv = (extra) => ({
  ...process.env,
  RUFLO_MODS_OWNS: '',
  RUFLO_DISABLE_HOOK_DEDUP: '1',
  RUFLO_HOOK_SKIP_NPX: '1',
  RUFLO_HOOK_CLI_OVERRIDE: `"${process.execPath}" "${SLOW}"`,
  ...extra,
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(file, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')); await sleep(50); }
  return null;
}
function runShim(subcommand, event, env, cwd) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [SHIM, subcommand], { input: JSON.stringify(event), env, cwd, encoding: 'utf8', timeout: 20_000 });
  return { ms: Date.now() - t0, status: r.status, stdout: r.stdout };
}
const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), name));

test('post-command returns before a slow CLI finishes, and the CLI still gets argv and stdin (#4128)', async () => {
  const work = tmp('rf-bg-'); const out = path.join(work, 'out.json');
  const env = dedupFreeEnv({ HOOK_SLOW_OUT: out, HOOK_SLOW_MS: '2500', RUFLO_HOOK_TMP_DIR: work });
  const event = { tool_input: { command: 'echo hi' }, tool_response: { exit_code: 0 } };
  const r = runShim('post-command', event, env, work);
  assert.equal(r.status, 0);
  assert.ok(r.ms < 1800, `shim took ${r.ms} ms, expected well under the CLI's 2500 ms`);
  assert.equal(fs.existsSync(out), false, 'CLI has not finished yet');
  const got = await waitFor(out);
  assert.ok(got, 'the detached CLI completed');
  assert.deepEqual(got.argv, ['hooks', 'post-command', '-c', 'echo hi', '-s', 'true', '-e', '0']);
  assert.deepEqual(JSON.parse(got.stdin), event);
});

test('PreToolUse telemetry is detached too and the verdict is still printed (#4128)', async () => {
  const work = tmp('rf-bg-'); const out = path.join(work, 'out.json');
  const env = dedupFreeEnv({ HOOK_SLOW_OUT: out, HOOK_SLOW_MS: '2500', RUFLO_HOOK_TMP_DIR: work });
  const r = runShim('modify-bash', { tool_input: { command: 'ls' } }, env, work);
  assert.equal(r.stdout, '{"permission":"allow"}');
  assert.ok(r.ms < 1800, `shim took ${r.ms} ms`);
  assert.ok(await waitFor(out), 'CLI still ran');
});

test('RUFLO_HOOK_SYNC=1 restores the synchronous path', () => {
  const work = tmp('rf-bg-'); const out = path.join(work, 'out.json');
  const env = dedupFreeEnv({ HOOK_SLOW_OUT: out, HOOK_SLOW_MS: '600', RUFLO_HOOK_SYNC: '1', RUFLO_HOOK_TMP_DIR: work });
  const r = runShim('post-command', { tool_input: { command: 'x' }, tool_response: { exit_code: 0 } }, env, work);
  assert.equal(r.status, 0);
  assert.equal(fs.existsSync(out), true, 'the CLI had finished when the shim returned');
});

test('the CLI runs from CLAUDE_PROJECT_DIR, not the shell directory the session cd-ed into (#4176)', async () => {
  const project = fs.realpathSync(tmp('rf-proj-')); const sub = path.join(project, 'sub', 'deep');
  fs.mkdirSync(sub, { recursive: true });
  const out = path.join(project, 'out.json');
  const env = dedupFreeEnv({ HOOK_SLOW_OUT: out, HOOK_SLOW_MS: '50', CLAUDE_PROJECT_DIR: project, RUFLO_HOOK_TMP_DIR: project });
  runShim('post-command', { tool_input: { command: 'x' }, tool_response: { exit_code: 0 } }, env, sub);
  const got = await waitFor(out);
  assert.ok(got, 'CLI ran');
  assert.equal(fs.realpathSync(got.cwd), project);
});

test('an unusable CLAUDE_PROJECT_DIR is ignored and the process cwd is kept (#4176)', async () => {
  const work = fs.realpathSync(tmp('rf-cwd-')); const out = path.join(work, 'out.json');
  for (const bad of ['relative/dir', path.join(work, 'does-not-exist'), path.join(work, 'out-file')]) {
    fs.rmSync(out, { force: true }); fs.writeFileSync(path.join(work, 'out-file'), 'x');
    const env = dedupFreeEnv({ HOOK_SLOW_OUT: out, HOOK_SLOW_MS: '50', CLAUDE_PROJECT_DIR: bad, RUFLO_HOOK_TMP_DIR: work });
    runShim('post-command', { tool_input: { command: 'x' }, tool_response: { exit_code: 0 } }, env, work);
    const got = await waitFor(out);
    assert.ok(got, `CLI ran for ${bad}`);
    assert.equal(fs.realpathSync(got.cwd), work);
  }
});

test('a burst over the concurrency cap drops telemetry instead of spawning without limit (#4128)', async () => {
  const work = tmp('rf-cap-');
  const outs = [0, 1, 2, 3, 4, 5].map((i) => path.join(work, `o${i}.json`));
  const results = outs.map((o) => runShim('post-command', { tool_input: { command: 'c' }, tool_response: { exit_code: 0 } },
    dedupFreeEnv({ HOOK_SLOW_OUT: o, HOOK_SLOW_MS: '3000', RUFLO_HOOK_MAX_PARALLEL: '2', RUFLO_HOOK_TMP_DIR: work }), work));
  assert.ok(results.every((r) => r.status === 0), 'no shim ever fails the turn');
  await sleep(4500);
  const finished = outs.filter((o) => fs.existsSync(o)).length;
  assert.equal(finished, 2, `exactly the cap of 2 ran, got ${finished}`);
});

test('a freed slot is reused: after the CLIs exit the next event runs again', async () => {
  const work = tmp('rf-reuse-'); const out = path.join(work, 'o.json');
  const env = dedupFreeEnv({ HOOK_SLOW_OUT: out, HOOK_SLOW_MS: '150', RUFLO_HOOK_MAX_PARALLEL: '1', RUFLO_HOOK_TMP_DIR: work });
  const ev = { tool_input: { command: 'c' }, tool_response: { exit_code: 0 } };
  runShim('post-command', ev, env, work);
  assert.ok(await waitFor(out), 'first ran');
  await sleep(300); fs.rmSync(out, { force: true });
  runShim('post-command', ev, env, work);
  assert.ok(await waitFor(out), 'second ran after the first exited');
});

test('session-end is never dropped by the cap', async () => {
  const work = tmp('rf-stop-'); const out = path.join(work, 'o.json');
  const base = { HOOK_SLOW_MS: '3000', RUFLO_HOOK_MAX_PARALLEL: '1', RUFLO_HOOK_TMP_DIR: work };
  runShim('post-command', { tool_input: { command: 'c' }, tool_response: { exit_code: 0 } }, dedupFreeEnv({ ...base, HOOK_SLOW_OUT: path.join(work, 'x.json') }), work);
  runShim('session-end', {}, dedupFreeEnv({ ...base, HOOK_SLOW_MS: '100', HOOK_SLOW_OUT: out }), work);
  assert.ok(await waitFor(out), 'session-end ran although the single slot was busy');
});

test('session-end dedup distinguishes lifecycle events within one session (#4206)', async () => {
  const work = tmp('rf-lifecycle-');
  const base = {
    CLAUDE_PROJECT_DIR: work,
    RUFLO_HOOK_DEDUP_DIR: path.join(work, 'dedup'),
    RUFLO_HOOK_TMP_DIR: work,
    HOOK_SLOW_MS: '50',
  };
  const stopOut = path.join(work, 'stop.json');
  const compactOut = path.join(work, 'compact.json');
  const stop = { session_id: 'same-session', hook_event_name: 'Stop' };
  const compact = { session_id: 'same-session', hook_event_name: 'PreCompact' };
  runShim('session-end', stop, dedupFreeEnv({ ...base, RUFLO_DISABLE_HOOK_DEDUP: '', HOOK_SLOW_OUT: stopOut }), work);
  assert.ok(await waitFor(stopOut), 'Stop session-end ran');
  runShim('session-end', compact, dedupFreeEnv({ ...base, RUFLO_DISABLE_HOOK_DEDUP: '', HOOK_SLOW_OUT: compactOut }), work);
  assert.ok(await waitFor(compactOut), 'PreCompact session-end was not suppressed by Stop');
});
