/**
 * Hive Mind Core System
 * Central orchestration and coordination logic
 */

import EventEmitter from 'events';
import { MCPToolWrapper } from './mcp-wrapper.js';
import { PerformanceOptimizer } from './performance-optimizer.js';

/**
 * HiveMindCore - Main orchestration class
 */
export class HiveMindCore extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      objective: '',
      name: `hive-${Date.now()}`,
      queenType: 'strategic',
      maxWorkers: 8,
      consensusAlgorithm: 'majority',
      autoScale: true,
      encryption: false,
      memorySize: 100, // MB
      taskTimeout: 60, // minutes
      ...config,
    };

    this.state = {
      status: 'initializing',
      swarmId: null,
      queen: null,
      workers: new Map(),
      tasks: new Map(),
      memory: new Map(),
      decisions: new Map(),
      metrics: {
        tasksCreated: 0,
        tasksCompleted: 0,
        decisionsReached: 0,
        memoryUsage: 0,
      },
    };

    this.mcpWrapper = new MCPToolWrapper({
      parallel: true,
      timeout: this.config.taskTimeout * 60 * 1000,
    });

    // Initialize performance optimizer
    this.performanceOptimizer = new PerformanceOptimizer({
      enableAsyncQueue: true,
      enableBatchProcessing: true,
      enableAutoTuning: true,
      asyncQueueConcurrency: Math.min(this.config.maxWorkers * 2, 20),
      batchMaxSize: 50,
      metricsInterval: 30000,
    });

    this._initializeEventHandlers();
    this._initializePerformanceMonitoring();
  }

  /**
   * Initialize event handlers
   */
  _initializeEventHandlers() {
    this.on('task:created', (task) => {
      this.state.metrics.tasksCreated++;
      this._checkAutoScale();
    });

    this.on('task:completed', (task) => {
      this.state.metrics.tasksCompleted++;
      this._updatePerformanceMetrics();
    });

    this.on('task:failed', (data) => {
      console.warn(`Task failed: ${data.task.id}`, data.error);
      this._handleTaskFailure(data.task, data.error);
    });

    this.on('decision:reached', (decision) => {
      this.state.metrics.decisionsReached++;
    });

    this.on('worker:idle', (workerId) => {
      this._assignNextTask(workerId);
    });

    this.on('error', (error) => {
      console.error('Hive Mind Error:', error);
      this._handleError(error);
    });
  }

  /**
   * Initialize performance monitoring
   */
  _initializePerformanceMonitoring() {
    // Listen to performance optimizer events
    this.performanceOptimizer.on('auto_tune', (data) => {
      this.emit('performance:auto_tuned', data);
    });

    this.performanceOptimizer.on('error', (error) => {
      console.error('Performance optimizer error:', error);
      this.emit('error', { type: 'performance_optimizer_error', error });
    });

    // Periodic performance reporting
    setInterval(() => {
      const stats = this.performanceOptimizer.getPerformanceStats();
      this.emit('performance:stats', stats);

      // Log performance warnings
      if (parseFloat(stats.asyncQueue.utilization) > 90) {
        console.warn('High async queue utilization:', stats.asyncQueue.utilization + '%');
      }

      if (parseFloat(stats.asyncQueue.successRate) < 95) {
        console.warn('Low async operation success rate:', stats.asyncQueue.successRate + '%');
      }
    }, 60000); // Every minute
  }

  /**
   * Handle task failure with recovery logic
   */
  _handleTaskFailure(task, error) {
    // Update metrics
    this.state.metrics.tasksFailed = (this.state.metrics.tasksFailed || 0) + 1;

    // Attempt task retry for recoverable failures
    if (task.retryCount < 2 && this._isRecoverableError(error)) {
      task.retryCount = (task.retryCount || 0) + 1;
      task.status = 'pending';

      // Find another worker for retry
      setTimeout(() => {
        const worker = this._findBestWorker(task);
        if (worker) {
          this._assignTask(worker.id, task.id);
        }
      }, 5000); // Wait 5 seconds before retry

      console.log(`Retrying task ${task.id} (attempt ${task.retryCount})`);
    }
  }

  /**
   * Check if error is recoverable
   */
  _isRecoverableError(error) {
    const recoverableErrors = ['timeout', 'network', 'temporary', 'connection'];

    return recoverableErrors.some((type) => error.message.toLowerCase().includes(type));
  }

  /**
   * Initialize the hive mind swarm
   */
  async initialize() {
    try {
      this.state.status = 'initializing';

      // Initialize swarm with MCP tools
      const [swarmInit, memoryInit, neuralInit] = await this.mcpWrapper.initializeSwarm({
        topology: this._determineTopology(),
        maxAgents: this.config.maxWorkers + 1, // +1 for queen
        swarmId: this.config.name,
      });

      this.state.swarmId = swarmInit.swarmId;

      // Store initial configuration in memory
      await this.mcpWrapper.storeMemory(this.state.swarmId, 'config', this.config, 'system');

      this.state.status = 'ready';
      this.emit('initialized', { swarmId: this.state.swarmId });

      return this.state.swarmId;
    } catch (error) {
      this.state.status = 'error';
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Determine optimal topology based on objective
   */
  _determineTopology() {
    const objective = this.config.objective.toLowerCase();

    // Heuristic topology selection
    if (objective.includes('research') || objective.includes('analysis')) {
      return 'mesh'; // Peer-to-peer for collaborative research
    } else if (objective.includes('build') || objective.includes('develop')) {
      return 'hierarchical'; // Clear command structure for development
    } else if (objective.includes('monitor') || objective.includes('maintain')) {
      return 'ring'; // Circular for continuous monitoring
    } else if (objective.includes('coordinate') || objective.includes('orchestrate')) {
      return 'star'; // Centralized for coordination
    }

    return 'hierarchical'; // Default
  }

  /**
   * Spawn the queen coordinator
   */
  async spawnQueen(queenData) {
    const [spawnResult] = await this.mcpWrapper.spawnAgents(['coordinator'], this.state.swarmId);

    this.state.queen = {
      id: queenData.id,
      agentId: spawnResult.agentId,
      type: this.config.queenType,
      status: 'active',
      decisions: 0,
      tasks: 0,
    };

    // Store queen info in memory
    await this.mcpWrapper.storeMemory(this.state.swarmId, 'queen', this.state.queen, 'system');

    this.emit('queen:spawned', this.state.queen);
    return this.state.queen;
  }

  /**
   * Spawn worker agents with batch optimization
   */
  async spawnWorkers(workerTypes) {
    const startTime = Date.now();

    try {
      // Batch spawn agents in parallel with optimized chunking
      const chunkSize = Math.min(workerTypes.length, 5); // Optimal batch size
      const chunks = [];

      for (let i = 0; i < workerTypes.length; i += chunkSize) {
        chunks.push(workerTypes.slice(i, i + chunkSize));
      }

      // Process chunks in parallel with Promise.all
      const allResults = await Promise.all(
        chunks.map((chunk) => this.mcpWrapper.spawnAgents(chunk, this.state.swarmId)),
      );

      // Flatten results
      const spawnResults = allResults.flat();

      // Batch create worker objects
      const workers = [];
      const workerUpdates = [];

      spawnResults.forEach((result, index) => {
        const worker = {
          id: `worker-${index}`,
          agentId: result.agentId,
          type: workerTypes[index],
          status: 'idle',
          tasksCompleted: 0,
          currentTask: null,
          spawnedAt: Date.now(),
          performance: {
            avgTaskTime: 0,
            successRate: 1.0,
          },
        };

        workers.push(worker);
        this.state.workers.set(worker.id, worker);

        workerUpdates.push({
          type: 'worker_spawned',
          workerId: worker.id,
          workerType: worker.type,
          timestamp: worker.spawnedAt,
        });
      });

      // Batch memory operations
      await Promise.all([
        this.mcpWrapper.storeMemory(this.state.swarmId, 'workers', workers, 'system'),
        this.mcpWrapper.storeMemory(
          this.state.swarmId,
          'worker_spawn_batch',
          {
            count: workers.length,
            types: workerTypes,
            spawnTime: Date.now() - startTime,
            updates: workerUpdates,
          },
          'metrics',
        ),
      ]);

      // Emit batch completion event
      this.emit('workers:spawned', {
        count: this.state.workers.size,
        batchSize: workers.length,
        spawnTime: Date.now() - startTime,
        workers: workers,
      });

      return workers;
    } catch (error) {
      this.emit('error', {
        type: 'spawn_batch_failed',
        error,
        workerTypes,
        spawnTime: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * Create and distribute task with performance optimization
   */
  async createTask(description, priority = 5, metadata = {}) {
    const timestamp = Date.now();
    const randomPart = Math.random().toString(36).substring(2, 11); // Use substring instead of substr
    const taskId = `task-${timestamp}-${randomPart}`;
    const createdAt = Date.now();

    const task = {
      id: taskId,
      swarmId: this.state.swarmId,
      description,
      priority,
      status: 'pending',
      createdAt: new Date(createdAt).toISOString(),
      assignedTo: null,
      result: null,
      metadata: {
        estimatedDuration: this._estimateTaskDuration(description),
        complexity: this._analyzeTaskComplexity(description),
        ...metadata,
      },
    };

    // Parallel operations: task storage, orchestration, and worker finding
    const [orchestrateResult, bestWorker] = await Promise.all([
      this.mcpWrapper.orchestrateTask(description, 'adaptive'),
      this._findBestWorkerAsync(task),
      // Store task immediately in parallel
      (async () => {
        this.state.tasks.set(task.id, task);
        await this.mcpWrapper.storeMemory(this.state.swarmId, `task-${task.id}`, task, 'task');
      })(),
    ]);

    task.orchestrationId = orchestrateResult[0].taskId;

    this.emit('task:created', task);

    // Assign task if worker available
    if (bestWorker) {
      // Use non-blocking assignment
      setImmediate(() => this._assignTask(bestWorker.id, task.id));
    }

    return task;
  }

  /**
   * Estimate task duration based on description analysis
   */
  _estimateTaskDuration(description) {
    const words = description.toLowerCase().split(/\s+/);
    const complexityKeywords = {
      simple: ['list', 'show', 'display', 'get', 'read'],
      medium: ['create', 'update', 'modify', 'change', 'build'],
      complex: ['analyze', 'optimize', 'refactor', 'implement', 'design'],
    };

    let score = 1;
    for (const word of words) {
      if (complexityKeywords.complex.includes(word)) score += 3;
      else if (complexityKeywords.medium.includes(word)) score += 2;
      else if (complexityKeywords.simple.includes(word)) score += 1;
    }

    return Math.min(score * 5000, 60000); // Cap at 1 minute
  }

  /**
   * Analyze task complexity
   */
  _analyzeTaskComplexity(description) {
    const words = description.toLowerCase().split(/\s+/);
    const indicators = {
      high: ['optimize', 'refactor', 'architecture', 'design', 'algorithm'],
      medium: ['implement', 'build', 'create', 'develop', 'integrate'],
      low: ['list', 'show', 'get', 'read', 'display'],
    };

    for (const [level, keywords] of Object.entries(indicators)) {
      if (keywords.some((keyword) => words.includes(keyword))) {
        return level;
      }
    }

    return 'medium';
  }

  /**
   * Find best worker for task (optimized async version)
   */
  async _findBestWorkerAsync(task) {
    const availableWorkers = Array.from(this.state.workers.values()).filter(
      (w) => w.status === 'idle',
    );

    if (availableWorkers.length === 0) {
      return null;
    }

    // Use cached analysis if available
    const cacheKey = `worker_match_${task.description.substring(0, 50)}`;
    const cachedMatch = await this.mcpWrapper.retrieveMemory(this.state.swarmId, cacheKey);

    if (cachedMatch && cachedMatch.timestamp > Date.now() - 300000) {
      // 5 min cache
      const cachedWorker = availableWorkers.find((w) => w.type === cachedMatch.workerType);
      if (cachedWorker) return cachedWorker;
    }

    // Enhanced matching algorithm with performance scoring
    const taskLower = task.description.toLowerCase();
    const taskWords = taskLower.split(/\s+/);

    // Enhanced priority mapping with weights
    const priorityMap = {
      researcher: {
        keywords: ['research', 'investigate', 'analyze', 'study', 'explore'],
        weight: 1.2,
      },
      coder: {
        keywords: ['code', 'implement', 'build', 'develop', 'fix', 'create', 'program'],
        weight: 1.0,
      },
      analyst: {
        keywords: ['analyze', 'data', 'metrics', 'performance', 'report', 'statistics'],
        weight: 1.1,
      },
      tester: { keywords: ['test', 'validate', 'check', 'verify', 'quality', 'qa'], weight: 1.0 },
      architect: {
        keywords: ['design', 'architecture', 'structure', 'plan', 'system'],
        weight: 1.3,
      },
      reviewer: { keywords: ['review', 'feedback', 'improve', 'refactor', 'audit'], weight: 1.0 },
      optimizer: {
        keywords: ['optimize', 'performance', 'speed', 'efficiency', 'enhance'],
        weight: 1.4,
      },
      documenter: { keywords: ['document', 'explain', 'write', 'describe', 'manual'], weight: 0.9 },
    };

    // Calculate scores for each worker
    const workerScores = availableWorkers.map((worker) => {
      const typeInfo = priorityMap[worker.type] || { keywords: [], weight: 1.0 };

      // Keyword matching score
      const keywordScore = typeInfo.keywords.reduce((score, keyword) => {
        return score + (taskWords.includes(keyword) ? 1 : 0);
      }, 0);

      // Performance history score
      const performanceScore = worker.performance
        ? worker.performance.successRate * 0.5 + (1 / (worker.performance.avgTaskTime + 1)) * 0.5
        : 0.5;

      // Task completion rate
      const completionScore =
        worker.tasksCompleted > 0 ? Math.min(worker.tasksCompleted / 10, 1) : 0;

      // Combined score
      const totalScore =
        (keywordScore * 2 + // Keyword relevance
          performanceScore * 1.5 + // Historical performance
          completionScore * 1.0) * // Experience
        typeInfo.weight;

      return {
        worker,
        score: totalScore,
        breakdown: {
          keyword: keywordScore,
          performance: performanceScore,
          completion: completionScore,
          weight: typeInfo.weight,
        },
      };
    });

    // Sort by score and select best
    workerScores.sort((a, b) => b.score - a.score);
    const bestMatch = workerScores[0];

    // Cache the result for future use
    if (bestMatch.score > 0) {
      setImmediate(async () => {
        await this.mcpWrapper.storeMemory(
          this.state.swarmId,
          cacheKey,
          {
            workerType: bestMatch.worker.type,
            score: bestMatch.score,
            timestamp: Date.now(),
          },
          'cache',
        );
      });
    }

    return bestMatch ? bestMatch.worker : availableWorkers[0];
  }

  /**
   * Synchronous version for backward compatibility
   */
  _findBestWorker(task) {
    const availableWorkers = Array.from(this.state.workers.values()).filter(
      (w) => w.status === 'idle',
    );

    if (availableWorkers.length === 0) {
      return null;
    }

    // Simplified scoring for sync version
    const taskLower = task.description.toLowerCase();
    const priorityMap = {
      researcher: ['research', 'investigate', 'analyze', 'study'],
      coder: ['code', 'implement', 'build', 'develop', 'fix', 'create'],
      analyst: ['analyze', 'data', 'metrics', 'performance', 'report'],
      tester: ['test', 'validate', 'check', 'verify', 'quality'],
      architect: ['design', 'architecture', 'structure', 'plan'],
      reviewer: ['review', 'feedback', 'improve', 'refactor'],
      optimizer: ['optimize', 'performance', 'speed', 'efficiency'],
      documenter: ['document', 'explain', 'write', 'describe'],
    };

    let bestWorker = null;
    let bestScore = 0;

    for (const worker of availableWorkers) {
      const keywords = priorityMap[worker.type] || [];
      const keywordScore = keywords.filter((k) => taskLower.includes(k)).length;
      const performanceBonus = worker.performance ? worker.performance.successRate * 0.5 : 0;
      const totalScore = keywordScore + performanceBonus;

      if (totalScore > bestScore) {
        bestScore = totalScore;
        bestWorker = worker;
      }
    }

    return bestWorker || availableWorkers[0];
  }

  /**
   * Assign task to worker
   */
  async _assignTask(workerId, taskId) {
    const worker = this.state.workers.get(workerId);
    const task = this.state.tasks.get(taskId);

    if (!worker || !task) return;

    worker.status = 'busy';
    worker.currentTask = taskId;
    task.status = 'in_progress';
    task.assignedTo = workerId;

    // Store assignment in memory
    await this.mcpWrapper.storeMemory(
      this.state.swarmId,
      `assignment-${taskId}`,
      { workerId, taskId, timestamp: Date.now() },
      'task',
    );

    this.emit('task:assigned', { workerId, taskId });

    // Simulate task execution
    this._executeTask(workerId, taskId);
  }

  /**
   * Execute task with performance optimization
   */
  async _executeTask(workerId, taskId) {
    const worker = this.state.workers.get(workerId);
    const task = this.state.tasks.get(taskId);
    const startTime = Date.now();

    try {
      // Use performance optimizer for async execution
      const result = await this.performanceOptimizer.optimizeAsyncOperation(
        async () => {
          // Simulate task execution based on complexity
          const baseDuration = {
            low: 5000,
            medium: 15000,
            high: 30000,
          }[task.metadata?.complexity || 'medium'];

          const duration = baseDuration + Math.random() * baseDuration * 0.5;

          return new Promise((resolve) => {
            setTimeout(() => {
              resolve({
                status: 'completed',
                result: `Task completed by ${worker.type} worker`,
                processingTime: Date.now() - startTime,
                complexity: task.metadata?.complexity || 'medium',
              });
            }, duration);
          });
        },
        { priority: task.priority },
      );

      // Update task and worker
      task.status = 'completed';
      task.completedAt = new Date().toISOString();
      task.result = result.result;
      task.actualDuration = result.processingTime;

      worker.status = 'idle';
      worker.currentTask = null;
      worker.tasksCompleted++;

      // Update worker performance metrics
      if (!worker.performance.avgTaskTime) {
        worker.performance.avgTaskTime = result.processingTime;
      } else {
        worker.performance.avgTaskTime =
          (worker.performance.avgTaskTime * (worker.tasksCompleted - 1) + result.processingTime) /
          worker.tasksCompleted;
      }

      // Batch store results for better performance
      await this.performanceOptimizer.optimizeBatchOperation(
        'task_results',
        {
          key: `result-${taskId}`,
          value: task,
          type: 'result',
        },
        async (items) => {
          // Batch store all results
          await Promise.all(
            items.map((item) =>
              this.mcpWrapper.storeMemory(this.state.swarmId, item.key, item.value, item.type),
            ),
          );
          return items.map(() => ({ success: true }));
        },
      );

      this.emit('task:completed', task);
      this.emit('worker:idle', workerId);
    } catch (error) {
      // Handle task failure
      task.status = 'failed';
      task.error = error.message;
      task.failedAt = new Date().toISOString();

      worker.status = 'idle';
      worker.currentTask = null;
      worker.performance.successRate =
        (worker.performance.successRate * worker.tasksCompleted) / (worker.tasksCompleted + 1);

      this.emit('task:failed', { task, error });
      this.emit('worker:idle', workerId);
    }
  }

  /**
   * Assign next task to idle worker
   */
  _assignNextTask(workerId) {
    const pendingTasks = Array.from(this.state.tasks.values())
      .filter((t) => t.status === 'pending')
      .sort((a, b) => b.priority - a.priority);

    if (pendingTasks.length > 0) {
      this._assignTask(workerId, pendingTasks[0].id);
    }
  }

  /**
   * Build consensus for decision
   */
  async buildConsensus(topic, options) {
    const decision = {
      id: `decision-${Date.now()}`,
      swarmId: this.state.swarmId,
      topic,
      options,
      votes: new Map(),
      algorithm: this.config.consensusAlgorithm,
      status: 'voting',
      createdAt: new Date().toISOString(),
    };

    this.state.decisions.set(decision.id, decision);

    // Simulate voting process
    const workers = Array.from(this.state.workers.values());
    const votes = {};

    // Each worker votes
    workers.forEach((worker) => {
      const vote = options[Math.floor(Math.random() * options.length)];
      votes[worker.id] = vote;
      decision.votes.set(worker.id, vote);
    });

    // Queen gets weighted vote
    const queenVote = options[Math.floor(Math.random() * options.length)];
    votes['queen'] = queenVote;
    decision.votes.set('queen', queenVote);

    // Calculate consensus
    const result = this._calculateConsensus(decision);
    decision.result = result.decision;
    decision.confidence = result.confidence;
    decision.status = 'completed';

    // Convert Map to plain object for proper JSON serialization
    const decisionForStorage = {
      ...decision,
      votes: decision.votes instanceof Map ? Object.fromEntries(decision.votes) : decision.votes,
    };

    // Store decision in memory
    await this.mcpWrapper.storeMemory(
      this.state.swarmId,
      `decision-${decision.id}`,
      decisionForStorage,
      'consensus',
    );

    this.emit('decision:reached', decision);
    return decision;
  }

  /**
   * Calculate consensus based on algorithm
   */
  _calculateConsensus(decision) {
    const votes = Array.from(decision.votes.values());
    const voteCount = {};

    // Count votes
    votes.forEach((vote) => {
      voteCount[vote] = (voteCount[vote] || 0) + 1;
    });

    switch (decision.algorithm) {
      case 'majority':
        // Simple majority
        const sorted = Object.entries(voteCount).sort((a, b) => b[1] - a[1]);
        const winner = sorted[0];
        return {
          decision: winner[0],
          confidence: winner[1] / votes.length,
        };

      case 'weighted':
        // Weight queen vote more heavily
        const queenVote = decision.votes.get('queen');
        voteCount[queenVote] = (voteCount[queenVote] || 0) + 2; // Queen counts as 3 votes

        const weightedSorted = Object.entries(voteCount).sort((a, b) => b[1] - a[1]);
        const weightedWinner = weightedSorted[0];
        return {
          decision: weightedWinner[0],
          confidence: weightedWinner[1] / (votes.length + 2),
        };

      case 'byzantine':
        // Requires 2/3 majority
        const byzantineSorted = Object.entries(voteCount).sort((a, b) => b[1] - a[1]);
        const byzantineWinner = byzantineSorted[0];
        const byzantineConfidence = byzantineWinner[1] / votes.length;

        if (byzantineConfidence >= 0.67) {
          return {
            decision: byzantineWinner[0],
            confidence: byzantineConfidence,
          };
        } else {
          return {
            decision: 'no_consensus',
            confidence: 0,
          };
        }

      default:
        return {
          decision: 'unknown',
          confidence: 0,
        };
    }
  }

  /**
   * Check if auto-scaling is needed
   */
  async _checkAutoScale() {
    if (!this.config.autoScale) return;

    const pendingTasks = Array.from(this.state.tasks.values()).filter(
      (t) => t.status === 'pending',
    ).length;

    const idleWorkers = Array.from(this.state.workers.values()).filter(
      (w) => w.status === 'idle',
    ).length;

    // Scale up if too many pending tasks
    if (pendingTasks > idleWorkers * 2 && this.state.workers.size < this.config.maxWorkers) {
      const newWorkerType = this._determineWorkerType();
      await this.spawnWorkers([newWorkerType]);
      console.log(`Auto-scaled: Added ${newWorkerType} worker`);
    }

    // Scale down if too many idle workers
    if (idleWorkers > pendingTasks + 2 && this.state.workers.size > 2) {
      // TODO: Implement worker removal
    }
  }

  /**
   * Determine worker type for auto-scaling
   */
  _determineWorkerType() {
    // Analyze pending tasks to determine needed worker type
    const pendingTasks = Array.from(this.state.tasks.values()).filter(
      (t) => t.status === 'pending',
    );

    // Simple heuristic based on task descriptions
    const typeScores = {};

    pendingTasks.forEach((task) => {
      const taskLower = task.description.toLowerCase();

      if (taskLower.includes('code') || taskLower.includes('implement')) {
        typeScores.coder = (typeScores.coder || 0) + 1;
      }
      if (taskLower.includes('test') || taskLower.includes('validate')) {
        typeScores.tester = (typeScores.tester || 0) + 1;
      }
      if (taskLower.includes('analyze') || taskLower.includes('data')) {
        typeScores.analyst = (typeScores.analyst || 0) + 1;
      }
      if (taskLower.includes('research') || taskLower.includes('investigate')) {
        typeScores.researcher = (typeScores.researcher || 0) + 1;
      }
    });

    // Return type with highest score
    const sorted = Object.entries(typeScores).sort((a, b) => b[1] - a[1]);
    return sorted.length > 0 ? sorted[0][0] : 'coder'; // Default to coder
  }

  /**
   * Update performance metrics
   */
  async _updatePerformanceMetrics() {
    // Calculate performance metrics
    const completionRate = this.state.metrics.tasksCompleted / this.state.metrics.tasksCreated;
    const avgTasksPerWorker = this.state.metrics.tasksCompleted / this.state.workers.size;

    // Store metrics in memory
    await this.mcpWrapper.storeMemory(
      this.state.swarmId,
      'metrics',
      {
        ...this.state.metrics,
        completionRate,
        avgTasksPerWorker,
        timestamp: Date.now(),
      },
      'metrics',
    );

    // Analyze performance if needed
    if (this.state.metrics.tasksCompleted % 10 === 0) {
      await this.mcpWrapper.analyzePerformance(this.state.swarmId);
    }
  }

  /**
   * Handle errors
   */
  _handleError(error) {
    // Log error to memory
    this.mcpWrapper
      .storeMemory(
        this.state.swarmId,
        `error-${Date.now()}`,
        {
          message: error.message,
          stack: error.stack,
          timestamp: Date.now(),
        },
        'error',
      )
      .catch(console.error);
  }

  /**
   * Get current status with performance metrics
   */
  getStatus() {
    const tasks = Array.from(this.state.tasks.values());
    const workers = Array.from(this.state.workers.values());

    return {
      swarmId: this.state.swarmId,
      status: this.state.status,
      queen: this.state.queen,
      workers: workers,
      tasks: {
        total: this.state.tasks.size,
        pending: tasks.filter((t) => t.status === 'pending').length,
        inProgress: tasks.filter((t) => t.status === 'in_progress').length,
        completed: tasks.filter((t) => t.status === 'completed').length,
        failed: tasks.filter((t) => t.status === 'failed').length,
      },
      metrics: {
        ...this.state.metrics,
        averageTaskTime: this._calculateAverageTaskTime(tasks),
        workerEfficiency: this._calculateWorkerEfficiency(workers),
        throughput: this._calculateThroughput(tasks),
      },
      decisions: this.state.decisions.size,
      performance: this.performanceOptimizer.getPerformanceStats(),
    };
  }

  /**
   * Calculate average task completion time
   */
  _calculateAverageTaskTime(tasks) {
    const completedTasks = tasks.filter((t) => t.status === 'completed' && t.actualDuration);
    if (completedTasks.length === 0) return 0;

    const totalTime = completedTasks.reduce((sum, task) => sum + task.actualDuration, 0);
    return Math.round(totalTime / completedTasks.length);
  }

  /**
   * Calculate worker efficiency
   */
  _calculateWorkerEfficiency(workers) {
    if (workers.length === 0) return 0;

    const efficiencies = workers.map((worker) => worker.performance?.successRate || 1.0);
    return ((efficiencies.reduce((sum, eff) => sum + eff, 0) / workers.length) * 100).toFixed(2);
  }

  /**
   * Calculate system throughput (tasks per minute)
   */
  _calculateThroughput(tasks) {
    const completedTasks = tasks.filter((t) => t.status === 'completed' && t.completedAt);
    if (completedTasks.length < 2) return 0;

    const firstCompleted = new Date(completedTasks[0].completedAt).getTime();
    const lastCompleted = new Date(completedTasks[completedTasks.length - 1].completedAt).getTime();
    const timeSpanMinutes = (lastCompleted - firstCompleted) / (1000 * 60);

    return timeSpanMinutes > 0 ? (completedTasks.length / timeSpanMinutes).toFixed(2) : 0;
  }

  /**
   * Shutdown hive mind with cleanup
   */
  async shutdown() {
    this.state.status = 'shutting_down';

    try {
      // Generate final performance report
      const performanceReport = this.performanceOptimizer.generatePerformanceReport();

      // Save final state and performance report
      await Promise.all([
        this.mcpWrapper.storeMemory(this.state.swarmId, 'final_state', this.getStatus(), 'system'),
        this.mcpWrapper.storeMemory(
          this.state.swarmId,
          'final_performance_report',
          performanceReport,
          'metrics',
        ),
      ]);

      // Close performance optimizer
      await this.performanceOptimizer.close();

      // Destroy swarm
      await this.mcpWrapper.destroySwarm(this.state.swarmId);

      this.state.status = 'shutdown';
      this.emit('shutdown', { performanceReport });
    } catch (error) {
      this.emit('error', { type: 'shutdown_failed', error });
      throw error;
    }
  }

  /**
   * Get performance insights and recommendations
   */
  getPerformanceInsights() {
    return this.performanceOptimizer.generatePerformanceReport();
  }
}
