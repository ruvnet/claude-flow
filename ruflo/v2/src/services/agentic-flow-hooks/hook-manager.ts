/**
 * Agentic Flow Hook Manager
 * 
 * Central manager for all agentic-flow hooks, providing registration,
 * execution, and lifecycle management.
 */

import { EventEmitter } from 'events';
import { Logger } from '../../core/logger.js';
import { HookMatcher } from '../../hooks/hook-matchers.js';
import type {
  AgenticHookContext,
  AgenticHookType,
  HookFilter,
  HookHandler,
  HookHandlerResult,
  HookOptions,
  HookPayload,
  HookPipeline,
  HookRegistration,
  HookRegistry,
  PipelineMetrics,
  PipelineStage,
  SideEffect,
} from './types.js';

const logger = new Logger({
  level: 'info',
  format: 'text',
  destination: 'console'
}, { prefix: 'AgenticHookManager' });

export class AgenticHookManager extends EventEmitter implements HookRegistry {
  private hooks: Map<AgenticHookType, HookRegistration[]> = new Map();
  private pipelines: Map<string, HookPipeline> = new Map();
  private metrics: Map<string, any> = new Map();
  private activeExecutions: Set<string> = new Set();
  private hookMatcher: HookMatcher;

  constructor() {
    super();
    this.initializeMetrics();
    this.hookMatcher = new HookMatcher({
      cacheEnabled: true,
      cacheTTL: 60000,
      matchStrategy: 'all',
    });
  }

  /**
   * Register a new hook
   */
  register(registration: HookRegistration): void {
    const { type, id } = registration;
    
    // Validate registration
    this.validateRegistration(registration);
    
    // Get or create hook list for type
    if (!this.hooks.has(type)) {
      this.hooks.set(type, []);
    }
    
    const hookList = this.hooks.get(type)!;
    
    // Check for duplicate ID
    if (hookList.some(h => h.id === id)) {
      throw new Error(`Hook with ID '${id}' already registered for type '${type}'`);
    }
    
    // Insert hook sorted by priority (higher priority first)
    const insertIndex = hookList.findIndex(h => h.priority < registration.priority);
    if (insertIndex === -1) {
      hookList.push(registration);
    } else {
      hookList.splice(insertIndex, 0, registration);
    }
    
    logger.info(`Registered hook '${id}' for type '${type}' with priority ${registration.priority}`);
    this.emit('hook:registered', { type, registration });
    
    // Update metrics
    this.updateMetric('hooks.registered', 1);
  }

  /**
   * Unregister a hook
   */
  unregister(id: string): void {
    let found = false;
    
    for (const [type, hookList] of this.hooks.entries()) {
      const index = hookList.findIndex(h => h.id === id);
      if (index !== -1) {
        hookList.splice(index, 1);
        found = true;
        
        logger.info(`Unregistered hook '${id}' from type '${type}'`);
        this.emit('hook:unregistered', { type, id });
        
        // Clean up empty lists
        if (hookList.length === 0) {
          this.hooks.delete(type);
        }
        
        break;
      }
    }
    
    if (!found) {
      throw new Error(`Hook with ID '${id}' not found`);
    }
    
    this.updateMetric('hooks.unregistered', 1);
  }

  /**
   * Get hooks by type with optional filtering
   */
  getHooks(type: AgenticHookType, filter?: HookFilter): HookRegistration[] {
    const hookList = this.hooks.get(type) || [];
    
    if (!filter) {
      return [...hookList];
    }
    
    return hookList.filter(hook => this.matchesFilter(hook, filter));
  }

  /**
   * Execute hooks for a given type
   */
  async executeHooks(
    type: AgenticHookType,
    payload: HookPayload,
    context: AgenticHookContext
  ): Promise<HookHandlerResult[]> {
    const executionId = this.generateExecutionId();
    this.activeExecutions.add(executionId);

    const startTime = Date.now();
    const results: HookHandlerResult[] = [];

    try {
      // Get all hooks for this type
      const allHooks = this.hooks.get(type) || [];

      // Use hook matcher to filter applicable hooks (2-3x performance improvement)
      const matchedHooks: HookRegistration[] = [];
      for (const hook of allHooks) {
        const matchResult = await this.hookMatcher.match(hook, context, payload);
        if (matchResult.matched) {
          matchedHooks.push(hook);

          // Track matcher performance
          this.updateMetric('hooks.matcher.executionTime', matchResult.executionTime);
          if (matchResult.cacheHit) {
            this.updateMetric('hooks.matcher.cacheHits', 1);
          }
        }
      }

      logger.debug(`Executing ${matchedHooks.length}/${allHooks.length} matched hooks for type '${type}'`);
      this.emit('hooks:executing', {
        type,
        total: allHooks.length,
        matched: matchedHooks.length,
        executionId
      });

      // Execute matched hooks in order
      let modifiedPayload = payload;
      for (const hook of matchedHooks) {
        try {
          const result = await this.executeHook(hook, modifiedPayload, context);
          results.push(result);

          // Handle side effects
          if (result.sideEffects) {
            await this.processSideEffects(result.sideEffects, context);
          }

          // Update payload if modified
          if (result.modified && result.payload) {
            modifiedPayload = result.payload;
          }

          // Check if we should continue
          if (!result.continue) {
            logger.debug(`Hook '${hook.id}' halted execution chain`);
            break;
          }
        } catch (error) {
          await this.handleHookError(hook, error as Error, context);

          // Determine if we should continue after error
          if (hook.options?.errorHandler) {
            hook.options.errorHandler(error as Error);
          } else {
            throw error; // Re-throw if no error handler
          }
        }
      }
      
      // Update metrics
      const duration = Date.now() - startTime;
      this.updateMetric('hooks.executions', 1);
      this.updateMetric('hooks.totalDuration', duration);
      this.updateMetric(`hooks.${type}.executions`, 1);
      this.updateMetric(`hooks.${type}.duration`, duration);
      
      this.emit('hooks:executed', { 
        type, 
        results, 
        duration, 
        executionId 
      });
      
      return results;
    } finally {
      this.activeExecutions.delete(executionId);
    }
  }

  /**
   * Create a new hook pipeline
   */
  createPipeline(config: Partial<HookPipeline>): HookPipeline {
    const pipeline: HookPipeline = {
      id: config.id || this.generatePipelineId(),
      name: config.name || 'Unnamed Pipeline',
      stages: config.stages || [],
      errorStrategy: config.errorStrategy || 'fail-fast',
      metrics: {
        executions: 0,
        avgDuration: 0,
        errorRate: 0,
        throughput: 0,
      },
    };
    
    this.pipelines.set(pipeline.id, pipeline);
    logger.info(`Created pipeline '${pipeline.name}' with ID '${pipeline.id}'`);
    
    return pipeline;
  }

  /**
   * Execute a pipeline
   */
  async executePipeline(
    pipelineId: string,
    initialPayload: HookPayload,
    context: AgenticHookContext
  ): Promise<HookHandlerResult[]> {
    const pipeline = this.pipelines.get(pipelineId);
    if (!pipeline) {
      throw new Error(`Pipeline '${pipelineId}' not found`);
    }
    
    const startTime = Date.now();
    const results: HookHandlerResult[] = [];
    let currentPayload = initialPayload;
    
    try {
      for (const stage of pipeline.stages) {
        // Check stage condition
        if (stage.condition && !stage.condition(context)) {
          logger.debug(`Skipping stage '${stage.name}' due to condition`);
          continue;
        }
        
        // Execute stage hooks
        const stageResults = await this.executeStage(
          stage, 
          currentPayload, 
          context
        );
        
        // Apply stage transform if provided
        if (stage.transform) {
          for (let i = 0; i < stageResults.length; i++) {
            stageResults[i] = stage.transform(stageResults[i]);
          }
        }
        
        results.push(...stageResults);
        
        // Update payload for next stage
        const lastModified = stageResults
          .reverse()
          .find(r => r.modified && r.payload);
        if (lastModified) {
          currentPayload = lastModified.payload;
        }
      }
      
      // Update pipeline metrics
      this.updatePipelineMetrics(pipeline, Date.now() - startTime, false);
      
      return results;
    } catch (error) {
      // Update error metrics
      this.updatePipelineMetrics(pipeline, Date.now() - startTime, true);
      
      // Handle error based on strategy
      if (pipeline.errorStrategy === 'rollback') {
        await this.rollbackPipeline(pipeline, results, context);
      }
      
      throw error;
    }
  }

  /**
   * Get current metrics
   */
  getMetrics(): Record<string, any> {
    const metrics: Record<string, any> = {};

    for (const [key, value] of this.metrics.entries()) {
      metrics[key] = value;
    }

    // Add computed metrics
    metrics['hooks.count'] = this.getTotalHookCount();
    metrics['hooks.types'] = Array.from(this.hooks.keys());
    metrics['pipelines.count'] = this.pipelines.size;
    metrics['executions.active'] = this.activeExecutions.size;

    // Add matcher metrics
    const matcherStats = this.hookMatcher.getCacheStats();
    metrics['hooks.matcher.cacheSize'] = matcherStats.size;
    metrics['hooks.matcher.cacheHitRate'] = matcherStats.hitRate;

    return metrics;
  }

  /**
   * Clear hook matcher cache
   */
  clearMatcherCache(): void {
    this.hookMatcher.clearCache();
    logger.info('Hook matcher cache cleared');
  }

  /**
   * Prune matcher cache
   */
  pruneMatcherCache(): number {
    const pruned = this.hookMatcher.pruneCache();
    logger.info(`Pruned ${pruned} expired matcher cache entries`);
    return pruned;
  }

  // ===== Private Methods =====

  private validateRegistration(registration: HookRegistration): void {
    if (!registration.id) {
      throw new Error('Hook registration must have an ID');
    }
    
    if (!registration.type) {
      throw new Error('Hook registration must have a type');
    }
    
    if (typeof registration.handler !== 'function') {
      throw new Error('Hook registration must have a handler function');
    }
    
    if (registration.priority < 0) {
      throw new Error('Hook priority must be non-negative');
    }
  }

  private matchesFilter(hook: HookRegistration, filter: HookFilter): boolean {
    if (!hook.filter) {
      return true; // No filter means hook applies to all
    }
    
    // Check providers
    if (filter.providers && hook.filter.providers) {
      const hasProvider = filter.providers.some(p => 
        hook.filter!.providers!.includes(p)
      );
      if (!hasProvider) return false;
    }
    
    // Check models
    if (filter.models && hook.filter.models) {
      const hasModel = filter.models.some(m => 
        hook.filter!.models!.includes(m)
      );
      if (!hasModel) return false;
    }
    
    // Check patterns
    if (filter.patterns && hook.filter.patterns) {
      // Complex pattern matching logic here
      // For now, simplified version
      return true;
    }
    
    // Check conditions
    if (filter.conditions && hook.filter.conditions) {
      // Evaluate conditions
      // Simplified for now
      return true;
    }
    
    return true;
  }

  private createFilterFromPayload(payload: HookPayload): HookFilter | undefined {
    const filter: HookFilter = {};
    
    // Extract filter criteria from payload
    if ('provider' in payload) {
      filter.providers = [payload.provider];
    }
    
    if ('model' in payload) {
      filter.models = [payload.model];
    }
    
    if ('operation' in payload) {
      filter.operations = [payload.operation];
    }
    
    if ('namespace' in payload) {
      filter.namespaces = [payload.namespace];
    }
    
    return Object.keys(filter).length > 0 ? filter : undefined;
  }

  private async executeHook(
    hook: HookRegistration,
    payload: HookPayload,
    context: AgenticHookContext
  ): Promise<HookHandlerResult> {
    const startTime = Date.now();
    
    try {
      // Check cache if enabled
      if (hook.options?.cache?.enabled) {
        const cacheKey = hook.options.cache.key(payload);
        const cached = this.getCachedResult(hook.id, cacheKey);
        if (cached) {
          this.updateMetric('hooks.cacheHits', 1);
          return cached;
        }
      }
      
      // Execute with timeout if specified
      let resultPromise = hook.handler(payload, context);
      
      if (hook.options?.timeout) {
        resultPromise = this.withTimeout(
          resultPromise, 
          hook.options.timeout,
          `Hook '${hook.id}' timed out`
        );
      }
      
      const result = await resultPromise;
      
      // Cache result if enabled
      if (hook.options?.cache?.enabled && result) {
        const cacheKey = hook.options.cache.key(payload);
        this.cacheResult(hook.id, cacheKey, result, hook.options.cache.ttl);
      }
      
      // Update hook-specific metrics
      const duration = Date.now() - startTime;
      this.updateMetric(`hooks.${hook.id}.executions`, 1);
      this.updateMetric(`hooks.${hook.id}.duration`, duration);
      
      return result;
    } catch (error) {
      // Handle retries if configured
      if (hook.options?.retries && hook.options.retries > 0) {
        logger.warn(`Hook '${hook.id}' failed, retrying...`);
        return this.retryHook(hook, payload, context, hook.options.retries);
      }
      
      // Use fallback if provided
      if (hook.options?.fallback) {
        logger.warn(`Hook '${hook.id}' failed, using fallback`);
        return hook.options.fallback(payload, context);
      }
      
      throw error;
    }
  }

  private async retryHook(
    hook: HookRegistration,
    payload: HookPayload,
    context: AgenticHookContext,
    retriesLeft: number
  ): Promise<HookHandlerResult> {
    for (let i = 0; i < retriesLeft; i++) {
      try {
        await this.delay(Math.pow(2, i) * 1000); // Exponential backoff
        return await hook.handler(payload, context);
      } catch (error) {
        if (i === retriesLeft - 1) {
          throw error; // Last retry failed
        }
      }
    }
    
    // Should not reach here
    throw new Error('Retry logic error');
  }

  private async processSideEffects(
    sideEffects: SideEffect[],
    context: AgenticHookContext
  ): Promise<void> {
    for (const effect of sideEffects) {
      try {
        await this.processSideEffect(effect, context);
      } catch (error) {
        logger.error(`Failed to process side effect: ${effect.type}`, error);
        // Continue processing other side effects
      }
    }
  }

  private async processSideEffect(
    effect: SideEffect,
    context: AgenticHookContext
  ): Promise<void> {
    switch (effect.type) {
      case 'memory':
        await this.processMemorySideEffect(effect, context);
        break;
      
      case 'neural':
        await this.processNeuralSideEffect(effect, context);
        break;
      
      case 'metric':
        this.processMetricSideEffect(effect);
        break;
      
      case 'notification':
        this.processNotificationSideEffect(effect);
        break;
      
      case 'log':
        this.processLogSideEffect(effect);
        break;
    }
  }

  private async processMemorySideEffect(
    effect: SideEffect,
    context: AgenticHookContext
  ): Promise<void> {
    // Implement memory side effect processing
    // This would integrate with the memory service
    logger.debug(`Processing memory side effect: ${effect.action}`, effect.data);
  }

  private async processNeuralSideEffect(
    effect: SideEffect,
    context: AgenticHookContext
  ): Promise<void> {
    // Implement neural side effect processing
    // This would integrate with the neural service
    logger.debug(`Processing neural side effect: ${effect.action}`, effect.data);
  }

  private processMetricSideEffect(effect: SideEffect): void {
    if (effect.action === 'update') {
      this.updateMetric(effect.data.name, effect.data.value);
    } else if (effect.action === 'increment') {
      this.updateMetric(effect.data.name, 1);
    }
  }

  private processNotificationSideEffect(effect: SideEffect): void {
    this.emit('notification', effect.data);
  }

  private processLogSideEffect(effect: SideEffect): void {
    const { level = 'info', message, data } = effect.data;
    logger[level as keyof Logger](message, data);
  }

  private async handleHookError(
    hook: HookRegistration,
    error: Error,
    context: AgenticHookContext
  ): Promise<void> {
    logger.error(`Hook '${hook.id}' error:`, error);
    
    this.updateMetric('hooks.errors', 1);
    this.updateMetric(`hooks.${hook.id}.errors`, 1);
    
    this.emit('hook:error', {
      hookId: hook.id,
      type: hook.type,
      error,
      context,
    });
  }

  private async executeStage(
    stage: PipelineStage,
    payload: HookPayload,
    context: AgenticHookContext
  ): Promise<HookHandlerResult[]> {
    if (stage.parallel) {
      // Execute hooks in parallel
      const promises = stage.hooks.map(hook => 
        this.executeHook(hook, payload, context)
      );
      return Promise.all(promises);
    } else {
      // Execute hooks sequentially
      const results: HookHandlerResult[] = [];
      let currentPayload = payload;
      
      for (const hook of stage.hooks) {
        const result = await this.executeHook(hook, currentPayload, context);
        results.push(result);
        
        if (result.modified && result.payload) {
          currentPayload = result.payload;
        }
        
        if (!result.continue) {
          break;
        }
      }
      
      return results;
    }
  }

  private updatePipelineMetrics(
    pipeline: HookPipeline,
    duration: number,
    hasError: boolean
  ): void {
    const metrics = pipeline.metrics;
    
    metrics.executions++;
    metrics.avgDuration = 
      (metrics.avgDuration * (metrics.executions - 1) + duration) / 
      metrics.executions;
    
    if (hasError) {
      metrics.errorRate = 
        (metrics.errorRate * (metrics.executions - 1) + 1) / 
        metrics.executions;
    } else {
      metrics.errorRate = 
        (metrics.errorRate * (metrics.executions - 1)) / 
        metrics.executions;
    }
    
    // Calculate throughput (executions per minute)
    const timeWindow = 60000; // 1 minute
    metrics.throughput = (metrics.executions / duration) * timeWindow;
  }

  private async rollbackPipeline(
    pipeline: HookPipeline,
    results: HookHandlerResult[],
    context: AgenticHookContext
  ): Promise<void> {
    logger.warn(`Rolling back pipeline '${pipeline.name}'`);
    // Implement rollback logic based on side effects in results
    // This is a placeholder for actual rollback implementation
  }

  private getTotalHookCount(): number {
    let count = 0;
    for (const hookList of this.hooks.values()) {
      count += hookList.length;
    }
    return count;
  }

  private initializeMetrics(): void {
    this.metrics.set('hooks.registered', 0);
    this.metrics.set('hooks.unregistered', 0);
    this.metrics.set('hooks.executions', 0);
    this.metrics.set('hooks.errors', 0);
    this.metrics.set('hooks.cacheHits', 0);
    this.metrics.set('hooks.totalDuration', 0);
  }

  private updateMetric(key: string, value: number): void {
    const current = this.metrics.get(key) || 0;
    this.metrics.set(key, current + value);
  }

  private generateExecutionId(): string {
    return `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generatePipelineId(): string {
    return `pipe_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private getCachedResult(
    hookId: string, 
    cacheKey: string
  ): HookHandlerResult | null {
    // Implement cache retrieval
    // This is a placeholder
    return null;
  }

  private cacheResult(
    hookId: string,
    cacheKey: string,
    result: HookHandlerResult,
    ttl: number
  ): void {
    // Implement cache storage
    // This is a placeholder
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeout: number,
    message: string
  ): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => 
        setTimeout(() => reject(new Error(message)), timeout)
      ),
    ]);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export singleton instance
export const agenticHookManager = new AgenticHookManager();