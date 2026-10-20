import { afterAll, describe, expect, it } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
const root = mkdtempSync(join(tmpdir(), 'ruflo-mcp-error-'));
mkdirSync(join(root, 'bin'));
mkdirSync(join(root, 'dist/src/mcp-tools'), { recursive: true });
copyFileSync(new URL('../bin/cli.js', import.meta.url), join(root, 'bin/cli.js'));
writeFileSync(join(root, 'package.json'), '{"type":"module"}');
writeFileSync(join(root, 'dist/src/mcp-client.js'), 'export const hasTool = () => true; export const listMCPTools = () => []; export const callMCPTool = async (_name, input) => input.payload;');
writeFileSync(join(root, 'dist/src/mcp-tools/policy-enforcer.js'), 'export const isPolicyEnforcementEnabled = () => false; export const loadMcpPolicy = () => ({}); export const evaluateToolCall = () => ({allowed:true});');
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('executable MCP fast path tool errors', () => {
  it.each([
    [{ success: false, error: 'invalid input' }, true],
    [{ success: false, recorded: true }, false],
  ])('uses the protocol error flag without losing output', (payload, isError) => {
    const request = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'fixture', arguments: { payload } } };
    const stdout = execFileSync(process.execPath, [join(root, 'bin/cli.js')], { input: `${JSON.stringify(request)}\n`, encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] });
    const response = JSON.parse(stdout.trim());
    expect(response.result.isError === true).toBe(isError);
    expect(JSON.parse(response.result.content[0].text)).toEqual(payload);
  });
});
