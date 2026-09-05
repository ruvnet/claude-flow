/**
 * RuVector LLM WASM Integration
 *
 * Wraps @ruvector/ruvllm-wasm for browser-native LLM inference utilities.
 * Provides HNSW routing, SONA instant adaptation, MicroLoRA fine-tuning,
 * chat template formatting, KV cache management, and inference arena.
 *
 * Published API (v2.0.2): RuvLLMWasm, ChatTemplateWasm, ChatMessageWasm,
 * GenerateConfig, HnswRouterWasm, SonaInstantWasm, MicroLoraWasm,
 * KvCacheWasm, BufferPoolWasm, InferenceArenaWasm.
 *
 * v2.0.2 fixes:
 * - HNSW supports 1000+ patterns (fixed connect_node ordering)
 * - MicroLoRA adapt() now takes (input: Float32Array, feedback: AdaptFeedbackWasm)
 *
 * Remaining quirks:
 * - Stats objects return WASM pointers — use .toJson() or named accessors
 * - GenerateConfig float precision loss (f32 roundtrip)
 * - MicroLoRA apply() hardcoded to 768 dims regardless of config
 *
 * @module @claude-flow/cli/ruvector/ruvllm-wasm
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

// WASM binary requires at least 768-dim input for MicroLoRA adapt()
const MICROLORA_WASM_MIN_DIM = 768;

// ── Types ────────────────────────────────────────────────────

export interface HnswRouterConfig {
  dimensions: number;
  maxPatterns: number;
  efSearch?: number;
}

export interface HnswPattern {
  name: string;
  embedding: Float32Array;
  metadata?: Record<string, unknown>;
}

export interface HnswRouteResult {
  name: string;
  score: number;
  metadata?: Record<string, unknown>;
}

export interface SonaConfig {
  hiddenDim?: number;
  learningRate?: number;
  emaDecay?: number;
  ewcLambda?: number;
  microLoraRank?: number;
  patternCapacity?: number;
}

export interface MicroLoraConfig {
  inputDim: number;
  outputDim: number;
  rank?: number;
  alpha?: number;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GenerateOptions {
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  repetitionPenalty?: number;
  stopSequences?: string[];
}

export interface RuvllmStatus {
  available: boolean;
  initialized: boolean;
  version: string | null;
}

// ── WASM Module Detection & Init ─────────────────────────────

let _wasmReady = false;

/**
 * Check if @ruvector/ruvllm-wasm is installed and loadable.
 */
export async function isRuvllmWasmAvailable(): Promise<boolean> {
  try {
    const mod = await import('@ruvector/ruvllm-wasm');
    return typeof mod.RuvLLMWasm === 'function';
  } catch {
    return false;
  }
}

/**
 * Initialize the WASM module for Node.js. Safe to call multiple times.
 * Uses initSync with object form: { module: bytes } (raw bytes deprecated).
 */
export async function initRuvllmWasm(): Promise<void> {
  if (_wasmReady) return;
  try {
    const mod = await import('@ruvector/ruvllm-wasm');
    const require_ = createRequire(import.meta.url);
    const wasmPath = require_.resolve('@ruvector/ruvllm-wasm/ruvllm_wasm_bg.wasm');
    const wasmBytes = readFileSync(wasmPath);
    // MUST use object form — initSync(bytes) is deprecated
    mod.initSync({ module: wasmBytes });
    _wasmReady = true;
  } catch (err) {
    throw new Error(`Failed to initialize @ruvector/ruvllm-wasm: ${err}`);
  }
}

/**
 * Get ruvllm-wasm status.
 */
export async function getRuvllmStatus(): Promise<RuvllmStatus> {
  const available = await isRuvllmWasmAvailable();
  if (!available) {
    return { available: false, initialized: false, version: null };
  }
  try {
    const mod = await import('@ruvector/ruvllm-wasm');
    // version is a standalone function, not on RuvLLMWasm class
    const version = typeof mod.getVersion === 'function' ? mod.getVersion() : null;
    return { available: true, initialized: _wasmReady, version };
  } catch {
    return { available: true, initialized: _wasmReady, version: null };
  }
}

// ── HNSW Router ──────────────────────────────────────────────

/**
 * Maximum safe pattern count for HNSW router.
 * v2.0.2 supports 1000+ patterns (fixed connect_node ordering).
 */
export const HNSW_MAX_SAFE_PATTERNS = 1024;

/**
 * Create a WASM HNSW router for semantic routing.
 * Returns an object with add/route/clear methods.
 *
 * Enforces HNSW_MAX_SAFE_PATTERNS limit (1024 in v2.0.2).
 */
export async function createHnswRouter(config: HnswRouterConfig): Promise<{
  addPattern: (pattern: HnswPattern) => boolean;
  route: (query: Float32Array, k?: number) => HnswRouteResult[];
  clear: () => void;
  patternCount: () => number;
  toJson: () => string;
}> {
  await initRuvllmWasm();
  const mod = await import('@ruvector/ruvllm-wasm');

  const router = new mod.HnswRouterWasm(config.dimensions, config.maxPatterns);
  if (config.efSearch) {
    router.setEfSearch(config.efSearch);
  }

  let count = 0;

  return {
    addPattern(pattern: HnswPattern): boolean {
      if (count >= HNSW_MAX_SAFE_PATTERNS) {
        throw new Error(
          `HNSW pattern limit reached (${HNSW_MAX_SAFE_PATTERNS}).`
        );
      }
      const metadataJson = JSON.stringify(pattern.metadata ?? {});
      // addPattern requires 3 args: (embedding, name, metadata_json)
      const ok = router.addPattern(pattern.embedding, pattern.name, metadataJson);
      if (ok) count++;
      return ok;
    },
    route(query: Float32Array, k = 3): HnswRouteResult[] {
      const raw = router.route(query, k);
      return Array.from(raw).map((r: any) => ({
        name: r.name ?? r.pattern_name ?? '',
        score: r.score ?? r.distance ?? 0,
        metadata: r.metadata ? (typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata) : undefined,
      }));
    },
    clear(): void {
      router.clear();
      count = 0;
    },
    patternCount(): number {
      return count;
    },
    toJson(): string {
      return router.toJson();
    },
  };
}

// ── SONA Instant Adaptation ──────────────────────────────────

/**
 * Create a SONA instant adaptation loop (<1ms adaptation).
 * v2.0.1: requires SonaConfigWasm object, not raw number.
 */
export async function createSonaInstant(config: SonaConfig = {}): Promise<{
  adapt: (quality: number) => void;
  recordPattern: (embedding: number[], success: boolean) => void;
  suggestAction: (context: string) => string | undefined;
  stats: () => string;
  reset: () => void;
  toJson: () => string;
}> {
  await initRuvllmWasm();
  const mod = await import('@ruvector/ruvllm-wasm');

  const sonaConfig = new mod.SonaConfigWasm();
  if (config.hiddenDim !== undefined) sonaConfig.hiddenDim = config.hiddenDim;
  if (config.learningRate !== undefined) sonaConfig.learningRate = config.learningRate;
  if (config.emaDecay !== undefined) sonaConfig.emaDecay = config.emaDecay;
  if (config.ewcLambda !== undefined) sonaConfig.ewcLambda = config.ewcLambda;
  if (config.microLoraRank !== undefined) sonaConfig.microLoraRank = config.microLoraRank;
  if (config.patternCapacity !== undefined) sonaConfig.patternCapacity = config.patternCapacity;

  const sona = new mod.SonaInstantWasm(sonaConfig);

  return {
    adapt(quality: number): void {
      sona.instantAdapt(quality);
    },
    recordPattern(embedding: number[], success: boolean): void {
      sona.recordPattern(embedding, success);
    },
    suggestAction(context: string): string | undefined {
      return sona.suggestAction(context);
    },
    stats(): string {
      return sona.toJson();
    },
    reset(): void {
      sona.reset();
    },
    toJson(): string {
      return sona.toJson();
    },
  };
}

// ── MicroLoRA ────────────────────────────────────────────────

/**
 * Create a MicroLoRA adapter (ultra-lightweight LoRA, ranks 1-4).
 * v2.0.2: .adapt(input, feedback) takes Float32Array + AdaptFeedbackWasm.
 */
export async function createMicroLora(config: MicroLoraConfig): Promise<{
  apply: (input: Float32Array) => Float32Array;
  adapt: (quality: number, learningRate?: number, success?: boolean) => void;
  applyUpdates: (learningRate?: number) => void;
  stats: () => string;
  reset: () => void;
  toJson: () => string;
  pendingUpdates: () => number;
}> {
  await initRuvllmWasm();
  const mod = await import('@ruvector/ruvllm-wasm');

  const loraConfig = new mod.MicroLoraConfigWasm();
  loraConfig.inputDim = config.inputDim;
  loraConfig.outputDim = config.outputDim;
  loraConfig.rank = config.rank ?? 2;
  loraConfig.alpha = config.alpha ?? 1.0;

  const lora = new mod.MicroLoraWasm(loraConfig);

  return {
    apply(input: Float32Array): Float32Array {
      return lora.apply(input);
    },
    adapt(quality: number, learningRate = 0.01, success = true): void {
      const feedback = new mod.AdaptFeedbackWasm();
      feedback.quality = quality;
      feedback.learningRate = learningRate;
      try { (feedback as any).success = success; } catch { /* v2.0.2 quirk */ }
      const input = new Float32Array(Math.max(config.inputDim, MICROLORA_WASM_MIN_DIM));
      lora.adapt(input, feedback);
      // Flush accumulated gradients. HONEST CAVEAT (audit
      // docs/reviews/intelligence-system-audit-2026-05-29.md): even WITH this
      // flush, the shipped @ruvector/ruvllm-wasm@2.0.2 MicroLoraWasm.apply()
      // output is empirically UNCHANGED (measured maxAbsDelta = 0 after 200
      // adapts). MicroLoRA adaptation is therefore effectively a no-op on
      // inference with this WASM backend. We do NOT synthesize a fake gradient
      // from the scalar quality to make output "move" — that would be a
      // fabricated signal. Real adaptation needs the WASM backend to flush B,
      // or a caller supplying real gradients.
      lora.applyUpdates(learningRate as unknown as Float32Array);
    },
    applyUpdates(learningRate = 0.01): void {
      // WASM runtime signature is applyUpdates(learning_rate: number); the
      // shipped .d.ts mistypes it as Float32Array, hence the cast.
      lora.applyUpdates(learningRate as unknown as Float32Array);
    },
    stats(): string {
      return lora.toJson();
    },
    reset(): void {
      lora.reset();
    },
    toJson(): string {
      return lora.toJson();
    },
    pendingUpdates(): number {
      return lora.pendingUpdates();
    },
  };
}

// ── Chat Template Formatting ─────────────────────────────────

type TemplatePreset = 'llama3' | 'mistral' | 'chatml' | 'phi' | 'gemma';

/**
 * Format chat messages using a chat template.
 * Supports presets (llama3, mistral, chatml, phi, gemma) and auto-detection.
 */
export async function formatChat(
  messages: ChatMessage[],
  template: TemplatePreset | { custom: string } | { modelId: string },
): Promise<string> {
  await initRuvllmWasm();
  const mod = await import('@ruvector/ruvllm-wasm');

  // Build template
  let tmpl: any;
  if (typeof template === 'string') {
    const presets: Record<string, () => any> = {
      llama3: () => mod.ChatTemplateWasm.llama3(),
      mistral: () => mod.ChatTemplateWasm.mistral(),
      chatml: () => mod.ChatTemplateWasm.chatml(),
      phi: () => mod.ChatTemplateWasm.phi(),
      gemma: () => mod.ChatTemplateWasm.gemma(),
    };
    const factory = presets[template];
    if (!factory) throw new Error(`Unknown template preset: ${template}. Use: ${Object.keys(presets).join(', ')}`);
    tmpl = factory();
  } else if ('custom' in template) {
    tmpl = mod.ChatTemplateWasm.custom(template.custom);
  } else if ('modelId' in template) {
    tmpl = mod.ChatTemplateWasm.detectFromModelId(template.modelId);
  }

  // Build messages
  const wasmMessages = messages.map(m => {
    switch (m.role) {
      case 'system': return mod.ChatMessageWasm.system(m.content);
      case 'user': return mod.ChatMessageWasm.user(m.content);
      case 'assistant': return mod.ChatMessageWasm.assistant(m.content);
      default: throw new Error(`Unknown role: ${m.role}`);
    }
  });

  return tmpl.format(wasmMessages);
}

// ── KV Cache ─────────────────────────────────────────────────

/**
 * Create a KV cache for token management.
 */
export async function createKvCache(opts?: {
  tailLength?: number;
  maxTokens?: number;
  numKvHeads?: number;
  headDim?: number;
}): Promise<{
  append: (keys: Float32Array, values: Float32Array) => void;
  stats: () => string;
  clear: () => void;
  tokenCount: () => number;
}> {
  await initRuvllmWasm();
  const mod = await import('@ruvector/ruvllm-wasm');

  let cache: any;
  if (opts) {
    const config = new mod.KvCacheConfigWasm();
    if (opts.tailLength !== undefined) config.tailLength = opts.tailLength;
    if (opts.maxTokens !== undefined) config.maxTokens = opts.maxTokens;
    if (opts.numKvHeads !== undefined) config.numKvHeads = opts.numKvHeads;
    if (opts.headDim !== undefined) config.headDim = opts.headDim;
    cache = new mod.KvCacheWasm(config);
  } else {
    cache = mod.KvCacheWasm.withDefaults();
  }

  return {
    append(keys: Float32Array, values: Float32Array): void {
      cache.append(keys, values);
    },
    stats(): string {
      // Use toJson if available, otherwise stringify
      try { return JSON.stringify(cache.stats()); } catch { return '{}'; }
    },
    clear(): void {
      cache.clear();
    },
    tokenCount(): number {
      return cache.tokenCount;
    },
  };
}

// ── Generate Config ──────────────────────────────────────────

/**
 * Create a generation config object.
 * Note: f32 precision loss is expected (0.7 → 0.699999...).
 */
export async function createGenerateConfig(opts: GenerateOptions = {}): Promise<string> {
  await initRuvllmWasm();
  const mod = await import('@ruvector/ruvllm-wasm');

  const config = new mod.GenerateConfig();
  if (opts.maxTokens !== undefined) config.maxTokens = opts.maxTokens;
  if (opts.temperature !== undefined) config.temperature = opts.temperature;
  if (opts.topP !== undefined) config.topP = opts.topP;
  if (opts.topK !== undefined) config.topK = opts.topK;
  if (opts.repetitionPenalty !== undefined) config.repetitionPenalty = opts.repetitionPenalty;
  for (const seq of opts.stopSequences ?? []) {
    config.addStopSequence(seq);
  }

  return config.toJson();
}

// ── Buffer Pool ──────────────────────────────────────────────

/**
 * Create a buffer pool for inference memory management.
 */
export async function createBufferPool(capacity: number): Promise<{
  prewarm: (count: number) => void;
  stats: () => string;
  hitRate: () => number;
  clear: () => void;
}> {
  await initRuvllmWasm();
  const mod = await import('@ruvector/ruvllm-wasm');

  const pool = mod.BufferPoolWasm.withCapacity(capacity);

  return {
    prewarm(count: number): void {
      pool.prewarmAll(count);
    },
    stats(): string {
      return pool.statsJson();
    },
    hitRate(): number {
      return pool.hitRate;
    },
    clear(): void {
      pool.clear();
    },
  };
}

// ── Inference Arena ──────────────────────────────────────────

/**
 * Create an inference arena for model memory allocation.
 */
export async function createInferenceArena(
  opts: { capacity: number } | { hiddenDim: number; vocabSize: number; batchSize: number },
): Promise<{
  reset: () => void;
  used: () => number;
  capacity: () => number;
  remaining: () => number;
}> {
  await initRuvllmWasm();
  const mod = await import('@ruvector/ruvllm-wasm');

  const arena = 'capacity' in opts
    ? new mod.InferenceArenaWasm(opts.capacity)
    : mod.InferenceArenaWasm.forModel(opts.hiddenDim, opts.vocabSize, opts.batchSize);

  return {
    reset(): void { arena.reset(); },
    used(): number { return arena.used; },
    capacity(): number { return arena.capacity; },
    remaining(): number { return arena.remaining; },
  };
}
