/**
 * Tool Template for Filesystem-Based Tool Discovery
 *
 * This template provides the structure for individual MCP tools
 * following the progressive disclosure pattern.
 *
 * Usage:
 * 1. Copy this file to appropriate category directory
 * 2. Rename to match tool name (e.g., spawn.ts for agents/spawn)
 * 3. Update all [PLACEHOLDER] values
 * 4. Implement handler logic
 */

import type { MCPTool, ClaudeFlowToolContext } from '../types.js';
import type { ILogger } from '../../interfaces/logger.js';

/**
 * Input interface for this tool
 * Define strongly-typed input parameters
 *
 * REPLACE: Rename ToolTemplateInput to match your tool name (e.g., AgentSpawnInput)
 */
interface ToolTemplateInput {
  // Define input properties with types
  // Example:
  // name: string;
  // config?: Record<string, unknown>;

  // PLACEHOLDER: Add your input properties here
  exampleProperty?: string;
}

/**
 * Result interface for this tool
 * Define strongly-typed return value
 *
 * REPLACE: Rename ToolTemplateResult to match your tool name (e.g., AgentSpawnResult)
 */
interface ToolTemplateResult {
  success: boolean;
  // Define result properties
  // Example:
  // resourceId: string;
  // status: string;

  // PLACEHOLDER: Add your result properties here
  message?: string;
}

/**
 * Create tool template
 *
 * REPLACE: Update function name to match your tool (e.g., createAgentSpawnTool)
 * REPLACE: Update JSDoc description
 *
 * @param logger - Logger instance for structured logging
 * @returns MCPTool definition
 */
export function createToolTemplateTool(logger: ILogger): MCPTool {
  return {
    // REPLACE: Update name to match your tool (e.g., 'agents/spawn')
    name: 'category/toolname',

    // REPLACE: Update description with detailed information about your tool
    description: 'Template for creating new MCP tools with progressive disclosure. Copy and customize this file.',

    inputSchema: {
      type: 'object',
      properties: {
        // Define JSON schema for input validation
        // Example:
        // name: {
        //   type: 'string',
        //   description: 'Resource name',
        //   minLength: 1,
        //   maxLength: 100,
        // },
      },
      required: [], // List required properties
    },

    // Optional: Metadata for progressive disclosure
    metadata: {
      // REPLACE: Update category to match your tool's purpose
      category: 'system', // agents, tasks, memory, system, etc.
      // REPLACE: Add relevant searchable tags
      tags: ['template', 'example'], // Searchable tags
      examples: [
        {
          description: 'Example usage scenario',
          input: {
            // Example input object
          },
          expectedOutput: {
            // Expected result object
          },
        },
      ],
      detailLevel: 'standard', // 'basic' | 'standard' | 'full'
    },

    /**
     * Tool execution handler
     *
     * @param input - Validated input parameters
     * @param context - Tool execution context with orchestrator, etc.
     * @returns Tool result
     */
    handler: async (
      input: any,
      context?: ClaudeFlowToolContext
    ): Promise<ToolTemplateResult> => {
      // Validate context availability
      if (!context?.orchestrator) {
        throw new Error('Orchestrator not available in tool context');
      }

      // Cast input to typed interface
      const validatedInput = input as ToolTemplateInput;

      // REPLACE: Update log message to match your tool
      logger.info('category/toolname invoked', {
        input: validatedInput,
        sessionId: context.sessionId,
      });

      try {
        // ============================================
        // IMPLEMENT TOOL LOGIC HERE
        // ============================================

        // Example:
        // const result = await context.orchestrator.someMethod(validatedInput);

        // ============================================
        // END TOOL LOGIC
        // ============================================

        // Log success
        logger.info('[namespace]/[toolname] completed successfully', {
          input: validatedInput,
        });

        return {
          success: true,
          // Include result data
        };
      } catch (error) {
        // Log error
        logger.error('[namespace]/[toolname] failed', {
          error,
          input: validatedInput,
        });

        // Re-throw for MCP error handling
        throw error;
      }
    },
  };
}

/**
 * Export lightweight metadata for tool discovery
 * This is loaded without executing the full tool definition
 *
 * REPLACE: Update all fields to match your tool
 */
export const toolMetadata = {
  name: 'category/toolname',
  description: 'Brief one-line description of the tool',
  category: 'system',
  detailLevel: 'standard' as const,
  tags: ['template', 'example'],
};
