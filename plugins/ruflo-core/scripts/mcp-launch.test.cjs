'use strict';
/**
 * Unit tests for mcp-launch.cjs's local-vs-npx resolution logic.
 *
 * Mirrors tests/hook-handler-runwithtimeout.test.cjs's convention: uses
 * node:test (built-in) so it runs without installing dependencies.
 * resolveLocalCliBin() takes (cwd, home) explicitly rather than reading
 * process.cwd()/os.homedir() itself, so these tests can point it at
 * disposable tmp-dir fixtures instead of mutating real process state.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { resolveLocalCliBin, buildLaunchSpec, runInProcess, MCP_ARGS } = require(
  path.join(__dirname, 'mcp-launch.cjs')
);
const NO_GLOBAL_PATH = { PATH: '' };

function makeCliInstall(root, { withDist } = { withDist: true }) {
  const binDir = path.join(root, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, 'cli.js'), '// fixture\n');
  if (withDist) {
    const distDir = path.join(root, 'dist', 'src');
    fs.mkdirSync(distDir, { recursive: true });
    fs.writeFileSync(path.join(distDir, 'index.js'), '// fixture\n');
  }
  return path.join(binDir, 'cli.js');
}

test('picks the node_modules/@claude-flow/cli candidate when it has a built dist/', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-launch-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-launch-home-'));
  try {
    const expected = makeCliInstall(path.join(cwd, 'node_modules', '@claude-flow', 'cli'));
    const resolved = resolveLocalCliBin(cwd, home, NO_GLOBAL_PATH);
    assert.equal(resolved, expected);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('skips a source-only checkout (bin/cli.js with no dist/) and falls through', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-launch-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-launch-home-'));
  try {
    // marketplace candidate: bin/cli.js present, dist/ missing — must be skipped
    makeCliInstall(
      path.join(home, '.claude', 'plugins', 'marketplaces', 'ruflo'),
      { withDist: false }
    );
    const expected = makeCliInstall(path.join(cwd, 'node_modules', 'ruflo'));
    const resolved = resolveLocalCliBin(cwd, home, NO_GLOBAL_PATH);
    assert.equal(resolved, expected);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('resolves the v3/@claude-flow/cli in-repo candidate last', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-launch-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-launch-home-'));
  try {
    const expected = makeCliInstall(path.join(cwd, 'v3', '@claude-flow', 'cli'));
    const resolved = resolveLocalCliBin(cwd, home, NO_GLOBAL_PATH);
    assert.equal(resolved, expected);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('returns null when no candidate resolves', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-launch-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-launch-home-'));
  try {
    assert.equal(resolveLocalCliBin(cwd, home, NO_GLOBAL_PATH), null);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('finds an installed CLI in an ancestor node_modules from a nested cwd', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-launch-root-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-launch-home-'));
  try {
    const cwd = path.join(root, 'packages', 'app', 'src');
    fs.mkdirSync(cwd, { recursive: true });
    const expected = makeCliInstall(path.join(root, 'node_modules', '@claude-flow', 'cli'));
    assert.equal(resolveLocalCliBin(cwd, home, NO_GLOBAL_PATH), expected);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('finds a built globally installed ruflo dependency from PATH', () => {
  const prefix = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-launch-prefix-'));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-launch-cwd-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-launch-home-'));
  try {
    const binDir = process.platform === 'win32' ? prefix : path.join(prefix, 'bin');
    const modulesDir = process.platform === 'win32'
      ? path.join(prefix, 'node_modules')
      : path.join(prefix, 'lib', 'node_modules');
    fs.mkdirSync(binDir, { recursive: true });
    const expected = makeCliInstall(path.join(modulesDir, 'ruflo', 'node_modules', '@claude-flow', 'cli'));
    assert.equal(resolveLocalCliBin(cwd, home, { PATH: binDir }), expected);
  } finally {
    fs.rmSync(prefix, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('an explicit CLI override is preferred and an invalid override cannot fall back to @latest', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-launch-cwd-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-launch-home-'));
  try {
    const override = makeCliInstall(path.join(cwd, 'pinned-cli'));
    const other = makeCliInstall(path.join(cwd, 'node_modules', '@claude-flow', 'cli'));
    assert.notEqual(override, other);
    assert.equal(resolveLocalCliBin(cwd, home, {
      PATH: '', RUFLO_MCP_CLI_OVERRIDE: override,
    }), override);
    assert.throws(() => resolveLocalCliBin(cwd, home, {
      PATH: '', RUFLO_MCP_CLI_OVERRIDE: path.join(cwd, 'missing-cli.js'),
    }), /RUFLO_MCP_CLI_OVERRIDE/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('buildLaunchSpec uses process.execPath + the resolved bin plus "mcp start" when a local candidate resolves', () => {
  const spec = buildLaunchSpec('/fake/path/to/bin/cli.js');
  assert.equal(spec.command, process.execPath);
  assert.deepEqual(spec.args, ['/fake/path/to/bin/cli.js', ...MCP_ARGS]);
  assert.equal(spec.shell, false);
});

test('buildLaunchSpec falls back to npx -y @claude-flow/cli@latest mcp start when nothing resolves', () => {
  const spec = buildLaunchSpec(null, {});
  const expectedCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  assert.equal(spec.command, expectedCmd);
  assert.deepEqual(spec.args, ['-y', '@claude-flow/cli@latest', ...MCP_ARGS]);
  // Windows .cmd shims need shell:true to spawn at all; other platforms
  // spawn npx directly with no shell involved.
  assert.equal(spec.shell, process.platform === 'win32');
});

test('RUFLO_MCP_SKIP_NPX=1 refuses an unpinned fallback', () => {
  assert.throws(
    () => buildLaunchSpec(null, { RUFLO_MCP_SKIP_NPX: '1' }),
    /RUFLO_MCP_SKIP_NPX=1 forbids/,
  );
});

// ---------------------------------------------------------------------------
// Project-directory resolution (split-brain fix).
//
// Claude Code starts one MCP server per session. Before this fix the launcher
// spawned `mcp start` with its own process.cwd() and never consulted the
// session's project directory, so MCP state (.claude-flow/hive-mind,
// memory, swarm) could land in a different folder than the CLI's.
// ---------------------------------------------------------------------------
const { execFileSync } = require('child_process');
const LAUNCHER = path.join(__dirname, 'mcp-launch.cjs');

function samePath(a, b) {
  const norm = (p) => {
    const r = fs.realpathSync.native(p);
    return process.platform === 'win32' ? r.toLowerCase() : r;
  };
  return norm(a) === norm(b);
}

function makeEchoCli(root) {
  // A "built" CLI fixture that reports where it was started.
  const bin = makeCliInstall(root);
  fs.writeFileSync(
    bin,
    'process.stdout.write(JSON.stringify({ cwd: process.cwd(), flowCwd: process.env.CLAUDE_FLOW_CWD || null, args: process.argv.slice(2) }));\n',
  );
  return bin;
}

test('end-to-end: the MCP server is started in CLAUDE_PROJECT_DIR, not the launcher cwd', () => {
  const sessionCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-launch-session-'));
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-launch-project-'));
  const cliRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-launch-cli-'));
  try {
    const bin = makeEchoCli(cliRoot);
    const env = { ...process.env, RUFLO_MCP_CLI_OVERRIDE: bin, CLAUDE_PROJECT_DIR: project };
    delete env.CLAUDE_FLOW_CWD;
    const out = JSON.parse(execFileSync(process.execPath, [LAUNCHER], { cwd: sessionCwd, env, encoding: 'utf8' }));
    assert.deepEqual(out.args, MCP_ARGS);
    assert.ok(samePath(out.cwd, project), `server cwd ${out.cwd} should be project ${project}`);
    assert.ok(out.flowCwd && samePath(out.flowCwd, project), `CLAUDE_FLOW_CWD ${out.flowCwd} should be project ${project}`);
  } finally {
    for (const d of [sessionCwd, project, cliRoot]) fs.rmSync(d, { recursive: true, force: true });
  }
});

test('end-to-end: without CLAUDE_PROJECT_DIR the launcher cwd is kept (backwards compatible)', () => {
  const sessionCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-launch-session-'));
  const cliRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-launch-cli-'));
  try {
    const bin = makeEchoCli(cliRoot);
    const env = { ...process.env, RUFLO_MCP_CLI_OVERRIDE: bin };
    delete env.CLAUDE_PROJECT_DIR;
    delete env.CLAUDE_FLOW_CWD;
    const out = JSON.parse(execFileSync(process.execPath, [LAUNCHER], { cwd: sessionCwd, env, encoding: 'utf8' }));
    assert.ok(samePath(out.cwd, sessionCwd));
  } finally {
    for (const d of [sessionCwd, cliRoot]) fs.rmSync(d, { recursive: true, force: true });
  }
});

test('resolveProjectDir: CLAUDE_PROJECT_DIR > CLAUDE_FLOW_CWD > cwd; home, root and missing dirs are not projects', () => {
  const { resolveProjectDir } = require(LAUNCHER);
  assert.equal(typeof resolveProjectDir, 'function');
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-launch-cwd-'));
  const a = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-launch-a-'));
  const b = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-launch-b-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-launch-home-'));
  try {
    assert.equal(resolveProjectDir({ CLAUDE_PROJECT_DIR: a, CLAUDE_FLOW_CWD: b }, cwd, home), path.resolve(a));
    assert.equal(resolveProjectDir({ CLAUDE_FLOW_CWD: b }, cwd, home), path.resolve(b));
    assert.equal(resolveProjectDir({}, cwd, home), path.resolve(cwd));
    // A project dir equal to the home directory is "no project" (Windows: HOME
    // is usually unset, so this must work off the supplied home/USERPROFILE).
    assert.equal(resolveProjectDir({ CLAUDE_PROJECT_DIR: home, CLAUDE_FLOW_CWD: b }, cwd, home), path.resolve(b));
    const homeVariant = process.platform === 'win32' ? home.toUpperCase() + path.sep : home + path.sep;
    assert.equal(resolveProjectDir({ CLAUDE_PROJECT_DIR: homeVariant }, cwd, home), path.resolve(cwd));
    assert.equal(resolveProjectDir({ CLAUDE_PROJECT_DIR: path.parse(cwd).root }, cwd, home), path.resolve(cwd));
    assert.equal(resolveProjectDir({ CLAUDE_PROJECT_DIR: path.join(a, 'does-not-exist') }, cwd, home), path.resolve(cwd));
  } finally {
    for (const d of [cwd, a, b, home]) fs.rmSync(d, { recursive: true, force: true });
  }
});

test('runInProcess loads the resolved bin in-process with the argv the child used to get', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-launch-inproc-'));
  const bin = path.join(dir, 'cli.js');
  fs.writeFileSync(bin, 'globalThis.__mcpLaunchArgv = process.argv.slice();\n');
  const savedArgv = process.argv;
  try {
    await runInProcess(bin);
    assert.deepEqual(globalThis.__mcpLaunchArgv, [process.execPath, bin, ...MCP_ARGS]);
  } finally {
    process.argv = savedArgv;
    delete globalThis.__mcpLaunchArgv;
  }
});

test('runInProcess runs the CLI in the project dir with CLAUDE_FLOW_CWD set before import', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-launch-inproc-proj-'));
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-launch-project-'));
  const bin = path.join(dir, 'cli.js');
  fs.writeFileSync(
    bin,
    'globalThis.__mcpLaunchSeen = { cwd: process.cwd(), flowCwd: process.env.CLAUDE_FLOW_CWD };\n',
  );
  const savedArgv = process.argv;
  const savedCwd = process.cwd();
  const hadFlowCwd = Object.prototype.hasOwnProperty.call(process.env, 'CLAUDE_FLOW_CWD');
  const savedFlowCwd = process.env.CLAUDE_FLOW_CWD;
  try {
    await runInProcess(bin, project);
    assert.ok(samePath(globalThis.__mcpLaunchSeen.cwd, project), `cwd ${globalThis.__mcpLaunchSeen.cwd} should be ${project}`);
    assert.equal(globalThis.__mcpLaunchSeen.flowCwd, project);
  } finally {
    process.chdir(savedCwd);
    process.argv = savedArgv;
    if (hadFlowCwd) process.env.CLAUDE_FLOW_CWD = savedFlowCwd;
    else delete process.env.CLAUDE_FLOW_CWD;
    delete globalThis.__mcpLaunchSeen;
    for (const d of [dir, project]) fs.rmSync(d, { recursive: true, force: true });
  }
});
