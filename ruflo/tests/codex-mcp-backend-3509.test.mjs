import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, test } from 'vitest';

const bridges = [
  '../src/mcp-bridge/index.js',
  '../src/ruvocal/mcp-bridge/index.js',
];
const processes = [];
const directories = [];
afterEach(() => {
  for (const child of processes.splice(0)) child.kill();
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

for (const relativePath of bridges) {
  test(`${relativePath}: removed Codex MCP mode does not delay other groups`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ruflo-codex-mcp-'));
    directories.push(dir);
    const marker = join(dir, 'npx-spawned');
    const fakeNpx = join(dir, 'npx');
    writeFileSync(fakeNpx, '#!/bin/sh\nprintf launched > "$RUFLO_CODEX_SPAWN_MARKER"\nexit 1\n');
    chmodSync(fakeNpx, 0o755);

    const child = spawn(process.execPath, [fileURLToPath(new URL(relativePath, import.meta.url))], {
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH ?? ''}`,
        PORT: '0',
        MCP_GROUP_INTELLIGENCE: 'false',
        MCP_GROUP_AGENTS: 'false',
        MCP_GROUP_MEMORY: 'false',
        MCP_GROUP_DEVTOOLS: 'false',
        MCP_GROUP_CODEX: 'true',
        RUFLO_CODEX_SPAWN_MARKER: marker,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    processes.push(child);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    const deadline = Date.now() + 3000;
    // stderr can reach the parent before stdout; wait for both startup signals.
    while (Date.now() < deadline &&
      (!stderr.includes('Codex CLI has no MCP server mode') || !/Active groups: core\s*$/m.test(stdout))) {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.match(stdout, /Active groups: core\s*$/m, `stdout: ${stdout}\nstderr: ${stderr}`);
    assert.match(stderr, /Codex CLI has no MCP server mode/, stderr);
    assert.equal(existsSync(marker), false, 'removed backend must not spawn npx');
  });
}
