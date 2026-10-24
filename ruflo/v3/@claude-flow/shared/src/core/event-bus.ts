/**
 * V3 Event Bus
 * Core event pub/sub implementation
 */

import type {
  IEvent,
  IEventBus,
  IEventCreate,
  IEventHandler,
  IEventSubscription,
  IEventFilter,
} from './interfaces/event.interface.js';
import { randomBytes } from 'crypto';

// Secure event ID generation
function generateSecureEventId(): string {
  const timestamp = Date.now().toString(36);
  const random = randomBytes(12).toString('hex');
  return `evt_${timestamp}_${random}`;
}

/**
 * Event subscription implementation
 */
class EventSubscription implements IEventSubscription {
  private active = true;
  private paused = false;

  constructor(
    readonly id: string,
    readonly filter: IEventFilter,
    private removeCallback: () => void,
  ) {}

  unsubscribe(): void {
    this.active = false;
    this.removeCallback();
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  isActive(): boolean {
    return this.active && !this.paused;
  }
}

/**
 * Event bus implementation
 */
export class EventBus implements IEventBus {
  private handlers = new Map<string, Set<IEventHandler>>();
  private subscriptions = new Map<string, { filter: IEventFilter; handler: IEventHandler; subscription: EventSubscription }>();
  private subscriptionId = 0;

  emit<T = unknown>(type: string, payload: T, options?: Partial<IEventCreate<T>>): void {
    const event = this.createEvent(type, payload, options);
    this.dispatchEvent(event);
  }

  async emitAsync<T = unknown>(type: string, payload: T, options?: Partial<IEventCreate<T>>): Promise<void> {
    const event = this.createEvent(type, payload, options);
    await this.dispatchEventAsync(event);
  }

  on<T = unknown>(type: string, handler: IEventHandler<T>): IEventSubscription {
    return this.subscribe({ types: [type] }, handler);
  }

  subscribe<T = unknown>(filter: IEventFilter, handler: IEventHandler<T>): IEventSubscription {
    const id = `sub_${++this.subscriptionId}`;

    // Register for all matching types
    const types = filter.types ?? ['*'];
    for (const type of types) {
      let handlers = this.handlers.get(type);
      if (!handlers) {
        handlers = new Set();
        this.handlers.set(type, handlers);
      }
      handlers.add(handler as IEventHandler);
    }

    const subscription = new EventSubscription(id, filter, () => {
      this.removeSubscription(id);
    });

    this.subscriptions.set(id, { filter, handler: handler as IEventHandler, subscription });

    return subscription;
  }

  once<T = unknown>(type: string, handler: IEventHandler<T>): IEventSubscription {
    const wrappedHandler: IEventHandler<T> = async (event) => {
      subscription.unsubscribe();
      await handler(event);
    };

    const subscription = this.on(type, wrappedHandler);
    return subscription;
  }

  off(type: string, handler: IEventHandler): void {
    const handlers = this.handlers.get(type);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.handlers.delete(type);
      }
    }
  }

  removeAllListeners(type?: string): void {
    if (type) {
      this.handlers.delete(type);
    } else {
      this.handlers.clear();
    }
  }

  listenerCount(type: string): number {
    return this.handlers.get(type)?.size ?? 0;
  }

  eventNames(): string[] {
    return Array.from(this.handlers.keys());
  }

  private createEvent<T>(type: string, payload: T, options?: Partial<IEventCreate<T>>): IEvent<T> {
    return {
      id: generateSecureEventId(),
      type,
      timestamp: new Date(),
      source: options?.source ?? 'event-bus',
      payload,
      priority: options?.priority,
      correlationId: options?.correlationId,
      causationId: options?.causationId,
      metadata: options?.metadata,
    };
  }

  private dispatchEvent<T>(event: IEvent<T>): void {
    // Get handlers for specific type
    const typeHandlers = this.handlers.get(event.type);

    // Get wildcard handlers
    const wildcardHandlers = this.handlers.get('*');

    const allHandlers = new Set<IEventHandler>();

    if (typeHandlers) {
      for (const handler of typeHandlers) {
        allHandlers.add(handler);
      }
    }

    if (wildcardHandlers) {
      for (const handler of wildcardHandlers) {
        allHandlers.add(handler);
      }
    }

    for (const handler of allHandlers) {
      try {
        const result = handler(event);
        if (result instanceof Promise) {
          result.catch((error) => {
            console.error(`Error in async event handler for ${event.type}:`, error);
          });
        }
      } catch (error) {
        console.error(`Error in event handler for ${event.type}:`, error);
      }
    }
  }

  private async dispatchEventAsync<T>(event: IEvent<T>): Promise<void> {
    const typeHandlers = this.handlers.get(event.type);
    const wildcardHandlers = this.handlers.get('*');

    const allHandlers = new Set<IEventHandler>();

    if (typeHandlers) {
      for (const handler of typeHandlers) {
        allHandlers.add(handler);
      }
    }

    if (wildcardHandlers) {
      for (const handler of wildcardHandlers) {
        allHandlers.add(handler);
      }
    }

    const promises = Array.from(allHandlers).map(async (handler) => {
      try {
        await handler(event);
      } catch (error) {
        console.error(`Error in event handler for ${event.type}:`, error);
      }
    });

    await Promise.allSettled(promises);
  }

  private removeSubscription(id: string): void {
    const sub = this.subscriptions.get(id);
    if (sub) {
      const types = sub.filter.types ?? ['*'];
      for (const type of types) {
        const handlers = this.handlers.get(type);
        if (handlers) {
          handlers.delete(sub.handler);
          if (handlers.size === 0) {
            this.handlers.delete(type);
          }
        }
      }
      this.subscriptions.delete(id);
    }
  }
}

/**
 * Create a new event bus instance
 */
export function createEventBus(): IEventBus {
  return new EventBus();
}
