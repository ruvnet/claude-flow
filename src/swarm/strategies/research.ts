/**
 * Optimized Research Strategy Implementation
 * Provides intelligent research capabilities with parallel processing,
 * semantic clustering, caching, and progressive refinement
 */

import { BaseStrategy, DecompositionResult, StrategyMetrics, TaskBatch } from './base.js';
import { Logger } from '../../core/logger.js';
import { generateId } from '../../utils/helpers.js';
import {
  SwarmObjective, TaskDefinition, TaskId, TaskType, TaskPriority,
  SwarmConfig, SWARM_CONSTANTS, SwarmMode, SwarmStrategy, CoordinationStrategy, AccessLevel,
  AgentState
} from '../types.js';

// Research-specific interfaces
interface ResearchQuery {
  id: string;
  query: string;
  keywords: string[];
  domains: string[];
  priority: number;
  timestamp: Date;
  sources?: string[];
  filters?: ResearchFilters;
}

interface ResearchFilters {
  dateRange?: { start: Date; end: Date };
  sourceTypes?: ('academic' | 'news' | 'blog' | 'documentation' | 'forum')[];
  languages?: string[];
  credibilityThreshold?: number;
  maxResults?: number;
}

interface ResearchResult {
  id: string;
  queryId: string;
  url: string;
  title: string;
  content: string;
  summary: string;
  credibilityScore: number;
  relevanceScore: number;
  sourceType: string;
  publishedDate?: Date;
  extractedAt: Date;
  metadata: Record<string, any>;
  semanticVector?: number[];
}

interface ResearchCluster {
  id: string;
  topic: string;
  results: ResearchResult[];
  centroid: number[];
  coherenceScore: number;
  keywords: string[];
  summary: string;
}

interface CacheEntry {
  key: string;
  data: any;
  timestamp: Date;
  ttl: number;
  accessCount: number;
  lastAccessed: Date;
}

interface ConnectionPool {
  active: number;
  idle: number;
  max: number;
  timeout: number;
  connections: Map<string, any>;
}

interface RateLimiter {
  requests: number;
  windowStart: Date;
  windowSize: number;
  maxRequests: number;
  backoffMultiplier: number;
}

export class ResearchStrategy extends BaseStrategy {
  private logger: Logger;
  private researchCache: Map<string, CacheEntry> = new Map();
  private connectionPool: ConnectionPool;
  private rateLimiters: Map<string, RateLimiter> = new Map();
  private semanticModel: any; // Placeholder for semantic analysis
  private researchQueries: Map<string, ResearchQuery> = new Map();
  private researchResults: Map<string, ResearchResult> = new Map();
  private researchClusters: Map<string, ResearchCluster> = new Map();

  // Research-specific metrics extending base metrics
  private researchMetrics = {
    queriesExecuted: 0,
    resultsCollected: 0,
    cacheHits: 0,
    cacheMisses: 0,
    averageResponseTime: 0,
    credibilityScores: [] as number[],
    clusteringAccuracy: 0,
    parallelEfficiency: 0
  };

  constructor(config: Partial<SwarmConfig> = {}) {
    // Create default config and merge with provided config
    const defaultConfig: SwarmConfig = {
      name: 'research-swarm',
      description: 'Research strategy swarm',
      version: '1.0.0',
      mode: 'distributed' as SwarmMode,
      strategy: 'research' as SwarmStrategy,
      coordinationStrategy: 'hierarchical' as unknown as CoordinationStrategy,
      maxAgents: 5,
      maxTasks: 100,
      maxDuration: 3600000, // 1 hour
      resourceLimits: {},
      qualityThreshold: 0.8,
      reviewRequired: false,
      testingRequired: false,
      monitoring: {
        metricsEnabled: true,
        loggingEnabled: true,
        tracingEnabled: false,
        metricsInterval: 5000,
        heartbeatInterval: 10000,
        healthCheckInterval: 30000,
        retentionPeriod: 3600000,
        maxLogSize: 10 * 1024 * 1024,
        maxMetricPoints: 10000,
        alertingEnabled: false,
        alertThresholds: {},
        exportEnabled: false,
        exportFormat: 'json',
        exportDestination: 'file'
      },
      memory: {
        namespace: 'research',
        partitions: [],
        permissions: {
          read: 'public' as AccessLevel,
          write: 'public' as AccessLevel,
          delete: 'team' as AccessLevel,
          share: 'public' as AccessLevel
        },
        persistent: false,
        backupEnabled: false,
        distributed: false,
        consistency: 'eventual',
        cacheEnabled: true,
        compressionEnabled: true
      },
      security: {
        authenticationRequired: false,
        authorizationRequired: false,
        encryptionEnabled: false,
        defaultPermissions: ['read', 'write'],
        adminRoles: ['admin'],
        auditEnabled: false,
        auditLevel: 'info',
        inputValidation: true,
        outputSanitization: true
      },
      performance: {
        cacheEnabled: true,
        maxConcurrency: 10,
        defaultTimeout: 300000,
        cacheSize: 1000,
        cacheTtl: 300000,
        optimizationEnabled: true,
        adaptiveScheduling: true,
        predictiveLoading: true,
        resourcePooling: true,
        connectionPooling: true,
        memoryPooling: true
      }
    };
    
    super({ ...defaultConfig, ...config });
    
    this.logger = new Logger(
      { level: 'info', format: 'text', destination: 'console' },
      { component: 'ResearchStrategy' }
    );

    // Initialize connection pool
    this.connectionPool = {
      active: 0,
      idle: 0,
      max: config.performance?.maxConcurrency || 10,
      timeout: 30000,
      connections: new Map()
    };

    this.logger.info('ResearchStrategy initialized with optimizations', {
      maxConcurrency: this.connectionPool.max,
      cacheEnabled: config.performance?.cacheEnabled !== false
    });
  }

  async decomposeObjective(objective: SwarmObjective): Promise<DecompositionResult> {
    this.logger.info('Decomposing research objective', {
      objectiveId: objective.id,
      description: objective.description
    });

    const tasks: TaskDefinition[] = [];
    const dependencies = new Map<string, string[]>();
    
    // Extract research parameters from objective
    const researchParams = this.extractResearchParameters(objective.description);
    
    // Create research query planning task
    const queryPlanningTask = this.createResearchTask(
      'query-planning',
      'research' as TaskType,
      'Research Query Planning',
      `Analyze the research objective and create optimized search queries:

${objective.description}

Create a comprehensive research plan that includes:
1. Primary and secondary research questions
2. Key search terms and synonyms
3. Relevant domains and sources to explore
4. Research methodology and approach
5. Quality criteria for evaluating sources

Focus on creating queries that will yield high-quality, credible results.`,
      {
        priority: 'high' as TaskPriority,
        estimatedDuration: 5 * 60 * 1000, // 5 minutes
        requiredCapabilities: ['research', 'analysis'],
        researchParams
      }
    );
    tasks.push(queryPlanningTask);

    // Create parallel web search tasks
    const webSearchTask = this.createResearchTask(
      'web-search',
      'research' as TaskType,
      'Parallel Web Search Execution',
      `Execute parallel web searches based on the research plan:

${objective.description}

Perform comprehensive web searches using:
1. Multiple search engines and sources
2. Parallel query execution for efficiency
3. Intelligent source ranking and filtering
4. Real-time credibility assessment
5. Deduplication of results

Collect diverse, high-quality sources relevant to the research objective.`,
      {
        priority: 'high' as TaskPriority,
        estimatedDuration: 10 * 60 * 1000, // 10 minutes
        requiredCapabilities: ['web-search', 'research'],
        dependencies: [queryPlanningTask.id.id],
        researchParams
      }
    );
    tasks.push(webSearchTask);
    dependencies.set(webSearchTask.id.id, [queryPlanningTask.id.id]);

    // Create data extraction and processing task
    const dataExtractionTask = this.createResearchTask(
      'data-extraction',
      'analysis' as TaskType,
      'Parallel Data Extraction',
      `Extract and process data from collected sources:

${objective.description}

Process the collected sources by:
1. Extracting key information and insights
2. Performing semantic analysis and clustering
3. Identifying patterns and relationships
4. Assessing information quality and reliability
5. Creating structured summaries

Use parallel processing for efficient data extraction.`,
      {
        priority: 'high' as TaskPriority,
        estimatedDuration: 8 * 60 * 1000, // 8 minutes
        requiredCapabilities: ['analysis', 'research'],
        dependencies: [webSearchTask.id.id],
        researchParams
      }
    );
    tasks.push(dataExtractionTask);
    dependencies.set(dataExtractionTask.id.id, [webSearchTask.id.id]);

    // Create semantic clustering task
    const clusteringTask = this.createResearchTask(
      'semantic-clustering',
      'analysis',
      'Semantic Clustering and Analysis',
      `Perform semantic clustering of research findings:

${objective.description}

Analyze the extracted data by:
1. Grouping related information using semantic similarity
2. Identifying key themes and topics
3. Creating coherent clusters of information
4. Generating cluster summaries and insights
5. Mapping relationships between clusters

Provide a structured analysis of the research findings.`,
      {
        priority: 'medium' as TaskPriority,
        estimatedDuration: 6 * 60 * 1000, // 6 minutes
        requiredCapabilities: ['analysis', 'research'],
        dependencies: [dataExtractionTask.id.id],
        researchParams
      }
    );
    tasks.push(clusteringTask);
    dependencies.set(clusteringTask.id.id, [dataExtractionTask.id.id]);

    // Create synthesis and reporting task
    const synthesisTask = this.createResearchTask(
      'synthesis-reporting',
      'documentation',
      'Research Synthesis and Reporting',
      `Synthesize research findings into comprehensive report:

${objective.description}

Create a comprehensive research report that includes:
1. Executive summary of key findings
2. Detailed analysis of each research cluster
3. Insights and recommendations
4. Source credibility assessment
5. Methodology and limitations
6. References and citations

Ensure the report is well-structured and actionable.`,
      {
        priority: 'medium' as TaskPriority,
        estimatedDuration: 7 * 60 * 1000, // 7 minutes
        requiredCapabilities: ['documentation', 'analysis'],
        dependencies: [clusteringTask.id.id],
        researchParams
      }
    );
    tasks.push(synthesisTask);
    dependencies.set(synthesisTask.id.id, [clusteringTask.id.id]);

    const totalDuration = tasks.reduce((sum, task) => 
      sum + (task.constraints.timeoutAfter || 0), 0
    );

    this.logger.info('Research objective decomposed', {
      objectiveId: objective.id,
      taskCount: tasks.length,
      estimatedDuration: totalDuration,
      parallelTasks: tasks.filter(t => !dependencies.has(t.id.id)).length
    });

    return {
      tasks,
      dependencies,
      estimatedDuration: totalDuration,
      recommendedStrategy: 'research',
      complexity: this.estimateComplexity(objective.description),
      batchGroups: this.createBatchGroups(tasks, dependencies)
    };
  }

  private createBatchGroups(tasks: TaskDefinition[], dependencies: Map<string, string[]>): TaskBatch[] {
    const batches: TaskBatch[] = [];
    const processed = new Set<string>();
    
    // Group tasks by dependency level
    const levels = new Map<string, number>();
    
    // Find tasks with no dependencies (level 0)
    tasks.forEach(task => {
      if (!dependencies.has(task.id.id)) {
        levels.set(task.id.id, 0);
      }
    });
    
    // Calculate levels for dependent tasks
    let changed = true;
    while (changed) {
      changed = false;
      tasks.forEach(task => {
        if (!levels.has(task.id.id)) {
          const deps = dependencies.get(task.id.id) || [];
          const depLevels = deps.map(d => levels.get(d)).filter(l => l !== undefined) as number[];
          if (depLevels.length === deps.length) {
            levels.set(task.id.id, Math.max(...depLevels) + 1);
            changed = true;
          }
        }
      });
    }
    
    // Group tasks by level into batches
    const tasksByLevel = new Map<number, TaskDefinition[]>();
    tasks.forEach(task => {
      const level = levels.get(task.id.id) || 0;
      if (!tasksByLevel.has(level)) {
        tasksByLevel.set(level, []);
      }
      tasksByLevel.get(level)!.push(task);
    });
    
    // Create batch groups
    Array.from(tasksByLevel.entries())
      .sort(([a], [b]) => a - b)
      .forEach(([level, levelTasks]) => {
        batches.push({
          id: `batch-${level}`,
          tasks: levelTasks,
          canRunInParallel: true,
          estimatedDuration: Math.max(...levelTasks.map(t => t.constraints.timeoutAfter || 0)),
          requiredResources: {
            memory: SWARM_CONSTANTS.DEFAULT_MEMORY_LIMIT,
            cpu: SWARM_CONSTANTS.DEFAULT_CPU_LIMIT
          }
        });
      });
    
    return batches;
  }

  // Research-specific optimizations for task execution
  async optimizeTaskExecution(task: TaskDefinition, agent: any): Promise<any> {
    const startTime = Date.now();
    
    try {
      // Apply research-specific optimizations based on task type
      switch (task.type) {
        case 'research':
          // Handle research tasks including web search
          if (task.description?.toLowerCase().includes('search') || 
              task.description?.toLowerCase().includes('gather')) {
            return await this.executeOptimizedWebSearch(task, agent);
          }
          return await this.executeGenericResearchTask(task, agent);
        case 'analysis':
          // Handle analysis tasks including data processing
          if (task.description?.toLowerCase().includes('data') || 
              task.description?.toLowerCase().includes('extract')) {
            return await this.executeOptimizedDataExtraction(task, agent);
          }
          return await this.executeOptimizedClustering(task, agent);
        default:
          return await this.executeGenericResearchTask(task, agent);
      }
    } finally {
      const duration = Date.now() - startTime;
      this.updateResearchMetrics(task.type, duration);
    }
  }

  private async executeOptimizedWebSearch(task: TaskDefinition, agent: any): Promise<any> {
    this.logger.info('Executing optimized web search', { taskId: task.id.id });

    // Check cache first
    const cacheKey = this.generateCacheKey('web-search', task.description);
    const cached = this.getFromCache(cacheKey);
    if (cached) {
      this.researchMetrics.cacheHits++;
      return cached;
    }

    // Execute parallel web searches with rate limiting
    const queries = this.generateSearchQueries(task.description);
    const searchPromises = queries.map(query => 
      this.executeRateLimitedSearch(query, agent)
    );

    const results = await Promise.allSettled(searchPromises);
    const successfulResults = results
      .filter(r => r.status === 'fulfilled')
      .map(r => (r as PromiseFulfilledResult<any>).value)
      .flat();

    // Rank and filter results by credibility
    const rankedResults = await this.rankResultsByCredibility(successfulResults);
    
    // Cache results
    this.setCache(cacheKey, rankedResults, 3600000); // 1 hour TTL
    this.researchMetrics.cacheMisses++;

    return {
      results: rankedResults,
      totalFound: successfulResults.length,
      queriesExecuted: queries.length,
      credibilityScores: rankedResults.map(r => r.credibilityScore)
    };
  }

  private async executeOptimizedDataExtraction(task: TaskDefinition, agent: any): Promise<any> {
    this.logger.info('Executing optimized data extraction', { taskId: task.id.id });

    // Get connection from pool
    const connection = await this.getPooledConnection();
    
    try {
      // Parallel data extraction with deduplication
      const extractionPromises = this.createParallelExtractionTasks(task, agent);
      const extractedData = await Promise.all(extractionPromises);
      
      // Deduplicate results
      const deduplicatedData = this.deduplicateResults(extractedData.flat());
      
      return {
        extractedData: deduplicatedData,
        totalExtracted: extractedData.flat().length,
        uniqueResults: deduplicatedData.length,
        deduplicationRate: 1 - (deduplicatedData.length / extractedData.flat().length)
      };
    } finally {
      this.releasePooledConnection(connection);
    }
  }

  private async executeOptimizedClustering(task: TaskDefinition, agent: any): Promise<any> {
    this.logger.info('Executing optimized semantic clustering', { taskId: task.id.id });

    // Implement semantic clustering with caching
    const data = task.input?.extractedData || [];
    const cacheKey = this.generateCacheKey('clustering', JSON.stringify(data));
    
    const cached = this.getFromCache(cacheKey);
    if (cached) {
      return cached;
    }

    // Perform semantic clustering
    const clusters = await this.performSemanticClustering(data);
    
    // Cache clustering results
    this.setCache(cacheKey, clusters, 7200000); // 2 hours TTL

    return {
      clusters,
      clusterCount: clusters.length,
      averageClusterSize: clusters.reduce((sum, c) => sum + c.results.length, 0) / clusters.length,
      coherenceScore: clusters.reduce((sum, c) => sum + c.coherenceScore, 0) / clusters.length
    };
  }

  private async executeGenericResearchTask(task: TaskDefinition, agent: any): Promise<any> {
    this.logger.info('Executing generic research task', { taskId: task.id.id });

    // Apply general research optimizations
    return {
      status: 'completed',
      optimizations: ['caching', 'rate-limiting', 'connection-pooling'],
      executionTime: Date.now()
    };
  }

  // Helper methods for research optimizations

  private extractResearchParameters(description: string): any {
    return {
      domains: this.extractDomains(description),
      keywords: this.extractKeywords(description),
      timeframe: this.extractTimeframe(description),
      sourceTypes: this.extractSourceTypes(description)
    };
  }

  private extractDomains(description: string): string[] {
    // Extract relevant domains from description
    const domains = [];
    if (description.includes('academic') || description.includes('research')) domains.push('academic');
    if (description.includes('news') || description.includes('current')) domains.push('news');
    if (description.includes('technical') || description.includes('documentation')) domains.push('technical');
    return domains.length > 0 ? domains : ['general'];
  }

  private extractKeywords(description: string): string[] {
    // Simple keyword extraction - in production, use NLP
    return description
      .toLowerCase()
      .split(/\s+/)
      .filter(word => word.length > 3)
      .slice(0, 10);
  }

  private extractTimeframe(description: string): any {
    // Extract time-related constraints
    const now = new Date();
    return {
      start: new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000), // 1 year ago
      end: now
    };
  }

  private extractSourceTypes(description: string): string[] {
    return ['academic', 'news', 'documentation', 'blog'];
  }

  private generateSearchQueries(description: string): ResearchQuery[] {
    const baseQuery = description.substring(0, 100);
    const keywords = this.extractKeywords(description);
    
    return [
      {
        id: generateId('query'),
        query: baseQuery,
        keywords: keywords.slice(0, 5),
        domains: ['general'],
        priority: 1,
        timestamp: new Date()
      },
      {
        id: generateId('query'),
        query: `${baseQuery} research study`,
        keywords: [...keywords.slice(0, 3), 'research', 'study'],
        domains: ['academic'],
        priority: 2,
        timestamp: new Date()
      },
      {
        id: generateId('query'),
        query: `${baseQuery} best practices`,
        keywords: [...keywords.slice(0, 3), 'best', 'practices'],
        domains: ['technical'],
        priority: 2,
        timestamp: new Date()
      }
    ];
  }

  private async executeRateLimitedSearch(query: ResearchQuery, agent: any): Promise<ResearchResult[]> {
    const domain = query.domains[0] || 'general';
    
    // Check rate limits
    if (!this.checkRateLimit(domain)) {
      await this.waitForRateLimit(domain);
    }

    // Simulate web search with retry logic
    let attempts = 0;
    const maxAttempts = 3;
    
    while (attempts < maxAttempts) {
      try {
        // Simulate search execution
        const results = await this.simulateWebSearch(query);
        this.updateRateLimit(domain);
        return results;
      } catch (error) {
        attempts++;
        if (attempts >= maxAttempts) throw error;
        await this.exponentialBackoff(attempts);
      }
    }
    
    return [];
  }

  private async simulateWebSearch(query: ResearchQuery): Promise<ResearchResult[]> {
    // Simulate web search results
    const resultCount = Math.floor(Math.random() * 10) + 5;
    const results: ResearchResult[] = [];
    
    for (let i = 0; i < resultCount; i++) {
      results.push({
        id: generateId('result'),
        queryId: query.id,
        url: `https://example.com/result-${i}`,
        title: `Research Result ${i} for ${query.query}`,
        content: `Content for ${query.query} - result ${i}`,
        summary: `Summary of result ${i}`,
        credibilityScore: Math.random() * 0.4 + 0.6, // 0.6-1.0
        relevanceScore: Math.random() * 0.3 + 0.7, // 0.7-1.0
        sourceType: query.domains[0] || 'general',
        extractedAt: new Date(),
        metadata: { queryKeywords: query.keywords }
      });
    }
    
    return results;
  }

  private async rankResultsByCredibility(results: ResearchResult[]): Promise<ResearchResult[]> {
    // Sort by combined credibility and relevance score
    return results.sort((a, b) => {
      const scoreA = (a.credibilityScore * 0.6) + (a.relevanceScore * 0.4);
      const scoreB = (b.credibilityScore * 0.6) + (b.relevanceScore * 0.4);
      return scoreB - scoreA;
    });
  }

  private createParallelExtractionTasks(task: TaskDefinition, agent: any): Promise<any>[] {
    // Create parallel extraction tasks
    const results = task.input?.results || [];
    const batchSize = Math.ceil(results.length / this.connectionPool.max);
    const batches = [];
    
    for (let i = 0; i < results.length; i += batchSize) {
      const batch = results.slice(i, i + batchSize);
      batches.push(this.extractDataFromBatch(batch));
    }
    
    return batches;
  }

  private async extractDataFromBatch(batch: ResearchResult[]): Promise<any[]> {
    // Simulate parallel data extraction
    return batch.map(result => ({
      id: result.id,
      extractedData: `Extracted data from ${result.title}`,
      insights: [`Insight 1 from ${result.title}`, `Insight 2 from ${result.title}`],
      metadata: result.metadata
    }));
  }

  private deduplicateResults(results: any[]): any[] {
    const seen = new Set();
    return results.filter(result => {
      const key = result.extractedData || result.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private async performSemanticClustering(data: any[]): Promise<ResearchCluster[]> {
    // Simulate semantic clustering
    const clusterCount = Math.min(Math.ceil(data.length / 5), 10);
    const clusters: ResearchCluster[] = [];
    
    for (let i = 0; i < clusterCount; i++) {
      const clusterData = data.slice(i * 5, (i + 1) * 5);
      clusters.push({
        id: generateId('cluster'),
        topic: `Research Topic ${i + 1}`,
        results: clusterData,
        centroid: Array(10).fill(0).map(() => Math.random()),
        coherenceScore: Math.random() * 0.3 + 0.7,
        keywords: [`keyword${i}1`, `keyword${i}2`],
        summary: `Summary of cluster ${i + 1}`
      });
    }
    
    return clusters;
  }

  // Connection pooling methods
  private async getPooledConnection(): Promise<any> {
    if (this.connectionPool.active >= this.connectionPool.max) {
      await this.waitForConnection();
    }
    
    this.connectionPool.active++;
    return { id: generateId('connection'), timestamp: new Date() };
  }

  private releasePooledConnection(connection: any): void {
    this.connectionPool.active--;
    this.connectionPool.idle++;
  }

  private async waitForConnection(): Promise<void> {
    return new Promise(resolve => {
      const checkConnection = () => {
        if (this.connectionPool.active < this.connectionPool.max) {
          resolve();
        } else {
          setTimeout(checkConnection, 100);
        }
      };
      checkConnection();
    });
  }

  // Rate limiting methods
  private checkRateLimit(domain: string): boolean {
    const limiter = this.rateLimiters.get(domain);
    if (!limiter) {
      this.rateLimiters.set(domain, {
        requests: 0,
        windowStart: new Date(),
        windowSize: 60000, // 1 minute
        maxRequests: 10,
        backoffMultiplier: 1
      });
      return true;
    }

    const now = new Date();
    if (now.getTime() - limiter.windowStart.getTime() > limiter.windowSize) {
      limiter.requests = 0;
      limiter.windowStart = now;
    }

    return limiter.requests < limiter.maxRequests;
  }

  private updateRateLimit(domain: string): void {
    const limiter = this.rateLimiters.get(domain);
    if (limiter) {
      limiter.requests++;
    }
  }

  private async waitForRateLimit(domain: string): Promise<void> {
    const limiter = this.rateLimiters.get(domain);
    if (!limiter) return;

    const waitTime = limiter.windowSize * limiter.backoffMultiplier;
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }

  private async exponentialBackoff(attempt: number): Promise<void> {
    const delay = Math.pow(2, attempt) * 1000;
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  // Caching methods
  private generateCacheKey(type: string, data: string): string {
    return `${type}:${Buffer.from(data).toString('base64').substring(0, 32)}`;
  }

  private getFromCache(key: string): any | null {
    const entry = this.researchCache.get(key);
    if (!entry) return null;

    const now = new Date();
    if (now.getTime() - entry.timestamp.getTime() > entry.ttl) {
      this.researchCache.delete(key);
      return null;
    }

    entry.accessCount++;
    entry.lastAccessed = now;
    return entry.data;
  }

  private setCache(key: string, data: any, ttl: number): void {
    this.researchCache.set(key, {
      key,
      data,
      timestamp: new Date(),
      ttl,
      accessCount: 0,
      lastAccessed: new Date()
    });

    // Cleanup old entries if cache is too large
    if (this.researchCache.size > 1000) {
      this.cleanupCache();
    }
  }

  private cleanupCache(): void {
    const entries = Array.from(this.researchCache.entries());
    entries.sort((a, b) => a[1].lastAccessed.getTime() - b[1].lastAccessed.getTime());
    
    // Remove oldest 20% of entries
    const toRemove = Math.floor(entries.length * 0.2);
    for (let i = 0; i < toRemove; i++) {
      this.researchCache.delete(entries[i][0]);
    }
  }

  private createResearchTask(
    id: string,
    type: TaskType,
    name: string,
    instructions: string,
    options: any = {}
  ): TaskDefinition {
    const taskId: TaskId = {
      id: generateId('task'),
      swarmId: 'research-swarm',
      sequence: 1,
      priority: 1
    };

    return {
      id: taskId,
      type,
      name,
      description: instructions,
      instructions,
      requirements: {
        capabilities: options.requiredCapabilities || ['research'],
        tools: ['WebFetchTool', 'WebSearch'],
        permissions: ['read', 'write']
      },
      constraints: {
        dependencies: options.dependencies || [],
        dependents: [],
        conflicts: [],
        maxRetries: 3,
        timeoutAfter: options.estimatedDuration || 300000
      },
      priority: options.priority || 'medium',
      input: options.researchParams || {},
      context: {},
      examples: [],
      status: 'created',
      createdAt: new Date(),
      updatedAt: new Date(),
      attempts: [],
      statusHistory: [{
        timestamp: new Date(),
        from: 'created',
        to: 'created',
        reason: 'Task created',
        triggeredBy: 'system'
      }]
    };
  }

  protected updateResearchMetrics(taskType: string, duration: number): void {
    this.researchMetrics.queriesExecuted++;
    this.researchMetrics.averageResponseTime = 
      (this.researchMetrics.averageResponseTime + duration) / 2;
  }

  // Public API for metrics
  public override getMetrics() {
    return {
      ...this.metrics,
      cacheHitRate: this.researchMetrics.cacheHits / (this.researchMetrics.cacheHits + this.researchMetrics.cacheMisses),
      averageCredibilityScore: this.researchMetrics.credibilityScores.length > 0 
        ? this.researchMetrics.credibilityScores.reduce((a: number, b: number) => a + b, 0) / this.researchMetrics.credibilityScores.length 
        : 0,
      connectionPoolUtilization: this.connectionPool.active / this.connectionPool.max,
      cacheSize: this.researchCache.size
    };
  }

  // Progressive refinement methods
  async refineResearchScope(objective: SwarmObjective, intermediateResults: any[]): Promise<SwarmObjective> {
    this.logger.info('Refining research scope based on intermediate results', {
      objectiveId: objective.id,
      resultsCount: intermediateResults.length
    });

    // Analyze intermediate results to refine scope
    const refinedObjective = { ...objective };
    
    // Update requirements based on findings
    if (intermediateResults.length > 0) {
      const avgCredibility = intermediateResults
        .map(r => r.credibilityScore || 0.5)
        .reduce((a, b) => a + b, 0) / intermediateResults.length;
      
      if (avgCredibility < 0.7) {
        refinedObjective.requirements.qualityThreshold = Math.max(
          refinedObjective.requirements.qualityThreshold,
          0.8
        );
      }
    }

    return refinedObjective;
  }

  // Implement abstract methods from BaseStrategy
  async selectAgentForTask(task: TaskDefinition, availableAgents: AgentState[]): Promise<string | null> {
    // Filter agents that have research capabilities
    const researchAgents = availableAgents.filter(agent => 
      agent.status === 'idle' && 
      agent.capabilities.research &&
      agent.type === 'researcher'
    );

    if (researchAgents.length === 0) {
      this.logger.warn('No available research agents for task', { taskId: task.id });
      return null;
    }

    // Select agent with best performance metrics
    const bestAgent = researchAgents.reduce((best, current) => {
      const currentScore = (current.metrics?.successRate || 0) * 0.5 + 
                          (1 - (current.metrics?.averageExecutionTime || 1000000) / 1000000) * 0.5;
      const bestScore = (best.metrics?.successRate || 0) * 0.5 + 
                       (1 - (best.metrics?.averageExecutionTime || 1000000) / 1000000) * 0.5;
      
      return currentScore > bestScore ? current : best;
    });

    this.logger.info('Selected agent for research task', {
      taskId: task.id,
      agentId: bestAgent.id,
      agentType: bestAgent.type
    });

    return bestAgent.id.id;
  }

  async optimizeTaskSchedule(tasks: TaskDefinition[], agents: AgentState[]): Promise<any[]> {
    // Group tasks by priority and dependencies
    const taskGroups = new Map<TaskPriority, TaskDefinition[]>();
    
    tasks.forEach(task => {
      const priority = task.priority || 'medium';
      if (!taskGroups.has(priority)) {
        taskGroups.set(priority, []);
      }
      taskGroups.get(priority)!.push(task);
    });

    // Create agent allocations
    const allocations: any[] = [];
    const availableAgents = agents.filter(a => a.status === 'idle' && a.type === 'researcher');
    let agentIndex = 0;

    // Allocate high priority tasks first
    const priorities: TaskPriority[] = ['critical', 'high', 'normal', 'low', 'background'];
    
    for (const priority of priorities) {
      const priorityTasks = taskGroups.get(priority) || [];
      
      for (const task of priorityTasks) {
        if (agentIndex >= availableAgents.length) {
          agentIndex = 0; // Round-robin if we run out of agents
        }
        
        const agent = availableAgents[agentIndex];
        
        // Find or create allocation for this agent
        let allocation = allocations.find(a => a.agentId === agent.id.id);
        if (!allocation) {
          allocation = {
            agentId: agent.id.id,
            tasks: [],
            estimatedWorkload: 0,
            capabilities: []
          };
          allocations.push(allocation);
        }
        
        allocation.tasks.push(task.id.id);
        allocation.estimatedWorkload += this.estimateTaskDuration(task.description);
        
        agentIndex++;
      }
    }

    this.logger.info('Optimized task schedule', {
      totalTasks: tasks.length,
      totalAgents: availableAgents.length,
      allocations: allocations.length
    });

    return allocations;
  }

  private estimateTaskDuration(description: string): number {
    // Use the existing method from BaseStrategy
    const pattern = this.taskPatterns.find(p => p.pattern.test(description));
    return pattern ? pattern.estimatedDuration : 300000; // Default 5 minutes
  }
}