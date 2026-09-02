/**
 * V3 Claude-Flow Agent Fixtures
 *
 * Test data for agent-related testing
 * Following London School principle of explicit test data
 */
import type { V3AgentType } from '../helpers/swarm-instance.js';

/**
 * Agent configuration fixtures
 */
export interface AgentConfig {
  type: V3AgentType;
  name: string;
  capabilities: string[];
  priority?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Agent instance fixtures
 */
export interface AgentInstance {
  id: string;
  type: V3AgentType;
  name: string;
  status: 'idle' | 'busy' | 'terminated';
  capabilities: string[];
  createdAt: Date;
  lastActiveAt?: Date;
}

/**
 * Pre-defined agent configurations for testing
 */
export const agentConfigs: Record<string, AgentConfig> = {
  queenCoordinator: {
    type: 'queen-coordinator',
    name: 'Queen Alpha',
    capabilities: ['orchestration', 'task-distribution', 'agent-management'],
    priority: 100,
    metadata: { isLeader: true },
  },

  securityArchitect: {
    type: 'security-architect',
    name: 'Security Architect',
    capabilities: ['security-design', 'threat-modeling', 'security-review'],
    priority: 90,
    metadata: { specialization: 'cve-prevention' },
  },

  securityAuditor: {
    type: 'security-auditor',
    name: 'Security Auditor',
    capabilities: ['cve-detection', 'vulnerability-scanning', 'security-testing'],
    priority: 90,
    metadata: { specialization: 'penetration-testing' },
  },

  memorySpecialist: {
    type: 'memory-specialist',
    name: 'Memory Specialist',
    capabilities: ['memory-optimization', 'agentdb-integration', 'caching'],
    priority: 80,
    metadata: { backend: 'agentdb' },
  },

  swarmSpecialist: {
    type: 'swarm-specialist',
    name: 'Swarm Specialist',
    capabilities: ['coordination', 'consensus', 'communication'],
    priority: 85,
    metadata: { topology: 'hierarchical-mesh' },
  },

  coder: {
    type: 'coder',
    name: 'Coder Agent',
    capabilities: ['coding', 'implementation', 'debugging'],
    priority: 70,
  },

  tester: {
    type: 'tester',
    name: 'Tester Agent',
    capabilities: ['testing', 'test-execution', 'coverage'],
    priority: 70,
  },

  reviewer: {
    type: 'reviewer',
    name: 'Reviewer Agent',
    capabilities: ['code-review', 'quality-check', 'suggestions'],
    priority: 75,
  },
};

/**
 * Pre-defined agent instances for testing
 */
export const agentInstances: Record<string, AgentInstance> = {
  idleQueen: {
    id: 'agent-queen-001',
    type: 'queen-coordinator',
    name: 'Queen Alpha',
    status: 'idle',
    capabilities: ['orchestration', 'task-distribution', 'agent-management'],
    createdAt: new Date('2024-01-01T00:00:00Z'),
  },

  busySecurityArchitect: {
    id: 'agent-security-001',
    type: 'security-architect',
    name: 'Security Architect',
    status: 'busy',
    capabilities: ['security-design', 'threat-modeling', 'security-review'],
    createdAt: new Date('2024-01-01T00:00:00Z'),
    lastActiveAt: new Date('2024-01-15T12:00:00Z'),
  },

  terminatedCoder: {
    id: 'agent-coder-001',
    type: 'coder',
    name: 'Coder Agent',
    status: 'terminated',
    capabilities: ['coding', 'implementation', 'debugging'],
    createdAt: new Date('2024-01-01T00:00:00Z'),
    lastActiveAt: new Date('2024-01-10T08:00:00Z'),
  },
};

/**
 * Factory function to create agent config with overrides
 */
export function createAgentConfig(
  base: keyof typeof agentConfigs,
  overrides?: Partial<AgentConfig>
): AgentConfig {
  return {
    ...agentConfigs[base],
    ...overrides,
  };
}

/**
 * Factory function to create agent instance with overrides
 */
export function createAgentInstance(
  base: keyof typeof agentInstances,
  overrides?: Partial<AgentInstance>
): AgentInstance {
  return {
    ...agentInstances[base],
    ...overrides,
    id: overrides?.id ?? `agent-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: overrides?.createdAt ?? new Date(),
  };
}

/**
 * Create a full 15-agent swarm configuration
 */
export function create15AgentSwarmConfig(): AgentConfig[] {
  return [
    agentConfigs.queenCoordinator,
    agentConfigs.securityArchitect,
    agentConfigs.securityAuditor,
    agentConfigs.memorySpecialist,
    agentConfigs.swarmSpecialist,
    createAgentConfig('coder', { name: 'Integration Architect', type: 'integration-architect' as V3AgentType }),
    createAgentConfig('coder', { name: 'Performance Engineer', type: 'performance-engineer' as V3AgentType }),
    createAgentConfig('coder', { name: 'Core Architect', type: 'core-architect' as V3AgentType }),
    createAgentConfig('tester', { name: 'Test Architect', type: 'test-architect' as V3AgentType }),
    createAgentConfig('coder', { name: 'Project Coordinator', type: 'project-coordinator' as V3AgentType }),
    agentConfigs.coder,
    agentConfigs.reviewer,
    agentConfigs.tester,
    createAgentConfig('coder', { name: 'Planner Agent', type: 'planner' as V3AgentType }),
    createAgentConfig('coder', { name: 'Researcher Agent', type: 'researcher' as V3AgentType }),
  ];
}

/**
 * Invalid agent configurations for error testing
 */
export const invalidAgentConfigs = {
  emptyName: {
    type: 'coder' as V3AgentType,
    name: '',
    capabilities: ['coding'],
  },

  noCapabilities: {
    type: 'coder' as V3AgentType,
    name: 'Invalid Agent',
    capabilities: [],
  },

  invalidType: {
    type: 'invalid-type' as V3AgentType,
    name: 'Invalid Agent',
    capabilities: ['something'],
  },

  negativePriority: {
    type: 'coder' as V3AgentType,
    name: 'Invalid Agent',
    capabilities: ['coding'],
    priority: -1,
  },
};
