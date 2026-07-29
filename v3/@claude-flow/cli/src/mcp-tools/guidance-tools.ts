/**
 * Guidance MCP Tools
 *
 * Helps the system navigate Ruflo's capabilities by providing structured
 * discovery of tools, commands, agents, skills, and recommended workflows.
 *
 * @module @claude-flow/cli/mcp-tools/guidance
 */

import { type MCPTool, getProjectCwd } from './types.js';
import { validateIdentifier, validateText } from './validate-input.js';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildCapabilityBrain,
  recommendCapabilities,
  type CapabilityToolMetadata,
} from './capability-brain.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
/**
 * Find the project root by looking for .claude/ directory.
 * Tries CWD first (most common), then walks up from the CLI package location.
 */
function findProjectRoot(): string {
  const cwd = getProjectCwd();
  let cwdIsCliPackage = false;
  const cwdManifest = join(cwd, 'package.json');
  if (existsSync(cwdManifest)) {
    try {
      const manifest = JSON.parse(readFileSync(cwdManifest, 'utf-8')) as { name?: string };
      cwdIsCliPackage = manifest.name === '@claude-flow/cli';
    } catch {
      // An invalid project manifest is not a reason to hide discoverable files.
    }
  }

  // User projects with a local .claude directory remain the primary root.
  // Exclude the CLI package's own shipped .claude assets during repository
  // development; otherwise ecosystem discovery silently stops at the package.
  if (!cwdIsCliPackage && existsSync(join(cwd, '.claude'))) {
    return cwd;
  }

  // Walk up to a Git/workspace root. Worktrees use a .git file, so existsSync
  // is intentionally used instead of requiring a directory.
  let dir = cwd;
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, '.git'))) return dir;
    if (!(cwdIsCliPackage && dir === cwd) && existsSync(join(dir, '.claude'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // Fallback: CWD
  return cwd;
}

const PROJECT_ROOT = findProjectRoot();

/**
 * Injected by mcp-client after every MCP tool has been registered. Keeping the
 * provider here avoids guidance importing the registry and creating a cycle.
 */
let liveToolProvider: () => readonly CapabilityToolMetadata[] = () => [];

export function configureGuidanceToolProvider(
  provider: () => readonly CapabilityToolMetadata[],
): void {
  liveToolProvider = provider;
}

function getCapabilityBrain() {
  return buildCapabilityBrain(liveToolProvider());
}

// ── Capability Catalog ──────────────────────────────────────

interface CapabilityArea {
  name: string;
  description: string;
  tools: string[];
  commands: string[];
  agents: string[];
  skills: string[];
  whenToUse: string;
}

const CAPABILITY_CATALOG: Record<string, CapabilityArea> = {
  'agent-management': {
    name: 'Agent Management',
    description: 'Spawn, manage, and monitor individual AI agents with lifecycle control. Use when native Bash / file tools are wrong because this MCP tool exposes Ruflo-specific state or controllers that have no shell equivalent. For tasks that fit a one-line native command, prefer that.',
    tools: ['agent_spawn', 'agent_list', 'agent_status', 'agent_stop', 'agent_metrics', 'agent_pool', 'agent_health', 'agent_logs'],
    commands: ['agent spawn', 'agent list', 'agent status', 'agent stop', 'agent metrics', 'agent pool', 'agent health', 'agent logs'],
    agents: ['coder', 'tester', 'reviewer', 'researcher', 'planner'],
    skills: [],
    whenToUse: 'When you need to create or manage individual agents for specific tasks.',
  },
  'swarm-orchestration': {
    name: 'Swarm Orchestration',
    description: 'Multi-agent coordination with topology-aware communication and consensus. Use when native Bash / file tools are wrong because this MCP tool exposes Ruflo-specific state or controllers that have no shell equivalent. For tasks that fit a one-line native command, prefer that.',
    tools: ['swarm_init', 'swarm_status', 'swarm_spawn', 'swarm_terminate', 'swarm_topology', 'swarm_metrics'],
    commands: ['swarm init', 'swarm status', 'swarm spawn', 'swarm terminate'],
    agents: ['hierarchical-coordinator', 'mesh-coordinator', 'adaptive-coordinator', 'queen-coordinator', 'collective-intelligence-coordinator'],
    skills: ['swarm-orchestration', 'swarm-advanced', 'claude-flow-swarm'],
    whenToUse: 'When a task requires multiple agents working together (3+ files, features, refactoring).',
  },
  'memory-knowledge': {
    name: 'Memory & Knowledge',
    description: 'Persistent memory with HNSW vector search, AgentDB storage, and embeddings. Use when native Bash / file tools are wrong because this MCP tool exposes Ruflo-specific state or controllers that have no shell equivalent. For tasks that fit a one-line native command, prefer that.',
    tools: ['memory_store', 'memory_retrieve', 'memory_search', 'memory_list', 'memory_delete', 'memory_init', 'memory_export', 'memory_import_claude', 'memory_stats', 'memory_compact', 'memory_namespace'],
    commands: ['memory store', 'memory retrieve', 'memory search', 'memory list', 'memory delete', 'memory init'],
    agents: ['swarm-memory-manager', 'v3-memory-specialist'],
    skills: ['v3-memory-unification', 'agentdb-advanced', 'agentdb-vector-search', 'agentdb-memory-patterns', 'agentdb-learning'],
    whenToUse: 'When you need to persist, search, or retrieve knowledge across sessions.',
  },
  'intelligence-learning': {
    name: 'Intelligence & Learning',
    description: 'Neural pattern training (SONA), RL loops, Flash Attention, EWC++ consolidation. Use when native Bash / file tools are wrong because this MCP tool exposes Ruflo-specific state or controllers that have no shell equivalent. For tasks that fit a one-line native command, prefer that.',
    tools: ['neural_train', 'neural_predict', 'neural_status', 'neural_patterns', 'neural_optimize'],
    commands: ['neural train', 'neural predict', 'neural status', 'neural patterns', 'neural optimize'],
    agents: ['sona-learning-optimizer', 'safla-neural'],
    skills: ['reasoningbank-intelligence', 'reasoningbank-agentdb'],
    whenToUse: 'When optimizing agent routing, training patterns from outcomes, or adaptive learning.',
  },
  'hooks-automation': {
    name: 'Hooks & Automation',
    description: '17 lifecycle hooks + 12 background workers for automated learning and coordination. Use when native Bash / file tools are wrong because this MCP tool exposes Ruflo-specific state or controllers that have no shell equivalent. For tasks that fit a one-line native command, prefer that.',
    tools: ['hooks_pre_task', 'hooks_post_task', 'hooks_pre_edit', 'hooks_post_edit', 'hooks_route', 'hooks_explain'],
    commands: [
      'hooks pre-task', 'hooks post-task', 'hooks pre-edit', 'hooks post-edit',
      'hooks session-start', 'hooks session-end', 'hooks route', 'hooks explain',
      'hooks pretrain', 'hooks build-agents', 'hooks intelligence', 'hooks worker',
      'hooks coverage-gaps', 'hooks coverage-route', 'hooks coverage-suggest',
      'hooks statusline', 'hooks progress',
    ],
    agents: [],
    skills: ['hooks-automation'],
    whenToUse: 'When you need pre/post task hooks, background workers, coverage routing, or intelligence.',
  },
  'hive-mind': {
    name: 'Hive Mind Consensus',
    description: 'Queen-led Byzantine fault-tolerant distributed consensus with multiple strategies. Use when native Bash / file tools are wrong because this MCP tool exposes Ruflo-specific state or controllers that have no shell equivalent. For tasks that fit a one-line native command, prefer that.',
    tools: ['hive_mind_init', 'hive_mind_status', 'hive_mind_propose', 'hive_mind_vote', 'hive_mind_consensus', 'hive_mind_metrics'],
    commands: ['hive-mind init', 'hive-mind status', 'hive-mind consensus', 'hive-mind sessions', 'hive-mind spawn', 'hive-mind stop'],
    agents: ['byzantine-coordinator', 'raft-manager', 'gossip-coordinator', 'crdt-synchronizer', 'quorum-manager'],
    skills: ['hive-mind-advanced'],
    whenToUse: 'When multiple agents need to reach agreement on decisions using BFT, Raft, or CRDT.',
  },
  'security': {
    name: 'Security & Compliance',
    description: 'Security scanning, CVE remediation, input validation, claims-based authorization. Use when native Bash / file tools are wrong because this MCP tool exposes Ruflo-specific state or controllers that have no shell equivalent. For tasks that fit a one-line native command, prefer that.',
    tools: ['security_scan', 'security_audit', 'security_cve', 'security_threats', 'security_validate', 'security_report', 'claims_check', 'claims_grant', 'claims_revoke', 'claims_list'],
    commands: ['security scan', 'security audit', 'security cve', 'security threats', 'claims check', 'claims grant'],
    agents: ['v3-security-architect'],
    skills: ['v3-security-overhaul'],
    whenToUse: 'When auditing code for vulnerabilities, managing permissions, or security reviews.',
  },
  'performance': {
    name: 'Performance & Profiling',
    description: 'Benchmarking, profiling, metrics collection, and optimization recommendations. Use when native Bash / file tools are wrong because this MCP tool exposes Ruflo-specific state or controllers that have no shell equivalent. For tasks that fit a one-line native command, prefer that.',
    tools: ['performance_benchmark', 'performance_profile', 'performance_metrics', 'performance_optimize', 'performance_report'],
    commands: ['performance benchmark', 'performance profile', 'performance metrics', 'performance optimize', 'performance report'],
    agents: ['v3-performance-engineer'],
    skills: ['v3-performance-optimization', 'performance-analysis'],
    whenToUse: 'When measuring, profiling, or optimizing system performance.',
  },
  'github-integration': {
    name: 'GitHub Integration',
    description: 'PR management, code review, issue tracking, release automation, multi-repo coordination. Use when native Bash / file tools are wrong because this MCP tool exposes Ruflo-specific state or controllers that have no shell equivalent. For tasks that fit a one-line native command, prefer that.',
    tools: ['github_pr_manage', 'github_code_review', 'github_issue_track', 'github_repo_analyze', 'github_sync_coord', 'github_metrics'],
    commands: [],
    agents: ['pr-manager', 'code-review-swarm', 'issue-tracker', 'release-manager', 'repo-architect', 'workflow-automation', 'multi-repo-swarm', 'project-board-sync', 'swarm-pr', 'swarm-issue', 'sync-coordinator', 'github-modes', 'release-swarm'],
    skills: ['github-release-management', 'github-workflow-automation', 'github-code-review', 'github-project-management', 'github-multi-repo'],
    whenToUse: 'When working with GitHub repos, PRs, issues, releases, or CI/CD pipelines.',
  },
  'session-workflow': {
    name: 'Session & Workflow',
    description: 'Session state management, workflow execution, task lifecycle, and daemon scheduling. Use when native Bash / file tools are wrong because this MCP tool exposes Ruflo-specific state or controllers that have no shell equivalent. For tasks that fit a one-line native command, prefer that.',
    tools: ['session_start', 'session_end', 'session_restore', 'session_list', 'workflow_execute', 'workflow_create', 'task_create', 'task_assign', 'task_status'],
    commands: ['session start', 'session end', 'session restore', 'workflow execute', 'workflow create', 'task create', 'daemon start', 'daemon stop'],
    agents: [],
    skills: [],
    whenToUse: 'When managing long-running sessions, executing workflow templates, or scheduling tasks.',
  },
  'embeddings-vectors': {
    name: 'Embeddings & Vector Search',
    description: 'Vector embeddings with sql.js, HNSW indexing, hyperbolic embeddings, ONNX integration. Use when native Bash / file tools are wrong because this MCP tool exposes Ruflo-specific state or controllers that have no shell equivalent. For tasks that fit a one-line native command, prefer that.',
    tools: ['embeddings_embed', 'embeddings_batch', 'embeddings_search', 'embeddings_init'],
    commands: ['embeddings embed', 'embeddings batch', 'embeddings search', 'embeddings init'],
    agents: [],
    skills: ['agentdb-vector-search', 'agentdb-optimization'],
    whenToUse: 'When you need semantic search, document embedding, or vector similarity operations.',
  },
  'wasm-agents': {
    name: 'WASM Sandboxed Agents',
    description: 'Sandboxed AI agents running in WebAssembly with virtual filesystem, no OS access. Use when native Bash / file tools are wrong because this MCP tool exposes Ruflo-specific state or controllers that have no shell equivalent. For tasks that fit a one-line native command, prefer that.',
    tools: ['wasm_agent_create', 'wasm_agent_prompt', 'wasm_agent_tool', 'wasm_agent_list', 'wasm_agent_terminate', 'wasm_agent_files', 'wasm_agent_export', 'wasm_gallery_list', 'wasm_gallery_search', 'wasm_gallery_create'],
    commands: [],
    agents: [],
    skills: [],
    whenToUse: 'When you need sandboxed agent execution without OS access (safe, isolated environments).',
  },
  'ruvllm-inference': {
    name: 'RuVLLM Inference',
    description: 'WASM-based HNSW routing, SONA instant adaptation, MicroLoRA, chat formatting. Use when native Bash / file tools are wrong because this MCP tool exposes Ruflo-specific state or controllers that have no shell equivalent. For tasks that fit a one-line native command, prefer that.',
    tools: ['ruvllm_status', 'ruvllm_hnsw_create', 'ruvllm_sona_create', 'ruvllm_microlora_create', 'ruvllm_chat_format', 'ruvllm_kvcache_create'],
    commands: [],
    agents: [],
    skills: [],
    whenToUse: 'When you need WASM-native HNSW routing, SONA adaptation, or MicroLoRA fine-tuning.',
  },
  'code-analysis': {
    name: 'Code Analysis & Diff',
    description: 'AST analysis, diff classification, coverage routing, dependency graph analysis. Use when native Bash / file tools are wrong because this MCP tool exposes Ruflo-specific state or controllers that have no shell equivalent. For tasks that fit a one-line native command, prefer that.',
    tools: ['analyze_diff', 'analyze_coverage', 'analyze_graph'],
    commands: [],
    agents: ['code-analyzer'],
    skills: ['verification-quality'],
    whenToUse: 'When analyzing code quality, diffs, coverage gaps, or dependency graphs.',
  },
  'sparc-methodology': {
    name: 'SPARC Methodology',
    description: 'Specification, Pseudocode, Architecture, Refinement, Completion — structured development. Use when native Bash / file tools are wrong because this MCP tool exposes Ruflo-specific state or controllers that have no shell equivalent. For tasks that fit a one-line native command, prefer that.',
    tools: [],
    commands: [],
    agents: ['specification', 'pseudocode', 'architecture', 'refinement'],
    skills: ['sparc-methodology'],
    whenToUse: 'When following structured SPARC development methodology for new features.',
  },
  'config-system': {
    name: 'Configuration & System',
    description: 'Configuration management, provider setup, system diagnostics, shell completions. Use when native Bash / file tools are wrong because this MCP tool exposes Ruflo-specific state or controllers that have no shell equivalent. For tasks that fit a one-line native command, prefer that.',
    tools: ['config_get', 'config_set', 'config_list', 'config_provider'],
    commands: ['config get', 'config set', 'config list', 'config provider', 'doctor', 'status', 'providers list', 'completions'],
    agents: [],
    skills: [],
    whenToUse: 'When managing configuration, providers, or running diagnostics.',
  },
};

// ── Task-to-Capability Routing ──────────────────────────────

interface TaskRoute {
  pattern: RegExp;
  areas: string[];
  workflow: string;
}

const TASK_ROUTES: TaskRoute[] = [
  { pattern: /\b(bug|fix|debug|error|issue|crash|broken)\b/i, areas: ['agent-management', 'hooks-automation'], workflow: 'bugfix' },
  { pattern: /\b(feature|implement|create|build|add)\b/i, areas: ['swarm-orchestration', 'agent-management', 'hooks-automation'], workflow: 'feature' },
  { pattern: /\b(refactor|restructure|reorganize|clean\s*up|modernize)\b/i, areas: ['swarm-orchestration', 'code-analysis'], workflow: 'refactor' },
  { pattern: /\b(test|coverage|tdd|spec|assert)\b/i, areas: ['agent-management', 'hooks-automation', 'code-analysis'], workflow: 'testing' },
  { pattern: /\b(security|vulnerab|cve|audit|threat|auth)\b/i, areas: ['security'], workflow: 'security' },
  { pattern: /\b(perf|benchmark|profil|slow|optimi|latency|speed)\b/i, areas: ['performance'], workflow: 'performance' },
  { pattern: /\b(memory|embed|vector|search|hnsw|semantic)\b/i, areas: ['memory-knowledge', 'embeddings-vectors'], workflow: 'memory' },
  { pattern: /\b(pr|pull\s*request|review|merge|branch)\b/i, areas: ['github-integration'], workflow: 'github-pr' },
  { pattern: /\b(release|deploy|publish|version|changelog)\b/i, areas: ['github-integration', 'session-workflow'], workflow: 'release' },
  { pattern: /\b(swarm|multi.agent|coordin|hive|consensus)\b/i, areas: ['swarm-orchestration', 'hive-mind'], workflow: 'swarm' },
  { pattern: /\b(learn|train|neural|pattern|sona|lora)\b/i, areas: ['intelligence-learning'], workflow: 'learning' },
  { pattern: /\b(wasm|sandbox|isolated|gallery)\b/i, areas: ['wasm-agents', 'ruvllm-inference'], workflow: 'wasm' },
  { pattern: /\b(hook|pre.task|post.task|worker|daemon)\b/i, areas: ['hooks-automation', 'session-workflow'], workflow: 'automation' },
  { pattern: /\b(config|setup|init|provider|doctor)\b/i, areas: ['config-system'], workflow: 'setup' },
];

const WORKFLOW_TEMPLATES: Record<string, { steps: string[]; agents: string[]; topology: string }> = {
  bugfix: {
    steps: ['Research the bug (hooks route)', 'Reproduce with tests', 'Fix the code', 'Verify fix passes', 'Record outcome (hooks post-task)'],
    agents: ['researcher', 'coder', 'tester'],
    topology: 'hierarchical',
  },
  feature: {
    steps: ['Design architecture', 'Implement solution', 'Write tests', 'Review code', 'Record patterns (hooks post-task)'],
    agents: ['planner', 'coder', 'tester', 'reviewer'],
    topology: 'hierarchical',
  },
  refactor: {
    steps: ['Analyze code structure', 'Plan refactor approach', 'Implement changes', 'Verify no regressions'],
    agents: ['code-analyzer', 'coder', 'reviewer'],
    topology: 'hierarchical',
  },
  testing: {
    steps: ['Analyze coverage gaps', 'Generate test plan', 'Write tests', 'Verify coverage improvement'],
    agents: ['tester', 'coder'],
    topology: 'hierarchical',
  },
  security: {
    steps: ['Run security scan', 'Triage findings', 'Fix vulnerabilities', 'Verify remediations'],
    agents: ['v3-security-architect', 'coder', 'reviewer'],
    topology: 'hierarchical',
  },
  performance: {
    steps: ['Run benchmarks', 'Profile bottlenecks', 'Implement optimizations', 'Re-benchmark'],
    agents: ['v3-performance-engineer', 'coder'],
    topology: 'hierarchical',
  },
  memory: {
    steps: ['Initialize memory store', 'Store/retrieve patterns', 'Search with HNSW', 'Compact and optimize'],
    agents: ['v3-memory-specialist'],
    topology: 'hierarchical',
  },
  'github-pr': {
    steps: ['Analyze changes', 'Run code review swarm', 'Check CI status', 'Merge or request changes'],
    agents: ['pr-manager', 'code-review-swarm', 'reviewer'],
    topology: 'hierarchical',
  },
  release: {
    steps: ['Verify all tests pass', 'Generate changelog', 'Bump version', 'Publish packages', 'Create GitHub release'],
    agents: ['release-manager', 'tester'],
    topology: 'hierarchical',
  },
  swarm: {
    steps: ['Initialize swarm topology', 'Spawn specialized agents', 'Coordinate via memory', 'Collect and synthesize results'],
    agents: ['hierarchical-coordinator', 'coder', 'tester', 'reviewer'],
    topology: 'hierarchical',
  },
  learning: {
    steps: ['Pretrain on codebase', 'Record trajectories', 'Compute rewards', 'Distill learning', 'Consolidate (EWC++)'],
    agents: ['sona-learning-optimizer'],
    topology: 'hierarchical',
  },
  wasm: {
    steps: ['Check WASM availability', 'Create sandboxed agent', 'Execute tools in sandbox', 'Export results'],
    agents: [],
    topology: 'hierarchical',
  },
  automation: {
    steps: ['List available hooks/workers', 'Configure hook handlers', 'Dispatch workers', 'Monitor outcomes'],
    agents: [],
    topology: 'hierarchical',
  },
  setup: {
    steps: ['Run doctor diagnostics', 'Configure providers', 'Initialize memory', 'Start daemon'],
    agents: [],
    topology: 'hierarchical',
  },
};

// ── Dynamic Discovery ───────────────────────────────────────

function discoverAgents(): string[] {
  const agents: string[] = [];
  function walk(dir: string) {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          walk(join(dir, entry.name));
        } else if (entry.name.endsWith('.md') && entry.name !== 'MIGRATION_SUMMARY.md') {
          const content = readFileSync(join(dir, entry.name), 'utf-8');
          const nameMatch = content.match(/^name:\s*(.+)$/m);
          if (nameMatch) agents.push(nameMatch[1].trim().replace(/^["']|["']$/g, ''));
        }
      }
    } catch { /* ignore */ }
  }
  const roots = [
    join(PROJECT_ROOT, '.claude/agents'),
    join(PROJECT_ROOT, '.agents/agents'),
  ];
  const pluginsDir = join(PROJECT_ROOT, 'plugins');
  if (existsSync(pluginsDir)) {
    for (const entry of readdirSync(pluginsDir, { withFileTypes: true })) {
      if (entry.isDirectory()) roots.push(join(pluginsDir, entry.name, 'agents'));
    }
  }
  for (const root of roots) {
    if (existsSync(root)) walk(root);
  }
  return [...new Set(agents)].sort();
}

function discoverSkills(): string[] {
  const skills: string[] = [];
  function walk(dir: string) {
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const target = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(target);
        } else if (entry.name === 'SKILL.md') {
          const content = readFileSync(target, 'utf-8');
          const nameMatch = content.match(/^name:\s*(.+)$/m);
          skills.push(
            nameMatch
              ? nameMatch[1]!.trim().replace(/^["']|["']$/g, '')
              : relative(PROJECT_ROOT, dirname(target)),
          );
        }
      }
    } catch {
      // Missing or unreadable optional capability roots are reported by absence.
    }
  }

  const roots = [
    join(PROJECT_ROOT, '.claude/skills'),
    join(PROJECT_ROOT, '.agents/skills'),
  ];
  const pluginsDir = join(PROJECT_ROOT, 'plugins');
  if (existsSync(pluginsDir)) {
    for (const entry of readdirSync(pluginsDir, { withFileTypes: true })) {
      if (entry.isDirectory()) roots.push(join(pluginsDir, entry.name, 'skills'));
    }
  }
  for (const root of roots) {
    if (existsSync(root)) walk(root);
  }
  return [...new Set(skills)].sort();
}

function discoverPlugins(): Array<Record<string, unknown>> {
  const pluginsDir = join(PROJECT_ROOT, 'plugins');
  if (!existsSync(pluginsDir)) return [];
  const plugins: Array<Record<string, unknown>> = [];
  for (const entry of readdirSync(pluginsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = join(pluginsDir, entry.name, '.claude-plugin', 'plugin.json');
    if (!existsSync(manifestPath)) continue;
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>;
      plugins.push({
        id: entry.name,
        name: manifest.name ?? entry.name,
        version: manifest.version ?? 'unknown',
        description: manifest.description ?? '',
        manifest: relative(PROJECT_ROOT, manifestPath),
      });
    } catch {
      plugins.push({
        id: entry.name,
        name: entry.name,
        version: 'unknown',
        manifest: relative(PROJECT_ROOT, manifestPath),
        invalidManifest: true,
      });
    }
  }
  return plugins.sort((left, right) => String(left.id).localeCompare(String(right.id), 'en-US'));
}

function discoverPackages(): Array<Record<string, unknown>> {
  const packagesDir = join(PROJECT_ROOT, 'v3', '@claude-flow');
  if (!existsSync(packagesDir)) return [];
  const packages: Array<Record<string, unknown>> = [];
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = join(packagesDir, entry.name, 'package.json');
    if (!existsSync(manifestPath)) continue;
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>;
      packages.push({
        name: manifest.name ?? entry.name,
        version: manifest.version ?? 'unknown',
        description: manifest.description ?? '',
        manifest: relative(PROJECT_ROOT, manifestPath),
      });
    } catch {
      packages.push({
        name: entry.name,
        version: 'unknown',
        manifest: relative(PROJECT_ROOT, manifestPath),
        invalidManifest: true,
      });
    }
  }
  return packages.sort((left, right) => String(left.name).localeCompare(String(right.name), 'en-US'));
}

// ── MCP Tool Definitions ────────────────────────────────────

const guidanceCapabilities: MCPTool = {
  name: 'guidance_capabilities',
  description: 'List all capability areas with their tools, commands, agents, and skills. Use this to discover what Ruflo can do. Use when generic "what tool should I use?" guessing is wrong — Ruflo\'s guidance system uses the live tool index + your workflow context to recommend. Pair with hooks_route at task start. For trivial native-only tasks, no guidance call is needed.',
  inputSchema: {
    type: 'object',
    properties: {
      area: {
        type: 'string',
        description: 'Filter to a specific area (e.g., "swarm-orchestration", "memory-knowledge"). Omit to list all areas.',
      },
      format: {
        type: 'string',
        enum: ['summary', 'detailed'],
        description: 'Output format. "summary" lists names and descriptions, "detailed" includes tools/agents/skills.',
      },
    },
  },
  handler: async (params: Record<string, unknown>) => {
    const area = params.area as string | undefined;
    const format = (params.format as string) || 'summary';
    const brain = getCapabilityBrain();

    if (area) { const v = validateIdentifier(area, 'area'); if (!v.valid) return { content: [{ type: 'text', text: JSON.stringify({ error: v.error }, null, 2) }], isError: true }; }

    if (area) {
      const cap = CAPABILITY_CATALOG[area];
      const brainDomain = brain.domains.find((domain) => domain.id === area);
      if (!cap && !brainDomain) {
        const available = [
          ...Object.keys(CAPABILITY_CATALOG),
          ...brain.domains.map((domain) => domain.id),
        ].filter((value, index, all) => all.indexOf(value) === index).join(', ');
        return { content: [{ type: 'text', text: JSON.stringify({ error: `Unknown area: ${area}`, available }, null, 2) }], isError: true };
      }
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            ...(cap ?? {}),
            legacyCatalogStatus: cap ? 'compatibility-only; tool names may be deprecated aliases' : undefined,
            legacyToolResolution: cap ? cap.tools.map((name) => ({
              name,
              registered: brain.domains.some((entry) => entry.tools.some((tool) => tool.name === name)),
            })) : undefined,
            capabilityBrain: brainDomain,
          }, null, 2),
        }],
      };
    }

    if (format === 'detailed') {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            legacyCatalog: {
              status: 'compatibility-only; use capabilityBrain for live routing',
              areas: CAPABILITY_CATALOG,
            },
            capabilityBrain: brain,
          }, null, 2),
        }],
      };
    }

    const summary = Object.entries(CAPABILITY_CATALOG).map(([key, val]) => ({
      area: key,
      name: val.name,
      description: val.description,
      toolCount: val.tools.length,
      agentCount: val.agents.length,
      skillCount: val.skills.length,
      whenToUse: val.whenToUse,
    }));

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          areas: summary,
          totalAreas: summary.length,
          live: {
            schemaVersion: brain.schemaVersion,
            registeredToolCount: brain.coverage.registeredToolCount,
            classifiedToolCount: brain.coverage.classifiedToolCount,
            coveragePercent: brain.coverage.coveragePercent,
            fallbackClassifiedTools: brain.coverage.fallbackClassifiedTools,
            domains: brain.domains.map((domain) => ({
              id: domain.id,
              name: domain.name,
              registeredToolCount: domain.tools.length,
              health: domain.health,
              authority: domain.authority,
              risk: domain.risk,
            })),
          },
        }, null, 2),
      }],
    };
  },
};

const guidanceRecommend: MCPTool = {
  name: 'guidance_recommend',
  description: 'Given a task description, recommend which capability areas, tools, agents, and workflow to use. Use when generic "what tool should I use?" guessing is wrong — Ruflo\'s guidance system uses the live tool index + your workflow context to recommend. Pair with hooks_route at task start. For trivial native-only tasks, no guidance call is needed.',
  inputSchema: {
    type: 'object',
    properties: {
      task: {
        type: 'string',
        description: 'Description of what you want to accomplish.',
      },
    },
    required: ['task'],
  },
  handler: async (params: Record<string, unknown>) => {
    const task = params.task as string;

    { const v = validateText(task, 'task'); if (!v.valid) return { content: [{ type: 'text', text: JSON.stringify({ error: v.error }, null, 2) }], isError: true }; }
    const brain = getCapabilityBrain();
    const capabilityRecommendation = recommendCapabilities(brain, task);

    const matches: Array<{ area: string; capability: CapabilityArea; workflow: string; score: number }> = [];

    for (const route of TASK_ROUTES) {
      if (route.pattern.test(task)) {
        for (const areaKey of route.areas) {
          const cap = CAPABILITY_CATALOG[areaKey];
          if (cap) {
            matches.push({ area: areaKey, capability: cap, workflow: route.workflow, score: 1 });
          }
        }
      }
    }

    // Deduplicate by area, keeping highest score
    const seen = new Map<string, (typeof matches)[0]>();
    for (const m of matches) {
      const existing = seen.get(m.area);
      if (!existing || m.score > existing.score) {
        seen.set(m.area, m);
      }
    }

    const recommendations = [...seen.values()];

    if (recommendations.length === 0) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            task,
            message: 'No specific pattern matched. Here are general-purpose capabilities:',
            suggestions: [
              { area: 'agent-management', reason: 'Spawn individual agents for targeted work' },
              { area: 'swarm-orchestration', reason: 'Use swarms for multi-file or complex tasks' },
              { area: 'hooks-automation', reason: 'Use hooks for task routing and learning' },
            ],
            tip: 'Use guidance_capabilities for a full list of all capability areas.',
            capabilityBrain: capabilityRecommendation,
          }, null, 2),
        }],
      };
    }

    const primaryWorkflow = recommendations[0]?.workflow;
    const template = primaryWorkflow ? WORKFLOW_TEMPLATES[primaryWorkflow] : undefined;
    const liveToolNames = new Set(
      brain.domains.flatMap((domain) => domain.tools.map((tool) => tool.name)),
    );

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          task,
          recommendations: recommendations.map(r => ({
            area: r.area,
            name: r.capability.name,
            description: r.capability.description,
            tools: r.capability.tools.filter((name) => liveToolNames.has(name)),
            unregisteredLegacyToolRefs: r.capability.tools.filter((name) => !liveToolNames.has(name)),
            agents: r.capability.agents,
            skills: r.capability.skills,
          })),
          workflow: template ? {
            name: primaryWorkflow,
            steps: template.steps,
            agents: template.agents,
            topology: template.topology,
          } : undefined,
          capabilityBrain: capabilityRecommendation,
        }, null, 2),
      }],
    };
  },
};

const guidanceDiscover: MCPTool = {
  name: 'guidance_discover',
  description: 'Discover all available agents and skills from the .claude/ directory. Returns live filesystem data. Use when generic "what tool should I use?" guessing is wrong — Ruflo\'s guidance system uses the live tool index + your workflow context to recommend. Pair with hooks_route at task start. For trivial native-only tasks, no guidance call is needed.',
  inputSchema: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['agents', 'skills', 'plugins', 'packages', 'all'],
        description: 'What to discover. Default: all.',
      },
    },
  },
  handler: async (params: Record<string, unknown>) => {
    const type = (params.type as string) || 'all';

    const result: Record<string, unknown> = {};

    if (type === 'agents' || type === 'all') {
      const agents = discoverAgents();
      result.agents = { count: agents.length, names: agents };
    }

    if (type === 'skills' || type === 'all') {
      const skills = discoverSkills();
      result.skills = { count: skills.length, names: skills };
    }

    if (type === 'plugins' || type === 'all') {
      const plugins = discoverPlugins();
      result.plugins = { count: plugins.length, entries: plugins };
    }

    if (type === 'packages' || type === 'all') {
      const packages = discoverPackages();
      result.packages = { count: packages.length, entries: packages };
    }

    result.capabilityBrain = {
      registeredTools: getCapabilityBrain().coverage.registeredToolCount,
      note: 'Filesystem discovery reports installed artifacts; it does not prove configuration, health, or authorization.',
    };

    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
};

const guidanceWorkflow: MCPTool = {
  name: 'guidance_workflow',
  description: 'Get a recommended workflow template for a task type. Includes steps, agents, and topology. Use when generic "what tool should I use?" guessing is wrong — Ruflo\'s guidance system uses the live tool index + your workflow context to recommend. Pair with hooks_route at task start. For trivial native-only tasks, no guidance call is needed.',
  inputSchema: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: Object.keys(WORKFLOW_TEMPLATES),
        description: 'Workflow type. Options: ' + Object.keys(WORKFLOW_TEMPLATES).join(', '),
      },
    },
    required: ['type'],
  },
  handler: async (params: Record<string, unknown>) => {
    const type = params.type as string;

    { const v = validateIdentifier(type, 'type'); if (!v.valid) return { content: [{ type: 'text', text: JSON.stringify({ error: v.error }, null, 2) }], isError: true }; }

    const template = WORKFLOW_TEMPLATES[type];

    if (!template) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: `Unknown workflow: ${type}`,
            available: Object.keys(WORKFLOW_TEMPLATES),
          }, null, 2),
        }],
        isError: true,
      };
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          workflow: type,
          ...template,
          swarmConfig: {
            topology: template.topology,
            maxAgents: Math.max(template.agents.length + 1, 4),
            strategy: 'specialized',
            consensus: 'raft',
          },
        }, null, 2),
      }],
    };
  },
};

const guidanceQuickRef: MCPTool = {
  name: 'guidance_quickref',
  description: 'Quick reference card for common operations. Returns the most useful commands for a given domain. Use when generic "what tool should I use?" guessing is wrong — Ruflo\'s guidance system uses the live tool index + your workflow context to recommend. Pair with hooks_route at task start. For trivial native-only tasks, no guidance call is needed.',
  inputSchema: {
    type: 'object',
    properties: {
      domain: {
        type: 'string',
        enum: ['getting-started', 'daily-dev', 'swarm-ops', 'memory-ops', 'github-ops', 'diagnostics'],
        description: 'Domain to get quick reference for.',
      },
    },
    required: ['domain'],
  },
  handler: async (params: Record<string, unknown>) => {
    const domain = params.domain as string;

    { const v = validateIdentifier(domain, 'domain'); if (!v.valid) return { content: [{ type: 'text', text: JSON.stringify({ error: v.error }, null, 2) }], isError: true }; }

    const refs: Record<string, { title: string; commands: Array<{ cmd: string; desc: string }> }> = {
      'getting-started': {
        title: 'Getting Started',
        commands: [
          { cmd: 'npx ruflo@latest init --wizard', desc: 'Initialize project with interactive setup' },
          { cmd: 'npx ruflo@latest doctor --fix', desc: 'Run diagnostics and auto-fix issues' },
          { cmd: 'npx ruflo@latest daemon start', desc: 'Start background workers' },
          { cmd: 'npx ruflo@latest status', desc: 'Check system status' },
        ],
      },
      'daily-dev': {
        title: 'Daily Development',
        commands: [
          { cmd: 'npx ruflo@latest hooks pre-task --description "..."', desc: 'Get routing recommendation before task' },
          { cmd: 'npx ruflo@latest hooks post-task --task-id "..." --success true', desc: 'Record task outcome for learning' },
          { cmd: 'npx ruflo@latest hooks post-edit --file "..." --train-neural true', desc: 'Train patterns from edits' },
          { cmd: 'npx ruflo@latest memory search --query "..."', desc: 'Search memory for relevant patterns' },
          { cmd: 'npx ruflo@latest hooks route --task "..."', desc: 'Route task to optimal agent' },
        ],
      },
      'swarm-ops': {
        title: 'Swarm Operations',
        commands: [
          { cmd: 'npx ruflo@latest swarm init --topology hierarchical --max-agents 8', desc: 'Initialize anti-drift swarm' },
          { cmd: 'npx ruflo@latest swarm status', desc: 'Check swarm status' },
          { cmd: 'npx ruflo@latest agent spawn -t coder --name my-coder', desc: 'Spawn a specific agent' },
          { cmd: 'npx ruflo@latest hive-mind init --strategy byzantine', desc: 'Start hive-mind consensus' },
        ],
      },
      'memory-ops': {
        title: 'Memory Operations',
        commands: [
          { cmd: 'npx ruflo@latest memory init --force', desc: 'Initialize memory database' },
          { cmd: 'npx ruflo@latest memory store --key "k" --value "v" --namespace patterns', desc: 'Store a value' },
          { cmd: 'npx ruflo@latest memory search --query "auth patterns"', desc: 'Semantic vector search' },
          { cmd: 'npx ruflo@latest memory list --namespace patterns', desc: 'List entries in namespace' },
          { cmd: 'npx ruflo@latest memory retrieve --key "k" --namespace patterns', desc: 'Get a specific entry' },
        ],
      },
      'github-ops': {
        title: 'GitHub Operations',
        commands: [
          { cmd: 'Use pr-manager agent for PR lifecycle', desc: 'Spawn pr-manager for automated PR management' },
          { cmd: 'Use code-review-swarm agent for reviews', desc: 'Deploy multi-agent code review' },
          { cmd: 'Use release-manager agent for releases', desc: 'Automated release with changelog' },
          { cmd: 'Use issue-tracker agent for triage', desc: 'Intelligent issue management' },
        ],
      },
      diagnostics: {
        title: 'Diagnostics & Troubleshooting',
        commands: [
          { cmd: 'npx ruflo@latest doctor --fix', desc: 'Full system diagnostics with auto-fix' },
          { cmd: 'npx ruflo@latest status --watch', desc: 'Live system monitoring' },
          { cmd: 'npx ruflo@latest hooks worker status', desc: 'Background worker health' },
          { cmd: 'npx ruflo@latest performance benchmark --suite all', desc: 'Run all benchmarks' },
          { cmd: 'npx ruflo@latest hooks progress --detailed', desc: 'V3 implementation progress' },
        ],
      },
    };

    const ref = refs[domain];
    if (!ref) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: `Unknown domain: ${domain}`, available: Object.keys(refs) }, null, 2) }], isError: true };
    }

    return { content: [{ type: 'text', text: JSON.stringify(ref, null, 2) }] };
  },
};

const guidanceBrain: MCPTool = {
  name: 'guidance_brain',
  description: 'Use when choosing how to execute a task with Ruflo. Queries the live capability brain, covers every registered MCP tool, separates registration from configuration/reachability/health/authorization, recommends capabilities, and returns the validated implementation loop.',
  inputSchema: {
    type: 'object',
    properties: {
      mode: {
        type: 'string',
        enum: ['overview', 'capabilities', 'coverage', 'ecosystem', 'recommend', 'implementation-loop'],
        description: 'Brain view. Default: overview.',
      },
      task: {
        type: 'string',
        description: 'Required for recommend mode.',
      },
      domain: {
        type: 'string',
        description: 'Optional capability domain filter for capabilities mode.',
      },
    },
  },
  handler: async (params: Record<string, unknown>) => {
    const mode = (params.mode as string | undefined) ?? 'overview';
    const task = params.task as string | undefined;
    const domain = params.domain as string | undefined;
    const brain = getCapabilityBrain();

    if (domain) {
      const validation = validateIdentifier(domain, 'domain');
      if (!validation.valid) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: validation.error }, null, 2) }],
          isError: true,
        };
      }
    }

    let result: unknown;
    switch (mode) {
      case 'overview':
        result = {
          schemaVersion: brain.schemaVersion,
          generatedAt: brain.generatedAt,
          truthModel: brain.truthModel,
          coverage: brain.coverage,
          domainCount: brain.domains.length,
          cliCommandCount: brain.cliCommands.length,
          cliCommands: brain.cliCommands,
          registeredDomains: brain.domains
            .filter((entry) => entry.health.registered)
            .map((entry) => ({
              id: entry.id,
              name: entry.name,
              toolCount: entry.tools.length,
              maturity: entry.maturity,
              authority: entry.authority,
              risk: entry.risk,
              health: entry.health,
            })),
          implementationLoop: brain.implementationLoop.map((step) => step.id),
        };
        break;
      case 'capabilities': {
        const capabilities = domain
          ? brain.domains.filter((entry) => entry.id === domain)
          : brain.domains;
        if (domain && capabilities.length === 0) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                error: `Unknown capability domain: ${domain}`,
                available: brain.domains.map((entry) => entry.id),
              }, null, 2),
            }],
            isError: true,
          };
        }
        result = { schemaVersion: brain.schemaVersion, truthModel: brain.truthModel, capabilities };
        break;
      }
      case 'coverage':
        result = {
          schemaVersion: brain.schemaVersion,
          coverage: brain.coverage,
          assignments: brain.domains.map((entry) => ({
            domain: entry.id,
            tools: entry.tools.map((tool) => tool.name),
          })),
        };
        break;
      case 'ecosystem': {
        const agents = discoverAgents();
        const skills = discoverSkills();
        const plugins = discoverPlugins();
        const packages = discoverPackages();
        result = {
          schemaVersion: brain.schemaVersion,
          agents: { count: agents.length, names: agents },
          skills: { count: skills.length, names: skills },
          plugins: { count: plugins.length, entries: plugins },
          packages: { count: packages.length, entries: packages },
          cliCommands: { count: brain.cliCommands.length, names: brain.cliCommands },
          availabilityNote: 'Installed or catalogued artifacts are not necessarily configured, reachable, healthy, or authorized.',
        };
        break;
      }
      case 'recommend': {
        const validation = validateText(task, 'task');
        if (!validation.valid) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: validation.error }, null, 2) }],
            isError: true,
          };
        }
        result = recommendCapabilities(brain, task!);
        break;
      }
      case 'implementation-loop':
        result = {
          schemaVersion: brain.schemaVersion,
          steps: brain.implementationLoop,
          invariants: [
            'Recall precedes implementation.',
            'Testing and validation precede optimization.',
            'Benchmarks compare a source-bound candidate with a source-bound baseline.',
            'Learning and optimization cannot authorize promotion.',
            'Publishing requires separate authorization and immutable artifact evidence.',
          ],
        };
        break;
      default:
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              error: `Unknown mode: ${mode}`,
              available: ['overview', 'capabilities', 'coverage', 'ecosystem', 'recommend', 'implementation-loop'],
            }, null, 2),
          }],
          isError: true,
        };
    }

    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
};

/**
 * All guidance tools
 */
export const guidanceTools: MCPTool[] = [
  guidanceBrain,
  guidanceCapabilities,
  guidanceRecommend,
  guidanceDiscover,
  guidanceWorkflow,
  guidanceQuickRef,
];

export default guidanceTools;
