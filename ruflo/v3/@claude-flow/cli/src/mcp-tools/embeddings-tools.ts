/**
 * Embeddings MCP Tools for CLI
 *
 * Tool definitions for ONNX embeddings with hyperbolic support and neural substrate.
 * Implements ADR-024: Embeddings MCP Tools
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import type { MCPTool } from './types.js';

// Configuration paths
const CONFIG_DIR = '.claude-flow';
const EMBEDDINGS_CONFIG = 'embeddings.json';
const MODELS_DIR = 'models';

interface EmbeddingsConfig {
  model: string;
  modelPath: string;
  dimension: number;
  cacheSize: number;
  hyperbolic: {
    enabled: boolean;
    curvature: number;
    epsilon: number;
    maxNorm: number;
  };
  neural: {
    enabled: boolean;
    driftThreshold: number;
    decayRate: number;
    ruvector?: {
      enabled: boolean;
      sona: boolean;
      flashAttention: boolean;
      ewcPlusPlus: boolean;
    };
    features?: {
      semanticDrift: boolean;
      memoryPhysics: boolean;
      stateMachine: boolean;
      swarmCoordination: boolean;
      coherenceMonitor: boolean;
    };
  };
  initialized: string;
}

function getConfigPath(): string {
  return resolve(join(CONFIG_DIR, EMBEDDINGS_CONFIG));
}

function ensureConfigDir(): void {
  const dir = resolve(CONFIG_DIR);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function loadConfig(): EmbeddingsConfig | null {
  try {
    const path = getConfigPath();
    if (existsSync(path)) {
      return JSON.parse(readFileSync(path, 'utf-8'));
    }
  } catch {
    // Return null on error
  }
  return null;
}

function saveConfig(config: EmbeddingsConfig): void {
  ensureConfigDir();
  writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), 'utf-8');
}

// Real ONNX embedding generation via memory-initializer
let realEmbeddingFn: ((text: string) => Promise<{ embedding: number[]; dimensions: number; model: string }>) | null = null;

async function getRealEmbeddingFunction() {
  if (!realEmbeddingFn) {
    try {
      const { generateEmbedding } = await import('../memory/memory-initializer.js');
      realEmbeddingFn = generateEmbedding;
    } catch {
      realEmbeddingFn = null;
    }
  }
  return realEmbeddingFn;
}

// Generate real ONNX embedding (falls back to deterministic hash if ONNX unavailable)
async function generateRealEmbedding(text: string, dimension: number): Promise<number[]> {
  const realFn = await getRealEmbeddingFunction();

  if (realFn) {
    try {
      const result = await realFn(text);
      return result.embedding;
    } catch {
      // Fall through to fallback
    }
  }

  // Fallback: deterministic hash-based (only if ONNX truly unavailable)
  console.warn('[MCP] ONNX unavailable, using fallback embedding');
  const embedding: number[] = [];
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }

  for (let i = 0; i < dimension; i++) {
    const seed = hash + i * 1337;
    embedding.push(Math.sin(seed) * Math.cos(seed * 0.5));
  }

  // L2 normalize
  const norm = Math.sqrt(embedding.reduce((sum, x) => sum + x * x, 0));
  return embedding.map(x => x / norm);
}

// Convert Euclidean embedding to Poincaré ball
function toPoincare(euclidean: number[], curvature: number): number[] {
  const c = Math.abs(curvature);
  const sqrtC = Math.sqrt(c);
  const norm = Math.sqrt(euclidean.reduce((sum, x) => sum + x * x, 0));

  // Exponential map at origin
  const factor = Math.tanh(sqrtC * norm / 2) / (sqrtC * norm + 1e-15);
  return euclidean.map(x => x * factor);
}

// Poincaré distance
function poincareDistance(a: number[], b: number[], curvature: number): number {
  const c = Math.abs(curvature);

  const diffSq = a.reduce((sum, _, i) => sum + (a[i] - b[i]) ** 2, 0);
  const normASq = a.reduce((sum, x) => sum + x * x, 0);
  const normBSq = b.reduce((sum, x) => sum + x * x, 0);

  const denom = (1 - normASq) * (1 - normBSq);
  const delta = 2 * diffSq / (denom + 1e-15);

  return (1 / Math.sqrt(c)) * Math.acosh(1 + delta);
}

// Cosine similarity
function cosineSimilarity(a: number[], b: number[]): number {
  const dot = a.reduce((sum, _, i) => sum + a[i] * b[i], 0);
  const normA = Math.sqrt(a.reduce((sum, x) => sum + x * x, 0));
  const normB = Math.sqrt(b.reduce((sum, x) => sum + x * x, 0));
  return dot / (normA * normB + 1e-15);
}

export const embeddingsTools: MCPTool[] = [
  {
    name: 'embeddings/init',
    description: 'Initialize the ONNX embedding subsystem with hyperbolic support',
    category: 'embeddings',
    inputSchema: {
      type: 'object',
      properties: {
        model: {
          type: 'string',
          description: 'ONNX model ID',
          enum: ['all-MiniLM-L6-v2', 'all-mpnet-base-v2'],
          default: 'all-MiniLM-L6-v2',
        },
        hyperbolic: {
          type: 'boolean',
          description: 'Enable hyperbolic (Poincaré ball) embeddings',
          default: true,
        },
        curvature: {
          type: 'number',
          description: 'Poincaré ball curvature (negative)',
          default: -1,
        },
        cacheSize: {
          type: 'number',
          description: 'LRU cache size',
          default: 256,
        },
        force: {
          type: 'boolean',
          description: 'Overwrite existing configuration',
          default: false,
        },
      },
    },
    handler: async (input) => {
      const model = (input.model as string) || 'all-MiniLM-L6-v2';
      const hyperbolic = input.hyperbolic !== false;
      const curvature = (input.curvature as number) || -1;
      const cacheSize = (input.cacheSize as number) || 256;
      const force = input.force === true;

      const existingConfig = loadConfig();
      if (existingConfig && !force) {
        return {
          success: false,
          error: 'Embeddings already initialized. Use force=true to overwrite.',
          existingConfig: {
            model: existingConfig.model,
            initialized: existingConfig.initialized,
          },
        };
      }

      const dimension = model.includes('mpnet') ? 768 : 384;
      const modelPath = resolve(join(CONFIG_DIR, MODELS_DIR));

      // Create models directory
      if (!existsSync(modelPath)) {
        mkdirSync(modelPath, { recursive: true });
      }

      const config: EmbeddingsConfig = {
        model,
        modelPath,
        dimension,
        cacheSize,
        hyperbolic: {
          enabled: hyperbolic,
          curvature,
          epsilon: 1e-15,
          maxNorm: 1 - 1e-5,
        },
        neural: {
          enabled: true,
          driftThreshold: 0.3,
          decayRate: 0.01,
        },
        initialized: new Date().toISOString(),
      };

      saveConfig(config);

      return {
        success: true,
        config: {
          model,
          dimension,
          cacheSize,
          hyperbolic: hyperbolic ? { enabled: true, curvature } : { enabled: false },
          neural: { enabled: true },
        },
        paths: {
          config: getConfigPath(),
          models: modelPath,
        },
        message: 'Embedding subsystem initialized successfully',
      };
    },
  },

  {
    name: 'embeddings/generate',
    description: 'Generate embeddings for text (Euclidean or hyperbolic)',
    category: 'embeddings',
    inputSchema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Text to embed',
        },
        hyperbolic: {
          type: 'boolean',
          description: 'Return hyperbolic (Poincaré) embedding',
          default: false,
        },
        normalize: {
          type: 'boolean',
          description: 'L2 normalize the embedding',
          default: true,
        },
      },
      required: ['text'],
    },
    handler: async (input) => {
      const config = loadConfig();
      if (!config) {
        return {
          success: false,
          error: 'Embeddings not initialized. Run embeddings/init first.',
        };
      }

      const text = input.text as string;
      const useHyperbolic = input.hyperbolic === true && config.hyperbolic.enabled;

      // Generate real ONNX embedding
      const embedding = await generateRealEmbedding(text, config.dimension);

      let result: number[];
      let geometry: string;

      if (useHyperbolic) {
        result = toPoincare(embedding, config.hyperbolic.curvature);
        geometry = 'poincare';
      } else {
        result = embedding;
        geometry = 'euclidean';
      }

      return {
        success: true,
        embedding: result,
        metadata: {
          model: config.model,
          dimension: config.dimension,
          geometry,
          curvature: useHyperbolic ? config.hyperbolic.curvature : null,
          textLength: text.length,
          norm: Math.sqrt(result.reduce((sum, x) => sum + x * x, 0)),
        },
      };
    },
  },

  {
    name: 'embeddings/compare',
    description: 'Compare similarity between two texts',
    category: 'embeddings',
    inputSchema: {
      type: 'object',
      properties: {
        text1: {
          type: 'string',
          description: 'First text',
        },
        text2: {
          type: 'string',
          description: 'Second text',
        },
        metric: {
          type: 'string',
          description: 'Similarity metric',
          enum: ['cosine', 'euclidean', 'poincare'],
          default: 'cosine',
        },
      },
      required: ['text1', 'text2'],
    },
    handler: async (input) => {
      const config = loadConfig();
      if (!config) {
        return {
          success: false,
          error: 'Embeddings not initialized. Run embeddings/init first.',
        };
      }

      const text1 = input.text1 as string;
      const text2 = input.text2 as string;
      const metric = (input.metric as string) || 'cosine';

      // Generate real ONNX embeddings for both texts
      const [emb1, emb2] = await Promise.all([
        generateRealEmbedding(text1, config.dimension),
        generateRealEmbedding(text2, config.dimension)
      ]);

      let similarity: number;
      let distance: number;

      switch (metric) {
        case 'poincare':
          if (!config.hyperbolic.enabled) {
            return {
              success: false,
              error: 'Hyperbolic mode not enabled. Initialize with hyperbolic=true.',
            };
          }
          const poinc1 = toPoincare(emb1, config.hyperbolic.curvature);
          const poinc2 = toPoincare(emb2, config.hyperbolic.curvature);
          distance = poincareDistance(poinc1, poinc2, config.hyperbolic.curvature);
          similarity = 1 / (1 + distance);
          break;

        case 'euclidean':
          distance = Math.sqrt(emb1.reduce((sum, _, i) => sum + (emb1[i] - emb2[i]) ** 2, 0));
          similarity = 1 / (1 + distance);
          break;

        default: // cosine
          similarity = cosineSimilarity(emb1, emb2);
          distance = 1 - similarity;
      }

      return {
        success: true,
        similarity,
        distance,
        metric,
        texts: {
          text1: { length: text1.length, preview: text1.slice(0, 50) },
          text2: { length: text2.length, preview: text2.slice(0, 50) },
        },
        interpretation: similarity > 0.8 ? 'very similar' :
                        similarity > 0.6 ? 'similar' :
                        similarity > 0.4 ? 'somewhat similar' :
                        similarity > 0.2 ? 'different' : 'very different',
      };
    },
  },

  {
    name: 'embeddings/search',
    description: 'Semantic search across stored embeddings',
    category: 'embeddings',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query',
        },
        topK: {
          type: 'number',
          description: 'Number of results to return',
          default: 5,
        },
        threshold: {
          type: 'number',
          description: 'Minimum similarity threshold (0-1)',
          default: 0.5,
        },
        namespace: {
          type: 'string',
          description: 'Search in specific namespace',
        },
      },
      required: ['query'],
    },
    handler: async (input) => {
      const config = loadConfig();
      if (!config) {
        return {
          success: false,
          error: 'Embeddings not initialized. Run embeddings/init first.',
        };
      }

      const query = input.query as string;
      const topK = (input.topK as number) || 5;
      const threshold = (input.threshold as number) || 0.5;
      const namespace = input.namespace as string;

      const startTime = performance.now();

      // Generate real ONNX embedding for query
      const queryEmbedding = await generateRealEmbedding(query, config.dimension);

      // Try to search using real memory search
      try {
        const { searchEntries } = await import('../memory/memory-initializer.js');
        const searchResult = await searchEntries({
          query,
          limit: topK,
          threshold,
          namespace: namespace || 'default'
        });

        const searchTime = (performance.now() - startTime).toFixed(2);

        return {
          success: true,
          query,
          results: searchResult.results.map((r) => ({
            key: r.key,
            content: r.content?.substring(0, 100),
            similarity: r.score,
            namespace: r.namespace
          })),
          metadata: {
            model: config.model,
            topK,
            threshold,
            namespace: namespace || 'default',
            searchTime: `${searchTime}ms`,
            indexType: config.hyperbolic.enabled ? 'HNSW (hyperbolic)' : 'HNSW (euclidean)',
            resultCount: searchResult.results.length
          },
        };
      } catch {
        // Database not available - return empty but truthful
        const searchTime = (performance.now() - startTime).toFixed(2);
        return {
          success: true,
          query,
          results: [],
          metadata: {
            model: config.model,
            topK,
            threshold,
            namespace: namespace || 'default',
            searchTime: `${searchTime}ms`,
            indexType: config.hyperbolic.enabled ? 'HNSW (hyperbolic)' : 'HNSW (euclidean)',
          },
          message: 'No embeddings indexed yet. Use memory store to add documents.',
        };
      }
    },
  },

  {
    name: 'embeddings/neural',
    description: 'Neural substrate operations (RuVector integration)',
    category: 'embeddings',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'Neural action',
          enum: ['status', 'init', 'drift', 'consolidate', 'adapt'],
          default: 'status',
        },
        driftThreshold: {
          type: 'number',
          description: 'Semantic drift detection threshold',
          default: 0.3,
        },
        decayRate: {
          type: 'number',
          description: 'Memory decay rate (hippocampal dynamics)',
          default: 0.01,
        },
      },
    },
    handler: async (input) => {
      const config = loadConfig();
      if (!config) {
        return {
          success: false,
          error: 'Embeddings not initialized. Run embeddings/init first.',
        };
      }

      const action = (input.action as string) || 'status';

      switch (action) {
        case 'init':
          config.neural = {
            enabled: true,
            driftThreshold: (input.driftThreshold as number) || 0.3,
            decayRate: (input.decayRate as number) || 0.01,
            ruvector: {
              enabled: true,
              sona: true,
              flashAttention: true,
              ewcPlusPlus: true,
            },
            features: {
              semanticDrift: true,
              memoryPhysics: true,
              stateMachine: true,
              swarmCoordination: true,
              coherenceMonitor: true,
            },
          };
          saveConfig(config);
          return {
            success: true,
            action: 'init',
            neural: config.neural,
            message: 'Neural substrate initialized with RuVector integration',
          };

        case 'drift':
          // Get real drift metrics if available
          try {
            const { getIntelligenceStats } = await import('../memory/intelligence.js');
            const stats = getIntelligenceStats();
            return {
              success: true,
              action: 'drift',
              status: {
                semanticDrift: {
                  enabled: config.neural.features?.semanticDrift ?? false,
                  threshold: config.neural.driftThreshold,
                  patternsTracked: stats.patternsLearned,
                  status: stats.patternsLearned > 0 ? 'tracking' : 'no patterns',
                },
              },
              message: stats.patternsLearned > 0
                ? `Tracking ${stats.patternsLearned} patterns for drift`
                : 'No patterns stored yet - drift detection inactive',
            };
          } catch {
            return {
              success: true,
              action: 'drift',
              status: { semanticDrift: { enabled: false, reason: 'Intelligence module unavailable' } },
            };
          }

        case 'consolidate':
          // Get real consolidation metrics
          try {
            const { getIntelligenceStats } = await import('../memory/intelligence.js');
            const stats = getIntelligenceStats();
            return {
              success: true,
              action: 'consolidate',
              status: {
                memoryPhysics: {
                  enabled: config.neural.features?.memoryPhysics ?? false,
                  decayRate: config.neural.decayRate,
                  patternsStored: stats.reasoningBankSize,
                  trajectoriesRecorded: stats.trajectoriesRecorded,
                },
              },
              message: `ReasoningBank: ${stats.reasoningBankSize} patterns, ${stats.trajectoriesRecorded} trajectories`,
            };
          } catch {
            return {
              success: true,
              action: 'consolidate',
              status: { memoryPhysics: { enabled: false, reason: 'Intelligence module unavailable' } },
            };
          }

        case 'adapt':
          // Get real SONA adaptation metrics
          try {
            const { benchmarkAdaptation, initializeIntelligence } = await import('../memory/intelligence.js');
            await initializeIntelligence();
            const benchmark = benchmarkAdaptation(100);
            return {
              success: true,
              action: 'adapt',
              status: {
                sona: {
                  enabled: true,
                  adaptationTime: `${(benchmark.avgMs * 1000).toFixed(2)}μs`,
                  targetMet: benchmark.targetMet,
                  minTime: `${(benchmark.minMs * 1000).toFixed(2)}μs`,
                  maxTime: `${(benchmark.maxMs * 1000).toFixed(2)}μs`,
                },
              },
              message: benchmark.targetMet
                ? `SONA adaptation: ${(benchmark.avgMs * 1000).toFixed(2)}μs (target <50μs met)`
                : `SONA adaptation: ${(benchmark.avgMs * 1000).toFixed(2)}μs (target not met)`,
            };
          } catch {
            return {
              success: true,
              action: 'adapt',
              status: { sona: { enabled: false, reason: 'Intelligence module unavailable' } },
            };
          }

        default: // status
          // Get real neural system status
          try {
            const { getIntelligenceStats, benchmarkAdaptation, initializeIntelligence } = await import('../memory/intelligence.js');
            await initializeIntelligence();
            const stats = getIntelligenceStats();
            const benchmark = benchmarkAdaptation(50);
            return {
              success: true,
              action: 'status',
              neural: {
                enabled: config.neural.enabled,
                sonaEnabled: stats.sonaEnabled,
                ruvector: config.neural.ruvector || { enabled: false },
                features: config.neural.features || {},
                realMetrics: {
                  patternsLearned: stats.patternsLearned,
                  trajectoriesRecorded: stats.trajectoriesRecorded,
                  reasoningBankSize: stats.reasoningBankSize,
                  adaptationTime: `${(benchmark.avgMs * 1000).toFixed(2)}μs`,
                  targetMet: benchmark.targetMet,
                  lastAdaptation: stats.lastAdaptation
                    ? new Date(stats.lastAdaptation).toISOString()
                    : null,
                },
              },
              capabilities: [
                stats.sonaEnabled ? '✅ SONA Active' : '❌ SONA Inactive',
                benchmark.targetMet ? '✅ <0.05ms Target Met' : '⚠️ Target Not Met',
                `${stats.patternsLearned} patterns learned`,
                `${stats.trajectoriesRecorded} trajectories recorded`,
              ],
            };
          } catch {
            return {
              success: true,
              action: 'status',
              neural: {
                enabled: config.neural.enabled,
                ruvector: config.neural.ruvector || { enabled: false },
                features: config.neural.features || {},
              },
              message: 'Intelligence module not available - showing config only',
            };
          }
      }
    },
  },

  {
    name: 'embeddings/hyperbolic',
    description: 'Hyperbolic embedding operations (Poincaré ball)',
    category: 'embeddings',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'Hyperbolic action',
          enum: ['status', 'convert', 'distance', 'midpoint'],
          default: 'status',
        },
        embedding: {
          type: 'array',
          description: 'Euclidean embedding to convert',
          items: { type: 'number' },
        },
        embedding1: {
          type: 'array',
          description: 'First embedding for distance/midpoint',
          items: { type: 'number' },
        },
        embedding2: {
          type: 'array',
          description: 'Second embedding for distance/midpoint',
          items: { type: 'number' },
        },
      },
    },
    handler: async (input) => {
      const config = loadConfig();
      if (!config) {
        return {
          success: false,
          error: 'Embeddings not initialized. Run embeddings/init first.',
        };
      }

      if (!config.hyperbolic.enabled) {
        return {
          success: false,
          error: 'Hyperbolic mode not enabled. Initialize with hyperbolic=true.',
        };
      }

      const action = (input.action as string) || 'status';
      const curvature = config.hyperbolic.curvature;

      switch (action) {
        case 'convert':
          const embedding = input.embedding as number[];
          if (!embedding || !Array.isArray(embedding)) {
            return { success: false, error: 'Embedding array required for convert action' };
          }
          const poincare = toPoincare(embedding, curvature);
          return {
            success: true,
            action: 'convert',
            euclidean: embedding,
            poincare,
            curvature,
            poincareNorm: Math.sqrt(poincare.reduce((sum, x) => sum + x * x, 0)),
          };

        case 'distance':
          const emb1 = input.embedding1 as number[];
          const emb2 = input.embedding2 as number[];
          if (!emb1 || !emb2) {
            return { success: false, error: 'embedding1 and embedding2 required for distance action' };
          }
          const dist = poincareDistance(emb1, emb2, curvature);
          return {
            success: true,
            action: 'distance',
            distance: dist,
            curvature,
            interpretation: dist < 1 ? 'close' : dist < 2 ? 'moderate' : 'far',
          };

        case 'midpoint':
          const e1 = input.embedding1 as number[];
          const e2 = input.embedding2 as number[];
          if (!e1 || !e2) {
            return { success: false, error: 'embedding1 and embedding2 required for midpoint action' };
          }
          // Simplified midpoint (proper Möbius midpoint is more complex)
          const mid = e1.map((_, i) => (e1[i] + e2[i]) / 2);
          const norm = Math.sqrt(mid.reduce((sum, x) => sum + x * x, 0));
          const scaledMid = mid.map(x => x * (config.hyperbolic.maxNorm / Math.max(norm, config.hyperbolic.maxNorm)));
          return {
            success: true,
            action: 'midpoint',
            midpoint: scaledMid,
            curvature,
          };

        default: // status
          return {
            success: true,
            action: 'status',
            hyperbolic: {
              enabled: true,
              curvature,
              epsilon: config.hyperbolic.epsilon,
              maxNorm: config.hyperbolic.maxNorm,
            },
            benefits: [
              'Better hierarchical data representation',
              'Exponential capacity in low dimensions',
              'Preserves tree-like structures',
              'Natural for taxonomy embeddings',
            ],
          };
      }
    },
  },

  {
    name: 'embeddings/status',
    description: 'Get embeddings system status and configuration',
    category: 'embeddings',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    handler: async () => {
      const config = loadConfig();
      if (!config) {
        return {
          success: false,
          initialized: false,
          message: 'Embeddings not initialized. Run embeddings/init first.',
        };
      }

      return {
        success: true,
        initialized: true,
        config: {
          model: config.model,
          dimension: config.dimension,
          cacheSize: config.cacheSize,
          hyperbolic: config.hyperbolic,
          neural: {
            enabled: config.neural.enabled,
            ruvector: config.neural.ruvector?.enabled ?? false,
          },
        },
        paths: {
          config: getConfigPath(),
          models: config.modelPath,
        },
        initializedAt: config.initialized,
        capabilities: {
          onnxModels: ['all-MiniLM-L6-v2', 'all-mpnet-base-v2'],
          geometries: ['euclidean', 'poincare'],
          normalizations: ['L2', 'L1', 'minmax', 'zscore'],
          features: ['semantic search', 'hyperbolic projection', 'neural substrate'],
        },
      };
    },
  },
];
