/**
 * Communication Class
 * 
 * Manages inter-agent messaging, broadcasts, and communication protocols
 * within the Hive Mind swarm.
 */

import { EventEmitter } from 'events';
import { DatabaseManager } from './DatabaseManager.js';
import { Agent } from './Agent.js';
import {
  Message,
  MessageType,
  MessagePriority,
  CommunicationStats,
  CommunicationChannel
} from '../types.js';

export class Communication extends EventEmitter {
  private swarmId: string;
  private db: DatabaseManager;
  private agents: Map<string, Agent>;
  private channels: Map<string, CommunicationChannel>;
  private messageQueue: Map<MessagePriority, Message[]>;
  private stats: CommunicationStats;
  private isActive: boolean = false;

  constructor(swarmId: string) {
    super();
    this.swarmId = swarmId;
    this.agents = new Map();
    this.channels = new Map();
    this.messageQueue = new Map([
      ['urgent', []],
      ['high', []],
      ['normal', []],
      ['low', []]
    ]);
    
    this.stats = {
      totalMessages: 0,
      avgLatency: 0,
      activeChannels: 0,
      messagesByType: {
        direct: 0,
        broadcast: 0,
        consensus: 0,
        query: 0,
        response: 0,
        notification: 0,
        task_assignment: 0,
        progress_update: 0,
        coordination: 0,
        channel: 0
      },
      throughput: 0
    };
  }

  /**
   * Initialize communication system
   */
  async initialize(): Promise<void> {
    this.db = await DatabaseManager.getInstance();
    
    // Set up default channels
    this.setupDefaultChannels();
    
    // Start message processing
    this.startMessageProcessor();
    this.startLatencyMonitor();
    this.startStatsCollector();
    
    this.isActive = true;
    this.emit('initialized');
  }

  /**
   * Add an agent to the communication network
   */
  addAgent(agent: Agent): void {
    this.agents.set(agent.id, agent);
    
    // Create agent-specific channels
    this.createAgentChannels(agent);
    
    // Subscribe agent to relevant channels
    this.subscribeAgentToChannels(agent);
    
    this.emit('agentAdded', { agentId: agent.id });
  }

  /**
   * Remove an agent from the communication network
   */
  removeAgent(agentId: string): void {
    this.agents.delete(agentId);
    
    // Remove agent from channels
    this.channels.forEach(channel => {
      channel.subscribers = channel.subscribers.filter(id => id !== agentId);
    });
    
    this.emit('agentRemoved', { agentId });
  }

  /**
   * Send a message
   */
  async sendMessage(message: Message): Promise<void> {
    // Store in database
    await this.db.createCommunication({
      from_agent_id: message.fromAgentId,
      to_agent_id: message.toAgentId,
      swarm_id: this.swarmId,
      message_type: message.type,
      content: JSON.stringify(message.content),
      priority: message.priority || 'normal',
      requires_response: message.requiresResponse || false
    });
    
    // Add to queue
    const priority = message.priority || 'normal';
    this.messageQueue.get(priority)!.push(message);
    
    // Update stats
    this.stats.totalMessages++;
    this.stats.messagesByType[message.type] = (this.stats.messagesByType[message.type] || 0) + 1;
    
    this.emit('messageSent', message);
  }

  /**
   * Broadcast a message to all agents
   */
  async broadcast(
    fromAgentId: string,
    type: MessageType,
    content: any,
    priority: MessagePriority = 'normal'
  ): Promise<void> {
    const message: Message = {
      id: this.generateMessageId(),
      fromAgentId,
      toAgentId: null, // null indicates broadcast
      swarmId: this.swarmId,
      type,
      content,
      priority,
      timestamp: new Date(),
      requiresResponse: false
    };
    
    await this.sendMessage(message);
  }

  /**
   * Send a message to a specific channel
   */
  async sendToChannel(
    channelName: string,
    fromAgentId: string,
    content: any,
    priority: MessagePriority = 'normal'
  ): Promise<void> {
    const channel = this.channels.get(channelName);
    if (!channel) {
      throw new Error(`Channel ${channelName} not found`);
    }
    
    // Send to all subscribers
    for (const subscriberId of channel.subscribers) {
      if (subscriberId !== fromAgentId) {
        const message: Message = {
          id: this.generateMessageId(),
          fromAgentId,
          toAgentId: subscriberId,
          swarmId: this.swarmId,
          type: 'channel',
          content: {
            channel: channelName,
            data: content
          },
          priority,
          timestamp: new Date(),
          requiresResponse: false
        };
        
        await this.sendMessage(message);
      }
    }
  }

  /**
   * Request response from an agent
   */
  async requestResponse(
    fromAgentId: string,
    toAgentId: string,
    query: any,
    timeout: number = 5000
  ): Promise<any> {
    const message: Message = {
      id: this.generateMessageId(),
      fromAgentId,
      toAgentId,
      swarmId: this.swarmId,
      type: 'query',
      content: query,
      priority: 'high',
      timestamp: new Date(),
      requiresResponse: true
    };
    
    await this.sendMessage(message);
    
    // Wait for response
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Response timeout'));
      }, timeout);
      
      const responseHandler = (response: Message) => {
        if (response.content.queryId === message.id) {
          clearTimeout(timer);
          this.off('messageReceived', responseHandler);
          resolve(response.content.response);
        }
      };
      
      this.on('messageReceived', responseHandler);
    });
  }

  /**
   * Create a new communication channel
   */
  createChannel(name: string, description: string, type: 'public' | 'private' = 'public'): void {
    if (this.channels.has(name)) {
      throw new Error(`Channel ${name} already exists`);
    }
    
    const channel: CommunicationChannel = {
      name,
      description,
      type,
      subscribers: [],
      createdAt: new Date()
    };
    
    this.channels.set(name, channel);
    this.stats.activeChannels++;
    
    this.emit('channelCreated', { channel });
  }

  /**
   * Subscribe an agent to a channel
   */
  subscribeToChannel(agentId: string, channelName: string): void {
    const channel = this.channels.get(channelName);
    if (!channel) {
      throw new Error(`Channel ${channelName} not found`);
    }
    
    if (!channel.subscribers.includes(agentId)) {
      channel.subscribers.push(agentId);
      this.emit('channelSubscribed', { agentId, channelName });
    }
  }

  /**
   * Unsubscribe an agent from a channel
   */
  unsubscribeFromChannel(agentId: string, channelName: string): void {
    const channel = this.channels.get(channelName);
    if (!channel) {
      return;
    }
    
    channel.subscribers = channel.subscribers.filter(id => id !== agentId);
    this.emit('channelUnsubscribed', { agentId, channelName });
  }

  /**
   * Get communication statistics
   */
  async getStats(): Promise<CommunicationStats> {
    // Calculate throughput
    const recentMessages = await this.db.getRecentMessages(this.swarmId, 60000); // Last minute
    this.stats.throughput = recentMessages.length;
    
    return { ...this.stats };
  }

  /**
   * Get pending messages for an agent
   */
  async getPendingMessages(agentId: string): Promise<Message[]> {
    const messages = await this.db.getPendingMessages(agentId);
    
    return messages.map(msg => ({
      id: msg.id.toString(),
      fromAgentId: msg.from_agent_id,
      toAgentId: msg.to_agent_id,
      swarmId: msg.swarm_id,
      type: msg.message_type as MessageType,
      content: JSON.parse(msg.content),
      priority: msg.priority as MessagePriority,
      timestamp: new Date(msg.timestamp),
      requiresResponse: msg.requires_response
    }));
  }

  /**
   * Mark message as delivered
   */
  async markDelivered(messageId: string): Promise<void> {
    await this.db.markMessageDelivered(messageId);
  }

  /**
   * Mark message as read
   */
  async markRead(messageId: string): Promise<void> {
    await this.db.markMessageRead(messageId);
  }

  /**
   * Setup default communication channels
   */
  private setupDefaultChannels(): void {
    // System channels
    this.createChannel('system', 'System-wide notifications and alerts');
    this.createChannel('coordination', 'Task coordination messages');
    this.createChannel('consensus', 'Consensus voting and decisions');
    this.createChannel('monitoring', 'Performance and health monitoring');
    
    // Agent type channels
    this.createChannel('coordinators', 'Coordinator agent communications');
    this.createChannel('researchers', 'Researcher agent communications');
    this.createChannel('coders', 'Coder agent communications');
    this.createChannel('analysts', 'Analyst agent communications');
  }

  /**
   * Create channels for a specific agent
   */
  private createAgentChannels(agent: Agent): void {
    // Direct message channel
    this.createChannel(`agent-${agent.id}`, `Direct messages for ${agent.name}`, 'private');
    
    // Team channel if agent is coordinator
    if (agent.type === 'coordinator') {
      this.createChannel(`team-${agent.id}`, `Team channel led by ${agent.name}`);
    }
  }

  /**
   * Subscribe agent to relevant channels
   */
  private subscribeAgentToChannels(agent: Agent): void {
    // Subscribe to system channels
    this.subscribeToChannel(agent.id, 'system');
    this.subscribeToChannel(agent.id, 'coordination');
    
    // Subscribe to type-specific channel
    const typeChannel = `${agent.type}s`;
    if (this.channels.has(typeChannel)) {
      this.subscribeToChannel(agent.id, typeChannel);
    }
    
    // Subscribe to own direct channel
    this.subscribeToChannel(agent.id, `agent-${agent.id}`);
    
    // Special subscriptions based on capabilities
    if (agent.capabilities.includes('consensus_building')) {
      this.subscribeToChannel(agent.id, 'consensus');
    }
    
    if (agent.capabilities.includes('system_monitoring')) {
      this.subscribeToChannel(agent.id, 'monitoring');
    }
  }

  /**
   * Start message processor
   */
  private startMessageProcessor(): void {
    setInterval(async () => {
      if (!this.isActive) return;
      
      // Process messages by priority
      const messageQueueArray = Array.from(this.messageQueue.entries());
      for (const [priority, messages] of messageQueueArray) {
        if (messages.length === 0) continue;
        
        // Process batch of messages
        const batch = messages.splice(0, 10); // Process up to 10 messages
        
        for (const message of batch) {
          await this.processMessage(message);
        }
      }
    }, 100); // Every 100ms
  }

  /**
   * Process a single message
   */
  private async processMessage(message: Message): Promise<void> {
    const startTime = Date.now();
    
    try {
      if (message.toAgentId) {
        // Direct message
        const agent = this.agents.get(message.toAgentId);
        if (agent) {
          await agent.receiveMessage(message);
          await this.markDelivered(message.id);
        }
      } else {
        // Broadcast message
        const agentArray = Array.from(this.agents.values());
        for (const agent of agentArray) {
          if (agent.id !== message.fromAgentId) {
            await agent.receiveMessage(message);
          }
        }
      }
      
      // Update latency stats
      const latency = Date.now() - startTime;
      this.updateLatencyStats(latency);
      
      this.emit('messageProcessed', { message, latency });
      
    } catch (error) {
      this.emit('messageError', { message, error });
    }
  }

  /**
   * Update latency statistics
   */
  private updateLatencyStats(latency: number): void {
    // Simple moving average
    this.stats.avgLatency = (this.stats.avgLatency * 0.9) + (latency * 0.1);
  }

  /**
   * Start latency monitor
   */
  private startLatencyMonitor(): void {
    setInterval(async () => {
      if (!this.isActive) return;
      
      // Check for high latency
      if (this.stats.avgLatency > 1000) {
        this.emit('highLatency', { avgLatency: this.stats.avgLatency });
      }
    }, 5000); // Every 5 seconds
  }

  /**
   * Start statistics collector
   */
  private startStatsCollector(): void {
    setInterval(async () => {
      if (!this.isActive) return;
      
      // Store stats in database
      await this.db.storePerformanceMetric({
        swarm_id: this.swarmId,
        metric_type: 'communication_throughput',
        metric_value: this.stats.throughput
      });
      
      await this.db.storePerformanceMetric({
        swarm_id: this.swarmId,
        metric_type: 'communication_latency',
        metric_value: this.stats.avgLatency
      });
      
    }, 60000); // Every minute
  }

  /**
   * Generate unique message ID
   */
  private generateMessageId(): string {
    return `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Shutdown communication system
   */
  async shutdown(): Promise<void> {
    this.isActive = false;
    
    // Clear queues
    this.messageQueue.forEach(queue => queue.length = 0);
    
    // Clear channels
    this.channels.clear();
    
    this.emit('shutdown');
  }
}