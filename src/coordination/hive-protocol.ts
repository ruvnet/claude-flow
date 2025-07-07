/**
 * Hive Mind Communication Protocol
 * Defines how agents communicate, vote, and share knowledge
 */

import { EventEmitter } from 'events';
import { generateId } from '../utils/helpers.js';

export interface HiveMessage {
  id: string;
  from: string;
  to: string | 'broadcast';
  type: HiveMessageType;
  payload: any;
  timestamp: number;
  priority: 'urgent' | 'high' | 'normal' | 'low';
  requiresResponse?: boolean;
  inReplyTo?: string;
}

export type HiveMessageType = 
  | 'task_proposal'
  | 'vote_request'
  | 'vote_response'
  | 'status_update'
  | 'knowledge_share'
  | 'help_request'
  | 'consensus_check'
  | 'quality_report'
  | 'coordination_sync';

export interface HiveChannel {
  id: string;
  name: string;
  type: 'broadcast' | 'consensus' | 'coordination' | 'knowledge';
  members: Set<string>;
  messages: HiveMessage[];
}

export class HiveCommunicationProtocol extends EventEmitter {
  private channels: Map<string, HiveChannel> = new Map();
  private messageQueue: Map<string, HiveMessage[]> = new Map();
  private knowledgeBase: Map<string, any> = new Map();
  private consensusThreshold: number;
  
  constructor(options: { consensusThreshold?: number } = {}) {
    super();
    this.consensusThreshold = options.consensusThreshold || 0.6;
    this.initializeChannels();
  }

  /**
   * Initialize default communication channels
   */
  private initializeChannels() {
    // Broadcast channel for all agents
    this.createChannel('broadcast', 'broadcast', 'General announcements and updates');
    
    // Consensus channel for voting
    this.createChannel('consensus', 'consensus', 'Voting and decision making');
    
    // Coordination channel for task management
    this.createChannel('coordination', 'coordination', 'Task assignment and progress');
    
    // Knowledge channel for sharing insights
    this.createChannel('knowledge', 'knowledge', 'Knowledge sharing and learning');
  }

  /**
   * Create a new communication channel
   */
  createChannel(
    name: string, 
    type: HiveChannel['type'], 
    description: string
  ): HiveChannel {
    const channel: HiveChannel = {
      id: generateId('channel'),
      name,
      type,
      members: new Set(),
      messages: []
    };
    
    this.channels.set(channel.id, channel);
    this.emit('channel:created', { channel, description });
    
    return channel;
  }

  /**
   * Join an agent to a channel
   */
  joinChannel(channelId: string, agentId: string) {
    const channel = this.channels.get(channelId);
    if (!channel) throw new Error(`Channel ${channelId} not found`);
    
    channel.members.add(agentId);
    this.emit('channel:joined', { channelId, agentId });
  }

  /**
   * Send a message through the protocol
   */
  sendMessage(message: Omit<HiveMessage, 'id' | 'timestamp'>): HiveMessage {
    const fullMessage: HiveMessage = {
      ...message,
      id: generateId('msg'),
      timestamp: Date.now()
    };
    
    // Route message based on type
    this.routeMessage(fullMessage);
    
    // Store in appropriate channel
    const channelType = this.getChannelTypeForMessage(fullMessage.type);
    const channel = Array.from(this.channels.values()).find(c => c.type === channelType);
    if (channel) {
      channel.messages.push(fullMessage);
    }
    
    // Queue for recipient(s)
    if (fullMessage.to === 'broadcast') {
      // Queue for all agents
      for (const channel of this.channels.values()) {
        for (const member of channel.members) {
          this.queueMessage(member, fullMessage);
        }
      }
    } else {
      // Queue for specific recipient
      this.queueMessage(fullMessage.to, fullMessage);
    }
    
    this.emit('message:sent', fullMessage);
    
    return fullMessage;
  }

  /**
   * Route message based on type
   */
  private routeMessage(message: HiveMessage) {
    switch (message.type) {
      case 'vote_request':
        this.handleVoteRequest(message);
        break;
      case 'knowledge_share':
        this.handleKnowledgeShare(message);
        break;
      case 'consensus_check':
        this.handleConsensusCheck(message);
        break;
      case 'quality_report':
        this.handleQualityReport(message);
        break;
    }
  }

  /**
   * Get channel type for message type
   */
  private getChannelTypeForMessage(messageType: HiveMessageType): HiveChannel['type'] {
    switch (messageType) {
      case 'vote_request':
      case 'vote_response':
      case 'consensus_check':
        return 'consensus';
      case 'task_proposal':
      case 'status_update':
      case 'coordination_sync':
        return 'coordination';
      case 'knowledge_share':
        return 'knowledge';
      default:
        return 'broadcast';
    }
  }

  /**
   * Queue message for agent
   */
  private queueMessage(agentId: string, message: HiveMessage) {
    if (!this.messageQueue.has(agentId)) {
      this.messageQueue.set(agentId, []);
    }
    this.messageQueue.get(agentId)!.push(message);
  }

  /**
   * Retrieve messages for agent
   */
  getMessages(agentId: string): HiveMessage[] {
    const messages = this.messageQueue.get(agentId) || [];
    this.messageQueue.set(agentId, []); // Clear after retrieval
    return messages;
  }

  /**
   * Handle vote request
   */
  private handleVoteRequest(message: HiveMessage) {
    const { proposal, deadline } = message.payload;
    
    this.emit('vote:requested', {
      messageId: message.id,
      proposal,
      deadline,
      from: message.from
    });
    
    // Set timeout for vote collection
    if (deadline) {
      setTimeout(() => {
        this.collectVotes(message.id);
      }, deadline - Date.now());
    }
  }

  /**
   * Submit a vote response
   */
  submitVote(
    requestId: string, 
    agentId: string, 
    vote: boolean, 
    confidence: number = 1.0
  ) {
    const voteMessage = this.sendMessage({
      from: agentId,
      to: 'consensus',
      type: 'vote_response',
      payload: {
        requestId,
        vote,
        confidence,
        reasoning: this.generateVoteReasoning(vote, confidence)
      },
      priority: 'high'
    });
    
    this.emit('vote:submitted', {
      requestId,
      agentId,
      vote,
      confidence
    });
    
    return voteMessage;
  }

  /**
   * Generate reasoning for vote
   */
  private generateVoteReasoning(vote: boolean, confidence: number): string {
    if (vote && confidence > 0.8) {
      return 'Strong alignment with objectives and capabilities';
    } else if (vote && confidence > 0.5) {
      return 'Moderate alignment, some concerns but manageable';
    } else if (!vote && confidence > 0.8) {
      return 'Significant concerns or misalignment detected';
    } else {
      return 'Insufficient information or capability mismatch';
    }
  }

  /**
   * Collect and evaluate votes
   */
  private collectVotes(requestId: string) {
    const votes = new Map<string, { vote: boolean; confidence: number }>();
    
    // Collect all vote responses for this request
    for (const channel of this.channels.values()) {
      for (const message of channel.messages) {
        if (message.type === 'vote_response' && 
            message.payload.requestId === requestId) {
          votes.set(message.from, {
            vote: message.payload.vote,
            confidence: message.payload.confidence
          });
        }
      }
    }
    
    // Calculate consensus
    const consensus = this.calculateConsensus(votes);
    
    this.emit('consensus:reached', {
      requestId,
      consensus,
      votes: Array.from(votes.entries())
    });
  }

  /**
   * Calculate consensus from votes
   */
  private calculateConsensus(
    votes: Map<string, { vote: boolean; confidence: number }>
  ): { approved: boolean; confidence: number } {
    if (votes.size === 0) {
      return { approved: false, confidence: 0 };
    }
    
    let totalWeight = 0;
    let approvalWeight = 0;
    
    for (const [_, { vote, confidence }] of votes) {
      totalWeight += confidence;
      if (vote) {
        approvalWeight += confidence;
      }
    }
    
    const approvalRate = approvalWeight / totalWeight;
    const approved = approvalRate >= this.consensusThreshold;
    
    return { approved, confidence: approvalRate };
  }

  /**
   * Handle knowledge sharing
   */
  private handleKnowledgeShare(message: HiveMessage) {
    const { key, value, metadata } = message.payload;
    
    // Store in knowledge base
    this.knowledgeBase.set(key, {
      value,
      metadata,
      contributor: message.from,
      timestamp: message.timestamp
    });
    
    this.emit('knowledge:shared', {
      key,
      contributor: message.from,
      timestamp: message.timestamp
    });
  }

  /**
   * Query knowledge base
   */
  queryKnowledge(pattern: string): any[] {
    const results = [];
    
    for (const [key, data] of this.knowledgeBase) {
      if (key.includes(pattern)) {
        results.push({ key, ...data });
      }
    }
    
    return results;
  }

  /**
   * Handle consensus check
   */
  private handleConsensusCheck(message: HiveMessage) {
    const { topic, options } = message.payload;
    
    // Initiate voting round
    const voteRequest = this.sendMessage({
      from: 'consensus-system',
      to: 'broadcast',
      type: 'vote_request',
      payload: {
        topic,
        options,
        deadline: Date.now() + 30000 // 30 second deadline
      },
      priority: 'urgent',
      requiresResponse: true
    });
    
    this.emit('consensus:initiated', {
      topic,
      options,
      requestId: voteRequest.id
    });
  }

  /**
   * Handle quality report
   */
  private handleQualityReport(message: HiveMessage) {
    const { taskId, metrics, issues } = message.payload;
    
    // Store quality metrics
    this.knowledgeBase.set(`quality/${taskId}`, {
      metrics,
      issues,
      reporter: message.from,
      timestamp: message.timestamp
    });
    
    // Check if quality threshold breached
    if (metrics.score < 0.7) {
      this.emit('quality:alert', {
        taskId,
        score: metrics.score,
        issues,
        reporter: message.from
      });
    }
  }

  /**
   * Get communication statistics
   */
  getStatistics() {
    const stats = {
      totalMessages: 0,
      messagesByType: new Map<HiveMessageType, number>(),
      messagesByPriority: new Map<string, number>(),
      activeChannels: this.channels.size,
      knowledgeEntries: this.knowledgeBase.size,
      avgResponseTime: 0
    };
    
    // Aggregate message statistics
    for (const channel of this.channels.values()) {
      stats.totalMessages += channel.messages.length;
      
      for (const message of channel.messages) {
        const typeCount = stats.messagesByType.get(message.type) || 0;
        stats.messagesByType.set(message.type, typeCount + 1);
        
        const priorityCount = stats.messagesByPriority.get(message.priority) || 0;
        stats.messagesByPriority.set(message.priority, priorityCount + 1);
      }
    }
    
    return stats;
  }

  /**
   * Export communication log
   */
  exportLog(): any {
    const log = {
      channels: Array.from(this.channels.values()).map(channel => ({
        id: channel.id,
        name: channel.name,
        type: channel.type,
        memberCount: channel.members.size,
        messageCount: channel.messages.length
      })),
      messages: [] as HiveMessage[],
      knowledge: Array.from(this.knowledgeBase.entries()).map(([key, value]) => ({
        key,
        ...value
      }))
    };
    
    // Collect all messages
    for (const channel of this.channels.values()) {
      log.messages.push(...channel.messages);
    }
    
    // Sort by timestamp
    log.messages.sort((a, b) => a.timestamp - b.timestamp);
    
    return log;
  }
}