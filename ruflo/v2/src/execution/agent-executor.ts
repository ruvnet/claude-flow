/**
 * Agent Executor - Wrapper around agentic-flow execution engine
 * Integrates agentic-flow agents with claude-flow hooks and coordination
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs-extra';

const execAsync = promisify(exec);

export interface AgentExecutionOptions {
  agent: string;
  task: string;
  provider?: 'anthropic' | 'openrouter' | 'onnx' | 'gemini';
  model?: string;
  temperature?: number;
  maxTokens?: number;
  outputFormat?: 'text' | 'json' | 'markdown';
  stream?: boolean;
  verbose?: boolean;
  retryOnError?: boolean;
  timeout?: number;

  // ReasoningBank memory options
  enableMemory?: boolean;           // Enable ReasoningBank learning
  memoryDatabase?: string;          // Path to .swarm/memory.db
  memoryRetrievalK?: number;        // Top-k memories to retrieve (default: 3)
  memoryLearning?: boolean;         // Enable post-task learning (default: true)
  memoryDomain?: string;            // Domain filter for memories
  memoryMinConfidence?: number;     // Minimum confidence threshold (default: 0.5)
  memoryTaskId?: string;            // Unique task ID for tracking
}

export interface AgentExecutionResult {
  success: boolean;
  output: string;
  error?: string;
  provider: string;
  model: string;
  tokens?: number;
  cost?: number;
  duration: number;
  agent: string;
  task: string;

  // ReasoningBank metrics
  memoryEnabled?: boolean;
  memoriesRetrieved?: number;
  memoriesUsed?: string[];          // IDs of memories applied
  memoryLearned?: boolean;          // Whether new memories were created
  memoryVerdict?: 'success' | 'failure';
  memoryConfidence?: number;
  newMemoryIds?: string[];          // IDs of newly created memories
}

export class AgentExecutor {
  private readonly agenticFlowPath: string;
  private readonly hooksManager: any;
  private memoryEnabled: boolean = false;
  private memoryDatabase: string = '.swarm/memory.db';

  constructor(hooksManager?: any) {
    this.hooksManager = hooksManager;
    // Agentic-flow is installed as npm dependency
    this.agenticFlowPath = 'npx agentic-flow';
  }

  /**
   * Initialize ReasoningBank database
   */
  async initializeMemory(dbPath?: string): Promise<void> {
    const db = dbPath || this.memoryDatabase;

    try {
      const { stdout } = await execAsync(
        `${this.agenticFlowPath} reasoningbank init`
      );

      this.memoryEnabled = true;
      this.memoryDatabase = db;
      console.log('✅ ReasoningBank initialized:', db);
    } catch (error: any) {
      console.error('Failed to initialize ReasoningBank:', error.message);
      throw error;
    }
  }

  /**
   * Get memory statistics
   */
  async getMemoryStats(): Promise<any> {
    if (!this.memoryEnabled) {
      return { enabled: false, totalMemories: 0 };
    }

    try {
      const { stdout } = await execAsync(
        `${this.agenticFlowPath} reasoningbank status`
      );
      return { enabled: true, output: stdout };
    } catch (error: any) {
      return { enabled: true, error: error.message };
    }
  }

  /**
   * Run memory consolidation (dedup + prune)
   */
  async consolidateMemories(): Promise<void> {
    if (!this.memoryEnabled) return;

    try {
      await execAsync(
        `${this.agenticFlowPath} reasoningbank consolidate`
      );
      console.log('✅ Memory consolidation complete');
    } catch (error: any) {
      console.warn('Consolidation failed:', error.message);
    }
  }

  /**
   * Execute an agent with agentic-flow
   */
  async execute(options: AgentExecutionOptions): Promise<AgentExecutionResult> {
    const startTime = Date.now();
    const taskId = options.memoryTaskId || `task-${Date.now()}`;

    try {
      // Initialize memory if requested
      if (options.enableMemory && !this.memoryEnabled) {
        try {
          await this.initializeMemory(options.memoryDatabase);
        } catch (error) {
          console.warn('Memory initialization failed, continuing without memory');
        }
      }

      // Trigger pre-execution hook
      if (this.hooksManager) {
        await this.hooksManager.trigger('pre-agent-execute', {
          agent: options.agent,
          task: options.task,
          provider: options.provider || 'anthropic',
          timestamp: Date.now(),
          memoryEnabled: this.memoryEnabled || options.enableMemory,
        });
      }

      // Build agentic-flow command
      const command = this.buildCommand(options);

      // Execute command
      const { stdout, stderr } = await execAsync(command, {
        timeout: options.timeout || 300000, // 5 minutes default
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer,
      });

      const duration = Date.now() - startTime;

      // Parse output
      const result: AgentExecutionResult = {
        success: true,
        output: stdout,
        provider: options.provider || 'anthropic',
        model: options.model || 'default',
        duration,
        agent: options.agent,
        task: options.task,
        memoryEnabled: this.memoryEnabled || options.enableMemory || false,
      };

      // Trigger post-execution hook
      if (this.hooksManager) {
        await this.hooksManager.trigger('post-agent-execute', {
          agent: options.agent,
          task: options.task,
          result,
          success: true,
        });
      }

      return result;
    } catch (error: any) {
      const duration = Date.now() - startTime;

      const result: AgentExecutionResult = {
        success: false,
        output: '',
        error: error.message,
        provider: options.provider || 'anthropic',
        model: options.model || 'default',
        duration,
        agent: options.agent,
        task: options.task,
        memoryEnabled: this.memoryEnabled || options.enableMemory || false,
      };

      // Trigger error hook
      if (this.hooksManager) {
        await this.hooksManager.trigger('agent-execute-error', {
          agent: options.agent,
          task: options.task,
          error: error.message,
        });
      }

      return result;
    }
  }

  /**
   * List available agents from agentic-flow
   */
  async listAgents(source?: 'all' | 'package' | 'local'): Promise<string[]> {
    try {
      // Agentic-flow uses 'agent list' command
      const command = source
        ? `${this.agenticFlowPath} agent list --filter ${source}`
        : `${this.agenticFlowPath} agent list`;

      const { stdout } = await execAsync(command);

      // Parse agent list from output
      const agents = stdout
        .split('\n')
        .filter(line => line.trim())
        .map(line => line.trim());

      return agents;
    } catch (error: any) {
      console.error('Failed to list agents:', error.message);
      return [];
    }
  }

  /**
   * Get agent information
   */
  async getAgentInfo(agentName: string): Promise<any> {
    try {
      // Agentic-flow uses 'agent info' command
      const command = `${this.agenticFlowPath} agent info ${agentName}`;
      const { stdout } = await execAsync(command);

      // Try to parse as JSON if it looks like JSON
      if (stdout.trim().startsWith('{')) {
        return JSON.parse(stdout);
      }

      // Otherwise return as plain text
      return { name: agentName, description: stdout };
    } catch (error: any) {
      console.error('Failed to get agent info:', error.message);
      return null;
    }
  }

  /**
   * Build agentic-flow command from options
   */
  private buildCommand(options: AgentExecutionOptions): string {
    const parts = [this.agenticFlowPath];

    // Agentic-flow uses --agent flag directly (no 'execute' subcommand)
    parts.push('--agent', options.agent);
    parts.push('--task', `"${options.task.replace(/"/g, '\\"')}"`);

    if (options.provider) {
      parts.push('--provider', options.provider);
    }

    if (options.model) {
      parts.push('--model', options.model);
    }

    if (options.temperature !== undefined) {
      parts.push('--temperature', options.temperature.toString());
    }

    if (options.maxTokens) {
      parts.push('--max-tokens', options.maxTokens.toString());
    }

    if (options.outputFormat) {
      parts.push('--output-format', options.outputFormat);
    }

    if (options.stream) {
      parts.push('--stream');
    }

    if (options.verbose) {
      parts.push('--verbose');
    }

    // Note: agentic-flow doesn't have a --retry flag
    // Retry logic should be handled by AgentExecutor if needed

    return parts.join(' ');
  }
}

export default AgentExecutor;
