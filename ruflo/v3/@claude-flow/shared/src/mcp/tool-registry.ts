/**
 * V3 MCP Tool Registry
 *
 * High-performance tool management with:
 * - Fast O(1) lookup using Map
 * - Category-based organization
 * - Tool validation on registration
 * - Dynamic registration/unregistration
 * - Caching for frequently used tools
 *
 * Performance Targets:
 * - Tool registration: <10ms
 * - Tool lookup: <1ms
 * - Tool validation: <5ms
 */

import { EventEmitter } from 'events';
import {
  MCPTool,
  JSONSchema,
  ToolHandler,
  ToolContext,
  ToolCallResult,
  ToolRegistrationOptions,
  ILogger,
} from './types.js';

/**
 * Tool metadata for enhanced lookup
 */
interface ToolMetadata {
  tool: MCPTool;
  registeredAt: Date;
  callCount: number;
  lastCalled?: Date;
  avgExecutionTime: number;
  errorCount: number;
}

/**
 * Tool search options
 */
interface ToolSearchOptions {
  category?: string;
  tags?: string[];
  deprecated?: boolean;
  cacheable?: boolean;
}

/**
 * Tool Registry
 *
 * Manages registration, lookup, and execution of MCP tools
 */
export class ToolRegistry extends EventEmitter {
  private readonly tools: Map<string, ToolMetadata> = new Map();
  private readonly categoryIndex: Map<string, Set<string>> = new Map();
  private readonly tagIndex: Map<string, Set<string>> = new Map();
  private defaultContext?: ToolContext;

  // Performance tracking
  private totalRegistrations = 0;
  private totalLookups = 0;
  private totalExecutions = 0;

  constructor(private readonly logger: ILogger) {
    super();
  }

  /**
   * Register a tool
   */
  register(tool: MCPTool, options: ToolRegistrationOptions = {}): boolean {
    const startTime = performance.now();

    // Check for existing tool
    if (this.tools.has(tool.name) && !options.override) {
      this.logger.warn('Tool already registered', { name: tool.name });
      return false;
    }

    // Validate tool if requested
    if (options.validate !== false) {
      const validation = this.validateTool(tool);
      if (!validation.valid) {
        this.logger.error('Tool validation failed', {
          name: tool.name,
          errors: validation.errors,
        });
        return false;
      }
    }

    // Create metadata
    const metadata: ToolMetadata = {
      tool,
      registeredAt: new Date(),
      callCount: 0,
      avgExecutionTime: 0,
      errorCount: 0,
    };

    // Register tool
    this.tools.set(tool.name, metadata);
    this.totalRegistrations++;

    // Update category index
    if (tool.category) {
      if (!this.categoryIndex.has(tool.category)) {
        this.categoryIndex.set(tool.category, new Set());
      }
      this.categoryIndex.get(tool.category)!.add(tool.name);
    }

    // Update tag index
    if (tool.tags) {
      for (const tag of tool.tags) {
        if (!this.tagIndex.has(tag)) {
          this.tagIndex.set(tag, new Set());
        }
        this.tagIndex.get(tag)!.add(tool.name);
      }
    }

    const duration = performance.now() - startTime;
    this.logger.debug('Tool registered', {
      name: tool.name,
      category: tool.category,
      duration: `${duration.toFixed(2)}ms`,
    });

    this.emit('tool:registered', tool.name);
    return true;
  }

  /**
   * Register multiple tools at once
   */
  registerBatch(tools: MCPTool[], options: ToolRegistrationOptions = {}): {
    registered: number;
    failed: string[];
  } {
    const startTime = performance.now();
    const failed: string[] = [];
    let registered = 0;

    for (const tool of tools) {
      if (this.register(tool, options)) {
        registered++;
      } else {
        failed.push(tool.name);
      }
    }

    const duration = performance.now() - startTime;
    this.logger.info('Batch registration complete', {
      total: tools.length,
      registered,
      failed: failed.length,
      duration: `${duration.toFixed(2)}ms`,
    });

    return { registered, failed };
  }

  /**
   * Unregister a tool
   */
  unregister(name: string): boolean {
    const metadata = this.tools.get(name);
    if (!metadata) {
      return false;
    }

    // Remove from category index
    if (metadata.tool.category) {
      const categoryTools = this.categoryIndex.get(metadata.tool.category);
      categoryTools?.delete(name);
      if (categoryTools?.size === 0) {
        this.categoryIndex.delete(metadata.tool.category);
      }
    }

    // Remove from tag index
    if (metadata.tool.tags) {
      for (const tag of metadata.tool.tags) {
        const tagTools = this.tagIndex.get(tag);
        tagTools?.delete(name);
        if (tagTools?.size === 0) {
          this.tagIndex.delete(tag);
        }
      }
    }

    this.tools.delete(name);
    this.logger.debug('Tool unregistered', { name });
    this.emit('tool:unregistered', name);

    return true;
  }

  /**
   * Get a tool by name
   */
  getTool(name: string): MCPTool | undefined {
    this.totalLookups++;
    return this.tools.get(name)?.tool;
  }

  /**
   * Check if a tool exists
   */
  hasTool(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Get tool count
   */
  getToolCount(): number {
    return this.tools.size;
  }

  /**
   * Get all tool names
   */
  getToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * List all tools with metadata
   */
  listTools(): Array<{
    name: string;
    description: string;
    category?: string;
    tags?: string[];
    deprecated?: boolean;
  }> {
    return Array.from(this.tools.values()).map(({ tool }) => ({
      name: tool.name,
      description: tool.description,
      category: tool.category,
      tags: tool.tags,
      deprecated: tool.deprecated,
    }));
  }

  /**
   * Search tools by criteria
   */
  search(options: ToolSearchOptions): MCPTool[] {
    let results: Set<string> | undefined;

    // Filter by category
    if (options.category) {
      const categoryTools = this.categoryIndex.get(options.category);
      if (!categoryTools) return [];
      results = new Set(categoryTools);
    }

    // Filter by tags (intersection)
    if (options.tags && options.tags.length > 0) {
      for (const tag of options.tags) {
        const tagTools = this.tagIndex.get(tag);
        if (!tagTools) return [];

        if (results) {
          results = new Set([...results].filter((name) => tagTools.has(name)));
        } else {
          results = new Set(tagTools);
        }
      }
    }

    // Get all tools if no filters applied
    if (!results) {
      results = new Set(this.tools.keys());
    }

    // Convert to tools and apply additional filters
    const tools: MCPTool[] = [];
    for (const name of results) {
      const metadata = this.tools.get(name);
      if (!metadata) continue;

      const tool = metadata.tool;

      // Filter by deprecated status
      if (options.deprecated !== undefined && tool.deprecated !== options.deprecated) {
        continue;
      }

      // Filter by cacheable status
      if (options.cacheable !== undefined && tool.cacheable !== options.cacheable) {
        continue;
      }

      tools.push(tool);
    }

    return tools;
  }

  /**
   * Get tools by category
   */
  getByCategory(category: string): MCPTool[] {
    const toolNames = this.categoryIndex.get(category);
    if (!toolNames) return [];

    return Array.from(toolNames)
      .map((name) => this.tools.get(name)?.tool)
      .filter((tool): tool is MCPTool => tool !== undefined);
  }

  /**
   * Get tools by tag
   */
  getByTag(tag: string): MCPTool[] {
    const toolNames = this.tagIndex.get(tag);
    if (!toolNames) return [];

    return Array.from(toolNames)
      .map((name) => this.tools.get(name)?.tool)
      .filter((tool): tool is MCPTool => tool !== undefined);
  }

  /**
   * Get all categories
   */
  getCategories(): string[] {
    return Array.from(this.categoryIndex.keys());
  }

  /**
   * Get all tags
   */
  getTags(): string[] {
    return Array.from(this.tagIndex.keys());
  }

  /**
   * Execute a tool
   */
  async execute(
    name: string,
    input: Record<string, unknown>,
    context?: ToolContext
  ): Promise<ToolCallResult> {
    const startTime = performance.now();
    const metadata = this.tools.get(name);

    if (!metadata) {
      return {
        content: [{ type: 'text', text: `Tool not found: ${name}` }],
        isError: true,
      };
    }

    // Build execution context with required sessionId
    const execContext: ToolContext = {
      sessionId: context?.sessionId || this.defaultContext?.sessionId || 'default-session',
      ...this.defaultContext,
      ...context,
    };
    this.totalExecutions++;
    metadata.callCount++;
    metadata.lastCalled = new Date();

    try {
      this.emit('tool:called', { name, input });

      const result = await metadata.tool.handler(input, execContext);

      const duration = performance.now() - startTime;
      this.updateAverageExecutionTime(metadata, duration);

      this.logger.debug('Tool executed', {
        name,
        duration: `${duration.toFixed(2)}ms`,
        success: true,
      });

      this.emit('tool:completed', { name, duration, success: true });

      // Format result
      return {
        content: [{
          type: 'text',
          text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
        }],
        isError: false,
      };
    } catch (error) {
      const duration = performance.now() - startTime;
      metadata.errorCount++;

      this.logger.error('Tool execution failed', { name, error });
      this.emit('tool:error', { name, error, duration });

      return {
        content: [{
          type: 'text',
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        }],
        isError: true,
      };
    }
  }

  /**
   * Set default execution context
   */
  setDefaultContext(context: ToolContext): void {
    this.defaultContext = context;
  }

  /**
   * Get tool metadata
   */
  getMetadata(name: string): ToolMetadata | undefined {
    return this.tools.get(name);
  }

  /**
   * Get registry statistics
   */
  getStats(): {
    totalTools: number;
    totalCategories: number;
    totalTags: number;
    totalRegistrations: number;
    totalLookups: number;
    totalExecutions: number;
    topTools: Array<{ name: string; calls: number }>;
  } {
    // Get top 10 most used tools
    const topTools = Array.from(this.tools.entries())
      .map(([name, metadata]) => ({ name, calls: metadata.callCount }))
      .sort((a, b) => b.calls - a.calls)
      .slice(0, 10);

    return {
      totalTools: this.tools.size,
      totalCategories: this.categoryIndex.size,
      totalTags: this.tagIndex.size,
      totalRegistrations: this.totalRegistrations,
      totalLookups: this.totalLookups,
      totalExecutions: this.totalExecutions,
      topTools,
    };
  }

  /**
   * Validate a tool definition
   */
  validateTool(tool: MCPTool): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!tool.name || typeof tool.name !== 'string') {
      errors.push('Tool name is required and must be a string');
    } else if (!/^[a-zA-Z][a-zA-Z0-9_/:-]*$/.test(tool.name)) {
      errors.push('Tool name must start with a letter and contain only alphanumeric characters, underscores, slashes, colons, and hyphens');
    }

    if (!tool.description || typeof tool.description !== 'string') {
      errors.push('Tool description is required and must be a string');
    }

    if (!tool.inputSchema || typeof tool.inputSchema !== 'object') {
      errors.push('Tool inputSchema is required and must be an object');
    } else {
      const schemaErrors = this.validateSchema(tool.inputSchema);
      errors.push(...schemaErrors);
    }

    if (typeof tool.handler !== 'function') {
      errors.push('Tool handler is required and must be a function');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validate JSON Schema
   */
  private validateSchema(schema: JSONSchema, path = ''): string[] {
    const errors: string[] = [];

    if (!schema.type) {
      errors.push(`${path || 'schema'}: type is required`);
    }

    if (schema.type === 'object' && schema.properties) {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        const propPath = path ? `${path}.${key}` : key;
        errors.push(...this.validateSchema(propSchema, propPath));
      }
    }

    if (schema.type === 'array' && schema.items) {
      errors.push(...this.validateSchema(schema.items, `${path}[]`));
    }

    return errors;
  }

  /**
   * Update average execution time
   */
  private updateAverageExecutionTime(metadata: ToolMetadata, duration: number): void {
    const n = metadata.callCount;
    metadata.avgExecutionTime =
      ((metadata.avgExecutionTime * (n - 1)) + duration) / n;
  }

  /**
   * Clear all tools
   */
  clear(): void {
    this.tools.clear();
    this.categoryIndex.clear();
    this.tagIndex.clear();
    this.logger.info('Tool registry cleared');
    this.emit('registry:cleared');
  }
}

/**
 * Create a tool registry
 */
export function createToolRegistry(logger: ILogger): ToolRegistry {
  return new ToolRegistry(logger);
}

/**
 * Helper to create a tool definition
 */
export function defineTool<TInput = Record<string, unknown>, TOutput = unknown>(
  name: string,
  description: string,
  inputSchema: JSONSchema,
  handler: ToolHandler<TInput, TOutput>,
  options?: {
    category?: string;
    tags?: string[];
    version?: string;
    deprecated?: boolean;
    cacheable?: boolean;
    cacheTTL?: number;
    timeout?: number;
  }
): MCPTool<TInput, TOutput> {
  return {
    name,
    description,
    inputSchema,
    handler,
    ...options,
  };
}
