/**
 * Ambient type declarations for optional runtime-imported modules.
 *
 * These modules are dynamically imported at runtime and may or may not
 * be installed. They are NOT bundled — users install them as needed.
 * Declaring them here prevents TS2307 in strict pnpm CI builds where
 * hoisted node_modules are not available.
 */

declare module 'pg' {
  const pg: any;
  export default pg;
  export const Pool: any;
  export const Client: any;
}

declare module 'sql.js' {
  const initSqlJs: any;
  export default initSqlJs;
}

// #2737 — native, WAL-aware SQLite bindings. Optional: doctor's default-run
// structural check and the strengthened `--component memory` integrity
// check both prefer this over sql.js when it's installed, falling back to
// sql.js (main-image-only / WAL-blind) when it's not.
declare module 'better-sqlite3' {
  interface DatabaseOptions {
    readonly?: boolean;
    fileMustExist?: boolean;
    timeout?: number;
    verbose?: (message?: unknown, ...additionalArgs: unknown[]) => void;
  }
  class Database {
    constructor(filename: string, options?: DatabaseOptions);
    pragma(source: string, options?: { simple?: boolean }): any;
    close(): void;
    readonly open: boolean;
  }
  export default Database;
}

declare module 'agentic-flow' {
  export const reasoningbank: any;
}

declare module 'agentic-flow/reasoningbank' {
  export const VERSION: string;
  export const PAPER_URL: string;
  export class ReflexionMemory { constructor(...args: any[]); }
  export class SkillLibrary { constructor(...args: any[]); }
  export class CausalMemoryGraph { constructor(...args: any[]); }
  export class HybridReasoningBank { constructor(...args: any[]); }
  export class AdvancedMemorySystem { constructor(...args: any[]); }
  export class EmbeddingService { constructor(...args: any[]); }
  export class NightlyLearner { constructor(...args: any[]); }
  export function initialize(...args: any[]): Promise<any>;
  export function retrieveMemories(query: string, opts?: any): Promise<any[]>;
  export function formatMemoriesForPrompt(memories: any[]): string;
  export function judgeTrajectory(...args: any[]): any;
  export function distillMemories(...args: any[]): any;
  export function consolidate(...args: any[]): any;
  export function shouldConsolidate(...args: any[]): boolean;
  export function computeEmbedding(text: string): Promise<number[]>;
  export function cosineSimilarity(a: number[], b: number[]): number;
  export function clearEmbeddingCache(): void;
  export function containsPII(text: string): boolean;
  export function scrubPII(text: string): string;
  export function scrubMemory(text: string): string;
  export function mmrSelection(items: any[], query: any, opts?: any): any[];
  export function runTask(...args: any[]): Promise<any>;
  export function loadConfig(): any;
  export const db: any;
  export function CausalRecall(...args: any[]): any;
  export function mattsParallel(...args: any[]): any;
  export function mattsSequential(...args: any[]): any;
}

declare module 'agentic-flow/router' {
  export class ModelRouter { constructor(...args: any[]); route(prompt: string, opts?: any): Promise<any>; getStats(): any; }
  export class AnthropicProvider { constructor(...args: any[]); }
  export class GeminiProvider { constructor(...args: any[]); }
  export class OpenRouterProvider { constructor(...args: any[]); }
  export class ONNXLocalProvider { constructor(...args: any[]); }
  export const CLAUDE_MODELS: any;
  export function getModelName(id: string): string;
  export function listModels(): any[];
  export function mapModelId(id: string): string;
}

declare module 'agentic-flow/orchestration' {
  export function createOrchestrator(...args: any[]): any;
  export function createOrchestrationClient(...args: any[]): any;
  export function seedMemory(...args: any[]): Promise<any>;
  export function searchMemory(...args: any[]): Promise<any>;
  export function harvestMemory(...args: any[]): Promise<any>;
  export function recordLearning(...args: any[]): Promise<any>;
  export function getRunStatus(id: string): Promise<any>;
  export function getRunArtifacts(id: string): Promise<any>;
  export function cancelRun(id: string): Promise<any>;
}

declare module 'agentic-flow/agent-booster' {
  export class EnhancedAgentBooster { constructor(...args: any[]); }
  export function getEnhancedBooster(...args: any[]): any;
  export function enhancedApply(opts: { code: string; edit: string; language?: string }): Promise<{ confidence: number; output: string }>;
  export function benchmark(...args: any[]): Promise<any>;
}

declare module 'agentic-flow/intelligence/agent-booster-enhanced' {
  export class EnhancedAgentBooster { constructor(...args: any[]); }
  export function getEnhancedBooster(...args: any[]): any;
  export function enhancedApply(opts: { code: string; edit: string; language?: string }): Promise<{ confidence: number; output: string }>;
  export function benchmark(...args: any[]): Promise<any>;
}

declare module 'agentic-flow/sdk' {
  const sdk: any;
  export default sdk;
}

declare module 'agentic-flow/security' {
  const security: any;
  export default security;
}

declare module 'agentic-flow/transport/quic' {
  const quic: any;
  export default quic;
}

declare module 'ruvector' {
  const ruvector: any;
  export default ruvector;
  export const VectorDB: any;
  export const VectorDb: any;
  export function isWasm(): boolean;

  // ONNX Embedder (ruvector >= 0.2.15, bundled MiniLM-L6-v2)
  export function initOnnxEmbedder(): Promise<void>;
  export function isOnnxAvailable(): boolean;
  export function getOptimizedOnnxEmbedder(): OptimizedOnnxEmbedder | null;

  export interface OptimizedOnnxEmbedder {
    embed(text: string): Promise<number[]>;
    embedBatch(texts: string[]): Promise<number[][]>;
    isReady(): boolean;
    getDimension(): number;
    similarity(a: number[], b: number[]): number;
  }

  // AdaptiveEmbedder (ruvector >= 0.2.16, LoRA B=0 fix — identity when untrained)
  export class AdaptiveEmbedder {
    constructor(options?: { useEpisodic?: boolean });
    embed(text: string): Promise<number[]>;
    embedBatch(texts: string[]): Promise<number[][]>;
    isReady(): boolean;
    getDimension(): number;
    similarity(a: number[], b: number[]): number;
    adapt(quality: number): void;
  }
}

declare module '@ruvector/core' {
  const core: any;
  export default core;
}

declare module '@ruvector/rvagent-wasm' {
  /** Initialize the WASM module (browser — uses fetch for .wasm file). */
  export default function init(): Promise<void>;

  /** Initialize the WASM module synchronously (Node.js — pass bytes from fs). */
  export function initSync(bytes: BufferSource): void;

  /** Browser/Node sandboxed AI agent with virtual filesystem. */
  export class WasmAgent {
    constructor(config_json: string);
    prompt(input: string): Promise<string>;
    set_model_provider(callback: Function): void;
    reset(): void;
    free(): void;
    get_state(): unknown;
    get_todos(): unknown[];
    get_tools(): string[];
    execute_tool(tool_json: string): Promise<{ success: boolean; output: string }>;
    model(): string;
    name(): string | undefined;
    turn_count(): number;
    file_count(): number;
    is_stopped(): boolean;
  }

  /** JavaScript model provider callback wrapper. */
  export class JsModelProvider {
    constructor(callback: Function);
  }

  /** JSON-RPC 2.0 MCP server in WASM. */
  export class WasmMcpServer {
    constructor(agent: WasmAgent);
    handle_request(json_rpc: string): Promise<string>;
    free(): void;
  }

  /** Pre-built agent template gallery (6 templates). */
  export class WasmGallery {
    constructor();
    list(): Array<{
      id: string; name: string; description: string;
      category: string; tags: string[]; version: string;
      author: string; builtin: boolean;
    }>;
    get(id: string): unknown | undefined;
    search(query: string): Array<{
      id: string; name: string; description: string;
      category: string; tags: string[]; relevance: number;
    }>;
    count(): number;
    getCategories(): Record<string, number>;
    listByCategory(category: string): unknown[];
    addCustom(json: string): boolean;
    removeCustom(id: string): boolean;
    exportCustom(): string;
    importCustom(json: string): boolean;
    configure(json: string): boolean;
    getConfig(): unknown;
    setActive(id: string): boolean;
    getActive(): unknown | undefined;
    loadRvf(data: Uint8Array): boolean;
    free(): void;
  }

  /** RVF binary container builder. */
  export class WasmRvfBuilder {
    constructor();
    addPrompt(json: string): void;
    addPrompts(json: string): void;
    addTool(json: string): void;
    addTools(json: string): void;
    addSkill(json: string): void;
    addSkills(json: string): void;
    addCapabilities(json: string): void;
    addMcpTools(json: string): void;
    setOrchestrator(json: string): void;
    build(): Uint8Array;
    free(): void;
  }
}

declare module '@ruvector/ruvllm-wasm' {
  export default function init(): Promise<void>;

  /** Initialize WASM synchronously (Node.js). Must use object form: initSync({ module: bytes }) */
  export function initSync(opts: { module: BufferSource }): void;

  export class RuvLLMWasm {
    constructor();
    initialize(): void;
    initializeWithConfig(config: KvCacheConfigWasm): void;
    isInitialized: boolean;
    getPoolStats(): string;
    reset(): void;
    // NOTE: version() is NOT on RuvLLMWasm — use standalone getVersion()
  }
  export class ChatMessageWasm {
    static system(content: string): ChatMessageWasm;
    static user(content: string): ChatMessageWasm;
    static assistant(content: string): ChatMessageWasm;
    role: string;
    content: string;
  }
  export class ChatTemplateWasm {
    static llama3(): ChatTemplateWasm;
    static mistral(): ChatTemplateWasm;
    static chatml(): ChatTemplateWasm;
    static phi(): ChatTemplateWasm;
    static gemma(): ChatTemplateWasm;
    static custom(template: string): ChatTemplateWasm;
    static detectFromModelId(model_id: string): ChatTemplateWasm;
    format(messages: ChatMessageWasm[]): string;
    name: string;
  }
  export class GenerateConfig {
    constructor();
    maxTokens: number;
    temperature: number;
    topP: number;
    topK: number;
    repetitionPenalty: number;
    addStopSequence(seq: string): void;
    clearStopSequences(): void;
    toJson(): string;
    static fromJson(json: string): GenerateConfig;
  }
  export class HnswRouterWasm {
    constructor(dimensions: number, max_patterns: number);
    /** Requires 3 args: (embedding, name, metadata_json). Panics at ~12+ patterns in v2.0.1. */
    addPattern(embedding: Float32Array, name: string, metadata: string): boolean;
    route(query: Float32Array, k: number): any[];
    setEfSearch(ef: number): void;
    clear(): void;
    toJson(): string;
    static fromJson(json: string): HnswRouterWasm;
    dimensions: number;
  }
  /** Configuration for SonaInstantWasm. Required since v2.0.1 (replaces raw number). */
  export class SonaConfigWasm {
    constructor();
    hiddenDim: number;
    learningRate: number;
    emaDecay: number;
    ewcLambda: number;
    microLoraRank: number;
    patternCapacity: number;
    toJson(): string;
  }
  export class SonaInstantWasm {
    /** v2.0.1: requires SonaConfigWasm, not raw number */
    constructor(config: SonaConfigWasm);
    instantAdapt(quality: number): void;
    recordPattern(embedding: number[], success: boolean): void;
    suggestAction(context: string): string | undefined;
    stats(): any;
    toJson(): string;
    static fromJson(json: string): SonaInstantWasm;
    reset(): void;
  }
  export class KvCacheConfigWasm {
    constructor();
    tailLength: number;
    maxTokens: number;
    numKvHeads: number;
    headDim: number;
  }
  export class KvCacheWasm {
    constructor(config: KvCacheConfigWasm);
    static withDefaults(): KvCacheWasm;
    append(keys: Float32Array, values: Float32Array): void;
    stats(): any;
    clear(): void;
    tokenCount: number;
  }
  /** Configuration for MicroLoraWasm. */
  export class MicroLoraConfigWasm {
    constructor();
    inputDim: number;
    outputDim: number;
    rank: number;
    alpha: number;
  }
  /** Feedback for MicroLoraWasm.adapt(). */
  export class AdaptFeedbackWasm {
    constructor();
    quality: number;
    learningRate: number;
    success: boolean;
  }
  export class MicroLoraWasm {
    constructor(config: MicroLoraConfigWasm);
    /** Transform input through LoRA adapter */
    apply(input: Float32Array): Float32Array;
    /** Adapt weights — v2.0.2: takes (input, feedback), v2.0.1: takes (feedback) */
    adapt(input: Float32Array, feedback: AdaptFeedbackWasm): void;
    adapt(feedback: AdaptFeedbackWasm): void;
    applyUpdates(gradients: Float32Array): void;
    stats(): any;
    reset(): void;
    toJson(): string;
    getConfig(): MicroLoraConfigWasm;
    pendingUpdates(): number;
  }
  export class InferenceArenaWasm {
    constructor(capacity: number);
    static forModel(hidden_dim: number, vocab_size: number, batch_size: number): InferenceArenaWasm;
    reset(): void;
    used: number;
    capacity: number;
    remaining: number;
  }
  export class BufferPoolWasm {
    constructor();
    static withCapacity(max: number): BufferPoolWasm;
    prewarmAll(count: number): void;
    statsJson(): string;
    hitRate: number;
    clear(): void;
  }
  export function getVersion(): string;
  export function isReady(): boolean;
  export function detectChatTemplate(model_id: string): ChatTemplateWasm;
}

declare module '@xenova/transformers' {
  const transformers: any;
  export default transformers;
  export const pipeline: any;
  export const env: any;
}

// Optional @claude-flow sibling packages (installed separately)
// Using permissive `any` types since these are runtime-resolved optional deps
declare module '@claude-flow/embeddings' {
  const mod: any;
  export default mod;
  export const createEmbeddingService: any;
  export const EmbeddingService: any;
  export const embed: any;
  export const embedBatch: any;
  export const search: any;
  export const init: any;
  export const downloadEmbeddingModel: any;
  export const listEmbeddingModels: any;
  export const chunkText: any;
  export const euclideanToPoincare: any;
  export const hyperbolicDistance: any;
  export const hyperbolicCentroid: any;
}

declare module '@claude-flow/guidance/compiler' {
  export const GuidanceCompiler: any;
  export const compile: any;
  export const compilePolicy: any;
}

declare module '@claude-flow/guidance/retriever' {
  export const ShardRetriever: any;
  export const HashEmbeddingProvider: any;
  export const retrieve: any;
}

declare module '@claude-flow/guidance/gates' {
  export const EnforcementGates: any;
  export const enforce: any;
}

declare module '@claude-flow/guidance/analyzer' {
  export const formatReport: any;
  export const optimizeForSize: any;
  export const formatBenchmark: any;
  export const abBenchmark: any;
  export const getDefaultABTasks: any;
  export const analyze: any;
}

declare module '@claude-flow/aidefence' {
  export const createAIDefence: any;
  export const scan: any;
  export const analyze: any;
  export const isSafe: any;
  export const isSecure: any;
  export class AIDefence { constructor(...args: any[]); }
}

declare module '@claude-flow/mcp' {
  export const createMCPServer: any;
  export const startMCPServer: any;
  export class MCPServer { constructor(...args: any[]); }
}
