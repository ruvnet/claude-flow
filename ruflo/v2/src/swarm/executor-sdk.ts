/**
 * Task Executor SDK Implementation
 * Claude-Flow v2.5-alpha.130
 *
 * Replaces custom retry logic with SDK-based execution
 */

import { spawn, ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import chalk from 'chalk';
import { Logger } from '../core/logger.js';
import { generateId } from '../utils/helpers.js';
import { ClaudeFlowSDKAdapter } from '../sdk/sdk-config.js';
import { ClaudeClientV25 } from '../api/claude-client-v2.5.js';
import {
  TaskDefinition,
  AgentState,
  TaskResult,
  SwarmEvent,
  EventType,
  SWARM_CONSTANTS,
} from './types.js';

export interface ExecutionConfig {
  apiKey?: string;
  maxRetries?: number;
  timeout?: number;
  swarmMode?: boolean;
  checkpointInterval?: number;
}

export interface ExecutionResult {
  success: boolean;
  output: any;
  errors: string[];
  executionTime: number;
  tokensUsed: number;
  retryCount?: number;
  checkpointId?: string;
}

/**
 * Task Executor using SDK for retry and error handling
 */
export class TaskExecutorSDK extends EventEmitter {
  private logger: Logger;
  private claudeClient: ClaudeClientV25;
  private sdkAdapter: ClaudeFlowSDKAdapter;
  private config: ExecutionConfig;
  private executionStats: Map<string, any> = new Map();

  constructor(config: ExecutionConfig = {}) {
    super();
    this.config = {
      apiKey: config.apiKey || process.env.ANTHROPIC_API_KEY,
      maxRetries: config.maxRetries || 3,
      timeout: config.timeout || 60000,
      swarmMode: config.swarmMode !== false,
      checkpointInterval: config.checkpointInterval || 30000
    };

    this.logger = new Logger('TaskExecutorSDK');

    // Initialize SDK adapter
    this.sdkAdapter = new ClaudeFlowSDKAdapter({
      apiKey: this.config.apiKey,
      maxRetries: this.config.maxRetries,
      timeout: this.config.timeout,
      swarmMode: this.config.swarmMode,
      checkpointInterval: this.config.checkpointInterval
    });

    // Initialize Claude client with SDK
    this.claudeClient = new ClaudeClientV25({
      apiKey: this.config.apiKey!,
      retryAttempts: this.config.maxRetries,
      timeout: this.config.timeout,
      enableSwarmMode: this.config.swarmMode
    }, this.logger);

    this.logger.info('Task Executor SDK initialized', {
      swarmMode: this.config.swarmMode,
      maxRetries: this.config.maxRetries
    });
  }

  /**
   * Execute task with SDK-based retry handling
   */
  async executeTask(
    task: TaskDefinition,
    agent: AgentState
  ): Promise<ExecutionResult> {
    const executionId = generateId('exec');
    const startTime = Date.now();

    this.logger.info(`Executing task ${task.id} with agent ${agent.id}`, {
      taskType: task.type,
      agentType: agent.type
    });

    try {
      // Emit start event
      this.emit('task:start', {
        executionId,
        taskId: task.id,
        agentId: agent.id
      });

      // Build the prompt for Claude
      const prompt = this.buildPrompt(task, agent);

      // Make request using SDK (retry is automatic)
      const response = await this.claudeClient.makeRequest({
        model: 'claude-3-sonnet-20240229',
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        system: this.getSystemPrompt(agent),
        max_tokens: 4000,
        temperature: 0.7
      });

      // Extract and process the response
      const output = this.processResponse(response);

      // Calculate execution metrics
      const executionTime = Date.now() - startTime;
      const tokensUsed = response.usage.input_tokens + response.usage.output_tokens;

      // Store execution stats
      this.executionStats.set(executionId, {
        taskId: task.id,
        agentId: agent.id,
        executionTime,
        tokensUsed,
        timestamp: Date.now()
      });

      // Emit success event
      this.emit('task:complete', {
        executionId,
        taskId: task.id,
        agentId: agent.id,
        result: output
      });

      return {
        success: true,
        output,
        errors: [],
        executionTime,
        tokensUsed,
        retryCount: 0 // SDK handles retry internally
      };

    } catch (error) {
      const executionTime = Date.now() - startTime;

      this.logger.error(`Task execution failed for ${task.id}`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        taskId: task.id,
        agentId: agent.id
      });

      // Emit failure event
      this.emit('task:error', {
        executionId,
        taskId: task.id,
        agentId: agent.id,
        error
      });

      return {
        success: false,
        output: null,
        errors: [error instanceof Error ? error.message : 'Unknown error'],
        executionTime,
        tokensUsed: 0
      };
    }
  }

  /**
   * Execute task with streaming response
   */
  async executeStreamingTask(
    task: TaskDefinition,
    agent: AgentState,
    onChunk?: (chunk: string) => void
  ): Promise<ExecutionResult> {
    const executionId = generateId('stream-exec');
    const startTime = Date.now();

    this.logger.info(`Executing streaming task ${task.id}`, {
      taskType: task.type,
      agentId: agent.id
    });

    try {
      const prompt = this.buildPrompt(task, agent);
      let fullOutput = '';

      // Make streaming request
      const response = await this.claudeClient.makeStreamingRequest(
        {
          model: 'claude-3-sonnet-20240229',
          messages: [{ role: 'user', content: prompt }],
          system: this.getSystemPrompt(agent),
          max_tokens: 4000,
          temperature: 0.7,
          stream: true
        },
        (chunk) => {
          if (chunk.type === 'content_block_delta' && chunk.delta?.text) {
            fullOutput += chunk.delta.text;
            onChunk?.(chunk.delta.text);
          }
        }
      );

      const executionTime = Date.now() - startTime;
      const tokensUsed = response.usage.input_tokens + response.usage.output_tokens;

      return {
        success: true,
        output: fullOutput,
        errors: [],
        executionTime,
        tokensUsed
      };

    } catch (error) {
      const executionTime = Date.now() - startTime;
      return {
        success: false,
        output: null,
        errors: [error instanceof Error ? error.message : 'Unknown error'],
        executionTime,
        tokensUsed: 0
      };
    }
  }

  /**
   * Execute Claude CLI task (backward compatibility)
   */
  async executeClaudeTask(
    task: TaskDefinition,
    agent: AgentState,
    options?: { interactive?: boolean }
  ): Promise<ExecutionResult> {
    // For Claude CLI tasks, we still need to spawn a process
    // But we can use the SDK for the API calls
    if (options?.interactive) {
      return this.executeInteractiveCLI(task, agent);
    }

    // For non-interactive, use SDK-based execution
    return this.executeTask(task, agent);
  }

  /**
   * Execute interactive CLI (legacy support)
   */
  private async executeInteractiveCLI(
    task: TaskDefinition,
    agent: AgentState
  ): Promise<ExecutionResult> {
    const startTime = Date.now();

    return new Promise((resolve) => {
      const args = ['--no-visual', task.description];
      const claudeProcess = spawn('claude', args, {
        stdio: 'pipe',
        env: { ...process.env }
      });

      let output = '';
      let errorOutput = '';

      claudeProcess.stdout?.on('data', (data) => {
        output += data.toString();
      });

      claudeProcess.stderr?.on('data', (data) => {
        errorOutput += data.toString();
      });

      claudeProcess.on('close', (code) => {
        const executionTime = Date.now() - startTime;
        resolve({
          success: code === 0,
          output: output || errorOutput,
          errors: code !== 0 ? [errorOutput] : [],
          executionTime,
          tokensUsed: 0
        });
      });

      claudeProcess.on('error', (error) => {
        const executionTime = Date.now() - startTime;
        resolve({
          success: false,
          output: null,
          errors: [error.message],
          executionTime,
          tokensUsed: 0
        });
      });
    });
  }

  /**
   * Build prompt for task execution
   */
  private buildPrompt(task: TaskDefinition, agent: AgentState): string {
    const agentContext = `
You are an AI agent with the following capabilities:
- Type: ${agent.type}
- Capabilities: ${agent.capabilities.join(', ')}
- Status: ${agent.status}
`;

    const taskContext = `
Task: ${task.description}
Type: ${task.type}
Priority: ${task.priority || 'medium'}
${task.dependencies?.length ? `Dependencies: ${task.dependencies.join(', ')}` : ''}
`;

    return `${agentContext}\n\n${taskContext}\n\nPlease complete this task and provide a detailed response.`;
  }

  /**
   * Get system prompt for agent
   */
  private getSystemPrompt(agent: AgentState): string {
    const prompts: Record<string, string> = {
      'researcher': 'You are a research specialist. Analyze information thoroughly and provide comprehensive insights.',
      'coder': 'You are a coding expert. Write clean, efficient, and well-documented code.',
      'analyst': 'You are a data analyst. Analyze patterns, metrics, and provide actionable insights.',
      'optimizer': 'You are an optimization specialist. Identify inefficiencies and suggest improvements.',
      'coordinator': 'You are a coordination expert. Organize tasks, manage dependencies, and ensure smooth execution.'
    };

    return prompts[agent.type] || 'You are a helpful AI assistant. Complete tasks accurately and efficiently.';
  }

  /**
   * Process Claude's response
   */
  private processResponse(response: any): any {
    if (!response.content || response.content.length === 0) {
      return null;
    }

    // Extract text content
    const textContent = response.content
      .filter((block: any) => block.type === 'text')
      .map((block: any) => block.text)
      .join('\n');

    return {
      text: textContent,
      model: response.model,
      tokensUsed: response.usage,
      stopReason: response.stop_reason
    };
  }

  /**
   * Get execution statistics
   */
  getExecutionStats(): Map<string, any> {
    return new Map(this.executionStats);
  }

  /**
   * Clear execution statistics
   */
  clearExecutionStats(): void {
    this.executionStats.clear();
  }

  /**
   * Get health status
   */
  async getHealthStatus(): Promise<any> {
    const health = await this.claudeClient.checkHealth();
    return {
      ...health,
      executorStats: {
        totalExecutions: this.executionStats.size,
        swarmMode: this.config.swarmMode
      }
    };
  }
}

// Export for backward compatibility
export { TaskExecutorSDK as TaskExecutor };