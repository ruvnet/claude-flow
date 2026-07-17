/** MetaHarness-compatible `ruflo proxy run` policy capability helpers. */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';

let stateDir: string;
let savedEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-client-run-test-'));
  savedEnv = { ...process.env };
  process.env.RUFLO_STATE_DIR = stateDir;
});

afterEach(() => {
  process.env = savedEnv;
  fs.rmSync(stateDir, { recursive: true, force: true });
});

describe('Meta-Proxy client launcher', () => {
  it('only passes the local bearer token to a literal loopback endpoint', async () => {
    const { proxyClientEndpoint, proxyClientEnvironment } = await import('../src/proxy/client-run.js');
    fs.writeFileSync(path.join(stateDir, 'proxy-token'), 'local-token\n');
    fs.writeFileSync(path.join(stateDir, 'proxy-config.toml'), 'bind = "127.0.0.1:22435"\n');

    expect(proxyClientEndpoint()).toBe('http://127.0.0.1:22435');
    expect(proxyClientEnvironment()).toEqual({
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:22435',
      ANTHROPIC_AUTH_TOKEN: 'local-token',
    });

    fs.writeFileSync(path.join(stateDir, 'proxy-config.toml'), 'bind = "0.0.0.0:11435"\n');
    expect(proxyClientEndpoint).toThrow(/non-loopback/i);
  });

  it('mints an eight-hour scoped policy capability without exposing the worktree path', async () => {
    const { createProxyPolicyToken, proxyWorktreeFingerprint } = await import('../src/proxy/client-run.js');
    const worktree = 'C:/tmp/herd/agent-a';
    const token = createProxyPolicyToken('local-proxy-secret', 'economy', proxyWorktreeFingerprint(worktree), 0);
    const [prefix, encoded, signature] = token.split('.');
    const claim = JSON.parse(Buffer.from(encoded!, 'base64url').toString('utf8'));

    expect(prefix).toBe('mh1');
    expect(signature).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(claim).toMatchObject({ policy: 'economy', exp: 28_800 });
    expect(claim.worktree).toMatch(/^[a-f0-9]{32}$/);
    expect(JSON.stringify(claim)).not.toContain(worktree);
  });

  it('launches a real client with a scoped token after authenticated proxy readiness', async () => {
    const { proxyBinaryPath, proxyPidFilePath } = await import('../src/proxy/paths.js');
    const { runProxyClient } = await import('../src/proxy/client-run.js');
    const observedPath = path.join(stateDir, 'observed-client-env.json');
    const localToken = 'local-test-token';
    const server = http.createServer((request, response) => {
      if (request.url === '/status' && request.headers.authorization === `Bearer ${localToken}`) {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end('{}');
        return;
      }
      response.writeHead(401);
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test server did not expose a TCP port');

    fs.mkdirSync(path.dirname(proxyBinaryPath()), { recursive: true });
    fs.writeFileSync(proxyBinaryPath(), 'test binary marker');
    fs.writeFileSync(proxyPidFilePath(), String(process.pid));
    fs.writeFileSync(path.join(stateDir, 'proxy-token'), `${localToken}\n`);
    fs.writeFileSync(path.join(stateDir, 'proxy-config.toml'), `bind = "127.0.0.1:${address.port}"\n`);

    const script = [
      "const fs = require('node:fs');",
      "const [prefix, payload] = process.env.ANTHROPIC_AUTH_TOKEN.split('.');",
      "fs.writeFileSync(process.argv[1], JSON.stringify({ base: process.env.ANTHROPIC_BASE_URL, prefix, claim: JSON.parse(Buffer.from(payload, 'base64url')) }));",
    ].join(' ');
    try {
      const result = await runProxyClient([process.execPath, '-e', script, observedPath], 'critical', stateDir);
      const observed = JSON.parse(fs.readFileSync(observedPath, 'utf8'));

      expect(result).toMatchObject({ success: true, exitCode: 0, started: false, policy: 'critical' });
      expect(observed).toMatchObject({ base: `http://127.0.0.1:${address.port}`, prefix: 'mh1', claim: { policy: 'critical' } });
      expect(JSON.stringify(observed)).not.toContain(localToken);
      expect(JSON.stringify(observed)).not.toContain(stateDir);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('exposes MetaHarness-compatible run, path, login, and logout subcommands', async () => {
    const { proxyCommand } = await import('../src/commands/proxy.js');
    const commands = proxyCommand.subcommands?.map((command) => command.name) ?? [];
    expect(commands).toEqual(expect.arrayContaining(['run', 'path', 'login', 'logout']));
    const run = proxyCommand.subcommands?.find((command) => command.name === 'run');
    expect(run?.options?.find((option) => option.name === 'policy')).toMatchObject({
      default: 'standard', choices: ['critical', 'standard', 'economy'],
    });
  });

  it('parses the documented policy and double-dash client boundary', async () => {
    const { CommandParser } = await import('../src/parser.js');
    const { proxyCommand } = await import('../src/commands/proxy.js');
    const parser = new CommandParser();
    parser.registerCommand(proxyCommand);

    expect(parser.parse(['proxy', 'run', '--policy', 'critical', '--', 'claude'])).toMatchObject({
      command: ['proxy', 'run'],
      flags: { policy: 'critical' },
      positional: ['claude'],
    });
  });
});
