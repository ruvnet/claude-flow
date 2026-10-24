/**
 * @claude-flow/mcp - Prompt Registry
 *
 * MCP 2025-11-25 compliant prompt management
 * Supports: list, get, arguments, templates, embedded resources
 */

import { EventEmitter } from 'events';
import type {
  MCPPrompt,
  PromptArgument,
  PromptMessage,
  PromptListResult,
  PromptGetResult,
  PromptContent,
  TextContent,
  EmbeddedResource,
  ResourceContent,
  ILogger,
} from './types.js';

export type PromptHandler = (
  args: Record<string, string>
) => Promise<PromptMessage[]>;

export interface PromptDefinition extends MCPPrompt {
  handler: PromptHandler;
}

export interface PromptRegistryOptions {
  maxPrompts?: number;
  validateArguments?: boolean;
}

export class PromptRegistry extends EventEmitter {
  private prompts: Map<string, PromptDefinition> = new Map();

  private readonly options: Required<PromptRegistryOptions>;

  constructor(
    private readonly logger: ILogger,
    options: PromptRegistryOptions = {}
  ) {
    super();
    this.options = {
      maxPrompts: options.maxPrompts ?? 1000,
      validateArguments: options.validateArguments ?? true,
    };
  }

  /**
   * Register a prompt
   */
  register(prompt: PromptDefinition): boolean {
    if (this.prompts.size >= this.options.maxPrompts) {
      this.logger.error('Maximum prompts reached', { max: this.options.maxPrompts });
      return false;
    }

    if (this.prompts.has(prompt.name)) {
      this.logger.warn('Prompt already registered', { name: prompt.name });
      return false;
    }

    this.prompts.set(prompt.name, prompt);

    this.logger.debug('Prompt registered', { name: prompt.name });
    this.emit('prompt:registered', { name: prompt.name });
    this.emitListChanged();

    return true;
  }

  /**
   * Unregister a prompt
   */
  unregister(name: string): boolean {
    if (!this.prompts.has(name)) {
      return false;
    }

    this.prompts.delete(name);

    this.logger.debug('Prompt unregistered', { name });
    this.emit('prompt:unregistered', { name });
    this.emitListChanged();

    return true;
  }

  /**
   * List prompts with pagination
   */
  list(cursor?: string, pageSize: number = 50): PromptListResult {
    const allPrompts = Array.from(this.prompts.values()).map((p) => ({
      name: p.name,
      title: p.title,
      description: p.description,
      arguments: p.arguments,
    }));

    let startIndex = 0;
    if (cursor) {
      const decoded = this.decodeCursor(cursor);
      startIndex = decoded.offset;
    }

    const endIndex = Math.min(startIndex + pageSize, allPrompts.length);
    const prompts = allPrompts.slice(startIndex, endIndex);

    const result: PromptListResult = { prompts };

    if (endIndex < allPrompts.length) {
      result.nextCursor = this.encodeCursor({ offset: endIndex });
    }

    return result;
  }

  /**
   * Get a prompt with arguments
   */
  async get(
    name: string,
    args: Record<string, string> = {}
  ): Promise<PromptGetResult> {
    const prompt = this.prompts.get(name);
    if (!prompt) {
      throw new Error(`Prompt not found: ${name}`);
    }

    // Validate required arguments
    if (this.options.validateArguments && prompt.arguments) {
      for (const arg of prompt.arguments) {
        if (arg.required && !(arg.name in args)) {
          throw new Error(`Missing required argument: ${arg.name}`);
        }
      }
    }

    const messages = await prompt.handler(args);

    this.emit('prompt:get', { name, argCount: Object.keys(args).length });

    return {
      description: prompt.description,
      messages,
    };
  }

  /**
   * Get prompt by name
   */
  getPrompt(name: string): MCPPrompt | undefined {
    const prompt = this.prompts.get(name);
    if (!prompt) return undefined;

    return {
      name: prompt.name,
      title: prompt.title,
      description: prompt.description,
      arguments: prompt.arguments,
    };
  }

  /**
   * Check if prompt exists
   */
  hasPrompt(name: string): boolean {
    return this.prompts.has(name);
  }

  /**
   * Get prompt count
   */
  getPromptCount(): number {
    return this.prompts.size;
  }

  /**
   * Get stats
   */
  getStats(): {
    totalPrompts: number;
    promptsWithArgs: number;
  } {
    let promptsWithArgs = 0;
    for (const prompt of this.prompts.values()) {
      if (prompt.arguments && prompt.arguments.length > 0) {
        promptsWithArgs++;
      }
    }

    return {
      totalPrompts: this.prompts.size,
      promptsWithArgs,
    };
  }

  /**
   * Encode cursor for pagination
   */
  private encodeCursor(data: { offset: number }): string {
    return Buffer.from(JSON.stringify(data)).toString('base64');
  }

  /**
   * Decode cursor for pagination
   */
  private decodeCursor(cursor: string): { offset: number } {
    try {
      return JSON.parse(Buffer.from(cursor, 'base64').toString('utf-8'));
    } catch {
      return { offset: 0 };
    }
  }

  /**
   * Emit listChanged notification
   */
  private emitListChanged(): void {
    this.emit('prompts:listChanged');
  }
}

export function createPromptRegistry(
  logger: ILogger,
  options?: PromptRegistryOptions
): PromptRegistry {
  return new PromptRegistry(logger, options);
}

/**
 * Helper to define a prompt
 */
export function definePrompt(
  name: string,
  description: string,
  handler: PromptHandler,
  options?: {
    title?: string;
    arguments?: PromptArgument[];
  }
): PromptDefinition {
  return {
    name,
    description,
    title: options?.title,
    arguments: options?.arguments,
    handler,
  };
}

/**
 * Helper to create a text message
 */
export function textMessage(
  role: 'user' | 'assistant',
  text: string
): PromptMessage {
  return {
    role,
    content: {
      type: 'text',
      text,
    } as TextContent,
  };
}

/**
 * Helper to create a message with embedded resource
 */
export function resourceMessage(
  role: 'user' | 'assistant',
  resource: ResourceContent
): PromptMessage {
  return {
    role,
    content: {
      type: 'resource',
      resource,
    } as EmbeddedResource,
  };
}

/**
 * Template string interpolation for prompts
 */
export function interpolate(
  template: string,
  args: Record<string, string>
): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    return args[key] ?? match;
  });
}
