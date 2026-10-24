/**
 * Tests for ruvllm-wasm integration module.
 * Mocks @ruvector/ruvllm-wasm since it may not be installed in CI.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock WASM module ─────────────────────────────────────────

const mockHnswRouter = {
  addPattern: vi.fn(() => true),
  route: vi.fn(() => [{ name: 'test', score: 0.95 }]),
  setEfSearch: vi.fn(),
  clear: vi.fn(),
  toJson: vi.fn(() => '{}'),
  dimensions: 64,
};

const mockSonaConfig = {
  hiddenDim: 64,
  learningRate: 0.01,
  emaDecay: 0.99,
  ewcLambda: 0.01,
  microLoraRank: 2,
  patternCapacity: 100,
};

const mockSonaInstant = {
  instantAdapt: vi.fn(),
  recordPattern: vi.fn(),
  suggestAction: vi.fn(() => 'optimize'),
  stats: vi.fn(() => ({ adaptations: 1 })),
  toJson: vi.fn(() => '{"adaptations":1}'),
  reset: vi.fn(),
};

const mockLoraConfig = {
  inputDim: 64,
  outputDim: 32,
  rank: 2,
  alpha: 1.0,
};

const mockLora = {
  apply: vi.fn(() => new Float32Array(32)),
  adapt: vi.fn(),
  applyUpdates: vi.fn(),
  stats: vi.fn(() => ({ rank: 2 })),
  reset: vi.fn(),
  toJson: vi.fn(() => '{"rank":2}'),
  getConfig: vi.fn(() => mockLoraConfig),
  pendingUpdates: vi.fn(() => 0),
};

const mockAdaptFeedback = {
  quality: 0,
  learningRate: 0,
  success: true,
};

const mockKvCacheConfig = { tailLength: 4, maxTokens: 2048, numKvHeads: 8, headDim: 64 };
const mockKvCache = {
  append: vi.fn(),
  stats: vi.fn(() => ({})),
  clear: vi.fn(),
  tokenCount: 0,
};

const mockGenerateConfig = {
  maxTokens: 100,
  temperature: 0.7,
  topP: 0.9,
  topK: 40,
  repetitionPenalty: 1.1,
  addStopSequence: vi.fn(),
  clearStopSequences: vi.fn(),
  toJson: vi.fn(() => '{"maxTokens":100}'),
};

const mockBufferPool = {
  prewarmAll: vi.fn(),
  statsJson: vi.fn(() => '{"hitRate":0.95}'),
  hitRate: 0.95,
  clear: vi.fn(),
};

const mockInferenceArena = {
  reset: vi.fn(),
  used: 1024,
  capacity: 8192,
  remaining: 7168,
};

const mockChatMessage = {
  system: vi.fn(() => ({ role: 'system', content: 'test' })),
  user: vi.fn(() => ({ role: 'user', content: 'test' })),
  assistant: vi.fn(() => ({ role: 'assistant', content: 'test' })),
};

const mockChatTemplate = {
  format: vi.fn(() => '<formatted>'),
  name: 'llama3',
};

// Use class syntax for mocks that are invoked with `new` — vi.fn().mockImplementation(() => ...)
// returns an arrow function which is NOT constructable and throws "is not a constructor".
vi.mock('@ruvector/ruvllm-wasm', () => ({
  default: vi.fn(),
  initSync: vi.fn(),
  RuvLLMWasm: class {
    initialize = vi.fn();
    isInitialized = true;
    getPoolStats = vi.fn(() => '{}');
    reset = vi.fn();
  },
  HnswRouterWasm: class {
    addPattern = mockHnswRouter.addPattern;
    route = mockHnswRouter.route;
    setEfSearch = mockHnswRouter.setEfSearch;
    clear = mockHnswRouter.clear;
    toJson = mockHnswRouter.toJson;
    dimensions = 64;
    constructor(..._args: unknown[]) { /* accept any ctor args */ }
  },
  SonaConfigWasm: class {
    hiddenDim = 64;
    learningRate = 0.01;
    emaDecay = 0.99;
    ewcLambda = 0.01;
    microLoraRank = 2;
    patternCapacity = 100;
  },
  SonaInstantWasm: class {
    instantAdapt = mockSonaInstant.instantAdapt;
    recordPattern = mockSonaInstant.recordPattern;
    suggestAction = mockSonaInstant.suggestAction;
    stats = mockSonaInstant.stats;
    toJson = mockSonaInstant.toJson;
    reset = mockSonaInstant.reset;
    constructor(..._args: unknown[]) { /* accept SonaConfigWasm */ }
  },
  MicroLoraConfigWasm: class {
    inputDim = 64;
    outputDim = 32;
    rank = 2;
    alpha = 1.0;
  },
  AdaptFeedbackWasm: class {
    quality = 0;
    learningRate = 0;
    success = true;
  },
  MicroLoraWasm: class {
    apply = mockLora.apply;
    adapt = mockLora.adapt;
    applyUpdates = mockLora.applyUpdates;
    stats = mockLora.stats;
    reset = mockLora.reset;
    toJson = mockLora.toJson;
    getConfig = mockLora.getConfig;
    pendingUpdates = mockLora.pendingUpdates;
    constructor(..._args: unknown[]) { /* accept MicroLoraConfigWasm */ }
  },
  KvCacheConfigWasm: class {
    tailLength = 4;
    maxTokens = 2048;
    numKvHeads = 8;
    headDim = 64;
  },
  KvCacheWasm: Object.assign(
    class { append = mockKvCache.append; stats = mockKvCache.stats; clear = mockKvCache.clear; tokenCount = 0; },
    { withDefaults: vi.fn(() => mockKvCache) },
  ),
  GenerateConfig: class {
    maxTokens = 100;
    temperature = 0.7;
    topP = 0.9;
    topK = 40;
    repetitionPenalty = 1.1;
    addStopSequence = mockGenerateConfig.addStopSequence;
    clearStopSequences = mockGenerateConfig.clearStopSequences;
    toJson = mockGenerateConfig.toJson;
  },
  BufferPoolWasm: { withCapacity: vi.fn(() => mockBufferPool) },
  InferenceArenaWasm: Object.assign(
    class { reset = mockInferenceArena.reset; used = 1024; capacity = 8192; remaining = 7168; },
    { forModel: vi.fn(() => mockInferenceArena) },
  ),
  ChatMessageWasm: mockChatMessage,
  ChatTemplateWasm: {
    llama3: vi.fn(() => mockChatTemplate),
    mistral: vi.fn(() => mockChatTemplate),
    chatml: vi.fn(() => mockChatTemplate),
    phi: vi.fn(() => mockChatTemplate),
    gemma: vi.fn(() => mockChatTemplate),
    custom: vi.fn(() => mockChatTemplate),
    detectFromModelId: vi.fn(() => mockChatTemplate),
  },
  getVersion: vi.fn(() => '2.0.1'),
  isReady: vi.fn(() => true),
}));

// Mock fs and module for Node.js init
vi.mock('node:fs', () => ({
  readFileSync: vi.fn(() => Buffer.from('fake wasm bytes')),
}));
vi.mock('node:module', () => ({
  createRequire: vi.fn(() => ({
    resolve: vi.fn(() => '/fake/path/ruvllm_wasm_bg.wasm'),
  })),
}));

// ── Tests ────────────────────────────────────────────────────

describe('ruvllm-wasm integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isRuvllmWasmAvailable', () => {
    it('should return true when module is available', async () => {
      const { isRuvllmWasmAvailable } = await import('../../src/ruvector/ruvllm-wasm.js');
      const available = await isRuvllmWasmAvailable();
      expect(available).toBe(true);
    });
  });

  describe('getRuvllmStatus', () => {
    it('should return status with version', async () => {
      const { getRuvllmStatus } = await import('../../src/ruvector/ruvllm-wasm.js');
      const status = await getRuvllmStatus();
      expect(status.available).toBe(true);
      expect(status.version).toBe('2.0.1');
    });
  });

  describe('createHnswRouter', () => {
    it('should create router with dimensions and maxPatterns', async () => {
      const { createHnswRouter } = await import('../../src/ruvector/ruvllm-wasm.js');
      const router = await createHnswRouter({ dimensions: 64, maxPatterns: 10 });
      expect(router).toBeDefined();
      expect(router.patternCount()).toBe(0);
    });

    it('should add patterns successfully', async () => {
      const { createHnswRouter } = await import('../../src/ruvector/ruvllm-wasm.js');
      const router = await createHnswRouter({ dimensions: 64, maxPatterns: 10 });
      const ok = router.addPattern({
        name: 'test-pattern',
        embedding: new Float32Array(64),
        metadata: { type: 'test' },
      });
      expect(ok).toBe(true);
      expect(router.patternCount()).toBe(1);
    });

    it('should enforce HNSW_MAX_SAFE_PATTERNS limit', async () => {
      const { createHnswRouter, HNSW_MAX_SAFE_PATTERNS } = await import('../../src/ruvector/ruvllm-wasm.js');
      const router = await createHnswRouter({ dimensions: 64, maxPatterns: 20 });
      // Add up to the limit
      for (let i = 0; i < HNSW_MAX_SAFE_PATTERNS; i++) {
        router.addPattern({ name: `p${i}`, embedding: new Float32Array(64) });
      }
      // Next should throw
      expect(() => router.addPattern({ name: 'overflow', embedding: new Float32Array(64) }))
        .toThrow(/pattern limit reached/);
    });

    it('should route queries', async () => {
      const { createHnswRouter } = await import('../../src/ruvector/ruvllm-wasm.js');
      const router = await createHnswRouter({ dimensions: 64, maxPatterns: 10 });
      const results = router.route(new Float32Array(64), 3);
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('test');
    });

    it('should clear patterns', async () => {
      const { createHnswRouter } = await import('../../src/ruvector/ruvllm-wasm.js');
      const router = await createHnswRouter({ dimensions: 64, maxPatterns: 10 });
      router.addPattern({ name: 'p1', embedding: new Float32Array(64) });
      expect(router.patternCount()).toBe(1);
      router.clear();
      expect(router.patternCount()).toBe(0);
    });
  });

  describe('createSonaInstant', () => {
    it('should create with default config', async () => {
      const { createSonaInstant } = await import('../../src/ruvector/ruvllm-wasm.js');
      const sona = await createSonaInstant();
      expect(sona).toBeDefined();
      expect(sona.adapt).toBeTypeOf('function');
    });

    it('should adapt with quality signal', async () => {
      const { createSonaInstant } = await import('../../src/ruvector/ruvllm-wasm.js');
      const sona = await createSonaInstant({ hiddenDim: 32 });
      sona.adapt(0.85);
      expect(mockSonaInstant.instantAdapt).toHaveBeenCalledWith(0.85);
    });

    it('should record patterns', async () => {
      const { createSonaInstant } = await import('../../src/ruvector/ruvllm-wasm.js');
      const sona = await createSonaInstant();
      sona.recordPattern([0.1, 0.2, 0.3], true);
      expect(mockSonaInstant.recordPattern).toHaveBeenCalledWith([0.1, 0.2, 0.3], true);
    });

    it('should suggest actions', async () => {
      const { createSonaInstant } = await import('../../src/ruvector/ruvllm-wasm.js');
      const sona = await createSonaInstant();
      const action = sona.suggestAction('test context');
      expect(action).toBe('optimize');
    });

    it('should return stats as JSON', async () => {
      const { createSonaInstant } = await import('../../src/ruvector/ruvllm-wasm.js');
      const sona = await createSonaInstant();
      const stats = sona.stats();
      expect(stats).toBe('{"adaptations":1}');
    });
  });

  describe('createMicroLora', () => {
    it('should create with config', async () => {
      const { createMicroLora } = await import('../../src/ruvector/ruvllm-wasm.js');
      const lora = await createMicroLora({ inputDim: 64, outputDim: 32, rank: 2 });
      expect(lora).toBeDefined();
    });

    it('should apply transform', async () => {
      const { createMicroLora } = await import('../../src/ruvector/ruvllm-wasm.js');
      const lora = await createMicroLora({ inputDim: 64, outputDim: 32 });
      const input = new Float32Array(64);
      const output = lora.apply(input);
      expect(mockLora.apply).toHaveBeenCalledWith(input);
      expect(output).toBeInstanceOf(Float32Array);
    });

    it('should adapt with feedback', async () => {
      const { createMicroLora } = await import('../../src/ruvector/ruvllm-wasm.js');
      const lora = await createMicroLora({ inputDim: 64, outputDim: 32 });
      lora.adapt(0.9, 0.01, true);
      expect(mockLora.adapt).toHaveBeenCalled();
    });

    it('should report pending updates', async () => {
      const { createMicroLora } = await import('../../src/ruvector/ruvllm-wasm.js');
      const lora = await createMicroLora({ inputDim: 64, outputDim: 32 });
      expect(lora.pendingUpdates()).toBe(0);
    });
  });

  describe('formatChat', () => {
    it('should format with preset template', async () => {
      const { formatChat } = await import('../../src/ruvector/ruvllm-wasm.js');
      const result = await formatChat(
        [{ role: 'system', content: 'You are helpful.' }, { role: 'user', content: 'Hi' }],
        'llama3',
      );
      expect(result).toBe('<formatted>');
    });

    it('should format with model ID auto-detection', async () => {
      const { formatChat } = await import('../../src/ruvector/ruvllm-wasm.js');
      const result = await formatChat(
        [{ role: 'user', content: 'Hello' }],
        { modelId: 'meta-llama/Llama-3-8B' },
      );
      expect(result).toBe('<formatted>');
    });

    it('should format with custom template', async () => {
      const { formatChat } = await import('../../src/ruvector/ruvllm-wasm.js');
      const result = await formatChat(
        [{ role: 'user', content: 'Test' }],
        { custom: '{{role}}: {{content}}' },
      );
      expect(result).toBe('<formatted>');
    });

    it('should reject unknown preset', async () => {
      const { formatChat } = await import('../../src/ruvector/ruvllm-wasm.js');
      await expect(formatChat([{ role: 'user', content: 'Hi' }], 'unknown' as any))
        .rejects.toThrow(/Unknown template preset/);
    });
  });

  describe('createKvCache', () => {
    it('should create with defaults', async () => {
      const { createKvCache } = await import('../../src/ruvector/ruvllm-wasm.js');
      const cache = await createKvCache();
      expect(cache).toBeDefined();
      expect(cache.tokenCount()).toBe(0);
    });

    it('should create with config', async () => {
      const { createKvCache } = await import('../../src/ruvector/ruvllm-wasm.js');
      const cache = await createKvCache({ maxTokens: 4096, headDim: 128 });
      expect(cache).toBeDefined();
    });

    it('should append and clear', async () => {
      const { createKvCache } = await import('../../src/ruvector/ruvllm-wasm.js');
      const cache = await createKvCache();
      cache.append(new Float32Array(8), new Float32Array(8));
      expect(mockKvCache.append).toHaveBeenCalled();
      cache.clear();
      expect(mockKvCache.clear).toHaveBeenCalled();
    });
  });

  describe('createGenerateConfig', () => {
    it('should create config JSON', async () => {
      const { createGenerateConfig } = await import('../../src/ruvector/ruvllm-wasm.js');
      const config = await createGenerateConfig({ maxTokens: 100, temperature: 0.7 });
      expect(config).toContain('maxTokens');
    });

    it('should handle stop sequences', async () => {
      const { createGenerateConfig } = await import('../../src/ruvector/ruvllm-wasm.js');
      await createGenerateConfig({ stopSequences: ['<|end|>', '\n\n'] });
      expect(mockGenerateConfig.addStopSequence).toHaveBeenCalledTimes(2);
    });
  });

  describe('createBufferPool', () => {
    it('should create with capacity', async () => {
      const { createBufferPool } = await import('../../src/ruvector/ruvllm-wasm.js');
      const pool = await createBufferPool(1024);
      expect(pool).toBeDefined();
      expect(pool.hitRate()).toBe(0.95);
    });

    it('should prewarm buffers', async () => {
      const { createBufferPool } = await import('../../src/ruvector/ruvllm-wasm.js');
      const pool = await createBufferPool(1024);
      pool.prewarm(10);
      expect(mockBufferPool.prewarmAll).toHaveBeenCalledWith(10);
    });
  });

  describe('createInferenceArena', () => {
    it('should create with raw capacity', async () => {
      const { createInferenceArena } = await import('../../src/ruvector/ruvllm-wasm.js');
      const arena = await createInferenceArena({ capacity: 8192 });
      expect(arena).toBeDefined();
      expect(arena.capacity()).toBe(8192);
      expect(arena.remaining()).toBe(7168);
    });
  });

  describe('HNSW_MAX_SAFE_PATTERNS', () => {
    it('should be 1024', async () => {
      const { HNSW_MAX_SAFE_PATTERNS } = await import('../../src/ruvector/ruvllm-wasm.js');
      expect(HNSW_MAX_SAFE_PATTERNS).toBe(1024);
    });
  });
});
