import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// ADR-490: bin/cli.js (what `ruflo mcp start` runs) and bin/mcp-server.js are independent stdio servers from src/mcp-server.ts. Each declared
// `resources` but answered resources/* with -32601. Driven over real stdio, the way Codex and Claude Code reach them.
const BIN = (f: string) => join(__dirname, '..', 'bin', f);

function rpc(entry: string, args: string[], calls: Array<{ method: string; params?: unknown }>): Promise<Array<{ result?: any; error?: any }>> {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [BIN(entry), ...args], { stdio: ['pipe', 'pipe', 'ignore'], env: { ...process.env, RUFLO_NO_SKILLS_SH: '1' } });
    const out: Array<{ result?: any; error?: any }> = [];
    let buf = '';
    const timer = setTimeout(() => { p.kill('SIGKILL'); reject(new Error(`timeout; got ${out.length}/${calls.length}`)); }, 60_000);
    p.stdout.on('data', (d) => {
      buf += d;
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        try { const m = JSON.parse(line); if (typeof m.id === 'number') out[m.id - 1] = m; } catch { /* log line */ }
        if (out.filter(Boolean).length === calls.length) { clearTimeout(timer); p.kill('SIGKILL'); resolve(out); }
      }
    });
    calls.forEach((c, i) => p.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: i + 1, method: c.method, params: c.params ?? {} })}\n`));
  });
}

// The bin entries import dist/, so this needs a built CLI; the e2e workflow (scripts/e2e) builds one and asserts the same thing over stdio.
const built = existsSync(join(__dirname, '..', 'dist', 'src', 'index.js'));

describe.skipIf(!built).each([
  ['cli.js', ['mcp', 'start']],
  ['mcp-server.js', []],
])('bin/%s stdio MCP resources capability', (entry, args) => {
  it('serves what it advertises', async () => {
    const [init, list, templates, read] = await rpc(entry, args, [
      { method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } } },
      { method: 'resources/list' },
      { method: 'resources/templates/list' },
      { method: 'resources/read', params: { uri: 'ruflo://nope' } },
    ]);
    const res = init.result.capabilities.resources;
    expect(res?.subscribe).not.toBe(true);
    expect(res?.listChanged).not.toBe(true);
    if (res) {
      expect(list.error).toBeUndefined();
      expect(list.result).toEqual({ resources: [] });
      expect(templates.result).toEqual({ resourceTemplates: [] });
    }
    expect(read.error?.code).toBe(-32002);
  }, 90_000);
});
