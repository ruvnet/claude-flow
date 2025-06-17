/**
 * Inter-agent messaging system
 */

import { Message, CoordinationConfig, SystemEvents } from '../utils/types.js';
import { IEventBus } from '../core/event-bus.js';
import { ILogger } from '../core/logger.js';
import { CoordinationError } from '../utils/errors.js';
import { generateId, timeout as timeoutHelper } from '../utils/helpers.js';

interface MessageQueue {
  messages: Message[];
  handlers: Map<string, (message: Message) => void>;
}

interface PendingResponse {
  resolve: (response: unknown) => void;
  reject: (error: Error) => void;
  timeout: number;
}

/**
 * Message router for inter-agent communication
 */
export class MessageRouter {
  private queues = new Map<string, MessageQueue>(); // agentId -> queue
  private pendingResponses = new Map<string, PendingResponse>();
  private messageCount = 0;

  constructor(
    private config: CoordinationConfig,
    private eventBus: IEventBus,
    private logger: ILogger,
  ) {}

  async initialize(): Promise<void> {
    this.logger.info('Initializing message router');
    
    // Set up periodic cleanup
    setInterval(() => this.cleanup(), 60000); // Every minute
  }

  async shutdown(): Promise<void> {
    this.logger.info('Shutting down message router');
    
    // Reject all pending responses
    for (const [id, pending] of this.pendingResponses) {
      pending.reject(new Error('Message router shutdown'));
      clearTimeout(pending.timeout);
    }
    
    this.queues.clear();
    this.pendingResponses.clear();
  }

  async send(from: string, to: string, payload: unknown): Promise<void> {
    const message: Message = {
      id: generateId('msg'),
      type: 'agent-message',
      payload,
      timestamp: new Date(),
      priority: 0,
    };

    await this.sendMessage(from, to, message);
  }

  async sendWithResponse<T = unknown>(
    from: string,
    to: string,
    payload: unknown,
    timeoutMs?: number,
  ): Promise<T> {
    const message: Message = {
      id: generateId('msg'),
      type: 'agent-request',
      payload,
      timestamp: new Date(),
      priority: 1,
    };

    // Create response promise
    const responsePromise = new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingResponses.delete(message.id);
        reject(new Error(`Message response timeout: ${message.id}`));
      }, timeoutMs || this.config.messageTimeout);

      this.pendingResponses.set(message.id, {
        resolve: resolve as (response: unknown) => void,
        reject,
        timeout: timeout as unknown as number,
      });
    });

    // Send message
    await this.sendMessage(from, to, message);

    // Wait for response
    return await responsePromise;
  }

  async broadcast(from: string, payload: unknown): Promise<void> {
    const message: Message = {
      id: generateId('broadcast'),
      type: 'broadcast',
      payload,
      timestamp: new Date(),
      priority: 0,
    };

    // Send to all agents
    const agents = Array.from(this.queues.keys()).filter(id => id !== from);
    
    await Promise.all(
      agents.map(to => this.sendMessage(from, to, message)),
    );
  }

  subscribe(agentId: string, handler: (message: Message) => void): void {
    const queue = this.ensureQueue(agentId);
    queue.handlers.set(generateId('handler'), handler);
  }

  unsubscribe(agentId: string, handlerId: string): void {
    const queue = this.queues.get(agentId);
    if (queue) {
      queue.handlers.delete(handlerId);
    }
  }

  async sendResponse(
    originalMessageId: string,
    response: unknown,
  ): Promise<void> {
    const pending = this.pendingResponses.get(originalMessageId);
    if (!pending) {
      this.logger.warn('No pending response found', { messageId: originalMessageId });
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingResponses.delete(originalMessageId);
    pending.resolve(response);
  }

  async getHealthStatus(): Promise<{ 
    healthy: boolean; 
    error?: string; 
    metrics?: Record<string, number>;
  }> {
    const totalQueues = this.queues.size;
    let totalMessages = 0;
    let totalHandlers = 0;

    for (const queue of this.queues.values()) {
      totalMessages += queue.messages.length;
      totalHandlers += queue.handlers.size;
    }

    return {
      healthy: true,
      metrics: {
        activeQueues: totalQueues,
        pendingMessages: totalMessages,
        registeredHandlers: totalHandlers,
        pendingResponses: this.pendingResponses.size,
        totalMessagesSent: this.messageCount,
      },
    };
  }

  private async sendMessage(
    from: string,
    to: string,
    message: Message,
  ): Promise<void> {
    this.logger.debug('Sending message', { 
      from,
      to,
      messageId: message.id,
      type: message.type,
    });

    // Ensure destination queue exists
    const queue = this.ensureQueue(to);

    // Add to queue
    queue.messages.push(message);
    this.messageCount++;

    // Emit event
    this.eventBus.emit(SystemEvents.MESSAGE_SENT, { from, to, message });

    // Process message immediately if handlers exist
    if (queue.handlers.size > 0) {
      await this.processMessage(to, message);
    }
  }

  private async processMessage(agentId: string, message: Message): Promise<void> {
    const queue = this.queues.get(agentId);
    if (!queue) {
      return;
    }

    // Remove message from queue
    const index = queue.messages.indexOf(message);
    if (index !== -1) {
      queue.messages.splice(index, 1);
    }

    // Call all handlers
    const handlers = Array.from(queue.handlers.values());
    await Promise.all(
      handlers.map(handler => {
        try {
          handler(message);
        } catch (error) {
          this.logger.error('Message handler error', { 
            agentId,
            messageId: message.id,
            error,
          });
        }
      }),
    );

    // Emit received event
    this.eventBus.emit(SystemEvents.MESSAGE_RECEIVED, { 
      from: '', // Would need to track this
      to: agentId,
      message,
    });
  }

  private ensureQueue(agentId: string): MessageQueue {
    if (!this.queues.has(agentId)) {
      this.queues.set(agentId, {
        messages: [],
        handlers: new Map(),
      });
    }
    return this.queues.get(agentId)!;
  }

  async performMaintenance(): Promise<void> {
    this.logger.debug('Performing message router maintenance');
    this.cleanup();
  }

  private cleanup(): void {
    const now = Date.now();

    // Clean up old messages
    for (const [agentId, queue] of this.queues) {
      const filtered = queue.messages.filter(msg => {
        const age = now - msg.timestamp.getTime();
        const maxAge = msg.expiry 
          ? msg.expiry.getTime() - msg.timestamp.getTime()
          : this.config.messageTimeout;

        if (age > maxAge) {
          this.logger.warn('Dropping expired message', { 
            agentId,
            messageId: msg.id,
            age,
          });
          return false;
        }
        return true;
      });

      queue.messages = filtered;

      // Remove empty queues
      if (queue.messages.length === 0 && queue.handlers.size === 0) {
        this.queues.delete(agentId);
      }
    }

    // Clean up timed out responses
    for (const [id, pending] of this.pendingResponses) {
      // This is handled by the timeout, but double-check
      clearTimeout(pending.timeout);
      pending.reject(new Error('Response timeout during cleanup'));
    }
    this.pendingResponses.clear();
  }
}