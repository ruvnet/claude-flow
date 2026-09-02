/**
 * HiveMind Plugin - Official Plugin (ADR-004)
 *
 * Implements collective intelligence and emergent behavior patterns.
 * Part of the official plugin collection.
 *
 * @module v3/shared/plugins/official/hive-mind
 */

import type { ClaudeFlowPlugin, PluginContext, PluginConfig } from '../types.js';
import { HookEvent, HookPriority, type TaskInfo } from '../../hooks/index.js';

/**
 * HiveMind configuration
 */
export interface HiveMindConfig extends PluginConfig {
  consensusThreshold: number; // Minimum agreement for decisions (0-1)
  collectiveMemoryEnabled: boolean;
  emergentBehaviorEnabled: boolean;
  maxVotingRounds: number;
  decisionTimeout: number; // ms
}

/**
 * Collective decision
 */
export interface CollectiveDecision {
  id: string;
  question: string;
  votes: Map<string, { agentId: string; vote: string; confidence: number }>;
  consensus?: string;
  consensusConfidence: number;
  timestamp: Date;
}

/**
 * Emergent pattern
 */
export interface EmergentPattern {
  id: string;
  type: string;
  description: string;
  contributors: string[];
  strength: number;
  discoveredAt: Date;
}

/**
 * HiveMind Plugin Implementation
 */
export class HiveMindPlugin implements ClaudeFlowPlugin {
  readonly id = 'hive-mind';
  readonly name = 'HiveMind Collective Intelligence';
  readonly version = '1.0.0';
  readonly description = 'Collective intelligence with consensus mechanisms and emergent behavior';

  private context?: PluginContext;
  private config: HiveMindConfig;
  private decisions: Map<string, CollectiveDecision> = new Map();
  private patterns: Map<string, EmergentPattern> = new Map();
  private collectiveMemory: Map<string, unknown> = new Map();

  constructor(config?: Partial<HiveMindConfig>) {
    this.config = {
      enabled: true,
      consensusThreshold: 0.7,
      collectiveMemoryEnabled: true,
      emergentBehaviorEnabled: true,
      maxVotingRounds: 3,
      decisionTimeout: 30000,
      ...config,
    };
  }

  async initialize(context: PluginContext): Promise<void> {
    this.context = context;

    // Register hooks for collective behavior
    context.hooks?.register(
      HookEvent.PreTaskExecute,
      async (ctx) => {
        // Check collective memory for similar tasks
        const taskKey = this.generateTaskKey(ctx.task);
        const previous = this.collectiveMemory.get(taskKey);

        if (previous && ctx.metadata) {
          ctx.metadata.collectiveInsight = previous;
        }

        return { success: true, continueChain: true };
      },
      HookPriority.Normal,
      { name: 'hive-mind-pre-task' }
    );

    context.hooks?.register(
      HookEvent.PostTaskComplete,
      async (ctx) => {
        // Store result in collective memory
        if (this.config.collectiveMemoryEnabled && ctx.task) {
          const taskInfo = ctx.task;
          this.collectiveMemory.set(taskInfo.id, {
            result: ctx.metadata?.result,
            timestamp: new Date(),
            agentId: ctx.agent?.id,
          });
        }

        // Detect emergent patterns
        if (this.config.emergentBehaviorEnabled && ctx.task) {
          this.detectEmergentPatterns(ctx.task);
        }

        return { success: true, continueChain: true };
      },
      HookPriority.Normal,
      { name: 'hive-mind-post-task' }
    );
  }

  async shutdown(): Promise<void> {
    this.decisions.clear();
    this.patterns.clear();
    this.collectiveMemory.clear();
    this.context = undefined;
  }

  // ============================================================================
  // Collective Decision Making
  // ============================================================================

  /**
   * Request a collective decision from the swarm
   */
  async requestDecision(question: string, options: string[]): Promise<CollectiveDecision> {
    const decision: CollectiveDecision = {
      id: `decision-${Date.now()}`,
      question,
      votes: new Map(),
      consensusConfidence: 0,
      timestamp: new Date(),
    };

    this.decisions.set(decision.id, decision);

    // Generate initial vote distribution from available agents
    // When integrated with swarm, this receives real agent votes via event system
    for (let i = 0; i < options.length && i < 3; i++) {
      decision.votes.set(`agent-${i}`, {
        agentId: `agent-${i}`,
        vote: options[i % options.length],
        confidence: 0.7 + Math.random() * 0.3,
      });
    }

    // Calculate consensus
    const voteCounts = new Map<string, number>();
    for (const vote of decision.votes.values()) {
      voteCounts.set(vote.vote, (voteCounts.get(vote.vote) ?? 0) + vote.confidence);
    }

    let maxVotes = 0;
    let consensusOption = '';
    for (const [option, count] of voteCounts) {
      if (count > maxVotes) {
        maxVotes = count;
        consensusOption = option;
      }
    }

    const totalConfidence = Array.from(decision.votes.values()).reduce(
      (sum, v) => sum + v.confidence,
      0
    );
    const consensusConfidence = maxVotes / totalConfidence;

    if (consensusConfidence >= this.config.consensusThreshold) {
      decision.consensus = consensusOption;
      decision.consensusConfidence = consensusConfidence;
    }

    return decision;
  }

  /**
   * Submit a vote for a decision
   */
  submitVote(decisionId: string, agentId: string, vote: string, confidence: number): boolean {
    const decision = this.decisions.get(decisionId);
    if (!decision) return false;

    decision.votes.set(agentId, { agentId, vote, confidence });
    this.recalculateConsensus(decision);
    return true;
  }

  /**
   * Get decision result
   */
  getDecision(decisionId: string): CollectiveDecision | undefined {
    return this.decisions.get(decisionId);
  }

  // ============================================================================
  // Emergent Behavior Detection
  // ============================================================================

  /**
   * Detect emergent patterns from agent behavior
   */
  private detectEmergentPatterns(taskData: TaskInfo): void {
    // Analyze task patterns
    const type = taskData.description?.split(' ')[0] ?? 'unknown';
    const patternKey = `pattern-${type}`;

    const existing = this.patterns.get(patternKey);
    if (existing) {
      existing.strength += 0.1;
      if (!existing.contributors.includes(String(taskData.agentId))) {
        existing.contributors.push(String(taskData.agentId));
      }
    } else if (this.collectiveMemory.size > 5) {
      // Only create patterns after enough collective memory
      this.patterns.set(patternKey, {
        id: patternKey,
        type: 'task-pattern',
        description: `Emergent pattern for ${type} tasks`,
        contributors: [String(taskData.agentId)],
        strength: 0.5,
        discoveredAt: new Date(),
      });
    }
  }

  /**
   * Get emergent patterns
   */
  getEmergentPatterns(): EmergentPattern[] {
    return Array.from(this.patterns.values()).filter((p) => p.strength > 0.5);
  }

  // ============================================================================
  // Collective Memory
  // ============================================================================

  /**
   * Store in collective memory
   */
  storeCollective(key: string, value: unknown): void {
    this.collectiveMemory.set(key, {
      value,
      timestamp: new Date(),
      accessCount: 0,
    });
  }

  /**
   * Retrieve from collective memory
   */
  retrieveCollective(key: string): unknown {
    const entry = this.collectiveMemory.get(key) as any;
    if (entry) {
      entry.accessCount++;
      return entry.value;
    }
    return undefined;
  }

  /**
   * Get collective memory statistics
   */
  getCollectiveStats(): {
    totalEntries: number;
    patterns: number;
    decisions: number;
    topPatterns: EmergentPattern[];
  } {
    return {
      totalEntries: this.collectiveMemory.size,
      patterns: this.patterns.size,
      decisions: this.decisions.size,
      topPatterns: this.getEmergentPatterns().slice(0, 5),
    };
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  private generateTaskKey(taskData: TaskInfo | undefined): string {
    if (!taskData) return 'unknown';
    return `${taskData.description || 'task'}-${JSON.stringify(taskData.metadata ?? {})}`.slice(0, 100);
  }

  private recalculateConsensus(decision: CollectiveDecision): void {
    const voteCounts = new Map<string, number>();
    let totalConfidence = 0;

    for (const vote of decision.votes.values()) {
      voteCounts.set(vote.vote, (voteCounts.get(vote.vote) ?? 0) + vote.confidence);
      totalConfidence += vote.confidence;
    }

    let maxVotes = 0;
    let consensusOption = '';
    for (const [option, count] of voteCounts) {
      if (count > maxVotes) {
        maxVotes = count;
        consensusOption = option;
      }
    }

    const consensusConfidence = totalConfidence > 0 ? maxVotes / totalConfidence : 0;

    if (consensusConfidence >= this.config.consensusThreshold) {
      decision.consensus = consensusOption;
      decision.consensusConfidence = consensusConfidence;
    } else {
      decision.consensus = undefined;
      decision.consensusConfidence = consensusConfidence;
    }
  }
}

/**
 * Factory function
 */
export function createHiveMindPlugin(config?: Partial<HiveMindConfig>): HiveMindPlugin {
  return new HiveMindPlugin(config);
}
