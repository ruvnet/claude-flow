#!/usr/bin/env node
// Real built-server stdio contract check. No imports or mocks of the tool registry.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const packageRoot = resolve(process.argv[2] ?? join(repository, 'v3/@claude-flow/cli'));
const entrypoint = join(packageRoot, 'bin/mcp-server.js');
const source = readFileSync(join(repository, 'v3/@claude-flow/cli/__tests__/fixtures/cuda/ptx-decompile-confirmation.ptx'));
const sourceSha256 = createHash('sha256').update(source).digest('hex');
assert.equal(sourceSha256, 'db69341fc0312e810e25b7c8ed97ca3112e4b2d057b13aaf2d7ade71201ed420');
const sandbox = mkdtempSync(join(tmpdir(), 'rure-ptx-mcp-e2e-'));
const fixture = join(sandbox, 'confirmation.ptx');
writeFileSync(fixture, source, { flag: 'wx' });
const child = spawn(process.execPath, [entrypoint], {
  cwd: sandbox,
  // Do not inherit tokens, provider settings, NODE_OPTIONS, or user MCP policy.
  env: {
    PATH: dirname(process.execPath), HOME: sandbox, TMPDIR: sandbox,
    XDG_CONFIG_HOME: sandbox, XDG_CACHE_HOME: sandbox, XDG_DATA_HOME: sandbox,
  },
  stdio: ['pipe', 'pipe', 'pipe'],
});
let closed = false, stdout = '', stderr = '', stdoutBytes = 0, failure;
const pending = new Map();
const completion = new Promise(resolveClose => child.once('close', (code, signal) => {
  closed = true;
  fail(new Error(`MCP server closed before completion (exit=${code}, signal=${signal})`));
  resolveClose({ code, signal });
}));
function fail(error) {
  failure ??= error;
  for (const request of pending.values()) { clearTimeout(request.timer); request.reject(error); }
  pending.clear();
}
child.once('error', fail);
child.stdin.on('error', fail);
child.stderr.setEncoding('utf8');
child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-8192); });
child.stdout.setEncoding('utf8');
child.stdout.on('data', chunk => {
  stdoutBytes += Buffer.byteLength(chunk);
  if (stdoutBytes > 4 * 1024 * 1024) { fail(new Error('MCP stdout exceeded the 4 MiB test budget')); child.kill('SIGTERM'); return; }
  stdout += chunk;
  let newline;
  while ((newline = stdout.indexOf('\n')) >= 0) {
    const line = stdout.slice(0, newline); stdout = stdout.slice(newline + 1);
    if (!line.trim()) continue;
    try {
      const response = JSON.parse(line);
      assert.equal(response.jsonrpc, '2.0', 'stdout must contain only JSON-RPC messages');
      if (!Object.hasOwn(response, 'id')) continue; // Protocol notifications.
      const request = pending.get(response.id);
      assert.ok(request, `Unexpected response id ${response.id}`);
      clearTimeout(request.timer); pending.delete(response.id);
      if (response.error) request.reject(new Error(`JSON-RPC error: ${JSON.stringify(response.error)}`));
      else request.resolve(response.result);
    } catch (error) { fail(error); }
  }
});
let nextId = 1;
function request(method, params = {}) {
  if (failure) return Promise.reject(failure);
  const id = nextId++;
  return new Promise((resolveRequest, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`MCP request timed out after 15000 ms: ${method}`));
    }, 15_000);
    pending.set(id, { resolve: resolveRequest, reject, timer });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}
function unwrap(result) {
  let depth = 0;
  while (result && Array.isArray(result.content)) {
    assert.ok(++depth <= 4, 'unexpected nested MCP result depth');
    assert.notEqual(result.isError, true, 'tool returned MCP isError');
    assert.equal(result.content.length, 1);
    assert.equal(result.content[0].type, 'text');
    result = JSON.parse(result.content[0].text);
  }
  assert.ok(depth > 0, 'expected MCP text result');
  return { result, depth };
}

const start = performance.now();
try {
  const initialized = await request('initialize', {
    protocolVersion: '2024-11-05', capabilities: {},
    clientInfo: { name: 'rure-ptx-contract-test', version: '1.0.0' },
  });
  assert.equal(initialized.protocolVersion, '2024-11-05');
  assert.equal(initialized.serverInfo.name, 'ruflo');
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const listing = await request('tools/list');
  const tool = listing.tools.find(t => t.name === 'rure_decompile_ptx');
  assert.ok(tool, 'built MCP registry must expose rure_decompile_ptx');
  assert.deepEqual(tool.inputSchema.required, ['path']);
  assert.deepEqual(tool.inputSchema.properties.output.enum, ['pseudocode', 'cuda']);
  const { result, depth } = unwrap(await request('tools/call', {
    name: tool.name, arguments: { path: fixture },
  }));
  assert.equal(result.success, true);
  assert.equal(result.status, 'complete');
  assert.equal(result.sourceSha256, sourceSha256);
  assert.equal(result.truncated, false);
  assert.deepEqual(result.functions.map(f => f.name), ['affine_i32', 'sum_i32']);
  assert.equal(result.presentationModified, false);
  const { result: recovery } = unwrap(await request('tools/call', {
    name: tool.name, arguments: { path: fixture, output: 'cuda' },
  }));
  assert.equal(recovery.success, true);
  assert.equal(recovery.status, 'emitted');
  assert.equal(recovery.language, 'cuda-cpp');
  assert.equal(recovery.proofStatus, 'not-proven');
  assert.equal(recovery.sourceSha256, sourceSha256);
  assert.equal(recovery.presentationModified, false);
  assert.deepEqual(recovery.functions.map(f => f.name), ['affine_i32', 'sum_i32']);
  assert.ok(recovery.code.includes('__global__'));
  assert.ok(!recovery.code.includes('asm(') && !recovery.code.includes('.version'));
  const sassTool = listing.tools.find(t => t.name === 'rure_recover_sass');
  assert.ok(sassTool, 'built MCP registry must expose rure_recover_sass');
  assert.deepEqual(sassTool.inputSchema.required, ['sassPath', 'elfPath']);
  assert.equal(sassTool.inputSchema.additionalProperties, false);
  const dumpRoot = join(repository, 'plugins/ruflo-rure/scripts/baselines/culifter/crosspath-inputs');
  const sassBytes = readFileSync(join(dumpRoot, 'copy32.sass'));
  const elfBytes = readFileSync(join(dumpRoot, 'copy32.elf'));
  const sassPath = join(sandbox, 'copy32.sass'), elfPath = join(sandbox, 'copy32.elf');
  writeFileSync(sassPath, sassBytes, { flag: 'wx' });
  writeFileSync(elfPath, elfBytes, { flag: 'wx' });
  const { result: sassRecovery } = unwrap(await request('tools/call', {
    name: sassTool.name, arguments: { sassPath, elfPath },
  }));
  assert.equal(sassRecovery.success, true);
  assert.equal(sassRecovery.status, 'emitted');
  assert.equal(sassRecovery.proofStatus, 'not-proven');
  assert.equal(sassRecovery.sourceSha256, createHash('sha256').update(sassBytes).digest('hex'));
  assert.equal(sassRecovery.elfSha256, createHash('sha256').update(elfBytes).digest('hex'));
  assert.equal(sassRecovery.presentationModified, false);
  assert.deepEqual(sassRecovery.functions.map(f => f.name), ['copy32']);
  assert.ok(sassRecovery.code.includes('__global__'));
  assert.ok(!sassRecovery.code.includes('asm('));
  console.log(JSON.stringify({
    status: 'pass', transport: 'stdio', builtEntrypoint: entrypoint,
    sourceSha256, functions: result.functions.length, tool: tool.name,
    resultEnvelopeDepth: depth, screened: result.screened,
    presentationModified: result.presentationModified,
    recovery: { status: recovery.status, proofStatus: recovery.proofStatus,
      codeSha256: createHash('sha256').update(recovery.code).digest('hex'),
      codeBytes: Buffer.byteLength(recovery.code), screened: recovery.screened },
    sassRecovery: { tool: sassTool.name, status: sassRecovery.status,
      proofStatus: sassRecovery.proofStatus, sourceSha256: sassRecovery.sourceSha256,
      elfSha256: sassRecovery.elfSha256, codeSha256: createHash('sha256').update(sassRecovery.code).digest('hex'),
      screened: sassRecovery.screened },
    elapsedMs: performance.now() - start, node: process.version,
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    status: 'fail', transport: 'stdio', builtEntrypoint: entrypoint,
    error: error instanceof Error ? error.message : String(error),
    serverStderr: stderr, elapsedMs: performance.now() - start,
  }, null, 2));
  process.exitCode = 1;
} finally {
  for (const request of pending.values()) clearTimeout(request.timer);
  pending.clear();
  child.stdin.end();
  if (!closed) child.kill('SIGTERM');
  const kill = setTimeout(() => { if (!closed) child.kill('SIGKILL'); }, 1000);
  kill.unref();
  await completion;
  clearTimeout(kill);
  rmSync(sandbox, { recursive: true, force: true });
}
