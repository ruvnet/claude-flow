/**
 * Agent Types - Dynamic loading from .claude/agents/ directory
 * This file provides type-safe access to dynamically loaded agent definitions
 */

import { 
  getAvailableAgentTypes, 
  isValidAgentType as validateAgentType,
  resolveLegacyAgentType as resolveLegacy,
  LEGACY_AGENT_MAPPING as LEGACY_MAPPING
} from '../agents/agent-loader.js';

// Dynamic agent type - will be a string that matches available agents
export type AgentType = string;

// Re-export legacy mapping from agent-loader
export const LEGACY_AGENT_MAPPING = LEGACY_MAPPING;

// Re-export getAvailableAgentTypes for MCP tools
export { getAvailableAgentTypes };

/**
 * Get all valid agent types dynamically
 */
export async function getValidAgentTypes(): Promise<string[]> {
  return await getAvailableAgentTypes();
}

/**
 * Helper function to validate agent type
 */
export async function isValidAgentType(type: string): Promise<boolean> {
  return await validateAgentType(type);
}

/**
 * Resolve legacy agent types to current equivalents
 */
export const resolveLegacyAgentType = resolveLegacy;

/**
 * Create JSON Schema for agent type validation (async)
 */
export async function getAgentTypeSchema() {
  const validTypes = await getValidAgentTypes();
  return {
    type: 'string',
    enum: validTypes,
    description: 'Type of specialized AI agent',
  };
}

// Strategy types
export const SWARM_STRATEGIES = {
  AUTO: 'auto',
  RESEARCH: 'research',
  DEVELOPMENT: 'development',
  ANALYSIS: 'analysis',
  TESTING: 'testing',
  OPTIMIZATION: 'optimization',
  MAINTENANCE: 'maintenance',
  CUSTOM: 'custom',
} as const;

export type SwarmStrategy = (typeof SWARM_STRATEGIES)[keyof typeof SWARM_STRATEGIES];
export const VALID_SWARM_STRATEGIES = Object.values(SWARM_STRATEGIES);

// Task orchestration strategies (different from swarm strategies)
export const ORCHESTRATION_STRATEGIES = {
  PARALLEL: 'parallel',
  SEQUENTIAL: 'sequential',
  ADAPTIVE: 'adaptive',
  BALANCED: 'balanced',
} as const;

export type OrchestrationStrategy =
  (typeof ORCHESTRATION_STRATEGIES)[keyof typeof ORCHESTRATION_STRATEGIES];
export const VALID_ORCHESTRATION_STRATEGIES = Object.values(ORCHESTRATION_STRATEGIES);
