/**
 * Seraphine Genesis Model
 * The first Claude Flow pattern model - "Hello World" for pattern sharing
 *
 * Seraphine represents the foundational patterns for intelligent agent coordination.
 * Named after the Greek "Seraphim" (burning ones), symbolizing the spark of knowledge
 * that ignites collaborative AI intelligence.
 */

import type {
  CFPFormat,
  PatternCollection,
  RoutingPattern,
  ComplexityPattern,
  CoveragePattern,
  TrajectoryPattern,
  CustomPattern,
} from '../types.js';
import { createCFP } from '../serialization/cfp.js';

/**
 * Seraphine model version
 */
export const SERAPHINE_VERSION = '1.0.0';

/**
 * Seraphine model metadata
 */
export const SERAPHINE_METADATA = {
  name: 'seraphine-genesis',
  displayName: 'Seraphine Genesis',
  description: 'The foundational Claude Flow pattern model. Contains core routing patterns, complexity heuristics, and coordination trajectories for multi-agent swarms.',
  author: {
    id: 'claude-flow-team',
    displayName: 'Claude Flow Team',
  },
  license: 'MIT',
  tags: [
    'genesis',
    'foundational',
    'routing',
    'swarm',
    'coordination',
    'multi-agent',
    'hello-world',
  ],
  language: 'typescript',
  framework: 'claude-flow',
};

/**
 * Core routing patterns for Seraphine
 * These define how tasks are routed to appropriate agents
 */
export const SERAPHINE_ROUTING_PATTERNS: RoutingPattern[] = [
  {
    id: 'route-code-to-coder',
    trigger: 'implement|code|write|create function|build feature',
    action: 'spawn coder agent',
    confidence: 0.95,
    usageCount: 1000,
    successRate: 0.92,
    context: {
      category: 'development',
      priority: 'high',
    },
  },
  {
    id: 'route-test-to-tester',
    trigger: 'test|validate|verify|check|ensure quality',
    action: 'spawn tester agent',
    confidence: 0.93,
    usageCount: 850,
    successRate: 0.89,
    context: {
      category: 'quality',
      priority: 'high',
    },
  },
  {
    id: 'route-review-to-reviewer',
    trigger: 'review|audit|analyze code|check security',
    action: 'spawn reviewer agent',
    confidence: 0.91,
    usageCount: 720,
    successRate: 0.87,
    context: {
      category: 'quality',
      priority: 'medium',
    },
  },
  {
    id: 'route-research-to-researcher',
    trigger: 'research|investigate|explore|find|search codebase',
    action: 'spawn researcher agent',
    confidence: 0.94,
    usageCount: 680,
    successRate: 0.91,
    context: {
      category: 'discovery',
      priority: 'medium',
    },
  },
  {
    id: 'route-architecture-to-architect',
    trigger: 'design|architect|plan structure|refactor system',
    action: 'spawn architect agent',
    confidence: 0.88,
    usageCount: 420,
    successRate: 0.85,
    context: {
      category: 'design',
      priority: 'high',
    },
  },
  {
    id: 'route-complex-to-swarm',
    trigger: 'complex task|multi-file|feature implementation|major refactor',
    action: 'initialize hierarchical swarm',
    confidence: 0.87,
    usageCount: 350,
    successRate: 0.82,
    context: {
      category: 'coordination',
      priority: 'critical',
      agentCount: 5,
    },
  },
  {
    id: 'route-security-to-auditor',
    trigger: 'security|vulnerability|CVE|threat|penetration',
    action: 'spawn security-architect agent',
    confidence: 0.96,
    usageCount: 280,
    successRate: 0.94,
    context: {
      category: 'security',
      priority: 'critical',
    },
  },
  {
    id: 'route-performance-to-optimizer',
    trigger: 'optimize|performance|speed|memory|benchmark',
    action: 'spawn performance-engineer agent',
    confidence: 0.89,
    usageCount: 310,
    successRate: 0.86,
    context: {
      category: 'optimization',
      priority: 'high',
    },
  },
];

/**
 * Complexity heuristics for Seraphine
 * These help estimate task complexity for resource allocation
 */
export const SERAPHINE_COMPLEXITY_PATTERNS: ComplexityPattern[] = [
  {
    id: 'complexity-single-file',
    pattern: 'single file modification',
    complexity: 1,
    tokens: 500,
    frequency: 0.45,
  },
  {
    id: 'complexity-multi-file',
    pattern: 'multiple file changes (2-5 files)',
    complexity: 3,
    tokens: 2000,
    frequency: 0.35,
  },
  {
    id: 'complexity-feature',
    pattern: 'new feature implementation',
    complexity: 5,
    tokens: 5000,
    frequency: 0.12,
  },
  {
    id: 'complexity-refactor',
    pattern: 'system-wide refactoring',
    complexity: 8,
    tokens: 10000,
    frequency: 0.05,
  },
  {
    id: 'complexity-migration',
    pattern: 'major version migration',
    complexity: 10,
    tokens: 20000,
    frequency: 0.03,
  },
];

/**
 * Coverage patterns for Seraphine
 * These track knowledge domain coverage
 */
export const SERAPHINE_COVERAGE_PATTERNS: CoveragePattern[] = [
  {
    id: 'coverage-typescript',
    domain: 'TypeScript Development',
    coverage: 0.92,
    gaps: ['advanced generics', 'decorators'],
  },
  {
    id: 'coverage-testing',
    domain: 'Testing & QA',
    coverage: 0.88,
    gaps: ['e2e testing', 'visual regression'],
  },
  {
    id: 'coverage-security',
    domain: 'Security Analysis',
    coverage: 0.85,
    gaps: ['supply chain', 'zero-day detection'],
  },
  {
    id: 'coverage-swarm',
    domain: 'Multi-Agent Coordination',
    coverage: 0.90,
    gaps: ['byzantine consensus', 'network partitions'],
  },
];

/**
 * Trajectory patterns for Seraphine
 * These capture successful task execution paths
 */
export const SERAPHINE_TRAJECTORY_PATTERNS: TrajectoryPattern[] = [
  {
    id: 'traj-bug-fix',
    steps: [
      'research: identify bug location',
      'coder: implement fix',
      'tester: write regression test',
      'reviewer: verify fix quality',
    ],
    outcome: 'success',
    duration: 1800000, // 30 minutes
    learnings: [
      'Always add regression test for bug fixes',
      'Review similar code for same bug pattern',
    ],
  },
  {
    id: 'traj-feature-impl',
    steps: [
      'architect: design feature structure',
      'researcher: analyze existing patterns',
      'coder: implement feature',
      'tester: write comprehensive tests',
      'reviewer: security and quality review',
      'coder: address review feedback',
    ],
    outcome: 'success',
    duration: 7200000, // 2 hours
    learnings: [
      'Design before implementation reduces rework',
      'Parallel testing accelerates delivery',
    ],
  },
  {
    id: 'traj-refactor',
    steps: [
      'researcher: map affected code',
      'architect: plan refactoring strategy',
      'tester: ensure test coverage exists',
      'coder: incremental refactoring',
      'tester: verify no regressions',
      'reviewer: architectural review',
    ],
    outcome: 'success',
    duration: 10800000, // 3 hours
    learnings: [
      'Test coverage before refactoring is critical',
      'Small incremental changes are safer',
    ],
  },
  {
    id: 'traj-security-audit',
    steps: [
      'security-architect: threat modeling',
      'researcher: dependency analysis',
      'security-auditor: code scanning',
      'coder: remediation',
      'security-architect: verification',
    ],
    outcome: 'success',
    duration: 14400000, // 4 hours
    learnings: [
      'Automated scanning catches common issues',
      'Manual review needed for logic flaws',
    ],
  },
];

/**
 * Custom patterns for Seraphine
 * These are specialized patterns unique to Seraphine
 */
export const SERAPHINE_CUSTOM_PATTERNS: CustomPattern[] = [
  {
    id: 'custom-swarm-topology',
    type: 'topology-recommendation',
    data: {
      taskType: 'feature-implementation',
      recommendedTopology: 'hierarchical',
      agentRoles: ['coordinator', 'architect', 'coder', 'tester', 'reviewer'],
      communicationPattern: 'hub-spoke',
    },
    metadata: {
      confidence: 0.89,
      source: 'production-data',
    },
  },
  {
    id: 'custom-memory-strategy',
    type: 'memory-optimization',
    data: {
      pattern: 'vector-search-first',
      hnswParams: { m: 16, efConstruction: 200 },
      cacheStrategy: 'lru-with-embedding',
    },
    metadata: {
      speedup: '150x',
      memoryReduction: '60%',
    },
  },
  {
    id: 'custom-hello-world',
    type: 'greeting',
    data: {
      message: 'Hello, World! Welcome to Claude Flow pattern sharing.',
      version: SERAPHINE_VERSION,
      genesis: true,
    },
    metadata: {
      significance: 'First pattern ever exported via transfer hook system',
      timestamp: new Date().toISOString(),
    },
  },
];

/**
 * Create the complete Seraphine pattern collection
 */
export function createSeraphinePatterns(): PatternCollection {
  return {
    routing: SERAPHINE_ROUTING_PATTERNS,
    complexity: SERAPHINE_COMPLEXITY_PATTERNS,
    coverage: SERAPHINE_COVERAGE_PATTERNS,
    trajectory: SERAPHINE_TRAJECTORY_PATTERNS,
    custom: SERAPHINE_CUSTOM_PATTERNS,
  };
}

/**
 * Create the Seraphine Genesis CFP document
 */
export function createSeraphineGenesis(): CFPFormat {
  return createCFP({
    name: SERAPHINE_METADATA.name,
    description: SERAPHINE_METADATA.description,
    patterns: createSeraphinePatterns(),
    author: SERAPHINE_METADATA.author,
    license: SERAPHINE_METADATA.license,
    tags: SERAPHINE_METADATA.tags,
    language: SERAPHINE_METADATA.language,
    framework: SERAPHINE_METADATA.framework,
  });
}

/**
 * Get Seraphine model info
 */
export function getSeraphineInfo(): {
  name: string;
  version: string;
  description: string;
  patternCounts: Record<string, number>;
} {
  return {
    name: SERAPHINE_METADATA.displayName,
    version: SERAPHINE_VERSION,
    description: SERAPHINE_METADATA.description,
    patternCounts: {
      routing: SERAPHINE_ROUTING_PATTERNS.length,
      complexity: SERAPHINE_COMPLEXITY_PATTERNS.length,
      coverage: SERAPHINE_COVERAGE_PATTERNS.length,
      trajectory: SERAPHINE_TRAJECTORY_PATTERNS.length,
      custom: SERAPHINE_CUSTOM_PATTERNS.length,
    },
  };
}
