/**
 * ADR-476 contract: the hive-mind gate trusts only the server-built
 * `context.transport`. Each dispatcher that reaches callMCPTool must label
 * itself, or remote callers would be classified by omission. If one of these
 * assertions breaks, a dispatcher changed and the gate's caller
 * classification must be re-verified.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = (p: string) => readFileSync(join(__dirname, '..', 'src', p), 'utf-8');

describe('hive-mind gate: dispatchers label their transport', () => {
  const server = src('mcp-server.ts');

  it('the stdio loop passes transport: stdio', () => {
    expect(server).toMatch(/callMCPTool\(toolName, toolParams, \{ sessionId, transport: 'stdio' \}\)/);
  });

  it('the HTTP/WebSocket handler passes http or websocket, never stdio/cli', () => {
    const m = server.match(/transport: this\.options\.transport === 'websocket' \? 'websocket' : 'http'/);
    expect(m).not.toBeNull();
    const httpBlock = server.slice(server.indexOf('private async startHttpServer'));
    expect(httpBlock).not.toMatch(/transport: 'stdio'|transport: 'cli'/);
  });

  it('both shipped stdio entry points (bin/mcp-server.js, bin/cli.js) pass transport: stdio', () => {
    for (const bin of ['mcp-server.js', 'cli.js']) {
      const text = readFileSync(join(__dirname, '..', 'bin', bin), 'utf-8');
      expect(text, bin).toMatch(/callMCPTool\(toolName, toolParams, \{ sessionId, transport: 'stdio' \}\)/);
    }
  });

  it('`mcp exec` is the local CLI', () => {
    expect(src('commands/mcp.ts')).toMatch(/transport: 'cli'/);
  });

  it('client-supplied tool arguments are never consulted for the caller class', () => {
    const tools = src('mcp-tools/hive-mind-tools.ts');
    const classify = tools.slice(tools.indexOf('function classifyCaller'), tools.indexOf('function constantTimeEqual'));
    expect(classify).not.toMatch(/input/);
  });
});
