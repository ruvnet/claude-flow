/**
 * Hooks Integration Module
 *
 * Provides comprehensive hook capabilities for plugin development.
 * Enables lifecycle event interception, transformation, and monitoring.
 */

import { EventEmitter } from 'events';
import type {
  HookDefinition,
  HookEvent,
  HookPriority,
  HookHandler,
  HookContext,
  HookResult,
  ILogger,
  IEventBus,
} from '../types/index.js';
import { HookEvent as HookEventEnum, HookPriority as HookPriorityEnum } from '../types/index.js';

// ============================================================================
// Hook Registry
// ============================================================================

export interface HookRegistryConfig {
  logger?: ILogger;
  eventBus?: IEventBus;
  maxHooksPerEvent?: number;
  defaultTimeout?: number;
  parallelExecution?: boolean;
}

export interface HookEntry {
  readonly hook: HookDefinition;
  readonly pluginName?: string;
  readonly registeredAt: Date;
  executionCount: number;
  lastExecuted?: Date;
  lastError?: string;
  avgExecutionTime: number;
}

export interface HookRegistryStats {
  totalHooks: number;
  hooksByEvent: Record<string, number>;
  executionCount: number;
  errorCount: number;
  avgExecutionTime: number;
}

/**
 * Central registry for hook management.
 */
export class HookRegistry extends EventEmitter {
  private readonly hooks = new Map<HookEvent, HookEntry[]>();
  private readonly config: HookRegistryConfig;
  private stats = { executionCount: 0, errorCount: 0, totalExecutionTime: 0 };

  constructor(config?: HookRegistryConfig) {
    super();
    this.config = {
      maxHooksPerEvent: 50,
      defaultTimeout: 30000,
      parallelExecution: false,
      ...config,
    };
  }

  /**
   * Register a hook.
   */
  register(hook: HookDefinition, pluginName?: string): () => void {
    const event = hook.event;

    if (!this.hooks.has(event)) {
      this.hooks.set(event, []);
    }

    const entries = this.hooks.get(event)!;

    if (entries.length >= (this.config.maxHooksPerEvent ?? 50)) {
      throw new Error(`Maximum hooks limit reached for event ${event}`);
    }

    const entry: HookEntry = {
      hook,
      pluginName,
      registeredAt: new Date(),
      executionCount: 0,
      avgExecutionTime: 0,
    };

    // Insert in priority order (higher priority first)
    const priority = hook.priority ?? HookPriorityEnum.Normal;
    const insertIndex = entries.findIndex(e => (e.hook.priority ?? HookPriorityEnum.Normal) < priority);

    if (insertIndex === -1) {
      entries.push(entry);
    } else {
      entries.splice(insertIndex, 0, entry);
    }

    // Return unregister function
    return () => this.unregister(event, hook.handler);
  }

  /**
   * Unregister a hook.
   */
  unregister(event: HookEvent, handler: HookHandler): boolean {
    const entries = this.hooks.get(event);
    if (!entries) return false;

    const index = entries.findIndex(e => e.hook.handler === handler);
    if (index === -1) return false;

    entries.splice(index, 1);
    return true;
  }

  /**
   * Execute hooks for an event.
   */
  async execute(event: HookEvent, data: unknown, source?: string): Promise<HookResult[]> {
    const entries = this.hooks.get(event);
    if (!entries || entries.length === 0) {
      return [];
    }

    const context: HookContext = {
      event,
      data,
      timestamp: new Date(),
      source,
    };

    const results: HookResult[] = [];

    if (this.config.parallelExecution) {
      // Execute hooks in parallel (respect priority groups)
      const priorityGroups = this.groupByPriority(entries);

      for (const group of priorityGroups) {
        const groupResults = await Promise.all(
          group.map(entry => this.executeHook(entry, context))
        );
        results.push(...groupResults);

        // Check for abort
        if (groupResults.some(r => r.abort)) {
          break;
        }
      }
    } else {
      // Execute hooks sequentially
      for (const entry of entries) {
        const result = await this.executeHook(entry, context);
        results.push(result);

        // Check for abort
        if (result.abort) {
          break;
        }

        // Pass modified data to next hook
        if (result.modified && result.data !== undefined) {
          (context as { data: unknown }).data = result.data;
        }
      }
    }

    return results;
  }

  private groupByPriority(entries: HookEntry[]): HookEntry[][] {
    const groups: HookEntry[][] = [];
    let currentPriority: number | null = null;
    let currentGroup: HookEntry[] = [];

    for (const entry of entries) {
      const priority = entry.hook.priority ?? HookPriorityEnum.Normal;

      if (currentPriority === null || currentPriority === priority) {
        currentGroup.push(entry);
        currentPriority = priority;
      } else {
        if (currentGroup.length > 0) {
          groups.push(currentGroup);
        }
        currentGroup = [entry];
        currentPriority = priority;
      }
    }

    if (currentGroup.length > 0) {
      groups.push(currentGroup);
    }

    return groups;
  }

  private async executeHook(entry: HookEntry, context: HookContext): Promise<HookResult> {
    const startTime = Date.now();
    this.stats.executionCount++;
    entry.executionCount++;
    entry.lastExecuted = new Date();

    try {
      const timeout = this.config.defaultTimeout ?? 30000;

      const result = await Promise.race([
        entry.hook.handler(context),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Hook execution timeout')), timeout)
        ),
      ]);

      const duration = Date.now() - startTime;
      this.stats.totalExecutionTime += duration;

      // Update average execution time
      const totalTime = entry.avgExecutionTime * (entry.executionCount - 1) + duration;
      entry.avgExecutionTime = totalTime / entry.executionCount;

      return result;
    } catch (error) {
      this.stats.errorCount++;
      entry.lastError = error instanceof Error ? error.message : String(error);

      return {
        success: false,
        error: entry.lastError,
      };
    }
  }

  /**
   * Get hooks for a specific event.
   */
  getHooks(event: HookEvent): HookEntry[] {
    return [...(this.hooks.get(event) ?? [])];
  }

  /**
   * Get all registered hooks.
   */
  getAllHooks(): Map<HookEvent, HookEntry[]> {
    return new Map(this.hooks);
  }

  /**
   * Get registry statistics.
   */
  getStats(): HookRegistryStats {
    const hooksByEvent: Record<string, number> = {};
    let totalHooks = 0;

    for (const [event, entries] of this.hooks) {
      hooksByEvent[event] = entries.length;
      totalHooks += entries.length;
    }

    return {
      totalHooks,
      hooksByEvent,
      executionCount: this.stats.executionCount,
      errorCount: this.stats.errorCount,
      avgExecutionTime: this.stats.executionCount > 0
        ? this.stats.totalExecutionTime / this.stats.executionCount
        : 0,
    };
  }

  /**
   * Clear all hooks.
   */
  clear(): void {
    this.hooks.clear();
    this.stats = { executionCount: 0, errorCount: 0, totalExecutionTime: 0 };
  }
}

// ============================================================================
// Hook Builder
// ============================================================================

/**
 * Fluent builder for creating hooks.
 */
export class HookBuilder {
  private event: HookEvent;
  private name?: string;
  private description?: string;
  private priority: HookPriority = HookPriorityEnum.Normal;
  private isAsync: boolean = true;
  private handler?: HookHandler;
  private conditions: Array<(context: HookContext) => boolean> = [];
  private transformers: Array<(data: unknown) => unknown> = [];

  constructor(event: HookEvent) {
    this.event = event;
  }

  withName(name: string): this {
    this.name = name;
    return this;
  }

  withDescription(description: string): this {
    this.description = description;
    return this;
  }

  withPriority(priority: HookPriority): this {
    this.priority = priority;
    return this;
  }

  synchronous(): this {
    this.isAsync = false;
    return this;
  }

  /**
   * Add a condition that must be met for the hook to execute.
   */
  when(condition: (context: HookContext) => boolean): this {
    this.conditions.push(condition);
    return this;
  }

  /**
   * Add a data transformer that runs before the handler.
   */
  transform(transformer: (data: unknown) => unknown): this {
    this.transformers.push(transformer);
    return this;
  }

  /**
   * Set the handler function.
   */
  handle(handler: HookHandler): this {
    this.handler = handler;
    return this;
  }

  /**
   * Build the hook definition.
   */
  build(): HookDefinition {
    if (!this.handler) {
      throw new Error(`Hook for event ${this.event} requires a handler`);
    }

    const originalHandler = this.handler;
    const conditions = this.conditions;
    const transformers = this.transformers;

    // Wrap handler with conditions and transformers
    const wrappedHandler: HookHandler = async (context: HookContext) => {
      // Check conditions
      for (const condition of conditions) {
        if (!condition(context)) {
          return { success: true, data: context.data };
        }
      }

      // Apply transformers
      let data = context.data;
      for (const transformer of transformers) {
        data = transformer(data);
      }

      // Create modified context
      const modifiedContext: HookContext = { ...context, data };

      // Execute handler
      return originalHandler(modifiedContext);
    };

    return {
      event: this.event,
      handler: wrappedHandler,
      priority: this.priority,
      name: this.name,
      description: this.description,
      async: this.isAsync,
    };
  }
}

// ============================================================================
// Pre-built Hook Factories
// ============================================================================

/**
 * Factory for creating common hooks.
 */
export class HookFactory {
  /**
   * Create a logging hook for any event.
   */
  static createLogger(
    event: HookEvent,
    logger: ILogger,
    options?: { name?: string; logLevel?: 'debug' | 'info' | 'warn' }
  ): HookDefinition {
    const logLevel = options?.logLevel ?? 'debug';

    return new HookBuilder(event)
      .withName(options?.name ?? `${event}-logger`)
      .withDescription(`Logs ${event} events`)
      .withPriority(HookPriorityEnum.Deferred)
      .handle(async (context) => {
        logger[logLevel](`Hook event: ${event}`, { data: context.data, source: context.source });
        return { success: true };
      })
      .build();
  }

  /**
   * Create a timing hook that measures execution time.
   */
  static createTimer(
    event: HookEvent,
    _onComplete: (duration: number, context: HookContext) => void
  ): HookDefinition {
    return new HookBuilder(event)
      .withName(`${event}-timer`)
      .withDescription(`Times ${event} events`)
      .withPriority(HookPriorityEnum.Critical)
      .handle(async (context) => {
        const startTime = Date.now();

        // Store start time in metadata
        const metadata = { ...context.metadata, _startTime: startTime };

        return {
          success: true,
          data: context.data,
          metadata,
        };
      })
      .build();
  }

  /**
   * Create a validation hook.
   */
  static createValidator<T>(
    event: HookEvent,
    validator: (data: T) => boolean | string,
    options?: { name?: string; abortOnFail?: boolean }
  ): HookDefinition {
    return new HookBuilder(event)
      .withName(options?.name ?? `${event}-validator`)
      .withDescription(`Validates ${event} data`)
      .withPriority(HookPriorityEnum.High)
      .handle(async (context) => {
        const result = validator(context.data as T);

        if (result === true) {
          return { success: true };
        }

        const error = typeof result === 'string' ? result : 'Validation failed';

        return {
          success: false,
          error,
          abort: options?.abortOnFail ?? false,
        };
      })
      .build();
  }

  /**
   * Create a rate limiting hook.
   */
  static createRateLimiter(
    event: HookEvent,
    options: { maxPerMinute: number; name?: string }
  ): HookDefinition {
    const windowMs = 60000;
    const timestamps: number[] = [];

    return new HookBuilder(event)
      .withName(options.name ?? `${event}-rate-limiter`)
      .withDescription(`Rate limits ${event} to ${options.maxPerMinute}/min`)
      .withPriority(HookPriorityEnum.Critical)
      .handle(async () => {
        const now = Date.now();

        // Clean old timestamps
        while (timestamps.length > 0 && timestamps[0] < now - windowMs) {
          timestamps.shift();
        }

        if (timestamps.length >= options.maxPerMinute) {
          return {
            success: false,
            error: `Rate limit exceeded: ${options.maxPerMinute}/min`,
            abort: true,
          };
        }

        timestamps.push(now);
        return { success: true };
      })
      .build();
  }

  /**
   * Create a caching hook.
   */
  static createCache<T>(
    event: HookEvent,
    options: {
      keyExtractor: (data: T) => string;
      ttlMs?: number;
      maxSize?: number;
      name?: string;
    }
  ): HookDefinition {
    const cache = new Map<string, { value: unknown; expires: number }>();
    const ttlMs = options.ttlMs ?? 60000;
    const maxSize = options.maxSize ?? 100;

    return new HookBuilder(event)
      .withName(options.name ?? `${event}-cache`)
      .withDescription(`Caches ${event} results`)
      .withPriority(HookPriorityEnum.High)
      .handle(async (context) => {
        const key = options.keyExtractor(context.data as T);
        const now = Date.now();

        // Check cache
        const cached = cache.get(key);
        if (cached && cached.expires > now) {
          return {
            success: true,
            data: cached.value,
            modified: true,
          };
        }

        // Clean expired entries if at max size
        if (cache.size >= maxSize) {
          for (const [k, v] of cache) {
            if (v.expires < now) {
              cache.delete(k);
            }
          }
          // Store result with TTL
          cache.set(key, { value: context.data, expires: now + ttlMs });
        }

        return { success: true };
      })
      .build();
  }

  /**
   * Create a retry hook.
   */
  static createRetry(
    event: HookEvent,
    options: {
      maxRetries: number;
      delayMs?: number;
      backoffMultiplier?: number;
      name?: string;
    }
  ): HookDefinition {
    const retryState = new Map<string, number>();

    return new HookBuilder(event)
      .withName(options.name ?? `${event}-retry`)
      .withDescription(`Adds retry logic to ${event}`)
      .withPriority(HookPriorityEnum.Normal)
      .handle(async (context) => {
        const key = context.source ?? 'default';
        const retryCount = retryState.get(key) ?? 0;

        if (retryCount >= options.maxRetries) {
          retryState.delete(key);
          return {
            success: false,
            error: `Max retries (${options.maxRetries}) exceeded`,
          };
        }

        return {
          success: true,
          data: {
            ...context.data as object,
            _retryCount: retryCount,
          },
          modified: true,
        };
      })
      .build();
  }
}

// ============================================================================
// Hook Executor
// ============================================================================

/**
 * Utility for executing hooks in different patterns.
 */
export class HookExecutor {
  private readonly registry: HookRegistry;

  constructor(registry: HookRegistry) {
    this.registry = registry;
  }

  /**
   * Execute hooks and collect all results.
   */
  async executeAll(event: HookEvent, data: unknown, source?: string): Promise<HookResult[]> {
    return this.registry.execute(event, data, source);
  }

  /**
   * Execute hooks and return the first successful result.
   */
  async executeFirst(event: HookEvent, data: unknown, source?: string): Promise<HookResult | null> {
    const results = await this.registry.execute(event, data, source);
    return results.find(r => r.success) ?? null;
  }

  /**
   * Execute hooks and return true if all succeeded.
   */
  async executeValidate(event: HookEvent, data: unknown, source?: string): Promise<boolean> {
    const results = await this.registry.execute(event, data, source);
    return results.every(r => r.success);
  }

  /**
   * Execute hooks and return the final transformed data.
   */
  async executeTransform<T>(event: HookEvent, data: T, source?: string): Promise<T> {
    const results = await this.registry.execute(event, data, source);

    let result = data;
    for (const r of results) {
      if (r.success && r.modified && r.data !== undefined) {
        result = r.data as T;
      }
    }

    return result;
  }

  /**
   * Execute hooks until one aborts.
   */
  async executeUntilAbort(
    event: HookEvent,
    data: unknown,
    source?: string
  ): Promise<{ results: HookResult[]; aborted: boolean }> {
    const results = await this.registry.execute(event, data, source);
    const aborted = results.some(r => r.abort);
    return { results, aborted };
  }
}

// ============================================================================
// Exports
// ============================================================================

export {
  HookEventEnum as HookEvent,
  HookPriorityEnum as HookPriority,
  type HookDefinition,
  type HookHandler,
  type HookContext,
  type HookResult,
};
