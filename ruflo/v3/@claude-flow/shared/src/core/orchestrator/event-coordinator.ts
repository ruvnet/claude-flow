/**
 * V3 Event Coordinator
 * Decomposed from orchestrator.ts - Event routing
 * ~100 lines (target achieved)
 */

import type {
  IEvent,
  IEventBus,
  IEventHandler,
  IEventCoordinator,
} from '../interfaces/event.interface.js';
import { SystemEventTypes } from '../interfaces/event.interface.js';

/**
 * Event coordinator implementation
 */
export class EventCoordinator implements IEventCoordinator {
  private handlers = new Map<string, Set<IEventHandler>>();
  private initialized = false;

  constructor(private eventBus: IEventBus) {}

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Register default system event handlers
    this.registerSystemHandlers();

    this.initialized = true;
  }

  async shutdown(): Promise<void> {
    // Clear all handlers
    this.handlers.clear();
    this.initialized = false;
  }

  async route(event: IEvent): Promise<void> {
    const handlers = this.handlers.get(event.type);
    if (!handlers || handlers.size === 0) {
      return;
    }

    const handlerPromises = Array.from(handlers).map(async handler => {
      try {
        await handler(event);
      } catch (error) {
        // Log error but don't throw
        console.error(`Error in event handler for ${event.type}:`, error);
      }
    });

    await Promise.allSettled(handlerPromises);
  }

  registerHandler(type: string, handler: IEventHandler): void {
    let handlers = this.handlers.get(type);
    if (!handlers) {
      handlers = new Set();
      this.handlers.set(type, handlers);
    }
    handlers.add(handler);

    // Also register with event bus
    this.eventBus.on(type, handler);
  }

  unregisterHandler(type: string, handler: IEventHandler): void {
    const handlers = this.handlers.get(type);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.handlers.delete(type);
      }
    }

    // Also unregister from event bus
    this.eventBus.off(type, handler);
  }

  getEventBus(): IEventBus {
    return this.eventBus;
  }

  private registerSystemHandlers(): void {
    // Error handling
    this.eventBus.on(SystemEventTypes.SYSTEM_ERROR, (event: IEvent) => {
      const { error, component } = event.payload as { error: Error; component: string };
      console.error(`System error in ${component}:`, error);
    });

    // Deadlock detection
    this.eventBus.on(SystemEventTypes.DEADLOCK_DETECTED, (event: IEvent) => {
      const { agents, resources } = event.payload as { agents: string[]; resources: string[] };
      console.warn('Deadlock detected:', { agents, resources });
    });
  }

  /**
   * Get registered handler count for a type
   */
  getHandlerCount(type: string): number {
    return this.handlers.get(type)?.size ?? 0;
  }

  /**
   * Get all registered event types
   */
  getRegisteredTypes(): string[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * Check if coordinator is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}
