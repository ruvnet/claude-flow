'use strict';
/**
 * Unit tests for ruflo-hook.cjs's escapeCmdArg() — the Windows cmd.exe
 * argument escaper added for the shell:true argv-injection risk in
 * invokeHook() (hook-derived values reach cmd.exe unescaped on win32).
 *
 * These assert the STRING TRANSFORM only — there is no Windows/cmd.exe
 * available in this environment to execute the escaped output end-to-end.
 * The properties checked below are the ones the algorithm
 * (https://qntm.org/cmd, matching `cross-spawn`'s Windows escaping) exists
 * to guarantee: every cmd.exe metacharacter is neutralized, and the
 * CommandLineToArgvW quote/backslash rules are respected so the value
 * round-trips as ONE literal argument. Real native-Windows execution
 * remains a required follow-up gate before calling this closed.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
// See ruflo-hook.cjs's own comment on this flag: requiring the file always
// runs main() otherwise (hooks.json has no require.main === module boundary
// to gate on), which would process.exit(0) before this test file's
// assertions ever ran.
process.env.RUFLO_HOOK_UNIT_TEST = '1';
const { escapeCmdArg } = require('./ruflo-hook.cjs');

const CMD_METACHARS = ['(', ')', '%', '!', '^', '"', '<', '>', '&', '|', ';', ','];

test('escapeCmdArg: every cmd.exe metacharacter is caret-escaped', () => {
  for (const ch of CMD_METACHARS) {
    const out = escapeCmdArg(`a${ch}b`);
    assert.ok(out.includes(`^${ch}`), `expected ^${ch} in ${JSON.stringify(out)} for input a${ch}b`);
  }
});

test('escapeCmdArg: a plain value round-trips as one quoted argument', () => {
  assert.equal(escapeCmdArg('hello'), '^"hello^"');
  assert.equal(escapeCmdArg('echo hi'), '^"echo hi^"');
});

test('escapeCmdArg: command chaining metacharacters are neutralized, not left live', () => {
  // The exact #667 threat model: a hook-derived value like `x & calc.exe` or
  // `a | b` must not contain a bare, unescaped &/| after escaping.
  for (const payload of ['a & calc.exe', 'a | b', 'a && b', 'a; rm -rf /', 'a > out.txt', 'a < in.txt']) {
    const out = escapeCmdArg(payload);
    assert.ok(!/(?<!\^)[&|;<>]/.test(out), `unescaped metachar survived in ${JSON.stringify(out)}`);
  }
});

test('escapeCmdArg: embedded double quotes do not break out of the argument', () => {
  const out = escapeCmdArg('a"b');
  // Every quote in the output — including the wrapping ones, which the
  // metachar pass caret-escapes too so they survive a .cmd shim's second
  // cmd.exe parse — must be caret-escaped. No bare, unescaped `"` anywhere.
  assert.ok(!/(?<!\^)"/.test(out), `bare quote survived in ${JSON.stringify(out)}`);
});

test('escapeCmdArg: percent (env-var expansion) and delayed-expansion bang are neutralized', () => {
  assert.ok(escapeCmdArg('%PATH%').includes('^%'));
  assert.ok(escapeCmdArg('!VAR!').includes('^!'));
});

test('escapeCmdArg: a trailing backslash does not consume the closing quote', () => {
  const out = escapeCmdArg('C:\\some\\path\\');
  // Must end with an escaped-quote sequence, not a bare trailing backslash
  // eating the terminating quote (the classic CommandLineToArgvW footgun).
  assert.ok(out.endsWith('\\\\^"') || out.endsWith('^"'), `unexpected ending in ${JSON.stringify(out)}`);
});

test('escapeCmdArg: empty string still produces a valid quoted-empty argument', () => {
  assert.equal(escapeCmdArg(''), '^"^"');
});

test('escapeCmdArg: non-string input is coerced safely', () => {
  assert.equal(escapeCmdArg(42), '^"42^"');
});
