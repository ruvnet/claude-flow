/**
 * V3 Hook Registry
 *
 * Central registry for hook registration, management, and lookup.
 * Provides priority-based execution ordering and filtering.
 */

import type {
  HookEvent,
  HookHandler,
  HookPriority,
  HookEntry,
  HookRegistrationOptions,
  HookRegistryStats,
  HookListFilter,
} from '../types.js';

/**
 * Hook Registry - manages hook registration and lookup
 */
export class HookRegistry {
  private hooks: Map<string, HookEntry> = new Map();
  private hooksByEvent: Map<HookEvent, Set<string>> = new Map();
  private stats = {
    totalExecutions: 0,
    totalFailures: 0,
    executionTimes: [] as number[],
  };

  /**
   * Register a new hook
   */
  register(
    event: HookEvent,
    handler: HookHandler,
    priority: HookPriority,
    options: HookRegistrationOptions = {}
  ): string {
    const id = this.generateId();

    const entry: HookEntry = {
      id,
      event,
      handler,
      priority,
      enabled: options.enabled ?? true,
      name: options.name,
      description: options.description,
      registeredAt: new Date(),
      metadata: options.metadata,
    };

    this.hooks.set(id, entry);

    // Index by event
    if (!this.hooksByEvent.has(event)) {
      this.hooksByEvent.set(event, new Set());
    }
    this.hooksByEvent.get(event)!.add(id);

    return id;
  }

  /**
   * Unregister a hook by ID
   */
  unregister(hookId: string): boolean {
    const entry = this.hooks.get(hookId);
    if (!entry) {
      return false;
    }

    // Remove from event index
    const eventHooks = this.hooksByEvent.get(entry.event);
    if (eventHooks) {
      eventHooks.delete(hookId);
    }

    this.hooks.delete(hookId);
    return true;
  }

  /**
   * Get a hook by ID
   */
  get(hookId: string): HookEntry | undefined {
    return this.hooks.get(hookId);
  }

  /**
   * Get all hooks for an event, sorted by priority (highest first)
   */
  getForEvent(event: HookEvent, enabledOnly = true): HookEntry[] {
    const hookIds = this.hooksByEvent.get(event);
    if (!hookIds) {
      return [];
    }

    const entries = Array.from(hookIds)
      .map((id) => this.hooks.get(id)!)
      .filter((entry) => !enabledOnly || entry.enabled);

    // Sort by priority descending (higher priority runs first)
    return entries.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Enable a hook
   */
  enable(hookId: string): boolean {
    const entry = this.hooks.get(hookId);
    if (!entry) {
      return false;
    }
    entry.enabled = true;
    return true;
  }

  /**
   * Disable a hook
   */
  disable(hookId: string): boolean {
    const entry = this.hooks.get(hookId);
    if (!entry) {
      return false;
    }
    entry.enabled = false;
    return true;
  }

  /**
   * List hooks with optional filtering
   */
  list(filter?: HookListFilter): HookEntry[] {
    let entries = Array.from(this.hooks.values());

    if (filter) {
      if (filter.event !== undefined) {
        entries = entries.filter((e) => e.event === filter.event);
      }
      if (filter.enabled !== undefined) {
        entries = entries.filter((e) => e.enabled === filter.enabled);
      }
      if (filter.minPriority !== undefined) {
        entries = entries.filter((e) => e.priority >= filter.minPriority!);
      }
      if (filter.namePattern) {
        entries = entries.filter(
          (e) => e.name && filter.namePattern!.test(e.name)
        );
      }
    }

    return entries.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Check if a hook exists
   */
  has(hookId: string): boolean {
    return this.hooks.has(hookId);
  }

  /**
   * Get registry statistics
   */
  getStats(): HookRegistryStats {
    const entries = Array.from(this.hooks.values());
    const enabledHooks = entries.filter((e) => e.enabled).length;

    const hooksByEvent: Record<string, number> = {};
    for (const [event, hooks] of this.hooksByEvent) {
      hooksByEvent[event] = hooks.size;
    }

    const avgExecutionTime =
      this.stats.executionTimes.length > 0
        ? this.stats.executionTimes.reduce((a, b) => a + b, 0) /
          this.stats.executionTimes.length
        : 0;

    return {
      totalHooks: this.hooks.size,
      enabledHooks,
      disabledHooks: this.hooks.size - enabledHooks,
      hooksByEvent,
      totalExecutions: this.stats.totalExecutions,
      totalFailures: this.stats.totalFailures,
      avgExecutionTime,
    };
  }

  /**
   * Record execution statistics
   */
  recordExecution(success: boolean, duration: number): void {
    this.stats.totalExecutions++;
    if (!success) {
      this.stats.totalFailures++;
    }
    this.stats.executionTimes.push(duration);

    // Keep only last 1000 execution times
    if (this.stats.executionTimes.length > 1000) {
      this.stats.executionTimes = this.stats.executionTimes.slice(-1000);
    }
  }

  /**
   * Clear all hooks
   */
  clear(): void {
    this.hooks.clear();
    this.hooksByEvent.clear();
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      totalExecutions: 0,
      totalFailures: 0,
      executionTimes: [],
    };
  }

  /**
   * Get count of hooks
   */
  get size(): number {
    return this.hooks.size;
  }

  /**
   * Generate unique hook ID
   */
  private generateId(): string {
    return `hook-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
}

/**
 * Default global registry instance
 */
export const defaultRegistry = new HookRegistry();

/**
 * Convenience function to register a hook on the default registry
 */
export function registerHook(
  event: HookEvent,
  handler: HookHandler,
  priority: HookPriority,
  options?: HookRegistrationOptions
): string {
  return defaultRegistry.register(event, handler, priority, options);
}

/**
 * Convenience function to unregister a hook from the default registry
 */
export function unregisterHook(hookId: string): boolean {
  return defaultRegistry.unregister(hookId);
}

export { HookRegistry as default };
