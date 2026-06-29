/**
 * Tests for http_fetch MCP tool (ADR-164 §5.1.8, Phase 4).
 *
 * Coverage:
 *   - URL allowlist (default-blocks file://, ftp://, RFC-1918, loopback, link-local)
 *   - Opt-in via CLAUDE_FLOW_HTTP_FETCH_ALLOW_PRIVATE=1 reaches a local server
 *   - Header sanitization (default-rejects Authorization / Cookie / X-Auth-*)
 *   - Opt-in via CLAUDE_FLOW_HTTP_FETCH_ALLOW_AUTH=1 passes the header
 *   - Hard timeout aborts via AbortController
 *   - Response truncation honours maxResponseBytes
 *   - Happy path against a local mock node:http server
 *   - Default User-Agent injected if caller did not provide one
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  httpFetchTools,
  httpFetchExecute,
  validateUrl,
  validateHeaders,
  HttpFetchValidationError,
} from '../src/mcp-tools/http-fetch-tools.js';

function findTool(name: string) {
  const t = httpFetchTools.find((x) => x.name === name);
  if (!t) throw new Error(`tool not found: ${name}`);
  return t;
}

// ---------- mock server for happy-path + truncation + timeout tests --------

let server: http.Server;
let port: number;
let lastUA: string | undefined;
let lastAuth: string | undefined;
let lastMethod: string | undefined;
let lastBody: string | undefined;

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = http.createServer((req, res) => {
      lastUA = req.headers['user-agent'] as string | undefined;
      lastAuth = req.headers['authorization'] as string | undefined;
      lastMethod = req.method;

      // Collect body
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        lastBody = Buffer.concat(chunks).toString('utf-8');

        const url = req.url ?? '/';
        if (url === '/ok') {
          res.writeHead(200, { 'content-type': 'text/plain', 'x-server': 'mock' });
          res.end('hello-world');
        } else if (url === '/big') {
          // 1MB+ body — should trigger truncation when maxResponseBytes < 1MB
          res.writeHead(200, { 'content-type': 'application/octet-stream' });
          res.end(Buffer.alloc(2 * 1024 * 1024, 0x41));
        } else if (url === '/slow') {
          // Never respond — caller must abort
          // Keep connection open. Don't write headers either.
          // Will be terminated when the test server closes.
        } else if (url === '/echo') {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ method: req.method, body: lastBody }));
        } else if (url === '/500') {
          res.writeHead(500, { 'content-type': 'text/plain' });
          res.end('server-error');
        } else {
          res.writeHead(404);
          res.end('not-found');
        }
      });
    });
    server.listen(0, '127.0.0.1', () => {
      port = (server.address() as AddressInfo).port;
      resolve();
    });
  });
});

afterAll(async () => {
  // Force-close to terminate any lingering /slow request
  await new Promise<void>((resolve) => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  });
});

// ---------- env-flag isolation -----------------------------------

const originalEnv = { ...process.env };
beforeEach(() => {
  delete process.env.CLAUDE_FLOW_HTTP_FETCH_ALLOW_PRIVATE;
  delete process.env.CLAUDE_FLOW_HTTP_FETCH_ALLOW_AUTH;
});
afterEach(() => {
  process.env = { ...originalEnv };
});

// ---------- URL allowlist tests ----------------------------------

describe('http_fetch — URL allowlist (default-deny)', () => {
  it('rejects file:// URLs', () => {
    expect(() => validateUrl('file:///etc/passwd')).toThrow(HttpFetchValidationError);
  });

  it('rejects ftp:// URLs', () => {
    expect(() => validateUrl('ftp://example.com/x')).toThrow(/protocol/);
  });

  it('rejects localhost', () => {
    expect(() => validateUrl('http://localhost/foo')).toThrow(/loopback|private/i);
  });

  it('rejects 127.0.0.1', () => {
    expect(() => validateUrl('http://127.0.0.1/foo')).toThrow(/loopback|private/i);
  });

  it('rejects 10.x RFC1918', () => {
    expect(() => validateUrl('http://10.0.0.5/foo')).toThrow(/loopback|private/i);
  });

  it('rejects 192.168.x.x RFC1918', () => {
    expect(() => validateUrl('http://192.168.1.1/foo')).toThrow(/loopback|private/i);
  });

  it('rejects 172.16.x.x RFC1918', () => {
    expect(() => validateUrl('http://172.20.0.1/foo')).toThrow(/loopback|private/i);
  });

  it('rejects 169.254.x.x link-local', () => {
    expect(() => validateUrl('http://169.254.169.254/latest')).toThrow(/loopback|private/i);
  });

  it('allows public host (example.com) by hostname check alone', () => {
    expect(() => validateUrl('https://example.com/foo')).not.toThrow();
  });

  it('opt-in CLAUDE_FLOW_HTTP_FETCH_ALLOW_PRIVATE=1 unlocks private addresses', () => {
    process.env.CLAUDE_FLOW_HTTP_FETCH_ALLOW_PRIVATE = '1';
    expect(() => validateUrl('http://127.0.0.1/foo')).not.toThrow();
    expect(() => validateUrl('http://10.0.0.5/foo')).not.toThrow();
  });
});

// ---------- header sanitization tests ----------------------------

describe('http_fetch — header sanitization (default-deny auth)', () => {
  it('rejects Authorization header by default', () => {
    expect(() => validateHeaders({ Authorization: 'Bearer abc' })).toThrow(/not allowed/i);
  });
  it('rejects Cookie header by default', () => {
    expect(() => validateHeaders({ Cookie: 'sid=abc' })).toThrow(/not allowed/i);
  });
  it('rejects X-Auth-Token by default', () => {
    expect(() => validateHeaders({ 'X-Auth-Token': 'abc' })).toThrow(/not allowed/i);
  });
  it('accepts benign headers', () => {
    const h = validateHeaders({ Accept: 'application/json', 'X-Pod': 'ops' });
    expect(h.Accept).toBe('application/json');
    expect(h['X-Pod']).toBe('ops');
  });
  it('opt-in CLAUDE_FLOW_HTTP_FETCH_ALLOW_AUTH=1 unlocks auth headers', () => {
    process.env.CLAUDE_FLOW_HTTP_FETCH_ALLOW_AUTH = '1';
    expect(() => validateHeaders({ Authorization: 'Bearer abc' })).not.toThrow();
  });
});

// ---------- happy path / timeout / truncation --------------------

describe('http_fetch — execution path against a mock server', () => {
  it('happy-path GET returns 200 and body', async () => {
    process.env.CLAUDE_FLOW_HTTP_FETCH_ALLOW_PRIVATE = '1';
    const result = await httpFetchExecute({ url: `http://127.0.0.1:${port}/ok` });
    expect(result.success).toBe(true);
    expect(result.status).toBe(200);
    expect(result.body).toBe('hello-world');
    expect(result.bodyTruncated).toBe(false);
  });

  it('default User-Agent is sent when caller omits it', async () => {
    process.env.CLAUDE_FLOW_HTTP_FETCH_ALLOW_PRIVATE = '1';
    lastUA = undefined;
    await httpFetchExecute({ url: `http://127.0.0.1:${port}/ok` });
    expect(lastUA).toMatch(/^ruflo-http-fetch\//);
  });

  it('aborts on timeout', async () => {
    process.env.CLAUDE_FLOW_HTTP_FETCH_ALLOW_PRIVATE = '1';
    const result = await httpFetchExecute({
      url: `http://127.0.0.1:${port}/slow`,
      timeoutMs: 100,
    });
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('TIMEOUT');
    expect(result.durationMs).toBeGreaterThanOrEqual(80);
    expect(result.durationMs).toBeLessThan(5_000);
  }, 10_000);

  it('truncates the response when body exceeds maxResponseBytes', async () => {
    process.env.CLAUDE_FLOW_HTTP_FETCH_ALLOW_PRIVATE = '1';
    const result = await httpFetchExecute({
      url: `http://127.0.0.1:${port}/big`,
      maxResponseBytes: 1024,
    });
    expect(result.success).toBe(true);
    expect(result.bodyTruncated).toBe(true);
    expect(result.bytesRead).toBeLessThanOrEqual(1024);
    expect(result.body.length).toBeLessThanOrEqual(1024);
  }, 10_000);

  it('refuses to call when URL is private and flag is off', async () => {
    const result = await httpFetchExecute({ url: `http://127.0.0.1:${port}/ok` });
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('PRIVATE_ADDRESS');
  });

  it('refuses Authorization header without env flag', async () => {
    process.env.CLAUDE_FLOW_HTTP_FETCH_ALLOW_PRIVATE = '1';
    const result = await httpFetchExecute({
      url: `http://127.0.0.1:${port}/ok`,
      headers: { Authorization: 'Bearer abc' },
    });
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('FORBIDDEN_HEADER');
  });

  it('POST with body echoes back through /echo', async () => {
    process.env.CLAUDE_FLOW_HTTP_FETCH_ALLOW_PRIVATE = '1';
    const result = await httpFetchExecute({
      url: `http://127.0.0.1:${port}/echo`,
      method: 'POST',
      body: 'hello',
    });
    expect(result.success).toBe(true);
    expect(result.status).toBe(200);
    const parsed = JSON.parse(result.body);
    expect(parsed.method).toBe('POST');
    expect(parsed.body).toBe('hello');
  });

  it('reports non-2xx status without throwing', async () => {
    process.env.CLAUDE_FLOW_HTTP_FETCH_ALLOW_PRIVATE = '1';
    const result = await httpFetchExecute({ url: `http://127.0.0.1:${port}/500` });
    expect(result.success).toBe(true);
    expect(result.status).toBe(500);
    expect(result.body).toBe('server-error');
  });
});

// ---------- MCP tool wiring -------------------------------------

describe('http_fetch — MCP tool registration', () => {
  it('exports http_fetch tool with required schema fields', () => {
    const tool = findTool('http_fetch');
    expect(tool.description.length).toBeGreaterThan(80);
    expect(tool.description).toMatch(/Use when/i);
    expect(tool.inputSchema.required).toEqual(['url']);
  });

  it('tool.handler dispatches to httpFetchExecute', async () => {
    process.env.CLAUDE_FLOW_HTTP_FETCH_ALLOW_PRIVATE = '1';
    const tool = findTool('http_fetch');
    const result = (await tool.handler({ url: `http://127.0.0.1:${port}/ok` })) as { status: number };
    expect(result.status).toBe(200);
  });
});
