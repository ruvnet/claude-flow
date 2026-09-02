/**
 * V3 Swarm Configuration
 * Configuration for the 15-agent hierarchical mesh swarm
 *
 * Based on the V3 Architecture Decision Records and Swarm Implementation Plan
 */

import {
  SwarmConfig,
  TopologyType,
  LoadBalancingStrategy,
  AgentDomain,
  PhaseId,
  PerformanceTargets,
  V3_PERFORMANCE_TARGETS
} from './shared/types';

// =============================================================================
// Swarm Configuration
// =============================================================================

export interface V3SwarmConfig extends SwarmConfig {
  name: string;
  version: string;
  description: string;
  domains: DomainConfig[];
  phases: PhaseConfig[];
  performance: PerformanceTargets;
  github: GitHubConfig;
  logging: LoggingConfig;
}

export interface DomainConfig {
  domain: AgentDomain;
  agents: string[];
  priority: number;
  parallelExecution: boolean;
}

export interface PhaseConfig {
  id: PhaseId;
  name: string;
  weeks: [number, number];
  activeDomains: AgentDomain[];
  prerequisites: PhaseId[];
}

export interface GitHubConfig {
  enabled: boolean;
  repository: string;
  issueLabels: Record<string, string>;
  autoReply: boolean;
  replyInterval: number;
}

export interface LoggingConfig {
  level: 'debug' | 'info' | 'warn' | 'error';
  format: 'json' | 'pretty';
  output: 'console' | 'file' | 'both';
  filePath: string;
}

// =============================================================================
// Default Configuration
// =============================================================================

export const defaultSwarmConfig: V3SwarmConfig = {
  // Core SwarmConfig
  topology: 'hierarchical-mesh',
  maxAgents: 15,
  messageTimeout: 30000,
  retryAttempts: 3,
  healthCheckInterval: 5000,
  loadBalancingStrategy: 'capability-match',

  // V3 Extensions
  name: 'claude-flow-v3-swarm',
  version: '3.0.0',
  description: '15-agent hierarchical mesh swarm for V3 implementation',

  // Domain Configuration
  domains: [
    {
      domain: 'security',
      agents: ['agent-2', 'agent-3', 'agent-4'],
      priority: 1,
      parallelExecution: true
    },
    {
      domain: 'core',
      agents: ['agent-1', 'agent-5', 'agent-6', 'agent-7', 'agent-8', 'agent-9'],
      priority: 2,
      parallelExecution: true
    },
    {
      domain: 'integration',
      agents: ['agent-10', 'agent-11', 'agent-12'],
      priority: 3,
      parallelExecution: true
    },
    {
      domain: 'quality',
      agents: ['agent-13'],
      priority: 2,
      parallelExecution: false
    },
    {
      domain: 'performance',
      agents: ['agent-14'],
      priority: 4,
      parallelExecution: false
    },
    {
      domain: 'deployment',
      agents: ['agent-15'],
      priority: 5,
      parallelExecution: false
    }
  ],

  // Phase Configuration
  phases: [
    {
      id: 'phase-1-foundation',
      name: 'Foundation',
      weeks: [1, 2],
      activeDomains: ['security', 'core'],
      prerequisites: []
    },
    {
      id: 'phase-2-core',
      name: 'Core Systems',
      weeks: [3, 6],
      activeDomains: ['core', 'quality'],
      prerequisites: ['phase-1-foundation']
    },
    {
      id: 'phase-3-integration',
      name: 'Integration',
      weeks: [7, 10],
      activeDomains: ['integration', 'quality', 'performance'],
      prerequisites: ['phase-2-core']
    },
    {
      id: 'phase-4-release',
      name: 'Optimization & Release',
      weeks: [11, 14],
      activeDomains: ['security', 'core', 'integration', 'quality', 'performance', 'deployment'],
      prerequisites: ['phase-3-integration']
    }
  ],

  // Performance Targets
  performance: V3_PERFORMANCE_TARGETS,

  // GitHub Integration
  github: {
    enabled: true,
    repository: 'ruvnet/claude-flow',
    issueLabels: {
      'agent-1': 'swarm:agent-1',
      'agent-2-4': 'swarm:agent-2-4',
      'agent-5-9': 'swarm:agent-5-9',
      'agent-10-12': 'swarm:agent-10-12',
      'agent-13': 'swarm:agent-13',
      'agent-14': 'swarm:agent-14',
      'agent-15': 'swarm:agent-15',
      'tdd': 'tdd:london',
      'benchmark': 'benchmark',
      'security': 'security:critical'
    },
    autoReply: true,
    replyInterval: 3600000
  },

  // Logging Configuration
  logging: {
    level: 'info',
    format: 'pretty',
    output: 'console',
    filePath: './logs/swarm.log'
  }
};

// =============================================================================
// Agent Mapping
// =============================================================================

export const agentRoleMapping = {
  'agent-1': {
    role: 'queen-coordinator',
    name: 'Queen Coordinator',
    domain: 'core' as AgentDomain,
    responsibilities: [
      'Orchestrate all 15 agents',
      'Manage GitHub issues and milestones',
      'Track overall progress',
      'Coordinate cross-domain communication'
    ]
  },
  'agent-2': {
    role: 'security-architect',
    name: 'Security Architect',
    domain: 'security' as AgentDomain,
    responsibilities: [
      'Security architecture review',
      'Threat modeling',
      'Security policy definition'
    ]
  },
  'agent-3': {
    role: 'security-implementer',
    name: 'Security Implementer',
    domain: 'security' as AgentDomain,
    responsibilities: [
      'CVE-1, CVE-2, CVE-3 fixes',
      'Security code implementation',
      'Input validation'
    ]
  },
  'agent-4': {
    role: 'security-tester',
    name: 'Security Tester',
    domain: 'security' as AgentDomain,
    responsibilities: [
      'Security test harness (TDD)',
      'Penetration testing',
      'Security audit verification'
    ]
  },
  'agent-5': {
    role: 'core-architect',
    name: 'Core Architect',
    domain: 'core' as AgentDomain,
    responsibilities: [
      'DDD architecture design',
      'Bounded context definition',
      'Core module structure'
    ]
  },
  'agent-6': {
    role: 'core-implementer',
    name: 'Core Implementer',
    domain: 'core' as AgentDomain,
    responsibilities: [
      'Type system modernization',
      'Core module implementation',
      'Config management'
    ]
  },
  'agent-7': {
    role: 'memory-specialist',
    name: 'Memory Specialist',
    domain: 'core' as AgentDomain,
    responsibilities: [
      'Memory system unification',
      'AgentDB integration (150x-12500x)',
      'Hybrid backend implementation'
    ]
  },
  'agent-8': {
    role: 'swarm-specialist',
    name: 'Swarm Specialist',
    domain: 'core' as AgentDomain,
    responsibilities: [
      'Single SwarmCoordinator',
      'Merge 4 coordination systems',
      'Pluggable topology strategies'
    ]
  },
  'agent-9': {
    role: 'mcp-specialist',
    name: 'MCP Specialist',
    domain: 'core' as AgentDomain,
    responsibilities: [
      'MCP server optimization',
      'Tool registration',
      'Protocol enhancements'
    ]
  },
  'agent-10': {
    role: 'integration-architect',
    name: 'Integration Architect',
    domain: 'integration' as AgentDomain,
    responsibilities: [
      'agentic-flow@alpha integration',
      'Service layer design',
      'API surface definition'
    ]
  },
  'agent-11': {
    role: 'cli-hooks-developer',
    name: 'CLI/Hooks Developer',
    domain: 'integration' as AgentDomain,
    responsibilities: [
      'CLI modernization',
      'Hooks system enhancement',
      'Command structure'
    ]
  },
  'agent-12': {
    role: 'neural-learning-dev',
    name: 'Neural/Learning Developer',
    domain: 'integration' as AgentDomain,
    responsibilities: [
      'Neural system integration',
      'SONA learning (<0.05ms)',
      'Pattern recognition'
    ]
  },
  'agent-13': {
    role: 'tdd-test-engineer',
    name: 'TDD Test Engineer',
    domain: 'quality' as AgentDomain,
    responsibilities: [
      'TDD London School methodology',
      'Test coverage (>90%)',
      'Mock-first approach'
    ]
  },
  'agent-14': {
    role: 'performance-engineer',
    name: 'Performance Engineer',
    domain: 'performance' as AgentDomain,
    responsibilities: [
      'Benchmark suite',
      '2.49x-7.47x Flash Attention',
      'Memory optimization (50-75%)'
    ]
  },
  'agent-15': {
    role: 'release-engineer',
    name: 'Release Engineer',
    domain: 'deployment' as AgentDomain,
    responsibilities: [
      'CI/CD pipeline',
      'Deployment automation',
      'v3.0.0 release'
    ]
  }
};

// =============================================================================
// Configuration Helpers
// =============================================================================

export function getAgentsByDomain(domain: AgentDomain): string[] {
  return Object.entries(agentRoleMapping)
    .filter(([_, config]) => config.domain === domain)
    .map(([id, _]) => id);
}

export function getAgentConfig(agentId: string) {
  return agentRoleMapping[agentId as keyof typeof agentRoleMapping];
}

export function getPhaseConfig(phaseId: PhaseId): PhaseConfig | undefined {
  return defaultSwarmConfig.phases.find(p => p.id === phaseId);
}

export function getActiveAgentsForPhase(phaseId: PhaseId): string[] {
  const phase = getPhaseConfig(phaseId);
  if (!phase) return [];

  const agents: string[] = [];
  for (const domain of phase.activeDomains) {
    agents.push(...getAgentsByDomain(domain));
  }

  return [...new Set(agents)];
}

export function createCustomConfig(overrides: Partial<V3SwarmConfig>): V3SwarmConfig {
  return {
    ...defaultSwarmConfig,
    ...overrides,
    performance: {
      ...defaultSwarmConfig.performance,
      ...overrides.performance
    },
    github: {
      ...defaultSwarmConfig.github,
      ...overrides.github
    },
    logging: {
      ...defaultSwarmConfig.logging,
      ...overrides.logging
    }
  };
}

// =============================================================================
// Topology Configuration
// =============================================================================

export const topologyConfigs: Record<TopologyType, TopologyConfig> = {
  'hierarchical-mesh': {
    name: 'Hierarchical Mesh',
    description: 'Queen-led hierarchy with mesh communication between domains',
    centralNode: 'agent-1',
    layers: [
      ['agent-1'],
      ['agent-2', 'agent-3', 'agent-4', 'agent-5', 'agent-6', 'agent-7', 'agent-8', 'agent-9', 'agent-10', 'agent-11', 'agent-12'],
      ['agent-13', 'agent-14', 'agent-15']
    ],
    meshConnections: [
      ['agent-2', 'agent-3', 'agent-4'],
      ['agent-5', 'agent-6', 'agent-7', 'agent-8', 'agent-9'],
      ['agent-10', 'agent-11', 'agent-12']
    ]
  },
  'mesh': {
    name: 'Full Mesh',
    description: 'All agents can communicate with all other agents',
    centralNode: null,
    layers: [
      ['agent-1', 'agent-2', 'agent-3', 'agent-4', 'agent-5', 'agent-6', 'agent-7', 'agent-8', 'agent-9', 'agent-10', 'agent-11', 'agent-12', 'agent-13', 'agent-14', 'agent-15']
    ],
    meshConnections: []
  },
  'hierarchical': {
    name: 'Hierarchical',
    description: 'Strict hierarchy with no cross-domain communication',
    centralNode: 'agent-1',
    layers: [
      ['agent-1'],
      ['agent-2', 'agent-5', 'agent-10'],
      ['agent-3', 'agent-4', 'agent-6', 'agent-7', 'agent-8', 'agent-9', 'agent-11', 'agent-12'],
      ['agent-13', 'agent-14', 'agent-15']
    ],
    meshConnections: []
  },
  'centralized': {
    name: 'Centralized',
    description: 'All communication goes through queen coordinator',
    centralNode: 'agent-1',
    layers: [
      ['agent-1'],
      ['agent-2', 'agent-3', 'agent-4', 'agent-5', 'agent-6', 'agent-7', 'agent-8', 'agent-9', 'agent-10', 'agent-11', 'agent-12', 'agent-13', 'agent-14', 'agent-15']
    ],
    meshConnections: []
  }
};

export interface TopologyConfig {
  name: string;
  description: string;
  centralNode: string | null;
  layers: string[][];
  meshConnections: string[][];
}

export function getTopologyConfig(topology: TopologyType): TopologyConfig {
  return topologyConfigs[topology];
}
