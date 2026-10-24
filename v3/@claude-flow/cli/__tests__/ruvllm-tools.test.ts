/**
 * Tests for ruvllm-wasm MCP tools.
 * Mocks the integration module to test tool handlers in isolation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the integration module
const mockRouter = {
  addPattern: vi.fn(() => true),
  route: vi.fn(() => [{ name: 'test', score: 0.9 }]),
  clear: vi.fn(),
  patternCount: vi.fn(() => 1),
  toJson: vi.fn(() => '{}'),
};

const mockSona = {
  adapt: vi.fn(),
  recordPattern: vi.fn(),
  suggestAction: vi.fn(() => 'optimize'),
  stats: vi.fn(() => '{"adaptations":1}'),
  reset: vi.fn(),
  toJson: vi.fn(() => '{}'),
};

const mockLora = {
  apply: vi.fn(() => new Float32Array(32)),
  adapt: vi.fn(),
  applyUpdates: vi.fn(),
  stats: vi.fn(() => '{"rank":2}'),
  reset: vi.fn(),
  toJson: vi.fn(() => '{}'),
  pendingUpdates: vi.fn(() => 0),
};

vi.mock('../src/ruvector/ruvllm-wasm.js', () => ({
  isRuvllmWasmAvailable: vi.fn(async () => true),
  initRuvllmWasm: vi.fn(async () => undefined),
  getRuvllmStatus: vi.fn(async () => ({ available: true, initialized: true, version: '2.0.1' })),
  createHnswRouter: vi.fn(async () => mockRouter),
  createSonaInstant: vi.fn(async () => mockSona),
  createMicroLora: vi.fn(async () => mockLora),
  formatChat: vi.fn(async () => '<|begin|>system\nHello<|end|>'),
  createGenerateConfig: vi.fn(async () => '{"maxTokens":100}'),
  createKvCache: vi.fn(async () => ({ append: vi.fn(), clear: vi.fn(), stats: vi.fn(), tokenCount: vi.fn() })),
  createBufferPool: vi.fn(async () => ({ prewarm: vi.fn(), stats: vi.fn(), hitRate: vi.fn(), clear: vi.fn() })),
  createInferenceArena: vi.fn(async () => ({ reset: vi.fn(), used: vi.fn(), capacity: vi.fn(), remaining: vi.fn() })),
  HNSW_MAX_SAFE_PATTERNS: 11,
}));

import { ruvllmWasmTools } from '../src/mcp-tools/ruvllm-tools.js';

function findTool(name: string) {
  const tool = ruvllmWasmTools.find(t => t.name === name);
  if (!tool) throw new Error(`Tool not found: ${name}`);
  return tool;
}

describe('ruvllm-wasm MCP tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should export 10 tools', () => {
    expect(ruvllmWasmTools).toHaveLength(10);
  });

  describe('ruvllm_status', () => {
    it('should return status', async () => {
      const tool = findTool('ruvllm_status');
      const result = await tool.handler({}) as any;
      const data = JSON.parse(result.content[0].text);
      expect(data.available).toBe(true);
      expect(data.version).toBe('2.0.1');
    });
  });

  describe('ruvllm_hnsw_create', () => {
    it('should create router and return ID', async () => {
      const tool = findTool('ruvllm_hnsw_create');
      const result = await tool.handler({ dimensions: 64, maxPatterns: 10 }) as any;
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.routerId).toMatch(/^hnsw-/);
    });
  });

  describe('ruvllm_hnsw_add', () => {
    it('should add pattern to router', async () => {
      // First create
      const createTool = findTool('ruvllm_hnsw_create');
      const createResult = await createTool.handler({ dimensions: 64, maxPatterns: 10 }) as any;
      const routerId = JSON.parse(createResult.content[0].text).routerId;

      const addTool = findTool('ruvllm_hnsw_add');
      const result = await addTool.handler({ routerId, name: 'test', embedding: Array(64).fill(0) }) as any;
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
    });

    it('should error on unknown router', async () => {
      const tool = findTool('ruvllm_hnsw_add');
      const result = await tool.handler({ routerId: 'nonexistent', name: 'test', embedding: [] }) as any;
      expect(result.isError).toBe(true);
    });
  });

  describe('ruvllm_hnsw_route', () => {
    it('should route query', async () => {
      const createTool = findTool('ruvllm_hnsw_create');
      const createResult = await createTool.handler({ dimensions: 64, maxPatterns: 10 }) as any;
      const routerId = JSON.parse(createResult.content[0].text).routerId;

      const routeTool = findTool('ruvllm_hnsw_route');
      const result = await routeTool.handler({ routerId, query: Array(64).fill(0) }) as any;
      const data = JSON.parse(result.content[0].text);
      expect(data.results).toBeDefined();
    });
  });

  describe('ruvllm_sona_create', () => {
    it('should create SONA instance', async () => {
      const tool = findTool('ruvllm_sona_create');
      const result = await tool.handler({ hiddenDim: 32 }) as any;
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.sonaId).toMatch(/^sona-/);
    });
  });

  describe('ruvllm_sona_adapt', () => {
    it('should adapt with quality signal', async () => {
      const createTool = findTool('ruvllm_sona_create');
      const createResult = await createTool.handler({}) as any;
      const sonaId = JSON.parse(createResult.content[0].text).sonaId;

      const adaptTool = findTool('ruvllm_sona_adapt');
      const result = await adaptTool.handler({ sonaId, quality: 0.85 }) as any;
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
    });
  });

  describe('ruvllm_microlora_create', () => {
    it('should create MicroLoRA', async () => {
      const tool = findTool('ruvllm_microlora_create');
      const result = await tool.handler({ inputDim: 64, outputDim: 32, rank: 2 }) as any;
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.loraId).toMatch(/^lora-/);
    });
  });

  describe('ruvllm_microlora_adapt', () => {
    it('should adapt with feedback', async () => {
      const createTool = findTool('ruvllm_microlora_create');
      const createResult = await createTool.handler({ inputDim: 64, outputDim: 32 }) as any;
      const loraId = JSON.parse(createResult.content[0].text).loraId;

      const adaptTool = findTool('ruvllm_microlora_adapt');
      const result = await adaptTool.handler({ loraId, quality: 0.9 }) as any;
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
    });
  });

  describe('ruvllm_chat_format', () => {
    it('should format with preset', async () => {
      const tool = findTool('ruvllm_chat_format');
      const result = await tool.handler({
        messages: [{ role: 'user', content: 'Hi' }],
        template: 'llama3',
      }) as any;
      expect(result.content[0].text).toContain('system');
    });
  });

  describe('ruvllm_generate_config', () => {
    it('should create config', async () => {
      const tool = findTool('ruvllm_generate_config');
      const result = await tool.handler({ maxTokens: 100, temperature: 0.7 }) as any;
      expect(result.content[0].text).toContain('maxTokens');
    });
  });
});
