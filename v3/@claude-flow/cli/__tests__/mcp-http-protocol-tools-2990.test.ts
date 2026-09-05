// #2990: the published HTTP transport completed startup but returned an
// object-valued protocolVersion and exposed only @claude-flow/mcp's four
// built-in diagnostic tools. This end-to-end test exercises the built CLI so
// dependency pinning, HTTP registration, dispatch, and the default bind are
// covered together.

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(HERE, '..', 'bin', 'cli.js');
const CLI_BUILT = fs.existsSync(CLI);
const TEST_TMP = path.resolve(HERE, '..', '..', '..', '..', '.tmp-2990', 'test-runtime');

let child: ChildProcessWithoutNullStreams | undefined;

afterEach(() => {
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
  }
  child = undefined;
});

function waitForOutput(
  proc: ChildProcessWithoutNullStreams,
  match: string,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      reject(new Error(`timed out waiting for "${match}"\nstdout: ${stdout}\nstderr: ${stderr}`));
    }, timeoutMs);
    const onStdout = (chunk: Buffer) => {
      stdout += chunk.toString();
      if (stdout.includes(match)) {
        clearTimeout(timer);
        proc.stdout.off('data', onStdout);
        resolve();
      }
    };
    proc.stdout.on('data', onStdout);
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    proc.once('exit', (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`process exited before startup (code=${code}, signal=${signal})\nstdout: ${stdout}\nstderr: ${stderr}`));
    });
  });
}

async function postJson(port: number, endpoint: string, body: unknown, host = '127.0.0.1'): Promise<any> {
  const response = await fetch(`http://${host.includes(':') ? `[${host}]` : host}:${port}${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(200);
  return await response.json();
}

async function startHttpCli(port: number, tools: string): Promise<void> {
  fs.mkdirSync(TEST_TMP, { recursive: true });
  child = spawn('node', [CLI, 'mcp', 'start', '-t', 'http', '--port', String(port)], {
    env: {
      ...process.env,
      CLAUDE_FLOW_MCP_TOOLS: tools,
      RUFLO_DAEMON_AUTOSTART: '0',
      TEMP: TEST_TMP,
      TMP: TEST_TMP,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForOutput(child, 'MCP Server started', 20_000);
}

describe('MCP HTTP protocol and tool registry (#2990, end-to-end)', () => {
  beforeAll(() => {
    if (!CLI_BUILT) {
      throw new Error(`Built CLI required for end-to-end coverage: ${CLI}`);
    }
  });

  it('serves a spec-valid protocol string and the executable CLI tools on both RPC paths', async () => {
    const port = 34000 + Math.floor(Math.random() * 4000);
    await startHttpCli(port, 'all');

    const health = await fetch(`http://127.0.0.1:${port}/health`);
    expect(health.status).toBe(200);
    const ipv6Health = await fetch(`http://[::1]:${port}/health`);
    expect(ipv6Health.status).toBe(200);

    const initialized = await postJson(port, '/mcp', {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'ruflo-http-regression', version: '1.0.0' },
      },
    });
    expect(initialized.result.protocolVersion).toBe('2025-11-25');

    // Initialize through IPv4, then call the alternate RPC path through IPv6.
    // Independent server instances would reject this as an uninitialized session.
    const listed = await postJson(port, '/rpc', {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
    }, '::1');
    const names = listed.result.tools.map((tool: { name: string }) => tool.name);
    expect(names.length).toBeGreaterThan(300);
    expect(names).toEqual(expect.arrayContaining([
      'agent_spawn',
      'swarm_init',
      'memory_store',
      'system_info',
    ]));

    const called = await postJson(port, '/mcp', {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'system_info', arguments: {} },
    });
    expect(called.result.isError).toBe(false);
    const systemInfo = JSON.parse(called.result.content[0].text);
    expect(systemInfo).toMatchObject({
      nodeVersion: process.version,
      platform: process.platform,
    });
  }, 30_000);

  it('applies CLAUDE_FLOW_MCP_TOOLS to the bridged HTTP catalogue', async () => {
    const port = 38000 + Math.floor(Math.random() * 2000);
    await startHttpCli(port, 'memory');

    await postJson(port, '/mcp', {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'ruflo-http-filter-regression', version: '1.0.0' },
      },
    });
    const listed = await postJson(port, '/mcp', {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
    });
    const names = listed.result.tools.map((tool: { name: string }) => tool.name);
    expect(names).toContain('memory_store');
    expect(names).not.toContain('agent_spawn');
  }, 30_000);

  it('supports the legacy SSE fallback on GET /mcp', async () => {
    const port = 32000 + Math.floor(Math.random() * 1500);
    await startHttpCli(port, 'memory');

    const controller = new AbortController();
    const streamResponse = await fetch(`http://127.0.0.1:${port}/mcp`, {
      headers: { accept: 'text/event-stream' },
      signal: controller.signal,
    });
    expect(streamResponse.status).toBe(200);
    expect(streamResponse.headers.get('content-type')).toContain('text/event-stream');
    const reader = streamResponse.body!.getReader();
    const decoder = new TextDecoder();
    let received = decoder.decode((await reader.read()).value, { stream: true });
    expect(received).toContain('event: endpoint');
    const endpoint = received.match(/data: (\/mcp\?sessionId=[^\r\n]+)/)?.[1];
    expect(endpoint).toBeTruthy();

    const accepted = await fetch(`http://127.0.0.1:${port}${endpoint}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'ruflo-sse-regression', version: '1.0.0' },
        },
      }),
    });
    expect(accepted.status).toBe(202);

    while (!received.includes('event: message')) {
      const chunk = await reader.read();
      if (chunk.done) break;
      received += decoder.decode(chunk.value, { stream: true });
    }
    expect(received).toContain('event: message');
    expect(received).toContain('"protocolVersion":"2025-11-25"');
    controller.abort();
  }, 30_000);
});
