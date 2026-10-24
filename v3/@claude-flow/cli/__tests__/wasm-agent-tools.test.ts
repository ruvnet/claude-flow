/**
 * Tests for WASM Agent MCP Tools
 *
 * Validates all 10 MCP tool handlers work correctly.
 */

import { describe, it, expect, vi } from 'vitest';

// ── Mock the agent-wasm module ───────────────────────────────

const mockAgentInfo = {
  id: 'wasm-agent-1-test',
  state: 'idle' as const,
  config: {},
  model: 'test-model',
  turnCount: 0,
  fileCount: 0,
  isStopped: false,
  createdAt: '2026-03-17T00:00:00.000Z',
};

vi.mock('../src/ruvector/agent-wasm.js', () => ({
  isAgentWasmAvailable: vi.fn(async () => true),
  initAgentWasm: vi.fn(async () => undefined),
  createWasmAgent: vi.fn(async () => ({ ...mockAgentInfo })),
  promptWasmAgent: vi.fn(async () => 'Agent response'),
  executeWasmTool: vi.fn(async () => ({ success: true, output: 'ok' })),
  getWasmAgent: vi.fn(() => ({ ...mockAgentInfo })),
  listWasmAgents: vi.fn(() => [{ ...mockAgentInfo }]),
  terminateWasmAgent: vi.fn(() => true),
  getWasmAgentState: vi.fn(() => ({ messages: [], turn_count: 0 })),
  getWasmAgentTools: vi.fn(() => ['read_file', 'write_file']),
  getWasmAgentTodos: vi.fn(() => []),
  exportWasmState: vi.fn(() => '{"state":"exported"}'),
  createWasmMcpServer: vi.fn(async () => vi.fn(async () => '{}')),
  listGalleryTemplates: vi.fn(async () => [{ id: 'coder', name: 'Coder Agent' }]),
  getGalleryCount: vi.fn(async () => 6),
  getGalleryCategories: vi.fn(async () => ({ development: 2 })),
  searchGalleryTemplates: vi.fn(async () => [{ id: 'coder', name: 'Coder Agent', relevance: 0.7 }]),
  getGalleryTemplate: vi.fn(async () => ({ id: 'coder', prompts: [], tools: [], skills: [] })),
  createAgentFromTemplate: vi.fn(async () => ({ ...mockAgentInfo, id: 'wasm-agent-2-tpl' })),
  buildRvfContainer: vi.fn(async () => new Uint8Array([0x52, 0x56, 0x46, 0x01])),
  buildRvfFromTemplate: vi.fn(async () => new Uint8Array([0x52, 0x56, 0x46, 0x01])),
}));

import { wasmAgentTools } from '../src/mcp-tools/wasm-agent-tools.js';

// ── Helper ───────────────────────────────────────────────────

function findTool(name: string) {
  const tool = wasmAgentTools.find(t => t.name === name);
  if (!tool) throw new Error(`Tool not found: ${name}`);
  return tool;
}

async function callTool(name: string, args: Record<string, unknown> = {}) {
  return findTool(name).handler(args);
}

function parseResult(result: { content: Array<{ type: string; text: string }> }) {
  return JSON.parse(result.content[0].text);
}

// ── Tests ────────────────────────────────────────────────────

describe('wasm-agent-tools MCP', () => {
  it('exports 10 tools', () => {
    expect(wasmAgentTools).toHaveLength(10);
  });

  it('all tools have required fields', () => {
    for (const tool of wasmAgentTools) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toBeDefined();
      expect(typeof tool.handler).toBe('function');
    }
  });

  describe('wasm_agent_create', () => {
    it('creates with config', async () => {
      const data = parseResult(await callTool('wasm_agent_create', { instructions: 'Test' }));
      expect(data.success).toBe(true);
      expect(data.agent.id).toBe('wasm-agent-1-test');
    });

    it('creates from template', async () => {
      const data = parseResult(await callTool('wasm_agent_create', { template: 'coder' }));
      expect(data.success).toBe(true);
      expect(data.source).toBe('gallery');
    });
  });

  it('wasm_agent_prompt returns response', async () => {
    const result = await callTool('wasm_agent_prompt', { agentId: 'test', input: 'Hello' });
    expect(result.content[0].text).toBe('Agent response');
  });

  it('wasm_agent_tool executes tool', async () => {
    const result = await callTool('wasm_agent_tool', { agentId: 'test', toolName: 'read_file', toolInput: { path: 'x' } });
    const text = result.content[0].text;
    expect(text).toContain('success');
  });

  it('wasm_agent_list lists agents', async () => {
    const data = parseResult(await callTool('wasm_agent_list'));
    expect(data.count).toBe(1);
  });

  it('wasm_agent_terminate terminates', async () => {
    const data = parseResult(await callTool('wasm_agent_terminate', { agentId: 'test' }));
    expect(data.success).toBe(true);
  });

  it('wasm_agent_files lists files', async () => {
    const result = await callTool('wasm_agent_files', { agentId: 'test' });
    expect(result.content[0].text).toContain('read_file');
  });

  it('wasm_agent_export exports state', async () => {
    const result = await callTool('wasm_agent_export', { agentId: 'test' });
    expect(result.content[0].text).toBe('{"state":"exported"}');
  });

  it('wasm_gallery_list lists templates', async () => {
    const data = parseResult(await callTool('wasm_gallery_list'));
    expect(data.count).toBe(1);
    expect(data.templates[0].id).toBe('coder');
  });

  it('wasm_gallery_search finds templates', async () => {
    const data = parseResult(await callTool('wasm_gallery_search', { query: 'code' }));
    expect(data.count).toBe(1);
  });

  it('wasm_gallery_create creates from template', async () => {
    const data = parseResult(await callTool('wasm_gallery_create', { template: 'coder' }));
    expect(data.success).toBe(true);
    expect(data.template).toBe('coder');
  });
});
