// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildPrepare, buildPromptChunks, buildLaunch, buildPoll, buildStop, buildProbe,
  parsePoll, parseLaunch, MAX_COMMAND_BYTES, buildRepoSummary, parseRepoSummary,
} from '../scripts/lib/command-builder.mjs';
import { RuosError } from '../scripts/lib/types.mjs';

const RUN = 'r-test-abc123';
const N = '0123456789abcdef';
const HOSTILE = [
  '$(touch /tmp/ruflo-ruos-pwned)',
  '`touch /tmp/ruflo-ruos-pwned`',
  "'; touch /tmp/ruflo-ruos-pwned; echo '",
  '"; touch /tmp/ruflo-ruos-pwned; echo "',
  'a\ntouch /tmp/ruflo-ruos-pwned',
  'a\r\ntouch /tmp/ruflo-ruos-pwned',
  '${IFS}touch${IFS}/tmp/ruflo-ruos-pwned',
  '| touch /tmp/ruflo-ruos-pwned &',
  "'\\'' ; touch /tmp/ruflo-ruos-pwned ; sh -c '", // sh -c '...' quote-break attempt
  'ünïcödé ✓ 🚀 ‮⁦ rtl',
  '\\x27 \\" %s %n',
];

/** Every variable region must be a validated id, an int, an enum, or base64. */
function assertOnlyExpectedRegions(/** @type {string} */ cmd) {
  assert.ok(!/[\n\r\0]/.test(cmd), 'single line');
  assert.ok(Buffer.byteLength(cmd) <= MAX_COMMAND_BYTES, 'size');
  assert.ok(!cmd.includes('ruflo-ruos-pwned'), 'task text must never appear verbatim');
  // Strip the single-quoted payloads; what remains is fixed template text.
  const outsideQuotes = cmd.replace(/'[^']*'/g, "''");
  assert.ok(!/[`]/.test(outsideQuotes), 'no backticks outside quotes');
}

test('prompt chunks carry only base64 inside single quotes', () => {
  for (const p of HOSTILE) {
    const { commands } = buildPromptChunks(RUN, p);
    for (const c of commands) {
      assertOnlyExpectedRegions(c);
      const m = /^printf '%s' '([^']*)' >> "\$HOME\/\.ruflo-ruos\/runs\/r-test-abc123"\/prompt\.b64$/.exec(c);
      assert.ok(m, `chunk shape: ${c.slice(0, 80)}`);
      assert.match(m[1], /^[A-Za-z0-9+/=]+$/);
    }
  }
});

test('chunking respects the 4000-byte limit at the boundaries', () => {
  const head = `printf '%s' '`.length + `' >> "$HOME/.ruflo-ruos/runs/${RUN}"/prompt.b64`.length;
  const room = MAX_COMMAND_BYTES - head;
  const step = room - (room % 4);
  const bytesForB64 = (/** @type {number} */ n) => (n / 4) * 3;
  for (const b64len of [step - 4, step, step + 4, 3 * step]) {
    const p = 'x'.repeat(bytesForB64(b64len));
    const { commands } = buildPromptChunks(RUN, p);
    for (const c of commands) assert.ok(Buffer.byteLength(c) <= MAX_COMMAND_BYTES);
    assert.equal(commands.length, Math.ceil(b64len / step));
    const joined = commands.map((c) => /'([A-Za-z0-9+/=]+)'/.exec(c)?.[1]).join('');
    assert.equal(Buffer.from(joined, 'base64').toString(), p);
  }
});

test('hostile run ids, models, budgets and offsets are refused', () => {
  for (const bad of ['../etc', 'r-x"; id', 'R-UPPER1', 'a', 'r-$(id)xx', 'r-ok\nnew', '']) {
    assert.throws(() => buildPrepare(bad, N), RuosError);
    assert.throws(() => buildPoll(bad, 0, N), RuosError);
    assert.throws(() => buildStop(bad, N), RuosError);
  }
  const base = { runId: RUN, prompt: 'x', runner: /** @type {'claude'} */ ('claude') };
  assert.throws(() => buildLaunch({ ...base, model: /** @type {any} */ ('opus; id') }), RuosError);
  assert.throws(() => buildLaunch({ ...base, maxBudgetUsd: /** @type {any} */ ('1e9') }), RuosError);
  assert.throws(() => buildLaunch({ ...base, maxBudgetUsd: -1 }, N), RuosError);
  assert.throws(() => buildLaunch({ ...base, runner: /** @type {any} */ ('bash') }), RuosError);
  assert.throws(() => buildPoll(RUN, -1, N), RuosError);
  assert.throws(() => buildPoll(RUN, /** @type {any} */ ('1;id'), N), RuosError);
  assert.throws(() => buildPromptChunks(RUN, 'a\0b'), RuosError);
  assert.throws(() => buildPromptChunks(RUN, '   '), RuosError);
  assert.throws(() => buildPromptChunks(RUN, 'x'.repeat(64 * 1024 + 1)), RuosError);
});

test('launch/poll/stop/probe are single fixed-template lines', () => {
  const cmds = [
    buildPrepare(RUN, N),
    buildLaunch({ runId: RUN, prompt: HOSTILE[0], runner: 'claude', model: 'haiku', maxBudgetUsd: 0.5 }, N),
    buildPoll(RUN, 12345, N),
    buildStop(RUN, N),
    buildProbe(N),
  ];
  for (const c of cmds) assertOnlyExpectedRegions(c);
  assert.match(cmds[1], /--model haiku --max-budget-usd 0\.50/);
  // Echo-proof: the output token RUOS<nonce>_ never appears in any command.
  for (const c of [...cmds, buildRepoSummary('projects/app', N)]) assert.ok(!c.includes(`RUOS${N}_`), c.slice(0, 60));
  for (const bad of ['', 'ABCDEF0123456789', '0123', "0123456789abcde'", '0123456789abcdef0']) {
    assert.throws(() => buildPoll(RUN, 0, bad), RuosError, `nonce ${bad}`);
  }
  assert.ok(!cmds.join(' ').includes('17870'), 'never targets the executor port');
});

test('parsePoll / parseLaunch', () => {
  assert.equal(parsePoll(`RUOS${N}_NORUN\n`, N), 'norun');
  const p = parsePoll(`RUOS${N}_POLL:0:5:0:${Buffer.from('hello').toString('base64')}\n`, N);
  assert.deepEqual([p !== 'norun' && p.exitCode, p !== 'norun' && p.size, p !== 'norun' && p.chunk.toString()], [0, 5, 'hello']);
  const r = parsePoll(`RUOS${N}_POLL:-:0:1:\n`, N);
  assert.equal(r !== 'norun' && r.exitCode, null);
  assert.throws(() => parsePoll('garbage', N), RuosError);
  const l = parseLaunch(`RUOS${N}_SHA:${'a'.repeat(64)}\nRUOS${N}_PID:42\n`, N);
  assert.deepEqual(l, { sha256: 'a'.repeat(64), pid: 42, noRunner: false });
  assert.equal(parseLaunch(`RUOS${N}_NO_RUNNER`, N).noRunner, true);
});

// Real-shell execution of the builder output against a fake `claude`, so the
// quoting is proven by /bin/sh itself, not only by pattern assertions.
const hasShell = (() => { try { execSync('command -v base64 setsid nohup sha256sum', { shell: '/bin/sh' }); return true; } catch { return false; } })();

test('real /bin/sh: hostile prompt round-trips inert; run completes and stops', { skip: !hasShell }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'ruflo-ruos-'));
  const home = join(root, 'home');
  const bin = join(root, 'bin');
  execFileSync('mkdir', ['-p', home, bin]);
  writeFileSync(join(bin, 'claude'), '#!/bin/sh\necho "ARGS:$*"; cat; sleep "${FAKE_SLEEP:-0}"; echo done\n');
  chmodSync(join(bin, 'claude'), 0o755);
  const env = { HOME: home, PATH: `${bin}:/usr/bin:/bin`, FAKE_SLEEP: '0' };
  const sh = (/** @type {string} */ c, /** @type {Record<string,string>} */ e = env) => execSync(c, { shell: '/bin/sh', env: e, encoding: 'utf8' });
  const prompt = HOSTILE.join('\n');
  const marker = '/tmp/ruflo-ruos-pwned';
  const before = existsSync(marker);

  sh(buildPrepare(RUN, N));
  const chunks = buildPromptChunks(RUN, prompt);
  for (const c of chunks.commands) sh(c);
  const launched = parseLaunch(sh(buildLaunch({ runId: RUN, prompt, runner: 'claude', model: 'sonnet' }, N)), N);
  assert.equal(launched.sha256, chunks.sha256);
  assert.ok(launched.pid);
  let p;
  for (let i = 0; i < 50; i++) {
    p = parsePoll(sh(buildPoll(RUN, 0, N)), N);
    if (p !== 'norun' && p.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.ok(p && p !== 'norun');
  assert.equal(p.exitCode, 0);
  assert.equal(p.chunk.toString(), `ARGS:-p --output-format text --model sonnet\n${prompt}done\n`);
  assert.equal(existsSync(marker), before, 'payload must not execute');
  assert.equal(statSync(join(home, '.ruflo-ruos/runs', RUN, 'out.log')).mode & 0o077, 0, 'run files are private');

  // A long-running run is stopped via its process group.
  const run2 = 'r-test-stop01';
  const env2 = { ...env, FAKE_SLEEP: '30' };
  sh(buildPrepare(run2, N), env2);
  for (const c of buildPromptChunks(run2, 'x').commands) sh(c, env2);
  sh(buildLaunch({ runId: run2, prompt: 'x', runner: 'claude' }, N), env2);
  await new Promise((r) => setTimeout(r, 200));
  assert.match(sh(buildStop(run2, N), env2), new RegExp(`^RUOS${N}_STOPPED$`, 'm'));
});

test('deploy hand-off probe is read-only and path-validated', () => {
  const c = buildRepoSummary('projects/app', N);
  assertOnlyExpectedRegions(c);
  for (const verb of ['push', 'deploy', 'commit', 'reset', 'checkout']) assert.ok(!new RegExp(`git ${verb}`).test(c), verb);
  for (const bad of ['../etc', 'a/../../b', '/abs', '$(id)', 'a b', "a'b", '-rf', '']) assert.throws(() => buildRepoSummary(bad, N), RuosError, bad);
  assert.deepEqual(parseRepoSummary(`RUOS${N}_NOREPO`, N), { found: false });
  assert.deepEqual(parseRepoSummary(`RUOS${N}_BRANCH:main\nRUOS${N}_HEAD:abc\nRUOS${N}_DIRTY:2\nRUOS${N}_AHEAD:1\n`, N), { found: true, branch: 'main', head: 'abc', dirty: 2, ahead: '1' });
});
