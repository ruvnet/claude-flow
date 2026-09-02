/**
 * QE Memory Bridge
 *
 * Anti-corruption layer for V3 memory system integration.
 * Handles storage and retrieval of test patterns, coverage data,
 * and learning trajectories via HNSW-indexed memory.
 *
 * Performance: 150x-12,500x faster search via HNSW indexing
 *
 * Based on:
 * - ADR-030: Agentic-QE Plugin Integration
 * - ADR-006: Unified Memory Service
 *
 * @module v3/plugins/agentic-qe/bridges/QEMemoryBridge
 */

import type {
  IQEMemoryBridge,
  TestPattern,
  PatternFilters,
  CoverageGap,
  LearningTrajectory,
  QEMemoryStats,
  QELogger,
} from '../interfaces.js';

// V3 Memory types (would be imported from @claude-flow/memory in production)
interface IMemoryService {
  createNamespace(name: string, config: NamespaceConfig): Promise<void>;
  store(entry: StoreEntry): Promise<string>;
  search(embedding: Float32Array, k: number, options?: SearchOptions): Promise<SearchResult[]>;
  query(query: QuerySpec): Promise<MemoryEntry[]>;
  delete(id: string): Promise<boolean>;
  clearNamespace(namespace: string): Promise<number>;
  getStats(): Promise<MemoryStats>;
}

interface NamespaceConfig {
  vectorDimension: number;
  hnswConfig: { m: number; efConstruction: number; efSearch: number };
  schema?: Record<string, { type: string; index?: boolean }>;
}

type MemoryProvenanceType =
  | 'user_claim'
  | 'agent_output'
  | 'system_observation'
  | 'tool_result'
  | 'unknown';

interface StoreEntry {
  namespace: string;
  content: string;
  provenance_type: MemoryProvenanceType;
  embedding?: Float32Array;
  metadata?: Record<string, unknown>;
  type?: string;
  ttl?: number;
}

interface SearchOptions {
  namespace?: string;
  filters?: Record<string, unknown>;
}

interface SearchResult {
  id: string;
  content: string;
  score: number;
  metadata?: Record<string, unknown>;
}

interface MemoryEntry {
  id: string;
  content: string;
  metadata?: Record<string, unknown>;
}

interface QuerySpec {
  namespace: string;
  filters?: Record<string, unknown>;
  limit?: number;
}

interface MemoryStats {
  totalEntries: number;
  entriesByNamespace: Record<string, number>;
  memoryUsage: number;
}

// V3 Embeddings types (would be imported from @claude-flow/embeddings in production)
interface IEmbeddingsService {
  embed(text: string): Promise<{ embedding: Float32Array }>;
}

/**
 * Memory namespace definitions for QE data
 */
const QE_NAMESPACES = {
  testPatterns: {
    name: 'aqe/v3/test-patterns',
    vectorDimension: 384,
    hnswConfig: { m: 16, efConstruction: 200, efSearch: 100 },
    schema: {
      patternType: { type: 'string', index: true },
      language: { type: 'string', index: true },
      framework: { type: 'string', index: true },
      effectiveness: { type: 'number' },
      usageCount: { type: 'number' },
    },
  },
  coverageData: {
    name: 'aqe/v3/coverage-data',
    vectorDimension: 384,
    hnswConfig: { m: 12, efConstruction: 150, efSearch: 50 },
    schema: {
      filePath: { type: 'string', index: true },
      type: { type: 'string', index: true },
      riskScore: { type: 'number' },
      priority: { type: 'string', index: true },
    },
    ttl: 86400000, // 24h
  },
  learningTrajectories: {
    name: 'aqe/v3/learning-trajectories',
    vectorDimension: 384,
    hnswConfig: { m: 16, efConstruction: 200, efSearch: 100 },
    schema: {
      taskType: { type: 'string', index: true },
      agentId: { type: 'string', index: true },
      success: { type: 'boolean', index: true },
      reward: { type: 'number' },
    },
  },
  codeKnowledge: {
    name: 'aqe/v3/code-knowledge',
    vectorDimension: 384,
    hnswConfig: { m: 24, efConstruction: 300, efSearch: 150 },
  },
  securityFindings: {
    name: 'aqe/v3/security-findings',
    vectorDimension: 384,
    hnswConfig: { m: 16, efConstruction: 200, efSearch: 100 },
  },
} as const;

/**
 * QE Memory Bridge Implementation
 *
 * Bridges agentic-qe memory needs to V3's unified memory service.
 * Uses HNSW indexing for 150x-12,500x faster pattern search.
 */
export class QEMemoryBridge implements IQEMemoryBridge {
  private memory: IMemoryService;
  private embeddings: IEmbeddingsService;
  private logger: QELogger;
  private initialized: boolean = false;

  constructor(
    memory: IMemoryService,
    embeddings: IEmbeddingsService,
    logger: QELogger
  ) {
    this.memory = memory;
    this.embeddings = embeddings;
    this.logger = logger;
  }

  /**
   * Initialize all QE memory namespaces
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      this.logger.debug('QEMemoryBridge already initialized');
      return;
    }

    this.logger.info('Initializing QE memory namespaces...');

    try {
      // Create all namespaces
      for (const [key, config] of Object.entries(QE_NAMESPACES)) {
        this.logger.debug(`Creating namespace: ${config.name}`);
        await this.memory.createNamespace(config.name, {
          vectorDimension: config.vectorDimension,
          hnswConfig: config.hnswConfig,
          schema: config.schema,
        });
      }

      this.initialized = true;
      this.logger.info('QE memory namespaces initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize QE memory namespaces', error);
      throw new QEMemoryError('Failed to initialize memory namespaces', error as Error);
    }
  }

  /**
   * Store a test pattern with semantic embedding
   */
  async storeTestPattern(pattern: TestPattern): Promise<string> {
    this.ensureInitialized();

    try {
      this.logger.debug(`Storing test pattern: ${pattern.id}`);

      // Generate embedding from pattern description and code
      const embeddingText = `${pattern.type} ${pattern.description} ${pattern.code}`;
      const { embedding } = await this.embeddings.embed(embeddingText);

      // Store in memory with metadata
      const id = await this.memory.store({
        namespace: QE_NAMESPACES.testPatterns.name,
        content: JSON.stringify(pattern),
        embedding,
        metadata: {
          patternType: pattern.type,
          language: pattern.language,
          framework: pattern.framework,
          effectiveness: pattern.effectiveness,
          usageCount: pattern.usageCount,
          tags: pattern.tags,
        },
        provenance_type: 'agent_output',
        type: 'semantic',
      });

      this.logger.debug(`Stored test pattern with ID: ${id}`);
      return id;
    } catch (error) {
      this.logger.error(`Failed to store test pattern: ${pattern.id}`, error);
      throw new QEMemoryError('Failed to store test pattern', error as Error);
    }
  }

  /**
   * Search for similar patterns using HNSW (150x faster)
   */
  async searchSimilarPatterns(
    query: string,
    k: number = 10,
    filters?: PatternFilters
  ): Promise<TestPattern[]> {
    this.ensureInitialized();

    try {
      this.logger.debug(`Searching similar patterns: "${query.slice(0, 50)}..."`);

      // Generate query embedding
      const { embedding } = await this.embeddings.embed(query);

      // Build filter object for HNSW search
      const searchFilters = this.buildPatternFilters(filters);

      // Execute HNSW search (150x-12,500x faster than brute force)
      const results = await this.memory.search(embedding, k, {
        namespace: QE_NAMESPACES.testPatterns.name,
        filters: searchFilters,
      });

      // Parse results back to TestPattern objects
      const patterns = results.map((result) => {
        try {
          return JSON.parse(result.content) as TestPattern;
        } catch {
          this.logger.warn(`Failed to parse pattern content: ${result.id}`);
          return null;
        }
      }).filter((p): p is TestPattern => p !== null);

      this.logger.debug(`Found ${patterns.length} similar patterns`);
      return patterns;
    } catch (error) {
      this.logger.error('Failed to search similar patterns', error);
      throw new QEMemoryError('Failed to search patterns', error as Error);
    }
  }

  /**
   * Store a coverage gap
   */
  async storeCoverageGap(gap: CoverageGap): Promise<string> {
    this.ensureInitialized();

    try {
      this.logger.debug(`Storing coverage gap: ${gap.file}:${gap.location.startLine}`);

      // Generate embedding for semantic search
      const embeddingText = `coverage gap ${gap.file} ${gap.type} ${gap.location.startLine} ${gap.reason}`;
      const { embedding } = await this.embeddings.embed(embeddingText);

      const id = await this.memory.store({
        namespace: QE_NAMESPACES.coverageData.name,
        content: JSON.stringify(gap),
        embedding,
        metadata: {
          filePath: gap.file,
          type: gap.type,
          riskScore: gap.riskScore,
          priority: gap.priority,
          startLine: gap.location.startLine,
          endLine: gap.location.endLine,
        },
        provenance_type: 'tool_result',
        type: 'episodic',
        ttl: QE_NAMESPACES.coverageData.ttl,
      });

      this.logger.debug(`Stored coverage gap with ID: ${id}`);
      return id;
    } catch (error) {
      this.logger.error('Failed to store coverage gap', error);
      throw new QEMemoryError('Failed to store coverage gap', error as Error);
    }
  }

  /**
   * Get coverage gaps for a specific file
   */
  async getCoverageGaps(file: string): Promise<CoverageGap[]> {
    this.ensureInitialized();

    try {
      this.logger.debug(`Getting coverage gaps for file: ${file}`);

      const results = await this.memory.query({
        namespace: QE_NAMESPACES.coverageData.name,
        filters: { filePath: file },
        limit: 100,
      });

      const gaps = results.map((result) => {
        try {
          return JSON.parse(result.content) as CoverageGap;
        } catch {
          return null;
        }
      }).filter((g): g is CoverageGap => g !== null);

      this.logger.debug(`Found ${gaps.length} coverage gaps for ${file}`);
      return gaps;
    } catch (error) {
      this.logger.error(`Failed to get coverage gaps for ${file}`, error);
      throw new QEMemoryError('Failed to get coverage gaps', error as Error);
    }
  }

  /**
   * Get prioritized coverage gaps
   */
  async getPrioritizedGaps(limit: number = 20): Promise<CoverageGap[]> {
    this.ensureInitialized();

    try {
      this.logger.debug(`Getting prioritized coverage gaps, limit: ${limit}`);

      // Query all gaps and sort by priority and risk score
      const results = await this.memory.query({
        namespace: QE_NAMESPACES.coverageData.name,
        limit: limit * 2, // Fetch more to allow for filtering
      });

      const gaps = results.map((result) => {
        try {
          return JSON.parse(result.content) as CoverageGap;
        } catch {
          return null;
        }
      }).filter((g): g is CoverageGap => g !== null);

      // Sort by priority (critical > high > medium > low) then by risk score
      const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      gaps.sort((a, b) => {
        const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
        if (priorityDiff !== 0) return priorityDiff;
        return b.riskScore - a.riskScore;
      });

      const prioritizedGaps = gaps.slice(0, limit);
      this.logger.debug(`Returning ${prioritizedGaps.length} prioritized gaps`);
      return prioritizedGaps;
    } catch (error) {
      this.logger.error('Failed to get prioritized gaps', error);
      throw new QEMemoryError('Failed to get prioritized gaps', error as Error);
    }
  }

  /**
   * Store a learning trajectory for ReasoningBank
   */
  async storeTrajectory(trajectory: LearningTrajectory): Promise<string> {
    this.ensureInitialized();

    try {
      this.logger.debug(`Storing learning trajectory: ${trajectory.id}`);

      // Generate embedding from trajectory steps
      const embeddingText = trajectory.steps.map((s) => s.action).join(' ');
      const { embedding } = await this.embeddings.embed(embeddingText);

      const id = await this.memory.store({
        namespace: QE_NAMESPACES.learningTrajectories.name,
        content: JSON.stringify(trajectory),
        embedding,
        metadata: {
          taskType: trajectory.taskType,
          agentId: trajectory.agentId,
          success: trajectory.success,
          reward: trajectory.reward,
          verdict: trajectory.verdict,
          stepCount: trajectory.steps.length,
          durationMs: trajectory.durationMs,
        },
        provenance_type: 'system_observation',
        type: 'procedural',
      });

      this.logger.debug(`Stored learning trajectory with ID: ${id}`);
      return id;
    } catch (error) {
      this.logger.error('Failed to store learning trajectory', error);
      throw new QEMemoryError('Failed to store trajectory', error as Error);
    }
  }

  /**
   * Search trajectories by similarity
   */
  async searchTrajectories(
    query: string,
    k: number = 10,
    filters?: { taskType?: string; success?: boolean }
  ): Promise<LearningTrajectory[]> {
    this.ensureInitialized();

    try {
      this.logger.debug(`Searching trajectories: "${query.slice(0, 50)}..."`);

      const { embedding } = await this.embeddings.embed(query);

      const searchFilters: Record<string, unknown> = {};
      if (filters?.taskType) searchFilters.taskType = filters.taskType;
      if (filters?.success !== undefined) searchFilters.success = filters.success;

      const results = await this.memory.search(embedding, k, {
        namespace: QE_NAMESPACES.learningTrajectories.name,
        filters: Object.keys(searchFilters).length > 0 ? searchFilters : undefined,
      });

      const trajectories = results.map((result) => {
        try {
          return JSON.parse(result.content) as LearningTrajectory;
        } catch {
          return null;
        }
      }).filter((t): t is LearningTrajectory => t !== null);

      this.logger.debug(`Found ${trajectories.length} similar trajectories`);
      return trajectories;
    } catch (error) {
      this.logger.error('Failed to search trajectories', error);
      throw new QEMemoryError('Failed to search trajectories', error as Error);
    }
  }

  /**
   * Clear temporary data (coverage data)
   */
  async clearTemporaryData(): Promise<void> {
    this.ensureInitialized();

    try {
      this.logger.info('Clearing temporary QE data...');

      const cleared = await this.memory.clearNamespace(QE_NAMESPACES.coverageData.name);

      this.logger.info(`Cleared ${cleared} temporary entries`);
    } catch (error) {
      this.logger.error('Failed to clear temporary data', error);
      throw new QEMemoryError('Failed to clear temporary data', error as Error);
    }
  }

  /**
   * Get memory statistics
   */
  async getStats(): Promise<QEMemoryStats> {
    this.ensureInitialized();

    try {
      const stats = await this.memory.getStats();

      const qeStats: QEMemoryStats = {
        testPatterns: stats.entriesByNamespace[QE_NAMESPACES.testPatterns.name] || 0,
        coverageGaps: stats.entriesByNamespace[QE_NAMESPACES.coverageData.name] || 0,
        learningTrajectories: stats.entriesByNamespace[QE_NAMESPACES.learningTrajectories.name] || 0,
        codeKnowledge: stats.entriesByNamespace[QE_NAMESPACES.codeKnowledge.name] || 0,
        securityFindings: stats.entriesByNamespace[QE_NAMESPACES.securityFindings.name] || 0,
        totalMemoryBytes: stats.memoryUsage,
      };

      return qeStats;
    } catch (error) {
      this.logger.error('Failed to get memory stats', error);
      throw new QEMemoryError('Failed to get stats', error as Error);
    }
  }

  /**
   * Build filter object for pattern search
   */
  private buildPatternFilters(filters?: PatternFilters): Record<string, unknown> | undefined {
    if (!filters) return undefined;

    const memoryFilters: Record<string, unknown> = {};

    if (filters.type) memoryFilters.patternType = filters.type;
    if (filters.language) memoryFilters.language = filters.language;
    if (filters.framework) memoryFilters.framework = filters.framework;
    if (filters.minEffectiveness !== undefined) {
      memoryFilters.effectiveness = { $gte: filters.minEffectiveness };
    }
    // Tags require special handling (array contains)
    if (filters.tags && filters.tags.length > 0) {
      memoryFilters.tags = { $containsAll: filters.tags };
    }

    return Object.keys(memoryFilters).length > 0 ? memoryFilters : undefined;
  }

  /**
   * Ensure bridge is initialized before operations
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new QEMemoryError('QEMemoryBridge not initialized. Call initialize() first.');
    }
  }
}

/**
 * QE Memory Error class
 */
export class QEMemoryError extends Error {
  public readonly cause?: Error;

  constructor(message: string, cause?: Error) {
    super(message);
    this.name = 'QEMemoryError';
    this.cause = cause;
  }
}
