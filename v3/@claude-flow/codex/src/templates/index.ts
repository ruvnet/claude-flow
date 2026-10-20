/**
 * @claude-flow/codex - Templates
 *
 * Built-in templates and skill definitions
 */

import type { AgentsMdTemplate, BuiltInSkill } from '../types.js';

/**
 * Built-in skill definitions
 */
export const BUILT_IN_SKILLS: Record<BuiltInSkill, { name: string; description: string; category: string }> = {
  'swarm-orchestration': {
    name: 'Swarm Orchestration',
    description: 'Multi-agent task coordination',
    category: 'coordination',
  },
  'memory-management': {
    name: 'Memory Management',
    description: 'Pattern storage and retrieval',
    category: 'memory',
  },
  'sparc-methodology': {
    name: 'SPARC Methodology',
    description: 'Structured development workflow',
    category: 'workflow',
  },
  'security-audit': {
    name: 'Security Audit',
    description: 'Security scanning and CVE detection',
    category: 'security',
  },
  'performance-analysis': {
    name: 'Performance Analysis',
    description: 'Profiling and optimization',
    category: 'performance',
  },
  'github-automation': {
    name: 'GitHub Automation',
    description: 'CI/CD and PR management',
    category: 'automation',
  },
  'agent-teams': {
    name: 'Agent Teams',
    description: 'Host-agnostic agent teams on the Ruflo team bus',
    category: 'coordination',
  },
};

/**
 * Template descriptions
 */
export const TEMPLATES: Record<AgentsMdTemplate, { name: string; description: string; skillCount: number }> = {
  minimal: {
    name: 'Minimal',
    description: 'Basic setup with essential skills only',
    skillCount: 3,
  },
  default: {
    name: 'Default',
    description: 'Standard setup with common skills',
    skillCount: 5,
  },
  full: {
    name: 'Full',
    description: 'Complete setup with all 137+ skills',
    skillCount: 137,
  },
  enterprise: {
    name: 'Enterprise',
    description: 'Full setup with all skills + governance',
    skillCount: 137,
  },
};

/**
 * Get template information
 */
export function getTemplate(name: AgentsMdTemplate): typeof TEMPLATES[AgentsMdTemplate] {
  return TEMPLATES[name];
}

/**
 * List all available templates
 */
export function listTemplates(): Array<{ name: AgentsMdTemplate; description: string; skillCount: number }> {
  return Object.entries(TEMPLATES).map(([name, info]) => ({
    name: name as AgentsMdTemplate,
    description: info.description,
    skillCount: info.skillCount,
  }));
}

/**
 * All available skills (137+ skills including agent skills)
 * Copied from .agents/skills/ during init
 */
export const ALL_AVAILABLE_SKILLS: string[] = [
  // Core skills
  'swarm-orchestration',
  'memory-management',
  'sparc-methodology',
  'security-audit',
  'performance-analysis',
  'github-automation',
  'agent-teams',
  // Advanced skills
  'agent-coordination',
  'agentdb-advanced',
  'agentdb-learning',
  'agentdb-memory-patterns',
  'agentdb-optimization',
  'agentdb-vector-search',
  'agentic-jujutsu',
  'claims',
  'embeddings',
  'flow-nexus-neural',
  'flow-nexus-platform',
  'flow-nexus-swarm',
  'github-code-review',
  'github-multi-repo',
  'github-project-management',
  'github-release-management',
  'github-workflow-automation',
  'hive-mind',
  'hive-mind-advanced',
  'hooks-automation',
  'neural-training',
  'pair-programming',
  'reasoningbank-agentdb',
  'reasoningbank-intelligence',
  'skill-builder',
  'stream-chain',
  'swarm-advanced',
  'v3-cli-modernization',
  'v3-core-implementation',
  'v3-ddd-architecture',
  'v3-integration-deep',
  'v3-mcp-optimization',
  'v3-memory-unification',
  'v3-performance-optimization',
  'v3-security-overhaul',
  'v3-swarm-coordination',
  'verification-quality',
  'worker-benchmarks',
  'worker-integration',
  'workflow-automation',
  // Agent skills (converted from Claude Code agents)
  'agent-payments',
  'agent-challenges',
  'agent-sandbox',
  'agent-app-store',
  'agent-user-tools',
  'agent-neural-network',
  'agent-swarm',
  'agent-workflow',
  'agent-authentication',
  'agent-docs-api-openapi',
  'agent-spec-mobile-react-native',
  'agent-v3-security-architect',
  'agent-v3-memory-specialist',
  'agent-v3-queen-coordinator',
  'agent-v3-integration-architect',
  'agent-v3-performance-engineer',
  'agent-coordinator-swarm-init',
  'agent-memory-coordinator',
  'agent-automation-smart-agent',
  'agent-github-pr-manager',
  'agent-implementer-sparc-coder',
  'agent-sparc-coordinator',
  'agent-migration-plan',
  'agent-performance-analyzer',
  'agent-orchestrator-task',
  'agent-arch-system-design',
  'agent-crdt-synchronizer',
  'agent-quorum-manager',
  'agent-performance-benchmarker',
  'agent-security-manager',
  'agent-raft-manager',
  'agent-gossip-coordinator',
  'agent-byzantine-coordinator',
  'agent-test-long-runner',
  'agent-queen-coordinator',
  'agent-swarm-memory-manager',
  'agent-worker-specialist',
  'agent-collective-intelligence-coordinator',
  'agent-scout-explorer',
  'agent-code-analyzer',
  'agent-analyze-code-quality',
  'agent-dev-backend-api',
  'agent-base-template-generator',
  'agent-agentic-payments',
  'agent-pseudocode',
  'agent-refinement',
  'agent-specification',
  'agent-architecture',
  'agent-pagerank-analyzer',
  'agent-consensus-coordinator',
  'agent-trading-predictor',
  'agent-performance-optimizer',
  'agent-matrix-optimizer',
  'agent-code-goal-planner',
  'agent-goal-planner',
  'agent-sublinear-goal-planner',
  'agent-sona-learning-optimizer',
  'agent-ml-developer',
  'agent-tester',
  'agent-coder',
  'agent-reviewer',
  'agent-researcher',
  'agent-planner',
];

/**
 * Default skills per template
 */
export const DEFAULT_SKILLS_BY_TEMPLATE: Record<AgentsMdTemplate, string[]> = {
  minimal: ['swarm-orchestration', 'memory-management', 'agent-teams'],
  default: ['swarm-orchestration', 'memory-management', 'sparc-methodology', 'security-audit', 'agent-teams'],
  full: ALL_AVAILABLE_SKILLS,
  enterprise: ALL_AVAILABLE_SKILLS,
};

/**
 * Directory structure template
 */
export const DIRECTORY_STRUCTURE = {
  root: {
    'AGENTS.md': 'Main project instructions',
  },
  '.agents': {
    'config.toml': 'Project-level Codex config',
    'skills/': 'Skill definitions',
  },
  '.codex': {
    'config.toml': 'User-local overrides (gitignored)',
    'AGENTS.override.md': 'Local instruction overrides',
  },
  '.claude-flow': {
    'config.yaml': 'Runtime configuration',
    'data/': 'Memory and cache data',
    'logs/': 'Log files',
  },
};

/**
 * Feature mapping between Claude Code and Codex
 */
export const PLATFORM_MAPPING = {
  claudeCode: {
    configFile: 'CLAUDE.md',
    localConfig: 'CLAUDE.local.md',
    settingsFormat: 'JSON (settings.json)',
    skillInvocation: '/skill-name',
    approvalLevels: 3,
  },
  codex: {
    configFile: 'AGENTS.md',
    localConfig: '.codex/AGENTS.override.md',
    settingsFormat: 'TOML (config.toml)',
    skillInvocation: '$skill-name',
    approvalLevels: 4,
  },
};

/**
 * Gitignore entries for Codex projects
 */
export const GITIGNORE_ENTRIES = [
  '# Codex local configuration',
  '.codex/',
  '',
  '# Claude Flow runtime data',
  '.claude-flow/data/',
  '.claude-flow/logs/',
  '',
  '# Environment variables',
  '.env',
  '.env.local',
  '.env.*.local',
];

/**
 * Default AGENTS.override.md content
 */
export const AGENTS_OVERRIDE_TEMPLATE = `# Local Development Overrides

## Environment
- Development mode: full-auto
- Sandbox: workspace-write
- Web search: live

## Personal Preferences
[Add your specific preferences here]

## Debug Settings
Enable verbose logging for development.

## Notes
This file is gitignored and contains local-only settings.
`;
