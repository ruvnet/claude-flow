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

const { resolveLocalCliBin, buildLaunchSpec, MCP_ARGS } = require(
  path.join(__dirname, 'mcp-launch.cjs')
);

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
    const resolved = resolveLocalCliBin(cwd, home);
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
    const resolved = resolveLocalCliBin(cwd, home);
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
    const resolved = resolveLocalCliBin(cwd, home);
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
    assert.equal(resolveLocalCliBin(cwd, home), null);
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
  const spec = buildLaunchSpec(null);
  const expectedCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  assert.equal(spec.command, expectedCmd);
  assert.deepEqual(spec.args, ['-y', '@claude-flow/cli@latest', ...MCP_ARGS]);
  // Windows .cmd shims need shell:true to spawn at all; other platforms
  // spawn npx directly with no shell involved.
  assert.equal(spec.shell, process.platform === 'win32');
});
