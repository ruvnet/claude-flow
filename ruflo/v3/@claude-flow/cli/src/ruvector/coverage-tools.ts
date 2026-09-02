/**
 * Coverage Router MCP Tools
 *
 * MCP tool implementations for coverage-aware routing.
 * Integrates with hooks_coverage_route and hooks_coverage_suggest from ruvector.
 */

import type { MCPTool } from '../mcp-tools/types.js';
import {
  coverageRoute,
  coverageSuggest,
  coverageGaps,
  type CoverageRouteResult,
  type CoverageSuggestResult,
  type CoverageGapsResult,
} from './coverage-router.js';

/**
 * Coverage-aware routing MCP tool
 *
 * Routes tasks to optimal agents based on test coverage gaps.
 * Uses ruvector's hooks_coverage_route when available.
 */
export const hooksCoverageRoute: MCPTool = {
  name: 'hooks/coverage-route',
  description: 'Route task to agents based on test coverage gaps (ruvector integration)',
  category: 'coverage',
  tags: ['coverage', 'routing', 'testing', 'ruvector'],
  inputSchema: {
    type: 'object',
    properties: {
      task: {
        type: 'string',
        description: 'Task description to route',
      },
      projectRoot: {
        type: 'string',
        description: 'Project root directory (defaults to cwd)',
      },
      threshold: {
        type: 'number',
        description: 'Coverage threshold percentage (default: 80)',
      },
      useRuvector: {
        type: 'boolean',
        description: 'Use ruvector integration if available (default: true)',
      },
    },
    required: ['task'],
  },
  handler: async (params: Record<string, unknown>): Promise<CoverageRouteResult> => {
    const task = params.task as string;
    const projectRoot = params.projectRoot as string | undefined;
    const threshold = params.threshold as number | undefined;
    const useRuvector = params.useRuvector as boolean | undefined;

    return coverageRoute(task, {
      projectRoot,
      threshold,
      useRuvector,
    });
  },
};

/**
 * Coverage suggestions MCP tool
 *
 * Suggests which files need better coverage in a given path.
 * Uses ruvector's hooks_coverage_suggest when available.
 */
export const hooksCoverageSuggest: MCPTool = {
  name: 'hooks/coverage-suggest',
  description: 'Suggest coverage improvements for a path (ruvector integration)',
  category: 'coverage',
  tags: ['coverage', 'suggestions', 'testing', 'ruvector'],
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to analyze for coverage suggestions',
      },
      projectRoot: {
        type: 'string',
        description: 'Project root directory (defaults to cwd)',
      },
      threshold: {
        type: 'number',
        description: 'Coverage threshold percentage (default: 80)',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of suggestions to return (default: 20)',
      },
      useRuvector: {
        type: 'boolean',
        description: 'Use ruvector integration if available (default: true)',
      },
    },
    required: ['path'],
  },
  handler: async (params: Record<string, unknown>): Promise<CoverageSuggestResult> => {
    const path = params.path as string;
    const projectRoot = params.projectRoot as string | undefined;
    const threshold = params.threshold as number | undefined;
    const limit = params.limit as number | undefined;
    const useRuvector = params.useRuvector as boolean | undefined;

    return coverageSuggest(path, {
      projectRoot,
      threshold,
      limit,
      useRuvector,
    });
  },
};

/**
 * Coverage gaps MCP tool
 *
 * Lists all coverage gaps in the project with agent assignments.
 */
export const hooksCoverageGaps: MCPTool = {
  name: 'hooks/coverage-gaps',
  description: 'List all coverage gaps with priority scoring and agent assignments',
  category: 'coverage',
  tags: ['coverage', 'gaps', 'testing', 'analysis'],
  inputSchema: {
    type: 'object',
    properties: {
      projectRoot: {
        type: 'string',
        description: 'Project root directory (defaults to cwd)',
      },
      threshold: {
        type: 'number',
        description: 'Coverage threshold percentage (default: 80)',
      },
      groupByAgent: {
        type: 'boolean',
        description: 'Group gaps by suggested agent (default: true)',
      },
      useRuvector: {
        type: 'boolean',
        description: 'Use ruvector integration if available (default: true)',
      },
    },
  },
  handler: async (params: Record<string, unknown>): Promise<CoverageGapsResult> => {
    const projectRoot = params.projectRoot as string | undefined;
    const threshold = params.threshold as number | undefined;
    const groupByAgent = params.groupByAgent as boolean | undefined;
    const useRuvector = params.useRuvector as boolean | undefined;

    return coverageGaps({
      projectRoot,
      threshold,
      groupByAgent,
      useRuvector,
    });
  },
};

/**
 * All coverage router MCP tools
 */
export const coverageRouterTools: MCPTool[] = [
  hooksCoverageRoute,
  hooksCoverageSuggest,
  hooksCoverageGaps,
];

export default coverageRouterTools;
