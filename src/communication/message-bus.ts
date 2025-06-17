/**
 * Advanced messaging and communication layer for swarm coordination
 */

import { EventEmitter } from 'node:events';
import { ILogger } from '../core/logger.js';
import { IEventBus } from '../core/event-bus.js';
import { 
  SwarmEvent, 
  EventType, 
  AgentId, 
  CommunicationStrategy 
} from '../swarm/types.js';
import { generateId } from '../utils/helpers.js';

export interface MessageBusConfig {
  strategy: CommunicationStrategy;
  enablePersistence: boolean;
  enableReliability: boolean;
  enableOrdering: boolean;
  enableFiltering: boolean;
  maxMessageSize: number;
  maxQueueSize: number;
  messageRetention: number;
  acknowledgmentTimeout: number;
  retryAttempts: number;
  backoffMultiplier: number;
  compressionEnabled: boolean;
  encryptionEnabled: boolean;
  metricsEnabled: boolean;
  debugMode: boolean;
}

export interface Message {
  id: string;
  type: string;
  sender: AgentId;
  receivers: AgentId[];
  content: any;
  metadata: MessageMetadata;
  timestamp: Date;
  expiresAt?: Date;
  priority: MessagePriority;
  reliability: ReliabilityLevel;
}

export interface MessageMetadata {
  correlationId?: string;
  causationId?: string;
  replyTo?: string;
  ttl?: number;
  compressed: boolean;
  encrypted: boolean;
  size: number;
  contentType: string;
  encoding: string;
  checksum?: string;
  route?: string[];
}

export interface MessageChannel {
  id: string;
  name: string;
  type: ChannelType;
  participants: AgentId[];
  config: ChannelConfig;
  statistics: ChannelStatistics;
  filters: MessageFilter[];
  middleware: ChannelMiddleware[];
}

export interface ChannelConfig {
  persistent: boolean;
  ordered: boolean;
  reliable: boolean;
  maxParticipants: number;
  maxMessageSize: number;
  maxQueueDepth: number;
  retentionPeriod: number;
  accessControl: AccessControlConfig;
}

export interface AccessControlConfig {
  readPermission: 'public' | 'participants' | 'restricted';
  writePermission: 'public' | 'participants' | 'restricted';
  adminPermission: 'creator' | 'administrators' | 'system';
  allowedSenders: AgentId[];
  allowedReceivers: AgentId[];
  bannedAgents: AgentId[];
}

export interface ChannelStatistics {
  messagesTotal: number;
  messagesDelivered: number;
  messagesFailed: number;
  bytesTransferred: number;
  averageLatency: number;
  throughput: number;
  errorRate: number;
  participantCount: number;
  lastActivity: Date;
}

export interface MessageFilter {
  id: string;
  name: string;
  enabled: boolean;
  conditions: FilterCondition[];
  action: 'allow' | 'deny' | 'modify' | 'route';
  priority: number;
}

export interface FilterCondition {
  field: string;
  operator: 'eq' | 'ne' | 'gt' | 'lt' | 'contains' | 'matches' | 'in';
  value: any;
  caseSensitive?: boolean;
}

export interface ChannelMiddleware {
  id: string;
  name: string;
  enabled: boolean;
  order: number;
  process: (message: Message, context: MiddlewareContext) => Promise<Message | null>;
}

export interface MiddlewareContext {
  channel: MessageChannel;
  direction: 'inbound' | 'outbound';
  agent: AgentId;
  metadata: Record<string, any>;
}

export interface MessageQueue {
  id: string;
  name: string;
  type: QueueType;
  messages: Message[];
  config: QueueConfig;
  subscribers: QueueSubscriber[];
  statistics: QueueStatistics;
}

export interface QueueConfig {
  maxSize: number;
  persistent: boolean;
  ordered: boolean;
  durability: 'memory' | 'disk' | 'distributed';
  deliveryMode: 'at-most-once' | 'at-least-once' | 'exactly-once';
  deadLetterQueue?: string;
  retryPolicy: RetryPolicy;
}

export interface QueueSubscriber {
  id: string;
  agent: AgentId;
  filter?: MessageFilter;
  ackMode: 'auto' | 'manual';
  prefetchCount: number;
  lastActivity: Date;
}

export interface QueueStatistics {
  depth: number;
  enqueueRate: number;
  dequeueRate: number;
  throughput: number;
  averageWaitTime: number;
  subscriberCount: number;
  deadLetterCount: number;
}

export interface RetryPolicy {
  maxAttempts: number;
  initialDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  jitter: boolean;
}

export interface TopicSubscription {
  id: string;
  topic: string;
  subscriber: AgentId;
  filter?: MessageFilter;
  ackRequired: boolean;
  qos: QualityOfService;
  createdAt: Date;
  lastMessage?: Date;
}

export interface RoutingRule {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  conditions: FilterCondition[];
  actions: RoutingAction[];
}

export interface RoutingAction {
  type: 'forward' | 'duplicate' | 'transform' | 'aggregate' | 'delay';
  target?: string;
  config: Record<string, any>;
}

export type MessagePriority = 'low' | 'normal' | 'high' | 'critical';
export type ReliabilityLevel = 'best-effort' | 'at-least-once' | 'exactly-once';
export type ChannelType = 'direct' | 'broadcast' | 'multicast' | 'topic' | 'queue';
export type QueueType = 'fifo' | 'lifo' | 'priority' | 'delay' | 'round-robin';
export type QualityOfService = 0 | 1 | 2; // MQTT-style QoS levels

/**
 * Advanced message bus with support for multiple communication patterns
 */
export class MessageBus extends EventEmitter {
  private logger: ILogger;
  private eventBus: IEventBus;
  private config: MessageBusConfig;

  // Core messaging components
  private channels = new Map<string, MessageChannel>();
  private queues = new Map<string, MessageQueue>();
  private subscriptions = new Map<string, TopicSubscription>();
  private routingRules = new Map<string, RoutingRule>();

  // Message tracking
  private messageStore = new Map<string, Message>();
  private deliveryReceipts = new Map<string, DeliveryReceipt>();
  private acknowledgments = new Map<string, MessageAcknowledgment>();

  // Routing and delivery
  private router: MessageRouter;
  private deliveryManager: DeliveryManager;
  private retryManager: RetryManager;

  // Performance monitoring
  private metrics: MessageBusMetrics;
  private metricsInterval?: NodeJS.Timeout;

  constructor(
    config: Partial<MessageBusConfig>,
    logger: ILogger,
    eventBus: IEventBus
  ) {
    super();
    this.logger = logger;
    this.eventBus = eventBus;

    this.config = {
      strategy: 'event-driven',
      enablePersistence: true,
      enableReliability: true,
      enableOrdering: false,
      enableFiltering: true,
      maxMessageSize: 1024 * 1024, // 1MB
      maxQueueSize: 10000,
      messageRetention: 86400000, // 24 hours
      acknowledgmentTimeout: 30000,
      retryAttempts: 3,
      backoffMultiplier: 2,
      compressionEnabled: false,
      encryptionEnabled: false,
      metricsEnabled: true,
      debugMode: false,
      ...config
    };

    this.router = new MessageRouter(this.config, this.logger);
    this.deliveryManager = new DeliveryManager(this.config, this.logger);
    this.retryManager = new RetryManager(this.config, this.logger);
    this.metrics = new MessageBusMetrics();

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.eventBus.on('agent:connected', (data) => {
      this.handleAgentConnected(data.agentId);
    });

    this.eventBus.on('agent:disconnected', (data) => {
      this.handleAgentDisconnected(data.agentId);
    });

    this.deliveryManager.on('delivery:success', (data) => {
      this.handleDeliverySuccess(data);
    });

    this.deliveryManager.on('delivery:failure', (data) => {
      this.handleDeliveryFailure(data);
    });

    this.retryManager.on('retry:exhausted', (data) => {
      this.handleRetryExhausted(data);
    });
  }

  async initialize(): Promise<void> {
    this.logger.info('Initializing message bus', {
      strategy: this.config.strategy,
      persistence: this.config.enablePersistence,
      reliability: this.config.enableReliability
    });

    // Initialize components
    await this.router.initialize();
    await this.deliveryManager.initialize();
    await this.retryManager.initialize();

    // Create default channels
    await this.createDefaultChannels();

    // Start metrics collection
    if (this.config.metricsEnabled) {
      this.startMetricsCollection();
    }

    this.emit('messagebus:initialized');
  }

  async shutdown(): Promise<void> {
    this.logger.info('Shutting down message bus');

    // Stop metrics collection
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }

    // Shutdown components
    await this.retryManager.shutdown();
    await this.deliveryManager.shutdown();
    await this.router.shutdown();

    // Persist any remaining messages if enabled
    if (this.config.enablePersistence) {
      await this.persistMessages();
    }

    this.emit('messagebus:shutdown');
  }

  // === MESSAGE OPERATIONS ===

  async sendMessage(
    type: string,
    content: any,
    sender: AgentId,
    receivers: AgentId | AgentId[],
    options: {
      priority?: MessagePriority;
      reliability?: ReliabilityLevel;
      ttl?: number;
      correlationId?: string;
      replyTo?: string;
      channel?: string;
    } = {}
  ): Promise<string> {
    const messageId = generateId('msg');
    const now = new Date();
    
    const receiversArray = Array.isArray(receivers) ? receivers : [receivers];
    
    const message: Message = {
      id: messageId,
      type,
      sender,
      receivers: receiversArray,
      content: await this.processContent(content),
      metadata: {
        correlationId: options.correlationId,
        replyTo: options.replyTo,
        ttl: options.ttl,
        compressed: this.config.compressionEnabled,
        encrypted: this.config.encryptionEnabled,
        size: this.calculateSize(content),
        contentType: this.detectContentType(content),
        encoding: 'utf-8',
        route: [sender.id]
      },
      timestamp: now,
      expiresAt: options.ttl ? new Date(now.getTime() + options.ttl) : undefined,
      priority: options.priority || 'normal',
      reliability: options.reliability || 'best-effort'
    };

    // Validate message
    this.validateMessage(message);

    // Store message if persistence is enabled
    if (this.config.enablePersistence) {
      this.messageStore.set(messageId, message);
    }

    // Route and deliver message
    await this.routeMessage(message, options.channel);

    this.metrics.recordMessageSent(message);

    this.logger.debug('Message sent', {
      messageId,
      type,
      sender: sender.id,
      receivers: receiversArray.map(r => r.id),
      size: message.metadata.size
    });

    this.emit('message:sent', { message });

    return messageId;
  }

  async broadcastMessage(
    type: string,
    content: any,
    sender: AgentId,
    options: {
      channel?: string;
      filter?: MessageFilter;
      priority?: MessagePriority;
      ttl?: number;
    } = {}
  ): Promise<string> {
    const channel = options.channel ? 
      this.channels.get(options.channel) : 
      this.getDefaultBroadcastChannel();

    if (!channel) {
      throw new Error('No broadcast channel available');
    }

    // Get all participants as receivers
    let receivers = channel.participants.filter(p => p.id !== sender.id);

    // Apply filter if provided
    if (options.filter) {
      receivers = await this.filterReceivers(receivers, options.filter, { type, content });
    }

    return this.sendMessage(type, content, sender, receivers, {
      priority: options.priority,
      ttl: options.ttl,
      channel: channel.id
    });
  }

  async subscribeToTopic(
    topic: string,
    subscriber: AgentId,
    options: {
      filter?: MessageFilter;
      qos?: QualityOfService;
      ackRequired?: boolean;
    } = {}
  ): Promise<string> {
    const subscriptionId = generateId('sub');
    
    const subscription: TopicSubscription = {
      id: subscriptionId,
      topic,
      subscriber,
      filter: options.filter,
      ackRequired: options.ackRequired || false,
      qos: options.qos || 0,
      createdAt: new Date()
    };

    this.subscriptions.set(subscriptionId, subscription);

    this.logger.info('Topic subscription created', {
      subscriptionId,
      topic,
      subscriber: subscriber.id,
      qos: subscription.qos
    });

    this.emit('subscription:created', { subscription });

    return subscriptionId;
  }

  async unsubscribeFromTopic(subscriptionId: string): Promise<void> {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription) {
      throw new Error(`Subscription ${subscriptionId} not found`);
    }

    this.subscriptions.delete(subscriptionId);

    this.logger.info('Topic subscription removed', {
      subscriptionId,
      topic: subscription.topic,
      subscriber: subscription.subscriber.id
    });

    this.emit('subscription:removed', { subscription });
  }

  async acknowledgeMessage(messageId: string, agentId: AgentId): Promise<void> {
    const message = this.messageStore.get(messageId);
    if (!message) {
      throw new Error(`Message ${messageId} not found`);
    }

    const ack: MessageAcknowledgment = {
      messageId,
      agentId,
      timestamp: new Date(),
      status: 'acknowledged'
    };

    this.acknowledgments.set(`${messageId}:${agentId.id}`, ack);

    this.logger.debug('Message acknowledged', {
      messageId,
      agentId: agentId.id
    });

    this.emit('message:acknowledged', { messageId, agentId });

    // Check if all receivers have acknowledged
    this.checkAllAcknowledgments(message);
  }

  // === CHANNEL MANAGEMENT ===

  async createChannel(
    name: string,
    type: ChannelType,
    config: Partial<ChannelConfig> = {}
  ): Promise<string> {
    const channelId = generateId('channel');
    
    const channel: MessageChannel = {
      id: channelId,
      name,
      type,
      participants: [],
      config: {
        persistent: true,
        ordered: false,
        reliable: true,
        maxParticipants: 1000,
        maxMessageSize: this.config.maxMessageSize,
        maxQueueDepth: this.config.maxQueueSize,
        retentionPeriod: this.config.messageRetention,
        accessControl: {
          readPermission: 'participants',
          writePermission: 'participants',
          adminPermission: 'creator',
          allowedSenders: [],
          allowedReceivers: [],
          bannedAgents: []
        },
        ...config
      },
      statistics: this.createChannelStatistics(),
      filters: [],
      middleware: []
    };

    this.channels.set(channelId, channel);

    this.logger.info('Channel created', {
      channelId,
      name,
      type,
      config: channel.config
    });

    this.emit('channel:created', { channel });

    return channelId;
  }

  async joinChannel(channelId: string, agentId: AgentId): Promise<void> {
    const channel = this.channels.get(channelId);
    if (!channel) {
      throw new Error(`Channel ${channelId} not found`);
    }

    // Check access permissions
    if (!this.canJoinChannel(channel, agentId)) {
      throw new Error(`Agent ${agentId.id} not allowed to join channel ${channelId}`);
    }

    // Check capacity
    if (channel.participants.length >= channel.config.maxParticipants) {
      throw new Error(`Channel ${channelId} is at capacity`);
    }

    // Add participant if not already present
    if (!channel.participants.some(p => p.id === agentId.id)) {
      channel.participants.push(agentId);
      channel.statistics.participantCount = channel.participants.length;
    }

    this.logger.info('Agent joined channel', {
      channelId,
      agentId: agentId.id,
      participantCount: channel.participants.length
    });

    this.emit('channel:joined', { channelId, agentId });
  }

  async leaveChannel(channelId: string, agentId: AgentId): Promise<void> {
    const channel = this.channels.get(channelId);
    if (!channel) {
      throw new Error(`Channel ${channelId} not found`);
    }

    // Remove participant
    channel.participants = channel.participants.filter(p => p.id !== agentId.id);
    channel.statistics.participantCount = channel.participants.length;

    this.logger.info('Agent left channel', {
      channelId,
      agentId: agentId.id,
      participantCount: channel.participants.length
    });

    this.emit('channel:left', { channelId, agentId });
  }

  // === QUEUE MANAGEMENT ===

  async createQueue(
    name: string,
    type: QueueType,
    config: Partial<QueueConfig> = {}
  ): Promise<string> {
    const queueId = generateId('queue');
    
    const queue: MessageQueue = {
      id: queueId,
      name,
      type,
      messages: [],
      config: {
        maxSize: this.config.maxQueueSize,
        persistent: this.config.enablePersistence,
        ordered: this.config.enableOrdering,
        durability: 'memory',
        deliveryMode: 'at-least-once',
        retryPolicy: {
          maxAttempts: this.config.retryAttempts,
          initialDelay: 1000,
          maxDelay: 30000,
          backoffMultiplier: this.config.backoffMultiplier,
          jitter: true
        },
        ...config
      },
      subscribers: [],
      statistics: this.createQueueStatistics()
    };

    this.queues.set(queueId, queue);

    this.logger.info('Queue created', {
      queueId,
      name,
      type,
      config: queue.config
    });

    this.emit('queue:created', { queue });

    return queueId;
  }

  async enqueueMessage(queueId: string, message: Message): Promise<void> {
    const queue = this.queues.get(queueId);
    if (!queue) {
      throw new Error(`Queue ${queueId} not found`);
    }

    // Check queue capacity
    if (queue.messages.length >= queue.config.maxSize) {
      if (queue.config.deadLetterQueue) {
        await this.sendToDeadLetterQueue(queue.config.deadLetterQueue, message, 'queue_full');
        return;
      } else {
        throw new Error(`Queue ${queueId} is full`);
      }
    }

    // Insert message based on queue type
    this.insertMessageInQueue(queue, message);

    queue.statistics.depth = queue.messages.length;
    queue.statistics.enqueueRate++;

    this.logger.debug('Message enqueued', {
      queueId,
      messageId: message.id,
      queueDepth: queue.messages.length
    });

    this.emit('message:enqueued', { queueId, message });

    // Process queue for delivery
    await this.processQueue(queue);
  }

  async dequeueMessage(queueId: string, subscriberId: string): Promise<Message | null> {
    const queue = this.queues.get(queueId);
    if (!queue) {
      throw new Error(`Queue ${queueId} not found`);
    }

    const subscriber = queue.subscribers.find(s => s.id === subscriberId);
    if (!subscriber) {
      throw new Error(`Subscriber ${subscriberId} not found in queue ${queueId}`);
    }

    // Find next eligible message
    let message: Message | null = null;
    let messageIndex = -1;

    for (let i = 0; i < queue.messages.length; i++) {
      const msg = queue.messages[i];
      
      // Check if message matches subscriber filter
      if (subscriber.filter && !this.matchesFilter(msg, subscriber.filter)) {
        continue;
      }

      message = msg;
      messageIndex = i;
      break;
    }

    if (!message) {
      return null;
    }

    // Remove message from queue (for at-least-once, remove after ack)
    if (queue.config.deliveryMode === 'at-most-once') {
      queue.messages.splice(messageIndex, 1);
    }

    queue.statistics.depth = queue.messages.length;
    queue.statistics.dequeueRate++;
    subscriber.lastActivity = new Date();

    this.logger.debug('Message dequeued', {
      queueId,
      messageId: message.id,
      subscriberId,
      queueDepth: queue.messages.length
    });

    this.emit('message:dequeued', { queueId, message, subscriberId });

    return message;
  }

  // === ROUTING AND DELIVERY ===

  private async routeMessage(message: Message, preferredChannel?: string): Promise<void> {
    // Apply routing rules
    const route = await this.router.calculateRoute(message, preferredChannel);
    
    // Update message route
    message.metadata.route = [...(message.metadata.route || []), ...route.hops];

    // Deliver to targets
    for (const target of route.targets) {
      await this.deliverMessage(message, target);
    }
  }

  private async deliverMessage(message: Message, target: DeliveryTarget): Promise<void> {
    try {
      await this.deliveryManager.deliver(message, target);
      this.metrics.recordDeliverySuccess(message);
      
    } catch (error) {
      this.metrics.recordDeliveryFailure(message);
      
      // Handle delivery failure based on reliability level
      if (message.reliability !== 'best-effort') {
        await this.retryManager.scheduleRetry(message, target, error);
      }
    }
  }

  // === UTILITY METHODS ===

  private validateMessage(message: Message): void {
    if (message.metadata.size > this.config.maxMessageSize) {
      throw new Error(`Message size ${message.metadata.size} exceeds limit ${this.config.maxMessageSize}`);
    }

    if (message.expiresAt && message.expiresAt <= new Date()) {
      throw new Error('Message has already expired');
    }

    if (message.receivers.length === 0) {
      throw new Error('Message must have at least one receiver');
    }
  }

  private async processContent(content: any): Promise<any> {
    let processed = content;

    // Compress if enabled
    if (this.config.compressionEnabled) {
      processed = await this.compress(processed);
    }

    // Encrypt if enabled
    if (this.config.encryptionEnabled) {
      processed = await this.encrypt(processed);
    }

    return processed;
  }

  private calculateSize(content: any): number {
    return JSON.stringify(content).length;
  }

  private detectContentType(content: any): string {
    if (typeof content === 'string') return 'text/plain';
    if (typeof content === 'object') return 'application/json';
    if (Buffer.isBuffer(content)) return 'application/octet-stream';
    return 'application/unknown';
  }

  private async filterReceivers(
    receivers: AgentId[],
    filter: MessageFilter,
    context: any
  ): Promise<AgentId[]> {
    // Placeholder for receiver filtering logic
    return receivers;
  }

  private canJoinChannel(channel: MessageChannel, agentId: AgentId): boolean {
    const acl = channel.config.accessControl;
    
    // Check banned list
    if (acl.bannedAgents.some(banned => banned.id === agentId.id)) {
      return false;
    }

    // Check allowed list (if specified)
    if (acl.allowedSenders.length > 0) {
      return acl.allowedSenders.some(allowed => allowed.id === agentId.id);
    }

    return true;
  }

  private matchesFilter(message: Message, filter: MessageFilter): boolean {
    return filter.conditions.every(condition => {
      const fieldValue = this.getFieldValue(message, condition.field);
      return this.evaluateCondition(fieldValue, condition.operator, condition.value);
    });
  }

  private getFieldValue(message: Message, field: string): any {
    const parts = field.split('.');
    let value: any = message;
    
    for (const part of parts) {
      value = value?.[part];
    }
    
    return value;
  }

  private evaluateCondition(fieldValue: any, operator: string, compareValue: any): boolean {
    switch (operator) {
      case 'eq': return fieldValue === compareValue;
      case 'ne': return fieldValue !== compareValue;
      case 'gt': return fieldValue > compareValue;
      case 'lt': return fieldValue < compareValue;
      case 'contains': return String(fieldValue).includes(String(compareValue));
      case 'matches': return new RegExp(compareValue).test(String(fieldValue));
      case 'in': return Array.isArray(compareValue) && compareValue.includes(fieldValue);
      default: return false;
    }
  }

  private insertMessageInQueue(queue: MessageQueue, message: Message): void {
    switch (queue.type) {
      case 'fifo':
        queue.messages.push(message);
        break;
      case 'lifo':
        queue.messages.unshift(message);
        break;
      case 'priority':
        this.insertByPriority(queue.messages, message);
        break;
      case 'delay':
        this.insertByTimestamp(queue.messages, message);
        break;
      default:
        queue.messages.push(message);
    }
  }

  private insertByPriority(messages: Message[], message: Message): void {
    const priorityOrder = { 'critical': 0, 'high': 1, 'normal': 2, 'low': 3 };
    const messagePriority = priorityOrder[message.priority];
    
    let insertIndex = messages.length;
    for (let i = 0; i < messages.length; i++) {
      const currentPriority = priorityOrder[messages[i].priority];
      if (messagePriority < currentPriority) {
        insertIndex = i;
        break;
      }
    }
    
    messages.splice(insertIndex, 0, message);
  }

  private insertByTimestamp(messages: Message[], message: Message): void {
    const targetTime = message.expiresAt || message.timestamp;
    
    let insertIndex = messages.length;
    for (let i = 0; i < messages.length; i++) {
      const currentTime = messages[i].expiresAt || messages[i].timestamp;
      if (targetTime <= currentTime) {
        insertIndex = i;
        break;
      }
    }
    
    messages.splice(insertIndex, 0, message);
  }

  private async processQueue(queue: MessageQueue): Promise<void> {
    // Process messages for subscribers
    for (const subscriber of queue.subscribers) {
      if (subscriber.prefetchCount > 0) {
        // Deliver up to prefetch count
        for (let i = 0; i < subscriber.prefetchCount; i++) {
          const message = await this.dequeueMessage(queue.id, subscriber.id);
          if (!message) break;
          
          await this.deliverMessageToSubscriber(message, subscriber);
        }
      }
    }
  }

  private async deliverMessageToSubscriber(message: Message, subscriber: QueueSubscriber): Promise<void> {
    try {
      // Deliver message to subscriber
      this.emit('message:delivered', {
        message,
        subscriber: subscriber.agent
      });

      // Handle acknowledgment if required
      if (subscriber.ackMode === 'auto') {
        await this.acknowledgeMessage(message.id, subscriber.agent);
      }

    } catch (error) {
      this.logger.error('Failed to deliver message to subscriber', {
        messageId: message.id,
        subscriberId: subscriber.id,
        error
      });
    }
  }

  private checkAllAcknowledgments(message: Message): void {
    const requiredAcks = message.receivers.length;
    const receivedAcks = message.receivers.filter(receiver =>
      this.acknowledgments.has(`${message.id}:${receiver.id}`)
    ).length;

    if (receivedAcks === requiredAcks) {
      this.emit('message:fully-acknowledged', { message });
      
      // Clean up acknowledgments
      message.receivers.forEach(receiver => {
        this.acknowledgments.delete(`${message.id}:${receiver.id}`);
      });
    }
  }

  private async createDefaultChannels(): Promise<void> {
    // System broadcast channel
    await this.createChannel('system-broadcast', 'broadcast', {
      persistent: true,
      reliable: true,
      maxParticipants: 10000
    });

    // Agent coordination channel
    await this.createChannel('agent-coordination', 'multicast', {
      persistent: true,
      reliable: true,
      ordered: true
    });

    // Task distribution channel
    await this.createChannel('task-distribution', 'topic', {
      persistent: true,
      reliable: false
    });
  }

  private getDefaultBroadcastChannel(): MessageChannel | undefined {
    return Array.from(this.channels.values())
      .find(channel => channel.type === 'broadcast');
  }

  private createChannelStatistics(): ChannelStatistics {
    return {
      messagesTotal: 0,
      messagesDelivered: 0,
      messagesFailed: 0,
      bytesTransferred: 0,
      averageLatency: 0,
      throughput: 0,
      errorRate: 0,
      participantCount: 0,
      lastActivity: new Date()
    };
  }

  private createQueueStatistics(): QueueStatistics {
    return {
      depth: 0,
      enqueueRate: 0,
      dequeueRate: 0,
      throughput: 0,
      averageWaitTime: 0,
      subscriberCount: 0,
      deadLetterCount: 0
    };
  }

  private startMetricsCollection(): void {
    this.metricsInterval = setInterval(() => {
      this.updateMetrics();
    }, 10000); // Every 10 seconds
  }

  private updateMetrics(): void {
    // Update channel statistics
    for (const channel of this.channels.values()) {
      // Calculate throughput, latency, etc.
      this.updateChannelStatistics(channel);
    }

    // Update queue statistics
    for (const queue of this.queues.values()) {
      this.updateQueueStatistics(queue);
    }

    // Emit metrics event
    this.emit('metrics:updated', { metrics: this.getMetrics() });
  }

  private updateChannelStatistics(channel: MessageChannel): void {
    // Placeholder for channel statistics calculation
    channel.statistics.lastActivity = new Date();
  }

  private updateQueueStatistics(queue: MessageQueue): void {
    // Placeholder for queue statistics calculation
    queue.statistics.depth = queue.messages.length;
  }

  private handleAgentConnected(agentId: AgentId): void {
    this.logger.info('Agent connected to message bus', { agentId: agentId.id });
    this.emit('agent:connected', { agentId });
  }

  private handleAgentDisconnected(agentId: AgentId): void {
    this.logger.info('Agent disconnected from message bus', { agentId: agentId.id });
    
    // Remove from all channels
    for (const channel of this.channels.values()) {
      channel.participants = channel.participants.filter(p => p.id !== agentId.id);
    }

    // Remove subscriptions
    for (const [subId, subscription] of this.subscriptions) {
      if (subscription.subscriber.id === agentId.id) {
        this.subscriptions.delete(subId);
      }
    }

    this.emit('agent:disconnected', { agentId });
  }

  private handleDeliverySuccess(data: any): void {
    this.metrics.recordDeliverySuccess(data.message);
  }

  private handleDeliveryFailure(data: any): void {
    this.metrics.recordDeliveryFailure(data.message);
  }

  private handleRetryExhausted(data: any): void {
    this.logger.error('Message delivery retry exhausted', {
      messageId: data.message.id,
      target: data.target
    });

    // Send to dead letter queue if configured
    this.sendToDeadLetterQueue('system-dlq', data.message, 'retry_exhausted');
  }

  private async sendToDeadLetterQueue(queueId: string, message: Message, reason: string): Promise<void> {
    try {
      message.metadata.deadLetterReason = reason;
      message.metadata.deadLetterTimestamp = new Date();
      
      await this.enqueueMessage(queueId, message);
      
    } catch (error) {
      this.logger.error('Failed to send message to dead letter queue', {
        messageId: message.id,
        queueId,
        reason,
        error
      });
    }
  }

  private async compress(content: any): Promise<any> {
    // Placeholder for compression
    return content;
  }

  private async encrypt(content: any): Promise<any> {
    // Placeholder for encryption
    return content;
  }

  private async persistMessages(): Promise<void> {
    // Placeholder for message persistence
    this.logger.info('Persisting messages', { count: this.messageStore.size });
  }

  // === PUBLIC API ===

  getChannel(channelId: string): MessageChannel | undefined {
    return this.channels.get(channelId);
  }

  getAllChannels(): MessageChannel[] {
    return Array.from(this.channels.values());
  }

  getQueue(queueId: string): MessageQueue | undefined {
    return this.queues.get(queueId);
  }

  getAllQueues(): MessageQueue[] {
    return Array.from(this.queues.values());
  }

  getSubscription(subscriptionId: string): TopicSubscription | undefined {
    return this.subscriptions.get(subscriptionId);
  }

  getAllSubscriptions(): TopicSubscription[] {
    return Array.from(this.subscriptions.values());
  }

  getMetrics(): any {
    return {
      channels: this.channels.size,
      queues: this.queues.size,
      subscriptions: this.subscriptions.size,
      storedMessages: this.messageStore.size,
      deliveryReceipts: this.deliveryReceipts.size,
      acknowledgments: this.acknowledgments.size,
      busMetrics: this.metrics.getMetrics()
    };
  }

  getMessage(messageId: string): Message | undefined {
    return this.messageStore.get(messageId);
  }

  async addChannelFilter(channelId: string, filter: MessageFilter): Promise<void> {
    const channel = this.channels.get(channelId);
    if (!channel) {
      throw new Error(`Channel ${channelId} not found`);
    }

    channel.filters.push(filter);
    channel.filters.sort((a, b) => a.priority - b.priority);
  }

  async addChannelMiddleware(channelId: string, middleware: ChannelMiddleware): Promise<void> {
    const channel = this.channels.get(channelId);
    if (!channel) {
      throw new Error(`Channel ${channelId} not found`);
    }

    channel.middleware.push(middleware);
    channel.middleware.sort((a, b) => a.order - b.order);
  }
}

// === HELPER CLASSES ===

interface DeliveryReceipt {
  messageId: string;
  target: string;
  status: 'delivered' | 'failed' | 'pending';
  timestamp: Date;
  attempts: number;
  error?: string;
}

interface MessageAcknowledgment {
  messageId: string;
  agentId: AgentId;
  timestamp: Date;
  status: 'acknowledged' | 'rejected';
}

interface DeliveryTarget {
  type: 'agent' | 'channel' | 'queue' | 'topic';
  id: string;
  address?: string;
}

interface RouteResult {
  targets: DeliveryTarget[];
  hops: string[];
  cost: number;
}

class MessageRouter {
  constructor(private config: MessageBusConfig, private logger: ILogger) {}

  async initialize(): Promise<void> {
    this.logger.debug('Message router initialized');
  }

  async shutdown(): Promise<void> {
    this.logger.debug('Message router shutdown');
  }

  async calculateRoute(message: Message, preferredChannel?: string): Promise<RouteResult> {
    const targets: DeliveryTarget[] = [];
    const hops: string[] = [];

    // Simple routing - direct to receivers
    for (const receiver of message.receivers) {
      targets.push({
        type: 'agent',
        id: receiver.id
      });
      hops.push(receiver.id);
    }

    return {
      targets,
      hops,
      cost: targets.length
    };
  }
}

class DeliveryManager extends EventEmitter {
  constructor(private config: MessageBusConfig, private logger: ILogger) {
    super();
  }

  async initialize(): Promise<void> {
    this.logger.debug('Delivery manager initialized');
  }

  async shutdown(): Promise<void> {
    this.logger.debug('Delivery manager shutdown');
  }

  async deliver(message: Message, target: DeliveryTarget): Promise<void> {
    // Simulate delivery
    this.logger.debug('Delivering message', {
      messageId: message.id,
      target: target.id,
      type: target.type
    });

    // Emit delivery success
    this.emit('delivery:success', { message, target });
  }
}

class RetryManager extends EventEmitter {
  private retryQueue: Array<{ message: Message; target: DeliveryTarget; attempts: number }> = [];
  private retryInterval?: NodeJS.Timeout;

  constructor(private config: MessageBusConfig, private logger: ILogger) {
    super();
  }

  async initialize(): Promise<void> {
    this.startRetryProcessor();
    this.logger.debug('Retry manager initialized');
  }

  async shutdown(): Promise<void> {
    if (this.retryInterval) {
      clearInterval(this.retryInterval);
    }
    this.logger.debug('Retry manager shutdown');
  }

  async scheduleRetry(message: Message, target: DeliveryTarget, error: any): Promise<void> {
    const existingEntry = this.retryQueue.find(entry =>
      entry.message.id === message.id && entry.target.id === target.id
    );

    if (existingEntry) {
      existingEntry.attempts++;
    } else {
      this.retryQueue.push({ message, target, attempts: 1 });
    }

    this.logger.debug('Retry scheduled', {
      messageId: message.id,
      target: target.id,
      error: error.message
    });
  }

  private startRetryProcessor(): void {
    this.retryInterval = setInterval(() => {
      this.processRetries();
    }, 5000); // Process retries every 5 seconds
  }

  private async processRetries(): Promise<void> {
    const now = Date.now();
    const toRetry = this.retryQueue.filter(entry => {
      const delay = this.calculateDelay(entry.attempts);
      return now >= entry.message.timestamp.getTime() + delay;
    });

    for (const entry of toRetry) {
      if (entry.attempts >= this.config.retryAttempts) {
        // Remove from retry queue and emit exhausted event
        this.retryQueue = this.retryQueue.filter(r => r !== entry);
        this.emit('retry:exhausted', entry);
      } else {
        // Retry delivery
        try {
          // Simulate retry delivery
          this.logger.debug('Retrying message delivery', {
            messageId: entry.message.id,
            attempt: entry.attempts
          });
          
          // Remove from retry queue on success
          this.retryQueue = this.retryQueue.filter(r => r !== entry);
          
        } catch (error) {
          // Keep in retry queue for next attempt
          this.logger.warn('Retry attempt failed', {
            messageId: entry.message.id,
            attempt: entry.attempts,
            error: error.message
          });
        }
      }
    }
  }

  private calculateDelay(attempts: number): number {
    const baseDelay = 1000; // 1 second
    return Math.min(
      baseDelay * Math.pow(this.config.backoffMultiplier, attempts - 1),
      30000 // Max 30 seconds
    );
  }
}

class MessageBusMetrics {
  private messagesSent = 0;
  private messagesDelivered = 0;
  private messagesFailed = 0;
  private bytesTransferred = 0;
  private deliveryLatencies: number[] = [];

  recordMessageSent(message: Message): void {
    this.messagesSent++;
    this.bytesTransferred += message.metadata.size;
  }

  recordDeliverySuccess(message: Message): void {
    this.messagesDelivered++;
    const latency = Date.now() - message.timestamp.getTime();
    this.deliveryLatencies.push(latency);
    
    // Keep only last 1000 latencies
    if (this.deliveryLatencies.length > 1000) {
      this.deliveryLatencies.shift();
    }
  }

  recordDeliveryFailure(message: Message): void {
    this.messagesFailed++;
  }

  getMetrics(): any {
    const avgLatency = this.deliveryLatencies.length > 0 ?
      this.deliveryLatencies.reduce((sum, lat) => sum + lat, 0) / this.deliveryLatencies.length : 0;

    return {
      messagesSent: this.messagesSent,
      messagesDelivered: this.messagesDelivered,
      messagesFailed: this.messagesFailed,
      bytesTransferred: this.bytesTransferred,
      averageLatency: avgLatency,
      successRate: this.messagesSent > 0 ? (this.messagesDelivered / this.messagesSent) * 100 : 100
    };
  }
}