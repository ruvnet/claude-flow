import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'codex-mod-hooks-')));
const cwd = path.join(temporary, 'project'); fs.mkdirSync(cwd);
after(() => fs.rmSync(temporary, { recursive: true, force: true }));
const token = `ghp_${'a1B2'.repeat(10)}`;
const fixtures = {
  adr: { tool: 'memory_store', input: { namespace: 'adr-patterns', key: 'ADR-007', value: token }, benign: { namespace: 'notes', value: token } },
  ddd: { tool: 'agentdb_hierarchical-store', input: { key: 'ddd-order', value: token }, benign: { key: 'personal-note', value: token } },
  sparc: { tool: 'agentdb_pattern-store', input: { namespace: 'sparc-specification', value: token }, benign: { namespace: 'notes', value: token } },
};
function run(name, mode, input, extra = {}) {
  const data = path.join(temporary, name); fs.mkdirSync(data, { recursive: true });
  return spawnSync(process.execPath, [path.join(root, `plugins/ruflo-${name}/hooks/codex-hook.cjs`), mode], {
    cwd, encoding: 'utf8', timeout: 5000,
    input: typeof input === 'string' ? input : JSON.stringify({ cwd, session_id: `native-${name}`, hook_event_name: mode, ...input }),
    env: { ...process.env, PLUGIN_DATA: data, ...extra },
  });
}
const event = (fixture, input = fixture.input) => ({ tool_name: `mcp__ruflo__${fixture.tool}`, tool_input: input });
for (const [name, fixture] of Object.entries(fixtures)) {
  test(`${name}: host-specific manifest replaces Claude modules with real synchronous guard/status hooks`, () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, `plugins/ruflo-${name}/.codex-plugin/plugin.json`)));
    const original = JSON.parse(fs.readFileSync(path.join(root, `plugins/ruflo-${name}/.claude-plugin/plugin.json`)));
    assert.equal(manifest.name, original.name); assert.equal(manifest.version, original.version);
    assert.equal(manifest.hooks, './hooks/codex-hooks.json');
    const hooks = JSON.parse(fs.readFileSync(path.join(root, `plugins/ruflo-${name}/hooks/codex-hooks.json`)));
    assert.deepEqual(Object.keys(hooks.hooks).sort(), ['PreToolUse', 'SessionStart']);
    assert.ok(hooks.hooks.PreToolUse[0].hooks[0].command.includes('${PLUGIN_ROOT}/hooks/codex-hook.cjs'));
    assert.equal(hooks.hooks.PreToolUse[0].hooks[0].type, 'command');
    assert.equal(hooks.hooks.PreToolUse[0].hooks[0].async, undefined);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, `plugins/ruflo-${name}/hooks/hooks.json`))).modules, ['./register.ts']);
  });
  test(`${name}: native envelope blocks owned secret write with exact supported deny output and no echoed secret`, () => {
    const out = run(name, 'PreToolUse', event(fixture)); assert.equal(out.status, 0, out.stderr);
    const parsed = JSON.parse(out.stdout);
    assert.deepEqual(Object.keys(parsed), ['hookSpecificOutput']);
    assert.deepEqual(Object.keys(parsed.hookSpecificOutput).sort(), ['hookEventName', 'permissionDecision', 'permissionDecisionReason']);
    assert.equal(parsed.hookSpecificOutput.hookEventName, 'PreToolUse'); assert.equal(parsed.hookSpecificOutput.permissionDecision, 'deny');
    assert.equal(typeof parsed.hookSpecificOutput.permissionDecisionReason, 'string'); assert.ok(parsed.hookSpecificOutput.permissionDecisionReason.includes('secret'));
    assert.ok(!`${out.stdout}${out.stderr}`.includes(token));
  });
  test(`${name}: clean/placeholder and unrelated writes allow silently`, () => {
    for (const input of [fixture.benign, { ...fixture.input, value: 'process.env.EXAMPLE_KEY' }]) {
      const out = run(name, 'PreToolUse', event(fixture, input)); assert.equal(out.status, 0, out.stderr); assert.equal(out.stdout, '');
    }
    const wrongTool = run(name, 'PreToolUse', { tool_name: 'mcp__ruflo__memory_search', tool_input: fixture.input });
    assert.equal(wrongTool.status, 0); assert.equal(wrongTool.stdout, '');
  });
  test(`${name}: native arbitrary-JSON inputs pass for unrelated tools, malformed memory writers fail closed`, () => {
    for (const input of ['*** Begin Patch\n*** End Patch', ['raw', 'arguments'], 7, true, null]) {
      for (const tool of ['apply_patch', 'mcp__other__unrelated_tool']) {
        const out = run(name, 'PreToolUse', { tool_name: tool, tool_input: input });
        assert.equal(out.status, 0, out.stderr); assert.equal(out.stdout, '');
      }
      const guarded = run(name, 'PreToolUse', { tool_name: `mcp__ruflo__${fixture.tool}`, tool_input: input });
      assert.equal(guarded.status, 2); assert.equal(guarded.stdout, '');
      assert.equal(guarded.stderr, `ruflo-${name}: native hook input or adapter failed\n`);
    }
    const missing = run(name, 'PreToolUse', { tool_name: 'apply_patch' }); assert.equal(missing.status, 2);
    const secret = run(name, 'PreToolUse', event(fixture));
    assert.equal(JSON.parse(secret.stdout).hookSpecificOutput.permissionDecision, 'deny');
  });
  test(`${name}: session counters persist across processes, initialize courtesy view, never retain tool input`, () => {
    const started = run(name, 'SessionStart', {}); assert.equal(started.status, 0); assert.equal(started.stdout, '');
    const denied = run(name, 'PreToolUse', event(fixture)); assert.equal(denied.status, 0);
    const file = path.join(cwd, `.claude-flow/${name}-mod/status.json`);
    const status = JSON.parse(fs.readFileSync(file, 'utf8')); assert.equal(status.version, 1); assert.equal(status.host, 'codex'); assert.equal(status.guard, true);
    assert.ok(status.blocked >= 1); assert.ok(!fs.readFileSync(file, 'utf8').includes(token));
    if (name === 'adr') { assert.ok(status.calls >= status.blocked); assert.ok(status.startedMs > 0); }
    if (name === 'sparc') { assert.ok(status.checked >= status.blocked); assert.ok(status.seen['sparc artifact write'] >= 1); }
  });
  test(`${name}: malformed/oversized input fails closed without echoed data`, () => {
    for (const input of ['bad JSON', '{"tool_name":"missing envelope"}', ' '.repeat(8 * 1024 * 1024 + 1)]) {
      const out = run(name, 'PreToolUse', input); assert.equal(out.status, 2); assert.equal(out.stdout, '');
      assert.equal(out.stderr, `ruflo-${name}: native hook input or adapter failed\n`);
    }
  });
  test(`${name}: courtesy failure never converts secret denial to an allowed call`, () => {
    const blockedData = path.join(temporary, `${name}-blocked-data`); fs.writeFileSync(blockedData, 'not a directory');
    const out = run(name, 'PreToolUse', event(fixture), { PLUGIN_DATA: blockedData });
    assert.equal(out.status, 0); assert.equal(JSON.parse(out.stdout).hookSpecificOutput.permissionDecision, 'deny');
    assert.ok(!out.stderr.includes(token));
  });
  test(`${name}: bundled adapter runs standalone without source imports or SDK installation`, () => {
    const isolated = path.join(temporary, `${name}-standalone.cjs`);
    fs.copyFileSync(path.join(root, `plugins/ruflo-${name}/hooks/codex-hook.cjs`), isolated);
    const out = spawnSync(process.execPath, [isolated, '--command', 'scan', token], { encoding: 'utf8', cwd, timeout: 5000 });
    assert.equal(out.status, 0, out.stderr); assert.ok(out.stdout.includes('refuse')); assert.ok(!out.stdout.includes(token));
  });
}
test('ADR causal-edge and DDD parent/child forms remain guarded; SPARC scope is namespace-only', () => {
  const adr = run('adr', 'PreToolUse', { tool_name: 'mcp__any__agentdb_causal-edge', tool_input: { sourceId: 'mem:ADR-008', metadata: { token } } });
  assert.equal(JSON.parse(adr.stdout).hookSpecificOutput.permissionDecision, 'deny');
  const ddd = run('ddd', 'PreToolUse', { tool_name: 'mcp__any__memory_store', tool_input: { parent: 'context:payments', value: token } });
  assert.equal(JSON.parse(ddd.stdout).hookSpecificOutput.permissionDecision, 'deny');
  const sparc = run('sparc', 'PreToolUse', { tool_name: 'mcp__any__memory_store', tool_input: { key: 'sparc-spec', value: token } }); assert.equal(sparc.stdout, '');
});
test('generated bundles match exact existing guard/screen/status source inputs', { skip: !process.env.ESBUILD }, () => {
  execFileSync(process.execPath, [path.join(root, 'scripts/build-codex-mod-hooks.mjs'), '--check'], { env: process.env });
});

// Opt-in real loader acceptance; private home only, no auth and no model turn.
test('native Codex loads six candidate hooks without module warnings (no inference)', { skip: !process.env.CODEX_NATIVE_LOADER, timeout: 30000 }, async () => {
  const binary = process.env.CODEX_NATIVE_LOADER;
  const home = path.join(temporary, 'native-home'); fs.mkdirSync(home, { mode: 0o700 });
  const env = { ...process.env, CODEX_HOME: home };
  execFileSync(binary, ['plugin', 'marketplace', 'add', root, '--json'], { env, timeout: 10000 });
  for (const name of Object.keys(fixtures)) execFileSync(binary, ['plugin', 'add', `ruflo-${name}@ruflo`, '--json'], { env, timeout: 10000 });
  const child = spawn(binary, ['app-server', '--listen', 'stdio://'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let buffer = ''; let sequence = 0; const pending = new Map();
  child.stderr.resume();
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf8'); let at;
    while ((at = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, at); buffer = buffer.slice(at + 1);
      const message = JSON.parse(line);
      if (pending.has(message.id)) { pending.get(message.id).resolve(message); pending.delete(message.id); }
    }
  });
  const call = (method, params) => new Promise((resolve, reject) => {
    const id = ++sequence; pending.set(id, { resolve, reject }); child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
  });
  const timer = setTimeout(() => { for (const request of pending.values()) request.reject(new Error('Native loader timed out')); child.kill('SIGKILL'); }, 20000);
  child.on('exit', () => { for (const request of pending.values()) request.reject(new Error('Native loader exited')); });
  try {
    const init = await call('initialize', { clientInfo: { name: 'ruflo_native_mod_test', version: '1' }, capabilities: { experimentalApi: true } });
    assert.ok(init.result); child.stdin.write(`${JSON.stringify({ method: 'initialized' })}\n`);
    const result = await call('hooks/list', { cwds: [root] }); const row = result.result.data[0];
    assert.deepEqual(row.warnings, []); assert.deepEqual(row.errors, []); assert.equal(row.hooks.length, 6);
    for (const hook of row.hooks) {
      assert.equal(hook.handlerType, 'command'); assert.equal(hook.async, false); assert.equal(hook.enabled, true);
      assert.ok(hook.sourcePath.startsWith(home)); assert.ok(hook.sourcePath.endsWith('/hooks/codex-hooks.json'));
    }
  } finally { clearTimeout(timer); child.kill(); }
});
