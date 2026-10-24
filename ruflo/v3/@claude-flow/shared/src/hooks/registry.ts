/**
 * V3 Hooks System - Hook Registry
 *
 * Central registry for managing hook definitions and lifecycle.
 * Provides registration, unregistration, and discovery of hooks.
 *
 * @module v3/shared/hooks/registry
 */

import {
  HookEvent,
  HookPriority,
  HookHandler,
  HookDefinition,
  HookStats,
} from './types.js';

/**
 * Hook registry implementation
 */
export class HookRegistry {
  private hooks = new Map<HookEvent, HookDefinition[]>();
  private hooksById = new Map<string, HookDefinition>();
  private hookIdCounter = 0;

  // Statistics tracking
  private stats = {
    executions: 0,
    failures: 0,
    totalExecutionTime: 0,
  };

  /**
   * Register a new hook
   *
   * @param event - Hook event type
   * @param handler - Hook handler function
   * @param priority - Hook priority (default: Normal)
   * @param options - Additional hook options
   * @returns Hook ID for later unregistration
   */
  register(
    event: HookEvent,
    handler: HookHandler,
    priority: HookPriority = HookPriority.Normal,
    options: {
      name?: string;
      timeout?: number;
      enabled?: boolean;
      metadata?: Record<string, unknown>;
    } = {}
  ): string {
    // Generate unique hook ID
    const id = `hook_${++this.hookIdCounter}_${Date.now()}`;

    // Create hook definition
    const definition: HookDefinition = {
      id,
      event,
      handler,
      priority,
      name: options.name,
      enabled: options.enabled ?? true,
      timeout: options.timeout,
      metadata: options.metadata,
    };

    // Add to event-specific list
    let eventHooks = this.hooks.get(event);
    if (!eventHooks) {
      eventHooks = [];
      this.hooks.set(event, eventHooks);
    }
    eventHooks.push(definition);

    // Sort by priority (highest first)
    eventHooks.sort((a, b) => b.priority - a.priority);

    // Add to ID map
    this.hooksById.set(id, definition);

    return id;
  }

  /**
   * Unregister a hook by ID
   *
   * @param hookId - Hook ID to unregister
   * @returns Whether hook was found and removed
   */
  unregister(hookId: string): boolean {
    const definition = this.hooksById.get(hookId);
    if (!definition) {
      return false;
    }

    // Remove from event-specific list
    const eventHooks = this.hooks.get(definition.event);
    if (eventHooks) {
      const index = eventHooks.findIndex(h => h.id === hookId);
      if (index !== -1) {
        eventHooks.splice(index, 1);
      }

      // Clean up empty arrays
      if (eventHooks.length === 0) {
        this.hooks.delete(definition.event);
      }
    }

    // Remove from ID map
    this.hooksById.delete(hookId);

    return true;
  }

  /**
   * Unregister all hooks for an event
   *
   * @param event - Event type to clear hooks for
   * @returns Number of hooks removed
   */
  unregisterAll(event?: HookEvent): number {
    if (event) {
      const eventHooks = this.hooks.get(event) || [];
      const count = eventHooks.length;

      // Remove from ID map
      for (const hook of eventHooks) {
        this.hooksById.delete(hook.id);
      }

      // Clear event hooks
      this.hooks.delete(event);

      return count;
    } else {
      // Clear all hooks
      const count = this.hooksById.size;
      this.hooks.clear();
      this.hooksById.clear();
      this.hookIdCounter = 0;
      return count;
    }
  }

  /**
   * Get all hooks for a specific event (sorted by priority)
   *
   * @param event - Event type
   * @param includeDisabled - Whether to include disabled hooks
   * @returns Array of hook definitions
   */
  getHandlers(event: HookEvent, includeDisabled = false): HookDefinition[] {
    const eventHooks = this.hooks.get(event) || [];

    if (includeDisabled) {
      return [...eventHooks];
    }

    return eventHooks.filter(h => h.enabled);
  }

  /**
   * Get a hook by ID
   *
   * @param hookId - Hook ID
   * @returns Hook definition or undefined
   */
  getHook(hookId: string): HookDefinition | undefined {
    return this.hooksById.get(hookId);
  }

  /**
   * Enable a hook
   *
   * @param hookId - Hook ID
   * @returns Whether hook was found and enabled
   */
  enable(hookId: string): boolean {
    const hook = this.hooksById.get(hookId);
    if (hook) {
      hook.enabled = true;
      return true;
    }
    return false;
  }

  /**
   * Disable a hook
   *
   * @param hookId - Hook ID
   * @returns Whether hook was found and disabled
   */
  disable(hookId: string): boolean {
    const hook = this.hooksById.get(hookId);
    if (hook) {
      hook.enabled = false;
      return true;
    }
    return false;
  }

  /**
   * List all registered hooks
   *
   * @param filter - Optional filter options
   * @returns Array of hook definitions
   */
  listHooks(filter?: {
    event?: HookEvent;
    enabled?: boolean;
    minPriority?: HookPriority;
  }): HookDefinition[] {
    let hooks: HookDefinition[];

    if (filter?.event) {
      hooks = this.hooks.get(filter.event) || [];
    } else {
      hooks = Array.from(this.hooksById.values());
    }

    // Apply filters
    if (filter?.enabled !== undefined) {
      hooks = hooks.filter(h => h.enabled === filter.enabled);
    }

    if (filter?.minPriority !== undefined) {
      const minPriority = filter.minPriority;
      hooks = hooks.filter(h => h.priority >= minPriority);
    }

    return hooks;
  }

  /**
   * Get all event types with registered hooks
   *
   * @returns Array of event types
   */
  getEventTypes(): HookEvent[] {
    return Array.from(this.hooks.keys());
  }

  /**
   * Get count of hooks for an event
   *
   * @param event - Event type (optional)
   * @returns Hook count
   */
  count(event?: HookEvent): number {
    if (event) {
      return this.hooks.get(event)?.length || 0;
    }
    return this.hooksById.size;
  }

  /**
   * Record hook execution statistics
   *
   * @param success - Whether execution succeeded
   * @param executionTime - Execution time in ms
   */
  recordExecution(success: boolean, executionTime: number): void {
    this.stats.executions++;
    this.stats.totalExecutionTime += executionTime;
    if (!success) {
      this.stats.failures++;
    }
  }

  /**
   * Get hook statistics
   *
   * @returns Hook statistics
   */
  getStats(): HookStats {
    const byEvent: Record<HookEvent, number> = {} as any;

    for (const [event, hooks] of this.hooks) {
      byEvent[event] = hooks.filter(h => h.enabled).length;
    }

    return {
      totalHooks: this.hooksById.size,
      byEvent,
      totalExecutions: this.stats.executions,
      totalFailures: this.stats.failures,
      avgExecutionTime: this.stats.executions > 0
        ? this.stats.totalExecutionTime / this.stats.executions
        : 0,
      totalExecutionTime: this.stats.totalExecutionTime,
    };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      executions: 0,
      failures: 0,
      totalExecutionTime: 0,
    };
  }

  /**
   * Check if a hook exists
   *
   * @param hookId - Hook ID
   * @returns Whether hook exists
   */
  has(hookId: string): boolean {
    return this.hooksById.has(hookId);
  }

  /**
   * Clear all hooks and reset state
   */
  clear(): void {
    this.hooks.clear();
    this.hooksById.clear();
    this.hookIdCounter = 0;
    this.resetStats();
  }
}

/**
 * Create a new hook registry
 */
export function createHookRegistry(): HookRegistry {
  return new HookRegistry();
}
