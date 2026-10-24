/**
 * MCP Integration Wrapper for Swarm System
 * 
 * This module provides a comprehensive wrapper around MCP tools to enable
 * seamless integration with the swarm orchestration system. It handles
 * tool discovery, execution, error handling, and result aggregation.
 */

import { EventEmitter } from 'node:events';
import { Logger } from '../core/logger.js';
import { generateId } from '../utils/helpers.js';
import { createClaudeFlowTools } from '../mcp/claude-flow-tools.js';
import { createRuvSwarmTools } from '../mcp/ruv-swarm-tools.js';
import type { MCPTool, MCPContext } from '../utils/types.js';
import type { AdvancedSwarmOrchestrator } from './advanced-orchestrator.js';
import {
  SwarmAgent,
  SwarmTask,
  TaskResult,
  SwarmExecutionContext,
  AgentState,
  TaskDefinition,
} from './types.js';

export interface MCPToolExecutionResult {
  success: boolean;
  result?: any;
  error?: string;
  duration: number;
  toolName: string;
  agentId: string;
  taskId?: string;
  metadata: {
    timestamp: Date;
    executionId: string;
    attempts: number;
    resourcesUsed?: any;
  };
}

export interface MCPToolRegistry {
  tools: Map<string, MCPTool>;
  categories: Map<string, string[]>;
  capabilities: Map<string, string[]>;
  permissions: Map<string, string[]>;
}

export interface MCPExecutionContext extends MCPContext {
  orchestrator: AdvancedSwarmOrchestrator;
  agent: SwarmAgent;
  task?: SwarmTask;
  swarmId: string;
  executionId: string;
  timeout: number;
  maxRetries: number;
}

export interface MCPIntegrationConfig {
  enableClaudeFlowTools: boolean;
  enableRuvSwarmTools: boolean;
  enableCustomTools: boolean;
  toolTimeout: number;
  maxRetries: number;
  enableCaching: boolean;
  cacheTimeout: number;
  enableMetrics: boolean;
  enableLogging: boolean;
  enableErrorRecovery: boolean;
  parallelExecution: boolean;
  maxConcurrentTools: number;
}

export class MCPIntegrationWrapper extends EventEmitter {
  private logger: Logger;
  private config: MCPIntegrationConfig;
  private toolRegistry: MCPToolRegistry;
  private executionCache: Map<string, MCPToolExecutionResult> = new Map();
  private activeExecutions: Map<string, AbortController> = new Map();
  private metrics: MCPIntegrationMetrics;

  constructor(config: Partial<MCPIntegrationConfig> = {}) {
    super();
    
    this.logger = new Logger('MCPIntegrationWrapper');
    this.config = this.createDefaultConfig(config);
    this.toolRegistry = this.initializeToolRegistry();
    this.metrics = this.initializeMetrics();

    this.setupEventHandlers();
  }

  /**
   * Initialize the MCP integration wrapper
   */
  async initialize(): Promise<void> {
    this.logger.info('Initializing MCP integration wrapper...');

    try {
      // Register Claude Flow tools
      if (this.config.enableClaudeFlowTools) {
        await this.registerClaudeFlowTools();
      }

      // Register ruv-swarm tools
      if (this.config.enableRuvSwarmTools) {
        await this.registerRuvSwarmTools();
      }

      // Start cache cleanup if enabled
      if (this.config.enableCaching) {
        this.startCacheCleanup();
      }

      this.logger.info('MCP integration wrapper initialized successfully', {
        totalTools: this.toolRegistry.tools.size,
        categories: this.toolRegistry.categories.size,
        capabilities: this.toolRegistry.capabilities.size,
      });

      this.emit('initialized', {
        toolCount: this.toolRegistry.tools.size,
        config: this.config,
      });

    } catch (error) {
      this.logger.error('Failed to initialize MCP integration wrapper', error);
      throw error;
    }
  }

  /**
   * Shutdown the wrapper gracefully
   */
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down MCP integration wrapper...');

    try {
      // Cancel all active executions
      for (const [executionId, controller] of this.activeExecutions) {
        controller.abort();
        this.logger.debug('Cancelled execution', { executionId });
      }
      this.activeExecutions.clear();

      // Clear cache if needed
      this.executionCache.clear();

      this.logger.info('MCP integration wrapper shut down successfully');
      this.emit('shutdown');

    } catch (error) {
      this.logger.error('Error during MCP wrapper shutdown', error);
      throw error;
    }
  }

  /**
   * Execute an MCP tool within a swarm context
   */
  async executeTool(
    toolName: string,
    input: any,
    context: MCPExecutionContext
  ): Promise<MCPToolExecutionResult> {
    const executionId = generateId('mcp-execution');
    const startTime = performance.now();

    this.logger.info('Executing MCP tool', {
      toolName,
      executionId,
      agentId: context.agent.id,
      taskId: context.task?.id,
      swarmId: context.swarmId,
    });

    try {
      // Check if tool exists
      const tool = this.toolRegistry.tools.get(toolName);
      if (!tool) {
        throw new Error(`Tool not found: ${toolName}`);
      }

      // Check cache if enabled
      if (this.config.enableCaching) {
        const cached = await this.getCachedResult(toolName, input, context);
        if (cached) {
          this.logger.debug('Using cached result', { toolName, executionId });
          return cached;
        }
      }

      // Create abort controller for timeout
      const abortController = new AbortController();
      this.activeExecutions.set(executionId, abortController);

      // Set up timeout
      const timeoutHandle = setTimeout(() => {
        abortController.abort();
      }, context.timeout || this.config.toolTimeout);

      try {
        // Execute tool with retry logic
        const result = await this.executeWithRetry(
          tool,
          input,
          context,
          executionId,
          abortController.signal
        );

        clearTimeout(timeoutHandle);

        const duration = performance.now() - startTime;
        const executionResult: MCPToolExecutionResult = {
          success: true,
          result,
          duration,
          toolName,
          agentId: context.agent.id,
          taskId: context.task?.id,
          metadata: {
            timestamp: new Date(),
            executionId,
            attempts: 1,
          },
        };

        // Cache result if enabled
        if (this.config.enableCaching) {
          await this.cacheResult(toolName, input, context, executionResult);
        }

        // Update metrics
        this.updateMetrics(executionResult);

        this.logger.info('MCP tool executed successfully', {
          toolName,
          executionId,
          duration,
        });

        this.emit('tool:executed', executionResult);
        return executionResult;

      } finally {
        clearTimeout(timeoutHandle);
        this.activeExecutions.delete(executionId);
      }

    } catch (error) {
      const duration = performance.now() - startTime;
      const executionResult: MCPToolExecutionResult = {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration,
        toolName,
        agentId: context.agent.id,
        taskId: context.task?.id,
        metadata: {
          timestamp: new Date(),
          executionId,
          attempts: 1,
        },
      };

      this.updateMetrics(executionResult);

      this.logger.error('MCP tool execution failed', {
        toolName,
        executionId,
        error: executionResult.error,
        duration,
      });

      this.emit('tool:failed', executionResult);
      return executionResult;
    }
  }

  /**
   * Execute multiple tools in parallel
   */
  async executeToolsParallel(
    toolExecutions: Array<{
      toolName: string;
      input: any;
      context: MCPExecutionContext;
    }>
  ): Promise<MCPToolExecutionResult[]> {
    if (!this.config.parallelExecution) {
      // Execute sequentially if parallel execution is disabled
      const results: MCPToolExecutionResult[] = [];
      for (const execution of toolExecutions) {
        const result = await this.executeTool(
          execution.toolName,
          execution.input,
          execution.context
        );
        results.push(result);
      }
      return results;
    }

    this.logger.info('Executing tools in parallel', {
      toolCount: toolExecutions.length,
      maxConcurrent: this.config.maxConcurrentTools,
    });

    // Limit concurrent executions
    const semaphore = new Semaphore(this.config.maxConcurrentTools);
    
    const promises = toolExecutions.map(async (execution) => {
      await semaphore.acquire();
      try {
        return await this.executeTool(
          execution.toolName,
          execution.input,
          execution.context
        );
      } finally {
        semaphore.release();
      }
    });

    const results = await Promise.allSettled(promises);
    
    return results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        // Create error result
        return {
          success: false,
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
          duration: 0,
          toolName: toolExecutions[index].toolName,
          agentId: toolExecutions[index].context.agent.id,
          taskId: toolExecutions[index].context.task?.id,
          metadata: {
            timestamp: new Date(),
            executionId: generateId('failed-execution'),
            attempts: 1,
          },
        };
      }
    });
  }

  /**
   * Get available tools with filtering options
   */
  getAvailableTools(options: {
    category?: string;
    capability?: string;
    agent?: SwarmAgent;
  } = {}): MCPTool[] {
    let tools = Array.from(this.toolRegistry.tools.values());

    // Filter by category
    if (options.category) {
      const categoryTools = this.toolRegistry.categories.get(options.category) || [];
      tools = tools.filter(tool => categoryTools.includes(tool.name));
    }

    // Filter by capability
    if (options.capability) {
      const capabilityTools = this.toolRegistry.capabilities.get(options.capability) || [];
      tools = tools.filter(tool => capabilityTools.includes(tool.name));
    }

    // Filter by agent permissions
    if (options.agent) {
      tools = tools.filter(tool => this.hasPermission(tool, options.agent!));
    }

    return tools;
  }

  /**
   * Get tool information
   */
  getToolInfo(toolName: string): MCPTool | null {
    return this.toolRegistry.tools.get(toolName) || null;
  }

  /**
   * Get integration metrics
   */
  getMetrics(): MCPIntegrationMetrics {
    return {
      ...this.metrics,
      cacheHitRate: this.calculateCacheHitRate(),
      averageExecutionTime: this.calculateAverageExecutionTime(),
      toolUsageDistribution: this.calculateToolUsageDistribution(),
    };
  }

  /**
   * Create MCP execution context for swarm operations
   */
  createExecutionContext(
    orchestrator: AdvancedSwarmOrchestrator,
    agent: SwarmAgent,
    swarmId: string,
    task?: SwarmTask
  ): MCPExecutionContext {
    return {
      sessionId: generateId('mcp-session'),
      orchestrator,
      agent,
      task,
      swarmId,
      executionId: generateId('mcp-execution'),
      timeout: this.config.toolTimeout,
      maxRetries: this.config.maxRetries,
    };
  }

  // Private methods

  private async registerClaudeFlowTools(): Promise<void> {
    this.logger.info('Registering Claude Flow tools...');
    
    const claudeFlowTools = createClaudeFlowTools(this.logger);
    
    for (const tool of claudeFlowTools) {
      this.toolRegistry.tools.set(tool.name, tool);
      
      // Categorize tool
      const category = this.categorizeClaudeFlowTool(tool.name);
      if (!this.toolRegistry.categories.has(category)) {
        this.toolRegistry.categories.set(category, []);
      }
      this.toolRegistry.categories.get(category)!.push(tool.name);
      
      // Add capabilities
      const capabilities = this.extractCapabilities(tool);
      for (const capability of capabilities) {
        if (!this.toolRegistry.capabilities.has(capability)) {
          this.toolRegistry.capabilities.set(capability, []);
        }
        this.toolRegistry.capabilities.get(capability)!.push(tool.name);
      }
    }

    this.logger.info(`Registered ${claudeFlowTools.length} Claude Flow tools`);
  }

  private async registerRuvSwarmTools(): Promise<void> {
    this.logger.info('Registering ruv-swarm tools...');
    
    const ruvSwarmTools = createRuvSwarmTools(this.logger);
    
    for (const tool of ruvSwarmTools) {
      this.toolRegistry.tools.set(tool.name, tool);
      
      // Categorize tool
      const category = this.categorizeRuvSwarmTool(tool.name);
      if (!this.toolRegistry.categories.has(category)) {
        this.toolRegistry.categories.set(category, []);
      }
      this.toolRegistry.categories.get(category)!.push(tool.name);
      
      // Add capabilities
      const capabilities = this.extractCapabilities(tool);
      for (const capability of capabilities) {
        if (!this.toolRegistry.capabilities.has(capability)) {
          this.toolRegistry.capabilities.set(capability, []);
        }
        this.toolRegistry.capabilities.get(capability)!.push(tool.name);
      }
    }

    this.logger.info(`Registered ${ruvSwarmTools.length} ruv-swarm tools`);
  }

  private async executeWithRetry(
    tool: MCPTool,
    input: any,
    context: MCPExecutionContext,
    executionId: string,
    signal: AbortSignal
  ): Promise<any> {
    let lastError: Error | null = null;
    const maxRetries = context.maxRetries || this.config.maxRetries;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Check if execution was aborted
        if (signal.aborted) {
          throw new Error('Execution aborted');
        }

        this.logger.debug('Executing tool attempt', {
          toolName: tool.name,
          executionId,
          attempt,
          maxRetries,
        });

        const result = await tool.handler(input, context);
        
        if (attempt > 1) {
          this.logger.info('Tool execution succeeded after retry', {
            toolName: tool.name,
            executionId,
            attempt,
          });
        }

        return result;

      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        this.logger.warn('Tool execution attempt failed', {
          toolName: tool.name,
          executionId,
          attempt,
          maxRetries,
          error: lastError.message,
        });

        // Don't retry on certain errors
        if (this.isNonRetryableError(lastError)) {
          break;
        }

        // Wait before retry (exponential backoff)
        if (attempt < maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError || new Error('Tool execution failed after all retries');
  }

  private isNonRetryableError(error: Error): boolean {
    const nonRetryablePatterns = [
      /not found/i,
      /invalid input/i,
      /permission denied/i,
      /unauthorized/i,
      /forbidden/i,
    ];

    return nonRetryablePatterns.some(pattern => pattern.test(error.message));
  }

  private async getCachedResult(
    toolName: string,
    input: any,
    context: MCPExecutionContext
  ): Promise<MCPToolExecutionResult | null> {
    const cacheKey = this.generateCacheKey(toolName, input, context);
    const cached = this.executionCache.get(cacheKey);
    
    if (cached) {
      const age = Date.now() - cached.metadata.timestamp.getTime();
      if (age < this.config.cacheTimeout) {
        this.metrics.cacheHits++;
        return cached;
      } else {
        // Remove expired entry
        this.executionCache.delete(cacheKey);
      }
    }

    this.metrics.cacheMisses++;
    return null;
  }

  private async cacheResult(
    toolName: string,
    input: any,
    context: MCPExecutionContext,
    result: MCPToolExecutionResult
  ): Promise<void> {
    const cacheKey = this.generateCacheKey(toolName, input, context);
    this.executionCache.set(cacheKey, result);
  }

  private generateCacheKey(
    toolName: string,
    input: any,
    context: MCPExecutionContext
  ): string {
    const inputHash = this.hashObject(input);
    const contextHash = this.hashObject({
      agentId: context.agent.id,
      swarmId: context.swarmId,
      taskId: context.task?.id,
    });
    
    return `${toolName}:${inputHash}:${contextHash}`;
  }

  private hashObject(obj: any): string {
    // Simple hash function for caching
    const str = JSON.stringify(obj, Object.keys(obj).sort());
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(36);
  }

  private hasPermission(tool: MCPTool, agent: SwarmAgent): boolean {
    // Check if agent has permission to use this tool
    const toolPermissions = this.toolRegistry.permissions.get(tool.name) || [];
    
    // If no specific permissions defined, allow all
    if (toolPermissions.length === 0) {
      return true;
    }

    // Check agent capabilities against tool permissions
    return agent.capabilities.some(capability => 
      toolPermissions.includes(capability)
    );
  }

  private categorizeClaudeFlowTool(toolName: string): string {
    if (toolName.includes('agents/')) return 'agent-management';
    if (toolName.includes('tasks/')) return 'task-management';
    if (toolName.includes('memory/')) return 'memory-management';
    if (toolName.includes('system/')) return 'system-monitoring';
    if (toolName.includes('config/')) return 'configuration';
    if (toolName.includes('workflow/')) return 'workflow-management';
    if (toolName.includes('terminal/')) return 'terminal-management';
    return 'general';
  }

  private categorizeRuvSwarmTool(toolName: string): string {
    if (toolName.includes('swarm_')) return 'swarm-lifecycle';
    if (toolName.includes('agent_')) return 'agent-management';
    if (toolName.includes('task_')) return 'task-orchestration';
    if (toolName.includes('memory_')) return 'memory-persistence';
    if (toolName.includes('neural_')) return 'neural-capabilities';
    if (toolName.includes('benchmark_')) return 'performance-benchmarking';
    return 'general';
  }

  private extractCapabilities(tool: MCPTool): string[] {
    const capabilities: string[] = [];
    
    // Extract capabilities from tool name and description
    const text = `${tool.name} ${tool.description}`.toLowerCase();
    
    const capabilityPatterns = [
      'agent', 'task', 'memory', 'system', 'config', 'workflow',
      'terminal', 'swarm', 'neural', 'benchmark', 'monitoring',
      'orchestration', 'coordination', 'analysis', 'research',
      'development', 'testing', 'documentation', 'optimization',
    ];

    for (const pattern of capabilityPatterns) {
      if (text.includes(pattern)) {
        capabilities.push(pattern);
      }
    }

    return capabilities.length > 0 ? capabilities : ['general'];
  }

  private updateMetrics(result: MCPToolExecutionResult): void {
    this.metrics.totalExecutions++;
    
    if (result.success) {
      this.metrics.successfulExecutions++;
    } else {
      this.metrics.failedExecutions++;
    }

    this.metrics.totalExecutionTime += result.duration;

    // Update tool-specific metrics
    if (!this.metrics.toolExecutions.has(result.toolName)) {
      this.metrics.toolExecutions.set(result.toolName, {
        count: 0,
        totalTime: 0,
        successCount: 0,
        failureCount: 0,
      });
    }

    const toolStats = this.metrics.toolExecutions.get(result.toolName)!;
    toolStats.count++;
    toolStats.totalTime += result.duration;
    
    if (result.success) {
      toolStats.successCount++;
    } else {
      toolStats.failureCount++;
    }
  }

  private calculateCacheHitRate(): number {
    const total = this.metrics.cacheHits + this.metrics.cacheMisses;
    return total > 0 ? this.metrics.cacheHits / total : 0;
  }

  private calculateAverageExecutionTime(): number {
    return this.metrics.totalExecutions > 0 
      ? this.metrics.totalExecutionTime / this.metrics.totalExecutions 
      : 0;
  }

  private calculateToolUsageDistribution(): Record<string, number> {
    const distribution: Record<string, number> = {};
    
    for (const [toolName, stats] of this.metrics.toolExecutions) {
      distribution[toolName] = stats.count;
    }

    return distribution;
  }

  private startCacheCleanup(): void {
    // Clean up expired cache entries every 5 minutes
    setInterval(() => {
      const now = Date.now();
      const expired: string[] = [];

      for (const [key, result] of this.executionCache) {
        const age = now - result.metadata.timestamp.getTime();
        if (age > this.config.cacheTimeout) {
          expired.push(key);
        }
      }

      expired.forEach(key => this.executionCache.delete(key));
      
      if (expired.length > 0) {
        this.logger.debug('Cleaned up expired cache entries', { 
          count: expired.length 
        });
      }
    }, 300000); // 5 minutes
  }

  private initializeToolRegistry(): MCPToolRegistry {
    return {
      tools: new Map(),
      categories: new Map(),
      capabilities: new Map(),
      permissions: new Map(),
    };
  }

  private initializeMetrics(): MCPIntegrationMetrics {
    return {
      totalExecutions: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      totalExecutionTime: 0,
      cacheHits: 0,
      cacheMisses: 0,
      toolExecutions: new Map(),
      cacheHitRate: 0,
      averageExecutionTime: 0,
      toolUsageDistribution: {},
    };
  }

  private createDefaultConfig(config: Partial<MCPIntegrationConfig>): MCPIntegrationConfig {
    return {
      enableClaudeFlowTools: true,
      enableRuvSwarmTools: true,
      enableCustomTools: true,
      toolTimeout: 30000, // 30 seconds
      maxRetries: 3,
      enableCaching: true,
      cacheTimeout: 300000, // 5 minutes
      enableMetrics: true,
      enableLogging: true,
      enableErrorRecovery: true,
      parallelExecution: true,
      maxConcurrentTools: 5,
      ...config,
    };
  }

  private setupEventHandlers(): void {
    this.on('tool:executed', (result) => {
      if (this.config.enableLogging) {
        this.logger.debug('Tool execution completed', {
          toolName: result.toolName,
          success: result.success,
          duration: result.duration,
        });
      }
    });

    this.on('tool:failed', (result) => {
      if (this.config.enableLogging) {
        this.logger.warn('Tool execution failed', {
          toolName: result.toolName,
          error: result.error,
          duration: result.duration,
        });
      }
    });
  }
}

// Supporting interfaces and classes

interface MCPIntegrationMetrics {
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  totalExecutionTime: number;
  cacheHits: number;
  cacheMisses: number;
  toolExecutions: Map<string, {
    count: number;
    totalTime: number;
    successCount: number;
    failureCount: number;
  }>;
  cacheHitRate: number;
  averageExecutionTime: number;
  toolUsageDistribution: Record<string, number>;
}

class Semaphore {
  private permits: number;
  private waitQueue: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      this.waitQueue.push(resolve);
    });
  }

  release(): void {
    if (this.waitQueue.length > 0) {
      const resolve = this.waitQueue.shift()!;
      resolve();
    } else {
      this.permits++;
    }
  }
}

export default MCPIntegrationWrapper;