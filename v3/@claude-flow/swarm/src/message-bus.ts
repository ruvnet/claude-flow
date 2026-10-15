/**
 * V3 Message Bus
 * High-performance inter-agent communication system
 * Target: 1000+ messages/second throughput
 */

import { EventEmitter } from 'events';
import {
  Message,
  MessageAck,
  MessageBusConfig,
  MessageBusStats,
  MessageType,
  IMessageBus,
  SWARM_CONSTANTS,
} from './types.js';

interface MessageQueueEntry {
  message: Message;
  attempts: number;
  enqueuedAt: Date;
  lastAttemptAt?: Date;
}

// ============================================================================
// High-Performance Deque Implementation
// O(1) push/pop from both ends using circular buffer
// ============================================================================

class Deque<T> {
  private buffer: (T | undefined)[];
  private head: number = 0;
  private tail: number = 0;
  private count: number = 0;
  private capacity: number;

  constructor(initialCapacity: number = 16) {
    this.capacity = initialCapacity;
    this.buffer = new Array(this.capacity);
  }

  get length(): number {
    return this.count;
  }

  private grow(): void {
    const newCapacity = this.capacity * 2;
    const newBuffer = new Array(newCapacity);

    // Copy elements in order
    for (let i = 0; i < this.count; i++) {
      newBuffer[i] = this.buffer[(this.head + i) % this.capacity];
    }

    this.buffer = newBuffer;
    this.head = 0;
    this.tail = this.count;
    this.capacity = newCapacity;
  }

  pushBack(item: T): void {
    if (this.count === this.capacity) {
      this.grow();
    }
    this.buffer[this.tail] = item;
    this.tail = (this.tail + 1) % this.capacity;
    this.count++;
  }

  popFront(): T | undefined {
    if (this.count === 0) {
      return undefined;
    }
    const item = this.buffer[this.head];
    this.buffer[this.head] = undefined; // Help GC
    this.head = (this.head + 1) % this.capacity;
    this.count--;
    return item;
  }

  peekFront(): T | undefined {
    if (this.count === 0) {
      return undefined;
    }
    return this.buffer[this.head];
  }

  clear(): void {
    this.buffer = new Array(this.capacity);
    this.head = 0;
    this.tail = 0;
    this.count = 0;
  }

  // Find and remove first matching element - O(n) but rarely used
  findAndRemove(predicate: (item: T) => boolean): T | undefined {
    for (let i = 0; i < this.count; i++) {
      const idx = (this.head + i) % this.capacity;
      const item = this.buffer[idx];
      if (item !== undefined && predicate(item)) {
        // Shift remaining elements (O(n) but acceptable for rare operations)
        for (let j = i; j < this.count - 1; j++) {
          const currentIdx = (this.head + j) % this.capacity;
          const nextIdx = (this.head + j + 1) % this.capacity;
          this.buffer[currentIdx] = this.buffer[nextIdx];
        }
        this.tail = (this.tail - 1 + this.capacity) % this.capacity;
        this.buffer[this.tail] = undefined;
        this.count--;
        return item;
      }
    }
    return undefined;
  }

  find(predicate: (item: T) => boolean): T | undefined {
    for (let i = 0; i < this.count; i++) {
      const idx = (this.head + i) % this.capacity;
      const item = this.buffer[idx];
      if (item !== undefined && predicate(item)) {
        return item;
      }
    }
    return undefined;
  }

  *[Symbol.iterator](): Iterator<T> {
    for (let i = 0; i < this.count; i++) {
      const item = this.buffer[(this.head + i) % this.capacity];
      if (item !== undefined) {
        yield item;
      }
    }
  }
}

// ============================================================================
// Priority Queue using 4-Level Deques
// O(1) insert, O(1) dequeue (vs O(n) for sorted array)
// ============================================================================

type Priority = 'urgent' | 'high' | 'normal' | 'low';
const PRIORITY_ORDER: Priority[] = ['urgent', 'high', 'normal', 'low'];

class PriorityMessageQueue {
  private queues: Map<Priority, Deque<MessageQueueEntry>> = new Map();
  private totalCount: number = 0;

  constructor() {
    for (const priority of PRIORITY_ORDER) {
      this.queues.set(priority, new Deque<MessageQueueEntry>());
    }
  }

  get length(): number {
    return this.totalCount;
  }

  enqueue(entry: MessageQueueEntry): void {
    const priority = entry.message.priority;
    const queue = this.queues.get(priority)!;
    queue.pushBack(entry);
    this.totalCount++;
  }

  dequeue(): MessageQueueEntry | undefined {
    // Dequeue from highest priority non-empty queue
    for (const priority of PRIORITY_ORDER) {
      const queue = this.queues.get(priority)!;
      if (queue.length > 0) {
        this.totalCount--;
        return queue.popFront();
      }
    }
    return undefined;
  }

  // Find and remove first low/normal priority entry for overflow handling
  removeLowestPriority(): MessageQueueEntry | undefined {
    // Check low priority first, then normal
    for (const priority of ['low', 'normal'] as Priority[]) {
      const queue = this.queues.get(priority)!;
      if (queue.length > 0) {
        this.totalCount--;
        return queue.popFront();
      }
    }
    // Fall back to any queue
    for (const priority of PRIORITY_ORDER) {
      const queue = this.queues.get(priority)!;
      if (queue.length > 0) {
        this.totalCount--;
        return queue.popFront();
      }
    }
    return undefined;
  }

  clear(): void {
    for (const queue of this.queues.values()) {
      queue.clear();
    }
    this.totalCount = 0;
  }

  find(predicate: (entry: MessageQueueEntry) => boolean): MessageQueueEntry | undefined {
    for (const queue of this.queues.values()) {
      const found = queue.find(predicate);
      if (found) {
        return found;
      }
    }
    return undefined;
  }
}

interface Subscription {
  agentId: string;
  callback: (message: Message) => void;
  filter?: MessageType[];
}

export class MessageBus extends EventEmitter implements IMessageBus {
  private config: MessageBusConfig;
  private queues: Map<string, PriorityMessageQueue> = new Map();
  private subscriptions: Map<string, Subscription> = new Map();
  private pendingAcks: Map<string, { message: Message; timeout: NodeJS.Timeout }> = new Map();
  private processingInterval?: NodeJS.Timeout;
  private statsInterval?: NodeJS.Timeout;
  private processScheduled: boolean = false;
  private isShutdown: boolean = false;
  private messageCounter: number = 0;
  private stats: MessageBusStats;
  private startTime: Date = new Date();
  // Circular buffer for message history (max 60 entries for 60 seconds)
  private messageHistory: { timestamp: number; count: number }[] = [];
  private messageHistoryIndex: number = 0;
  private static readonly MAX_HISTORY_SIZE = 60;
  // processQueues() is now primarily triggered event-driven (see
  // scheduleProcessing()); the interval below is a low-frequency backstop
  // only, so a caller-configured processingIntervalMs is floored here
  // rather than driving per-tick dispatch directly (dream-cycle 2026-09-30).
  private static readonly MIN_BACKSTOP_INTERVAL_MS = 250;
  // Retries used to be spaced by the poll interval (~10ms in production);
  // event-driven dispatch would otherwise retry a failing handler back to
  // back. Linear backoff (attempt * base), bounded by retryAttempts.
  private static readonly RETRY_BACKOFF_BASE_MS = 10;
  private retryTimers: Set<NodeJS.Timeout> = new Set();

  constructor(config: Partial<MessageBusConfig> = {}) {
    super();
    this.config = {
      maxQueueSize: config.maxQueueSize ?? SWARM_CONSTANTS.MAX_QUEUE_SIZE,
      processingIntervalMs: config.processingIntervalMs ?? 10,
      ackTimeoutMs: config.ackTimeoutMs ?? 5000,
      retryAttempts: config.retryAttempts ?? SWARM_CONSTANTS.MAX_RETRIES,
      enablePersistence: config.enablePersistence ?? false,
      compressionEnabled: config.compressionEnabled ?? false,
    };

    this.stats = {
      totalMessages: 0,
      messagesPerSecond: 0,
      avgLatencyMs: 0,
      queueDepth: 0,
      ackRate: 1.0,
      errorRate: 0,
    };
  }

  async initialize(config?: MessageBusConfig): Promise<void> {
    if (config) {
      this.config = { ...this.config, ...config };
    }

    this.isShutdown = false;
    this.startProcessing();
    this.startStatsCollection();
    this.emit('initialized');
  }

  async shutdown(): Promise<void> {
    // Guards scheduleProcessing() against scheduling a new setImmediate
    // after teardown (e.g. a straggler delivery failure retrying right as
    // shutdown() runs) — harmless before this flag existed (processQueues()
    // just iterated the now-empty queues Map), but it's cleaner to not
    // schedule work post-shutdown at all.
    this.isShutdown = true;

    for (const timer of this.retryTimers) {
      clearTimeout(timer);
    }
    this.retryTimers.clear();

    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = undefined;
    }

    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = undefined;
    }

    // Clear all pending acks
    for (const [, pending] of this.pendingAcks) {
      clearTimeout(pending.timeout);
    }
    this.pendingAcks.clear();

    // Clear all queues
    this.queues.clear();
    this.subscriptions.clear();
    this.messageHistory = [];

    this.emit('shutdown');
  }

  private generateMessageId(): string {
    this.messageCounter++;
    return `msg_${Date.now()}_${this.messageCounter.toString(36)}`;
  }

  async send(message: Omit<Message, 'id' | 'timestamp'>): Promise<string> {
    const fullMessage: Message = {
      ...message,
      id: this.generateMessageId(),
      timestamp: new Date(),
    };

    return this.enqueue(fullMessage);
  }

  async broadcast(message: Omit<Message, 'id' | 'timestamp' | 'to'>): Promise<string> {
    const fullMessage: Message = {
      ...message,
      id: this.generateMessageId(),
      timestamp: new Date(),
      to: 'broadcast',
    };

    return this.enqueue(fullMessage);
  }

  private async enqueue(message: Message): Promise<string> {
    const startTime = performance.now();

    if (message.to === 'broadcast') {
      // Broadcast to all subscribed agents
      for (const [agentId, subscription] of this.subscriptions) {
        if (agentId !== message.from) {
          this.addToQueue(agentId, message);
        }
      }
    } else {
      this.addToQueue(message.to, message);
    }

    this.stats.totalMessages++;
    const latency = performance.now() - startTime;
    this.updateLatencyStats(latency);

    this.emit('message.enqueued', { messageId: message.id, to: message.to });
    this.scheduleProcessing();

    return message.id;
  }

  private addToQueue(agentId: string, message: Message, existingAttempts: number = 0): void {
    if (!this.queues.has(agentId)) {
      this.queues.set(agentId, new PriorityMessageQueue());
    }

    const queue = this.queues.get(agentId)!;

    // Check queue size limit - O(1) removal of lowest priority
    if (queue.length >= this.config.maxQueueSize) {
      queue.removeLowestPriority();
    }

    // O(1) priority-aware insertion
    const entry: MessageQueueEntry = {
      message,
      attempts: existingAttempts,
      enqueuedAt: new Date(),
    };

    queue.enqueue(entry);
  }

  subscribe(agentId: string, callback: (message: Message) => void, filter?: MessageType[]): void {
    this.subscriptions.set(agentId, {
      agentId,
      callback,
      filter,
    });

    // Initialize queue for this agent
    const queue = this.queues.get(agentId);
    if (!queue) {
      this.queues.set(agentId, new PriorityMessageQueue());
    } else if (queue.length > 0) {
      // Messages can be enqueued for an agentId before that agent's
      // subscribe() call lands (e.g. a coordinator sending to an agent it
      // just spawned) — processQueues() skips any queue with no matching
      // subscription, so without this those messages would otherwise only
      // surface at the next backstop tick instead of immediately.
      this.scheduleProcessing();
    }

    this.emit('subscription.added', { agentId });
  }

  unsubscribe(agentId: string): void {
    this.subscriptions.delete(agentId);
    this.queues.delete(agentId);
    this.emit('subscription.removed', { agentId });
  }

  async acknowledge(ack: MessageAck): Promise<void> {
    const pending = this.pendingAcks.get(ack.messageId);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingAcks.delete(ack.messageId);

    if (!ack.received && ack.error) {
      this.handleAckFailure(pending.message, ack.error);
    }

    this.emit('message.acknowledged', {
      messageId: ack.messageId,
      success: ack.received
    });
  }

  private startProcessing(): void {
    // Dispatch is event-driven via scheduleProcessing() (triggered from
    // enqueue() and from retry re-queuing); this interval is only a
    // low-frequency backstop for whatever it might miss, so a small
    // caller-configured processingIntervalMs no longer forces a busy-poll —
    // it's floored at MIN_BACKSTOP_INTERVAL_MS.
    const backstopIntervalMs = Math.max(
      this.config.processingIntervalMs,
      MessageBus.MIN_BACKSTOP_INTERVAL_MS
    );
    this.processingInterval = setInterval(() => {
      this.processQueues();
    }, backstopIntervalMs);
  }

  // Coalesces bursts of synchronous enqueue()/retry calls within the same
  // tick into a single processQueues() pass on the next macrotask, instead
  // of polling on a fixed interval regardless of whether any queue holds a
  // message.
  private scheduleProcessing(): void {
    if (this.processScheduled || this.isShutdown) {
      return;
    }
    this.processScheduled = true;
    setImmediate(() => {
      this.processScheduled = false;
      if (this.isShutdown) {
        return;
      }
      this.processQueues();
    });
  }

  private processQueues(): void {
    const now = Date.now();
    // Each agent is capped at a 10-message batch per pass (below); if a
    // burst left more than that queued, drain the rest on the next
    // macrotask instead of stalling until the backstop interval fires —
    // otherwise a large synchronous burst (many enqueue() calls coalesced
    // by scheduleProcessing() into one pass) would only ever drain its
    // first 10-per-agent messages promptly and leave the remainder to
    // trickle in at the >=250ms backstop rate.
    let hasRemainingWork = false;

    for (const [agentId, queue] of this.queues) {
      const subscription = this.subscriptions.get(agentId);
      if (!subscription) {
        continue;
      }

      // Process messages in batch for better throughput
      const batchSize = Math.min(10, queue.length);
      const batch: MessageQueueEntry[] = [];

      for (let i = 0; i < batchSize && queue.length > 0; i++) {
        // O(1) dequeue from highest priority queue
        const entry = queue.dequeue();
        if (!entry) break;

        // Check TTL
        if (now - entry.message.timestamp.getTime() > entry.message.ttlMs) {
          this.emit('message.expired', { messageId: entry.message.id });
          continue;
        }

        // Check filter
        if (subscription.filter && !subscription.filter.includes(entry.message.type)) {
          continue;
        }

        batch.push(entry);
      }

      // Deliver batch
      for (const entry of batch) {
        this.deliverMessage(subscription, entry);
      }

      if (queue.length > 0) {
        hasRemainingWork = true;
      }
    }

    if (hasRemainingWork) {
      this.scheduleProcessing();
    }
  }

  private deliverMessage(subscription: Subscription, entry: MessageQueueEntry): void {
    const message = entry.message;

    try {
      // Set up ack timeout if required
      if (message.requiresAck) {
        const timeout = setTimeout(() => {
          this.handleAckTimeout(message);
        }, this.config.ackTimeoutMs);

        this.pendingAcks.set(message.id, { message, timeout });
      }

      // Deliver asynchronously
      setImmediate(() => {
        try {
          subscription.callback(message);
          this.emit('message.delivered', {
            messageId: message.id,
            to: subscription.agentId
          });
        } catch (error) {
          this.handleDeliveryError(message, entry, error as Error, subscription.agentId);
        }
      });
    } catch (error) {
      this.handleDeliveryError(message, entry, error as Error, subscription.agentId);
    }
  }

  private handleAckTimeout(message: Message): void {
    this.pendingAcks.delete(message.id);
    this.stats.ackRate = Math.max(0, this.stats.ackRate - 0.01);
    this.emit('message.ack_timeout', { messageId: message.id });
  }

  private handleAckFailure(message: Message, error: string): void {
    this.stats.errorRate += 0.01;
    this.emit('message.ack_failed', { messageId: message.id, error });
  }

  private handleDeliveryError(message: Message, entry: MessageQueueEntry, error: Error, subscriberAgentId: string): void {
    entry.attempts++;
    entry.lastAttemptAt = new Date();

    if (entry.attempts < this.config.retryAttempts) {
      // Re-queue for retry, preserving the attempt count so it's bounded by
      // retryAttempts instead of resetting to 0 on every re-queue.
      //
      // Re-queue under the real subscriber's agentId, not message.to: for a
      // broadcast message, message.to is the literal string 'broadcast',
      // not any queue a subscription actually drains (enqueue() fanned the
      // original send out to each subscriber's own agentId-keyed queue), so
      // re-queuing under message.to would silently strand the retry in an
      // orphaned queue nobody processes.
      //
      // The re-queue itself is delayed (not just the dispatch) so the
      // backstop interval cannot pick the message up early either.
      const backoffMs = MessageBus.RETRY_BACKOFF_BASE_MS * entry.attempts;
      const timer = setTimeout(() => {
        this.retryTimers.delete(timer);
        if (this.isShutdown) {
          return;
        }
        // The subscriber may have unsubscribed during the backoff; addToQueue
        // would recreate an orphaned queue nobody drains.
        if (!this.subscriptions.has(subscriberAgentId)) {
          return;
        }
        this.addToQueue(subscriberAgentId, message, entry.attempts);
        this.scheduleProcessing();
      }, backoffMs);
      timer.unref?.();
      this.retryTimers.add(timer);
      this.emit('message.retry', {
        messageId: message.id,
        attempt: entry.attempts
      });
    } else {
      this.stats.errorRate += 0.01;
      this.emit('message.failed', {
        messageId: message.id,
        error: error.message
      });
    }
  }

  private startStatsCollection(): void {
    this.statsInterval = setInterval(() => {
      this.calculateMessagesPerSecond();
    }, 1000);
  }

  private calculateMessagesPerSecond(): void {
    const now = Date.now();
    const entry = { timestamp: now, count: this.stats.totalMessages };

    // Use circular buffer pattern - O(1) instead of O(n) filter
    if (this.messageHistory.length < MessageBus.MAX_HISTORY_SIZE) {
      this.messageHistory.push(entry);
    } else {
      this.messageHistory[this.messageHistoryIndex] = entry;
      this.messageHistoryIndex = (this.messageHistoryIndex + 1) % MessageBus.MAX_HISTORY_SIZE;
    }

    // Calculate messages per second from history
    if (this.messageHistory.length >= 2) {
      // Find oldest valid entry (within last 60 seconds)
      let oldest = entry;
      for (const h of this.messageHistory) {
        if (h.timestamp < oldest.timestamp && now - h.timestamp < 60000) {
          oldest = h;
        }
      }
      const seconds = (now - oldest.timestamp) / 1000;
      const messages = entry.count - oldest.count;
      this.stats.messagesPerSecond = seconds > 0 ? messages / seconds : 0;
    }

    // Update queue depth
    this.stats.queueDepth = this.getQueueDepth();
  }

  private updateLatencyStats(latencyMs: number): void {
    // Exponential moving average
    const alpha = 0.1;
    this.stats.avgLatencyMs = alpha * latencyMs + (1 - alpha) * this.stats.avgLatencyMs;
  }

  getStats(): MessageBusStats {
    return { ...this.stats };
  }

  getQueueDepth(): number {
    let total = 0;
    for (const queue of this.queues.values()) {
      total += queue.length;
    }
    return total;
  }

  // Direct message retrieval for agents (pull mode)
  getMessages(agentId: string): Message[] {
    const queue = this.queues.get(agentId);
    if (!queue) {
      return [];
    }

    const now = Date.now();
    const messages: Message[] = [];

    // O(1) per dequeue operation
    while (queue.length > 0) {
      const entry = queue.dequeue();
      if (!entry) break;
      if (now - entry.message.timestamp.getTime() <= entry.message.ttlMs) {
        messages.push(entry.message);
      }
    }

    return messages;
  }

  // Query pending messages for an agent
  hasPendingMessages(agentId: string): boolean {
    const queue = this.queues.get(agentId);
    return queue !== undefined && queue.length > 0;
  }

  // Get message by ID
  getMessage(messageId: string): Message | undefined {
    for (const queue of this.queues.values()) {
      const entry = queue.find(e => e.message.id === messageId);
      if (entry) {
        return entry.message;
      }
    }
    return undefined;
  }
}

export function createMessageBus(config?: Partial<MessageBusConfig>): MessageBus {
  return new MessageBus(config);
}
