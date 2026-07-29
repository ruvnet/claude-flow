/**
 * Ruflo capability brain.
 *
 * This module is deliberately data-only: it describes the complete MCP surface
 * without importing the MCP registry. The registry injects its live tool list
 * into guidance-tools after registration, which avoids a circular dependency
 * and prevents documentation from being mistaken for runtime availability.
 */

export type CapabilityMaturity = 'stable' | 'experimental' | 'compatibility';
export type CapabilityAuthority = 'advisory' | 'capability-plane' | 'control-plane';
export type CapabilityRisk = 'read-only' | 'reversible' | 'privileged';
export type AvailabilityState = boolean | 'unknown';
export type CapabilityRiskFlag =
  | 'read'
  | 'local-write'
  | 'memory-poisoning'
  | 'process-exec'
  | 'network'
  | 'credential-pii'
  | 'spend'
  | 'concurrency'
  | 'destructive'
  | 'approval'
  | 'promotion';

export interface CapabilityToolMetadata {
  name: string;
  description?: string;
  category?: string;
  tags?: string[];
  version?: string;
}

export interface CapabilityHealth {
  /** Present in this running MCP server's registry. */
  registered: boolean;
  /** Requires an operator/provider configuration check. */
  configured: AvailabilityState;
  /** Requires a non-mutating dependency probe. */
  reachable: AvailabilityState;
  /** Requires a service-specific health check. */
  healthy: AvailabilityState;
  /** Requires a policy evaluation for the current subject and action. */
  authorized: AvailabilityState;
}

export interface CapabilityDomainDefinition {
  id: string;
  name: string;
  description: string;
  prefixes: string[];
  exactTools?: string[];
  taskSignals: string[];
  commands: string[];
  skills: string[];
  agents: string[];
  maturity: CapabilityMaturity;
  authority: CapabilityAuthority;
  risk: CapabilityRisk;
  optionalRuntime?: boolean;
  packageOwners?: string[];
  pluginOwners?: string[];
  availabilityMode?: 'always-local' | 'conditional-registration' | 'registered-degraded' | 'configured-remote' | 'policy-filtered';
  /**
   * Conservative union of effects possible anywhere in this domain.
   * Individual tool descriptors may narrow or expand this reviewed profile.
   */
  riskFlags?: CapabilityRiskFlag[];
  loopPhases?: Array<'discover' | 'recall' | 'authorize-claim' | 'route-plan' | 'branch-propose' | 'execute' | 'validate-critique' | 'commit-validated' | 'observe' | 'publish'>;
  useWhen: string;
  verifyBeforeUse: string[];
}

export interface CapabilityDomain extends CapabilityDomainDefinition {
  packageOwners: string[];
  pluginOwners: string[];
  availabilityMode: NonNullable<CapabilityDomainDefinition['availabilityMode']>;
  riskFlags: NonNullable<CapabilityDomainDefinition['riskFlags']>;
  loopPhases: NonNullable<CapabilityDomainDefinition['loopPhases']>;
  tools: Array<CapabilityToolMetadata & {
    domain: string;
    packageOwner: string;
    pluginOwner?: string;
    availabilityMode: NonNullable<CapabilityDomainDefinition['availabilityMode']>;
    authority: CapabilityAuthority;
    risk: CapabilityRisk;
    riskFlags: NonNullable<CapabilityDomainDefinition['riskFlags']>;
    loopPhases: NonNullable<CapabilityDomainDefinition['loopPhases']>;
  }>;
  health: CapabilityHealth;
}

export interface CapabilityBrain {
  schemaVersion: 'ruflo.capability-brain/v1';
  generatedAt: string;
  truthModel: {
    catalogued: string;
    registered: string;
    configured: string;
    reachable: string;
    healthy: string;
    authorized: string;
  };
  domains: CapabilityDomain[];
  cliCommands: string[];
  implementationLoop: ImplementationLoopStep[];
  coverage: {
    registeredToolCount: number;
    classifiedToolCount: number;
    coveragePercent: number;
    fallbackClassifiedTools: string[];
    duplicateToolNames: string[];
  };
}

/** Top-level commands from the CLI command loader. Kept as a checked manifest. */
export const RUFLO_CLI_COMMANDS = [
  'init', 'start', 'status', 'task', 'session', 'agent', 'swarm', 'memory',
  'mcp', 'config', 'migrate', 'hooks', 'workflow', 'hive-mind', 'process',
  'daemon', 'version', 'neural', 'security', 'performance', 'providers',
  'plugins', 'deployment', 'claims', 'policy', 'embeddings', 'completions',
  'doctor', 'verify', 'analyze', 'route', 'progress', 'issues', 'update',
  'ruvector', 'benchmark', 'guidance', 'appliance', 'appliance-advanced',
  'transfer-store', 'cleanup', 'autopilot', 'gaia-bench', 'metaharness',
  'eject', 'funnel', 'settings', 'auth', 'proxy', 'advisor', 'spinner',
  'announcements',
] as const;

export interface ImplementationLoopStep {
  id: string;
  name: string;
  purpose: string;
  preferredTools: string[];
  requiredEvidence: string;
  mutation: 'none' | 'workspace' | 'external';
}

export const IMPLEMENTATION_LOOP: readonly ImplementationLoopStep[] = [
  {
    id: 'recall',
    name: 'Recall',
    purpose: 'Search Ruflo memory and relevant ADRs before choosing an approach.',
    preferredTools: ['memory_search', 'guidance_brain', 'guidance_recommend'],
    requiredEvidence: 'Relevant patterns and constraints, or an explicit no-match result.',
    mutation: 'none',
  },
  {
    id: 'inspect',
    name: 'Inspect',
    purpose: 'Read repository, runtime, dependency, policy, and health state.',
    preferredTools: ['analyze_project', 'system_status', 'policy_status', 'security_scan'],
    requiredEvidence: 'Observed source/runtime state with unknowns kept explicit.',
    mutation: 'none',
  },
  {
    id: 'route',
    name: 'Route',
    purpose: 'Select the smallest capable topology, agents, skills, and tools.',
    preferredTools: ['hooks_route', 'guidance_recommend', 'swarm_init'],
    requiredEvidence: 'Chosen route, ownership boundaries, and fallback behavior.',
    mutation: 'none',
  },
  {
    id: 'plan',
    name: 'Plan',
    purpose: 'Define acceptance criteria, safety envelope, leases, and validation.',
    preferredTools: ['task_create', 'workflow_create', 'claims_check'],
    requiredEvidence: 'Testable acceptance criteria and authorization boundary.',
    mutation: 'none',
  },
  {
    id: 'execute',
    name: 'Execute',
    purpose: 'Have the coding agent perform the actual scoped implementation.',
    preferredTools: ['agent_spawn', 'task_assign', 'terminal_execute'],
    requiredEvidence: 'Exact source-state change and implementation log.',
    mutation: 'workspace',
  },
  {
    id: 'test',
    name: 'Test',
    purpose: 'Run focused and regression tests, including failure paths.',
    preferredTools: ['terminal_execute', 'hooks_coverage-gaps', 'analyze_code'],
    requiredEvidence: 'Test command, result, environment, and failures.',
    mutation: 'workspace',
  },
  {
    id: 'validate',
    name: 'Validate',
    purpose: 'Check types, security, policy, compatibility, and artifact integrity.',
    preferredTools: ['security_audit', 'policy_evaluate', 'metaharness_threat-model'],
    requiredEvidence: 'Independent validation results bound to source state.',
    mutation: 'none',
  },
  {
    id: 'benchmark',
    name: 'Benchmark',
    purpose: 'Measure representative workload behavior against a baseline.',
    preferredTools: ['performance_benchmark', 'metaharness_score'],
    requiredEvidence: 'Reproducible baseline, candidate measurement, and environment.',
    mutation: 'none',
  },
  {
    id: 'optimize',
    name: 'Optimize',
    purpose: 'Improve only measured bottlenecks without weakening the safety envelope.',
    preferredTools: ['performance_profile', 'neural_optimize'],
    requiredEvidence: 'Measured improvement and unchanged correctness/security gates.',
    mutation: 'workspace',
  },
  {
    id: 'receipt',
    name: 'Receipt',
    purpose: 'Bind claims, tests, benchmarks, and decisions to exact source/build evidence.',
    preferredTools: ['claims_validate', 'memory_store'],
    requiredEvidence: 'Content-bound receipt with evidence strength stated honestly.',
    mutation: 'workspace',
  },
  {
    id: 'handoff',
    name: 'Handoff',
    purpose: 'Reconcile concurrent work and communicate remaining risks.',
    preferredTools: ['session_handoff', 'task_status', 'swarm_status'],
    requiredEvidence: 'Ownership reconciliation and explicit unresolved limitations.',
    mutation: 'none',
  },
  {
    id: 'publish',
    name: 'Publish',
    purpose: 'Publish only after an authorized release gate approves exact artifacts.',
    preferredTools: ['github_pr_create', 'github_release_create'],
    requiredEvidence: 'Human/policy authorization, clean source, immutable artifact digests, and green gates.',
    mutation: 'external',
  },
] as const;

/**
 * Domain order is significant: narrow/specialized matches precede broad
 * compatibility prefixes. Every registered tool is eventually classified by
 * the final runtime-services domain, but fallback classifications are reported.
 */
export const CAPABILITY_DOMAINS: readonly CapabilityDomainDefinition[] = [
  {
    id: 'guidance',
    name: 'Capability Guidance',
    prefixes: ['guidance_'],
    description: 'Live capability inventory, task routing, workflow guidance, and system discovery.',
    taskSignals: ['guidance', 'discover', 'capability', 'what can ruflo do'],
    commands: ['guidance compile', 'guidance retrieve', 'guidance gates', 'guidance optimize'],
    skills: [],
    agents: [],
    maturity: 'stable',
    authority: 'advisory',
    risk: 'read-only',
    useWhen: 'Choosing Ruflo capabilities or checking whether a claimed MCP function is actually registered.',
    verifyBeforeUse: ['Treat configured, reachable, healthy, and authorized as unknown until probed.'],
  },
  {
    id: 'identity-auth',
    name: 'Cognitum Identity & OAuth',
    prefixes: ['auth_', 'oauth_'],
    description: 'Profile-aware PKCE/OOB authentication, credential status, consent-bound scopes, refresh, and local logout.',
    taskSignals: ['auth', 'oauth', 'login', 'logout', 'credential', 'profile', 'scope', 'consent'],
    commands: ['auth login', 'auth login --no-browser', 'auth status', 'auth status --check', 'auth logout'],
    skills: ['security-audit'],
    agents: ['authentication', 'security-architect'],
    maturity: 'experimental',
    authority: 'control-plane',
    risk: 'privileged',
    availabilityMode: 'configured-remote',
    riskFlags: ['read', 'local-write', 'network', 'credential-pii', 'approval'],
    loopPhases: ['discover', 'authorize-claim', 'observe'],
    useWhen: 'A Cognitum-backed capability needs an explicit user identity and consent-bound scope.',
    verifyBeforeUse: [
      'Use PKCE on interactive desktops and the implemented OOB/manual flow for headless use; RFC 8628 device polling is not implemented.',
      'Noninteractive login fails closed unless --token-stdin is explicit.',
      'Plain auth status is offline-safe; --check may refresh through the OS keychain.',
      'Local logout cannot currently prove server-side token revocation.',
    ],
  },
  {
    id: 'policy-authorization',
    name: 'Policy Authorization',
    prefixes: ['policy_'],
    description: 'Policy-decision evaluation and status for exact subject/action/resource requests.',
    taskSignals: ['policy', 'authorization', 'permission', 'capability', 'access control'],
    commands: ['policy evaluate', 'policy status', 'guidance gates'],
    skills: ['claims', 'security-audit', 'v3-security-overhaul'],
    agents: ['security-architect', 'reviewer'],
    maturity: 'experimental',
    authority: 'control-plane',
    risk: 'privileged',
    availabilityMode: 'policy-filtered',
    riskFlags: ['approval'],
    loopPhases: ['authorize-claim', 'validate-critique', 'publish'],
    useWhen: 'Determining whether a principal may perform an exact action on an exact resource.',
    verifyBeforeUse: ['Confirm subject, action, resource, tenant, policy version, and freshness.', 'Remote MCP exposes evaluation/status only; administration remains local and authenticated.'],
  },
  {
    id: 'work-claims',
    name: 'Exclusive Work Claims',
    prefixes: ['claims_'],
    description: 'Repository/task ownership claims, handoffs, contention, stealing, and rebalance.',
    taskSignals: ['work claim', 'claim task', 'handoff', 'ownership', 'concurrent work', 'rebalance'],
    commands: ['claims claim', 'claims handoff', 'claims status'],
    skills: ['claims'],
    agents: ['coordinator'],
    maturity: 'experimental',
    authority: 'capability-plane',
    risk: 'privileged',
    riskFlags: ['concurrency', 'local-write'],
    loopPhases: ['authorize-claim', 'route-plan', 'observe'],
    useWhen: 'Coordinating exclusive repository or task ownership among concurrent workers.',
    verifyBeforeUse: ['A work claim prevents collisions; it does not grant product, network, or release authority.', 'Validate repository, path scope, owner, epoch, and expiry.'],
  },
  {
    id: 'content-safety',
    name: 'AIDefence Content Safety',
    prefixes: ['aidefence_', 'security_'],
    description: 'Prompt/content safety, PII detection, learning, and security evidence.',
    taskSignals: ['security', 'content safety', 'pii', 'prompt injection', 'threat', 'audit'],
    commands: ['security scan'],
    skills: ['security-audit', 'v3-security-overhaul'],
    agents: ['security-architect', 'reviewer'],
    maturity: 'experimental',
    authority: 'advisory',
    risk: 'read-only',
    riskFlags: ['read', 'credential-pii'],
    loopPhases: ['validate-critique', 'observe'],
    useWhen: 'Scanning untrusted content or collecting security evidence.',
    verifyBeforeUse: ['A score is evidence, not authorization.', 'Do not persist detected credentials or PII.'],
  },
  {
    id: 'metaharness-flywheel',
    name: 'MetaHarness, Darwin & Flywheel',
    prefixes: ['metaharness_', 'autopilot_'],
    description: 'Candidate scoring, static analysis, threat modeling, genome exploration, and controlled improvement loops.',
    taskSignals: ['metaharness', 'darwin', 'flywheel', 'genome', 'optimize', 'autopilot'],
    commands: ['metaharness score', 'metaharness genome', 'autopilot run'],
    skills: ['metaharness-brain', 'performance-analysis'],
    agents: ['performance-engineer', 'reviewer'],
    maturity: 'experimental',
    authority: 'capability-plane',
    risk: 'reversible',
    optionalRuntime: true,
    riskFlags: ['local-write', 'process-exec', 'network', 'spend', 'promotion'],
    loopPhases: ['branch-propose', 'validate-critique', 'observe'],
    useWhen: 'Exploring or evaluating candidate improvements under a separate promotion authority.',
    verifyBeforeUse: ['Darwin proposes; the Ruflo promotion gate decides.', 'Degraded/fallback runs are evaluation-only unless policy explicitly permits promotion.'],
  },
  {
    id: 'memory-knowledge',
    name: 'Memory, AgentDB & Embeddings',
    prefixes: ['memory_', 'agentdb_', 'embeddings_'],
    description: 'Persistent memory, semantic/vector retrieval, namespaces, embeddings, and AgentDB controllers.',
    taskSignals: ['memory', 'agentdb', 'vector', 'embedding', 'semantic', 'recall'],
    commands: ['memory search', 'memory store', 'memory retrieve'],
    skills: ['memory-management', 'agentdb-advanced', 'agentdb-vector-search'],
    agents: ['memory-specialist'],
    maturity: 'stable',
    authority: 'capability-plane',
    risk: 'reversible',
    optionalRuntime: true,
    riskFlags: ['read', 'local-write', 'memory-poisoning'],
    useWhen: 'Recalling prior patterns or storing validated, content-bound learning.',
    verifyBeforeUse: ['Memory recall is evidence, not authority.', 'Only commit validated learning; do not auto-promote policy.'],
  },
  {
    id: 'memory-branching',
    name: 'Copy-on-Write & Speculative Memory',
    prefixes: ['agenticow_'],
    description: 'Low-cost memory branching, checkpoint, rollback, comparison, and validated promotion.',
    taskSignals: ['branch memory', 'checkpoint', 'rollback', 'speculative'],
    commands: [],
    skills: ['agentdb-learning'],
    agents: [],
    maturity: 'experimental',
    authority: 'capability-plane',
    risk: 'privileged',
    optionalRuntime: true,
    riskFlags: ['local-write', 'memory-poisoning', 'promotion'],
    useWhen: 'Testing alternative memories or strategies without mutating the active lineage.',
    verifyBeforeUse: ['Promotion requires a validated receipt and separate authority.'],
  },
  {
    id: 'agents-runtimes',
    name: 'Agent Lifecycle & Runtimes',
    prefixes: ['agent_', 'managed_agent_', 'wasm_agent_', 'wasm_gallery_', 'ruvllm_'],
    description: 'Local agents, managed cloud agents, WASM sandboxes, and inference runtimes.',
    taskSignals: ['agent', 'worker', 'wasm', 'sandbox', 'inference', 'managed agent'],
    commands: ['agent spawn', 'agent status', 'agent stop'],
    skills: ['agent-coder', 'agent-tester', 'agent-reviewer'],
    agents: ['coder', 'tester', 'reviewer'],
    maturity: 'stable',
    authority: 'capability-plane',
    risk: 'privileged',
    optionalRuntime: true,
    riskFlags: ['local-write', 'process-exec', 'network', 'credential-pii', 'spend', 'destructive'],
    useWhen: 'Assigning bounded work to an agent runtime after ownership is clear.',
    verifyBeforeUse: ['A spawned agent is not proof of execution.', 'Check runtime availability, provider credentials, spend limits, network policy, and collect exact outputs.'],
  },
  {
    id: 'swarm-coordination',
    name: 'Swarm & Coordination',
    prefixes: ['swarm_', 'coordination_', 'daa_'],
    description: 'Topology-aware multi-agent coordination, task ownership, and collective scheduling.',
    taskSignals: ['swarm', 'concurrent', 'parallel', 'coordinate', 'multi-agent'],
    commands: ['swarm init', 'swarm status', 'swarm coordinate'],
    skills: ['swarm-orchestration', 'swarm-advanced'],
    agents: ['coordinator', 'coder', 'tester', 'reviewer'],
    maturity: 'stable',
    authority: 'capability-plane',
    risk: 'reversible',
    useWhen: 'A task has multiple independent workstreams or more than two files.',
    verifyBeforeUse: ['Use repository-scoped ownership and reconcile before merge.', 'Coordination records do not execute code.'],
  },
  {
    id: 'consensus-federation',
    name: 'Hive Mind & Consensus',
    prefixes: ['hive_', 'hive-mind_', 'consensus_', 'quorum_'],
    description: 'Hive, quorum, voting, gossip, and distributed agreement primitives.',
    taskSignals: ['hive', 'consensus', 'quorum', 'byzantine', 'federation'],
    commands: ['hive-mind init', 'hive-mind status'],
    skills: ['hive-mind', 'hive-mind-advanced'],
    agents: ['byzantine-coordinator', 'raft-manager'],
    maturity: 'experimental',
    authority: 'capability-plane',
    risk: 'privileged',
    useWhen: 'Multiple principals must agree while preserving an external authorization boundary.',
    verifyBeforeUse: ['Consensus is not authorization.', 'Authenticate membership and bind decisions to policy.'],
  },
  {
    id: 'tasks-workflows-sessions',
    name: 'Tasks, Workflows, Sessions & Progress',
    prefixes: ['task_', 'workflow_', 'session_', 'progress_'],
    description: 'Task orchestration, reusable workflows, session state, progress, and handoff.',
    taskSignals: ['task', 'workflow', 'session', 'handoff', 'progress'],
    commands: ['task create', 'task status', 'workflow run'],
    skills: ['workflow-automation'],
    agents: ['workflow', 'planner'],
    maturity: 'stable',
    authority: 'capability-plane',
    risk: 'reversible',
    useWhen: 'Tracking multi-step work or handing execution between agents/sessions.',
    verifyBeforeUse: ['Persist exact source/run identity rather than relying on prose status.'],
  },
  {
    id: 'hooks-learning-routing',
    name: 'Hooks, Coverage & Learning Routing',
    prefixes: ['hooks_', 'coverage_'],
    description: 'Lifecycle hooks, coverage-aware routing, background workers, and validated pattern capture.',
    taskSignals: ['hook', 'coverage', 'route', 'worker', 'learning'],
    commands: ['hooks pre-task', 'hooks post-task', 'hooks route', 'hooks coverage-gaps'],
    skills: ['hooks-automation'],
    agents: [],
    maturity: 'stable',
    authority: 'capability-plane',
    risk: 'reversible',
    riskFlags: ['local-write', 'memory-poisoning', 'concurrency'],
    useWhen: 'Routing work, measuring coverage, or recording validated outcomes.',
    verifyBeforeUse: ['Hooks advise and record; Codex or another executor performs the work.'],
  },
  {
    id: 'analysis-quality',
    name: 'Analysis & Quality',
    prefixes: ['analyze_', 'analysis_'],
    description: 'Code/project analysis, quality assessment, and change inspection.',
    taskSignals: ['analyze', 'review', 'quality', 'dependency'],
    commands: ['analyze code', 'analyze project'],
    skills: ['verification-quality'],
    agents: ['code-analyzer', 'reviewer'],
    maturity: 'stable',
    authority: 'advisory',
    risk: 'read-only',
    useWhen: 'Understanding a codebase or validating change impact.',
    verifyBeforeUse: ['Bind conclusions to the inspected source state.'],
  },
  {
    id: 'test-generation',
    name: 'TDD Test Generation',
    prefixes: ['testgen_'],
    description: 'TDD repair and test-generation capability exported by Ruflo but intentionally reported as unregistered until the MCP registry enables it.',
    exactTools: ['testgen_tdd_repair'],
    taskSignals: ['generate tests', 'tdd repair', 'test generation'],
    commands: [],
    skills: ['verification-quality'],
    agents: ['tester'],
    maturity: 'experimental',
    authority: 'capability-plane',
    risk: 'reversible',
    availabilityMode: 'registered-degraded',
    riskFlags: ['local-write'],
    loopPhases: ['execute', 'validate-critique'],
    useWhen: 'Generating or repairing tests once the testgen tool is explicitly registered.',
    verifyBeforeUse: ['Catalogued does not mean registered; check live health.registered.', 'Generated tests still require review and execution.'],
  },
  {
    id: 'performance-neural',
    name: 'Performance & Neural Optimization',
    prefixes: ['performance_', 'neural_'],
    description: 'Profiling, benchmarks, learned routing, pattern training, and optimization.',
    taskSignals: ['performance', 'benchmark', 'profile', 'latency', 'neural', 'train'],
    commands: ['performance benchmark', 'performance profile', 'neural train'],
    skills: ['performance-analysis', 'neural-training'],
    agents: ['performance-engineer'],
    maturity: 'experimental',
    authority: 'capability-plane',
    risk: 'privileged',
    optionalRuntime: true,
    riskFlags: ['read', 'local-write', 'memory-poisoning', 'process-exec', 'spend', 'promotion'],
    useWhen: 'A reproducible baseline exists and a measured optimization is needed.',
    verifyBeforeUse: ['Apply hard resource/safety constraints before Pareto ranking.', 'Re-run correctness and security gates after optimization.'],
  },
  {
    id: 'browser-web',
    name: 'Browser & Web Actions',
    prefixes: ['browser_', 'http_fetch'],
    description: 'Browser sessions, page actions, intent routing, and guarded HTTP probes.',
    taskSignals: ['browser', 'web page', 'navigate', 'click', 'http', 'fetch'],
    commands: ['browser open', 'browser act'],
    skills: [],
    agents: [],
    maturity: 'experimental',
    authority: 'capability-plane',
    risk: 'privileged',
    optionalRuntime: true,
    riskFlags: ['network', 'credential-pii', 'spend', 'approval'],
    useWhen: 'Interacting with web surfaces or testing endpoints under explicit network policy.',
    verifyBeforeUse: ['Check network target policy, authentication, side effects, and runtime provider health.'],
  },
  {
    id: 'github-delivery',
    name: 'GitHub & Delivery',
    prefixes: ['github_', 'pr_', 'release_'],
    description: 'Issues, pull requests, workflows, releases, repository automation, and handoff.',
    taskSignals: ['github', 'issue', 'pull request', 'merge', 'release', 'publish'],
    commands: ['github pr', 'github release'],
    skills: ['github-automation', 'github-release-management'],
    agents: ['pr-manager', 'release-manager'],
    maturity: 'stable',
    authority: 'control-plane',
    risk: 'privileged',
    riskFlags: ['network', 'credential-pii', 'approval', 'destructive'],
    useWhen: 'Managing GitHub state after explicit authorization and validation.',
    verifyBeforeUse: ['External writes require current authorization.', 'Publish immutable artifacts from a clean, exact source state.'],
  },
  {
    id: 'business-collaboration',
    name: 'AgentBBS & Business Pods',
    // Metadata classification only; execution remains behind the existing loadAgentbbs guard.
    prefixes: ['agentbbs_', 'business_pod_', 'federation_bbs_'],
    description: 'Federated business rooms, domain-affinity routing, and business-pod validation.',
    taskSignals: ['business pod', 'bbs', 'room', 'domain affinity'],
    commands: [],
    skills: [],
    agents: [],
    maturity: 'experimental',
    authority: 'capability-plane',
    risk: 'privileged',
    optionalRuntime: true,
    riskFlags: ['network', 'credential-pii', 'spend', 'concurrency'],
    useWhen: 'Coordinating business-domain agents across a federated room or pod.',
    verifyBeforeUse: ['Authenticate room membership and enforce claim/resource policy at ingress.'],
  },
  {
    id: 'configuration-transfer',
    name: 'Configuration & Transfer',
    prefixes: ['config_', 'transfer_'],
    description: 'Configuration state plus portable import, export, backup, and migration.',
    taskSignals: ['config', 'setup', 'import', 'export', 'backup', 'migrate'],
    commands: ['config show', 'memory export'],
    skills: [],
    agents: [],
    maturity: 'stable',
    authority: 'control-plane',
    risk: 'privileged',
    riskFlags: ['read', 'local-write', 'credential-pii', 'destructive'],
    useWhen: 'Inspecting configuration or moving Ruflo state between installations.',
    verifyBeforeUse: ['Redact secrets and validate destination compatibility before mutation.'],
  },
  {
    id: 'system-terminal',
    name: 'System & Terminal Compatibility',
    prefixes: ['system_', 'terminal_', 'mcp_'],
    description: 'System diagnostics and legacy-compatible terminal execution surfaces.',
    taskSignals: ['terminal', 'shell', 'doctor', 'system status'],
    commands: ['doctor', 'status'],
    skills: [],
    agents: [],
    maturity: 'compatibility',
    authority: 'control-plane',
    risk: 'privileged',
    riskFlags: ['read', 'local-write', 'process-exec', 'credential-pii', 'destructive', 'approval'],
    useWhen: 'Diagnosing Ruflo or using an MCP execution surface that policy explicitly permits.',
    verifyBeforeUse: ['Prefer native executor tools for ordinary shell/file work.', 'Validate command, cwd, environment, timeout, and destructive scope.'],
  },
  {
    id: 'runtime-services',
    name: 'Other Registered Runtime Services',
    prefixes: [],
    description: 'Live MCP tools not yet assigned to a specialized domain; included so coverage is never silently incomplete.',
    taskSignals: [],
    commands: [],
    skills: [],
    agents: [],
    maturity: 'experimental',
    authority: 'capability-plane',
    risk: 'privileged',
    useWhen: 'Only after inspecting the tool schema and policy because specialized guidance is not yet available.',
    verifyBeforeUse: ['Treat fallback classification as a guidance coverage gap.', 'Inspect the tool description, schema, side effects, and policy before use.'],
  },
] as const;

function toolMatchesDomain(tool: CapabilityToolMetadata, domain: CapabilityDomainDefinition): boolean {
  if (domain.exactTools?.includes(tool.name)) return true;
  return domain.prefixes.some((prefix) => tool.name.startsWith(prefix));
}

export function classifyCapabilityTool(tool: CapabilityToolMetadata): CapabilityDomainDefinition {
  return CAPABILITY_DOMAINS.find((domain) =>
    domain.id !== 'runtime-services' && toolMatchesDomain(tool, domain)
  ) ?? CAPABILITY_DOMAINS[CAPABILITY_DOMAINS.length - 1]!;
}

function defaultAvailabilityMode(
  definition: CapabilityDomainDefinition,
): NonNullable<CapabilityDomainDefinition['availabilityMode']> {
  if (definition.availabilityMode) return definition.availabilityMode;
  if (definition.id === 'browser-web') return 'conditional-registration';
  if (definition.id === 'github-delivery' || definition.id === 'business-collaboration') {
    return 'configured-remote';
  }
  if (definition.optionalRuntime) return 'registered-degraded';
  return 'always-local';
}

function defaultRiskFlags(
  definition: CapabilityDomainDefinition,
): NonNullable<CapabilityDomainDefinition['riskFlags']> {
  if (definition.riskFlags) return [...definition.riskFlags];
  if (definition.risk === 'read-only') return ['read'];
  if (definition.risk === 'reversible') return ['local-write'];
  return definition.authority === 'control-plane'
    ? ['approval', 'local-write']
    : ['local-write', 'concurrency'];
}

function defaultLoopPhases(
  definition: CapabilityDomainDefinition,
): NonNullable<CapabilityDomainDefinition['loopPhases']> {
  if (definition.loopPhases) return [...definition.loopPhases];
  if (definition.authority === 'advisory') return ['discover', 'validate-critique', 'observe'];
  if (definition.authority === 'control-plane') return ['authorize-claim', 'execute', 'publish'];
  return ['route-plan', 'execute', 'observe'];
}

const TOOL_OWNERSHIP: ReadonlyArray<{
  prefixes: string[];
  packageOwner: string;
  pluginOwner?: string;
}> = [
  { prefixes: ['policy_'], packageOwner: '@claude-flow/security', pluginOwner: 'ruflo-security-audit' },
  { prefixes: ['aidefence_', 'security_'], packageOwner: '@claude-flow/aidefence', pluginOwner: 'ruflo-aidefence' },
  { prefixes: ['claims_'], packageOwner: '@claude-flow/claims', pluginOwner: 'ruflo-core' },
  { prefixes: ['memory_'], packageOwner: '@claude-flow/memory', pluginOwner: 'ruflo-rag-memory' },
  { prefixes: ['agentdb_'], packageOwner: 'agentdb', pluginOwner: 'ruflo-agentdb' },
  { prefixes: ['embeddings_'], packageOwner: '@claude-flow/embeddings', pluginOwner: 'ruflo-rag-memory' },
  { prefixes: ['swarm_', 'coordination_'], packageOwner: '@claude-flow/swarm', pluginOwner: 'ruflo-swarm' },
  { prefixes: ['hooks_', 'coverage_'], packageOwner: '@claude-flow/hooks', pluginOwner: 'ruflo-loop-workers' },
  { prefixes: ['neural_'], packageOwner: '@claude-flow/neural', pluginOwner: 'ruflo-intelligence' },
  { prefixes: ['ruvllm_'], packageOwner: '@ruvector/ruvllm', pluginOwner: 'ruflo-ruvllm' },
  { prefixes: ['browser_'], packageOwner: '@claude-flow/browser', pluginOwner: 'ruflo-browser' },
  { prefixes: ['metaharness_'], packageOwner: 'metaharness', pluginOwner: 'ruflo-metaharness' },
  { prefixes: ['agenticow_'], packageOwner: 'agenticow', pluginOwner: 'ruflo-rvf' },
  { prefixes: ['federation_bbs_'], packageOwner: '@claude-flow/plugin-agent-federation', pluginOwner: 'ruflo-bbs-federation' },
  { prefixes: ['business_pod_'], packageOwner: '@claude-flow/cli', pluginOwner: 'ruflo-business-pods' },
  { prefixes: ['testgen_'], packageOwner: '@claude-flow/cli', pluginOwner: 'ruflo-testgen' },
  { prefixes: ['managed_agent_', 'wasm_agent_', 'wasm_gallery_'], packageOwner: '@claude-flow/cli', pluginOwner: 'ruflo-agent' },
  { prefixes: ['guidance_'], packageOwner: '@claude-flow/guidance', pluginOwner: 'ruflo-core' },
] as const;

function ownershipForTool(
  toolName: string,
  definition: CapabilityDomainDefinition,
): { packageOwner: string; pluginOwner?: string } {
  const explicit = TOOL_OWNERSHIP.find((entry) =>
    entry.prefixes.some((prefix) => toolName.startsWith(prefix))
  );
  if (explicit) {
    return {
      packageOwner: explicit.packageOwner,
      ...(explicit.pluginOwner ? { pluginOwner: explicit.pluginOwner } : {}),
    };
  }
  return {
    packageOwner: definition.packageOwners?.[0] ?? '@claude-flow/cli',
    ...(definition.pluginOwners?.[0] ? { pluginOwner: definition.pluginOwners[0] } : {}),
  };
}

export function buildCapabilityBrain(
  registeredTools: readonly CapabilityToolMetadata[],
  now = new Date(),
): CapabilityBrain {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  const toolsByDomain = new Map<string, CapabilityToolMetadata[]>();
  const fallbackClassifiedTools: string[] = [];

  for (const tool of registeredTools) {
    if (seen.has(tool.name)) duplicates.add(tool.name);
    seen.add(tool.name);
    const domain = classifyCapabilityTool(tool);
    if (domain.id === 'runtime-services') fallbackClassifiedTools.push(tool.name);
    const tools = toolsByDomain.get(domain.id) ?? [];
    tools.push({ ...tool });
    toolsByDomain.set(domain.id, tools);
  }

  const domains = CAPABILITY_DOMAINS.map((definition): CapabilityDomain => {
    const packageOwners = definition.packageOwners ?? ['@claude-flow/cli'];
    const pluginOwners = definition.pluginOwners ?? [];
    const availabilityMode = defaultAvailabilityMode(definition);
    const riskFlags = defaultRiskFlags(definition);
    const loopPhases = defaultLoopPhases(definition);
    const tools = (toolsByDomain.get(definition.id) ?? [])
      .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
      .map((tool) => {
        const ownership = ownershipForTool(tool.name, definition);
        return {
          ...tool,
          domain: definition.id,
          packageOwner: ownership.packageOwner,
          ...(ownership.pluginOwner ? { pluginOwner: ownership.pluginOwner } : {}),
          availabilityMode,
          authority: definition.authority,
          risk: definition.risk,
          riskFlags: [...riskFlags],
          loopPhases: [...loopPhases],
        };
      });
    return {
      ...definition,
      prefixes: [...definition.prefixes],
      exactTools: definition.exactTools ? [...definition.exactTools] : undefined,
      taskSignals: [...definition.taskSignals],
      commands: [...definition.commands],
      skills: [...definition.skills],
      agents: [...definition.agents],
      packageOwners: [...packageOwners],
      pluginOwners: [...pluginOwners],
      availabilityMode,
      riskFlags,
      loopPhases,
      tools,
      health: {
        registered: tools.length > 0,
        configured: 'unknown',
        reachable: 'unknown',
        healthy: 'unknown',
        authorized: 'unknown',
      },
    };
  });

  const uniqueToolCount = seen.size;
  const classifiedToolCount = uniqueToolCount;
  return {
    schemaVersion: 'ruflo.capability-brain/v1',
    generatedAt: now.toISOString(),
    truthModel: {
      catalogued: 'Described by this version of Ruflo; it does not prove runtime presence.',
      registered: 'Present in this process MCP registry; it does not prove configuration or health.',
      configured: 'Required providers and settings are present.',
      reachable: 'Dependencies answer a non-mutating probe.',
      healthy: 'Dependencies satisfy their service-specific health contract.',
      authorized: 'Current subject is allowed to perform the exact action on the exact resource.',
    },
    domains,
    cliCommands: [...RUFLO_CLI_COMMANDS],
    implementationLoop: IMPLEMENTATION_LOOP.map((step) => ({
      ...step,
      preferredTools: [...step.preferredTools],
    })),
    coverage: {
      registeredToolCount: uniqueToolCount,
      classifiedToolCount,
      coveragePercent: uniqueToolCount === 0 ? 100 : 100,
      fallbackClassifiedTools: fallbackClassifiedTools.sort(),
      duplicateToolNames: [...duplicates].sort(),
    },
  };
}

export interface CapabilityRecommendation {
  task: string;
  domains: Array<{
    id: string;
    name: string;
    score: number;
    registeredTools: string[];
    health: CapabilityHealth;
    authority: CapabilityAuthority;
    risk: CapabilityRisk;
    verifyBeforeUse: string[];
  }>;
  implementationLoop: ImplementationLoopStep[];
  guardrails: string[];
}

export function recommendCapabilities(brain: CapabilityBrain, task: string): CapabilityRecommendation {
  const normalized = task.toLocaleLowerCase('en-US');
  const scored = brain.domains
    .filter((domain) => domain.id !== 'runtime-services')
    .map((domain) => {
      const score = domain.taskSignals.reduce((total, signal) =>
        normalized.includes(signal.toLocaleLowerCase('en-US')) ? total + 1 : total, 0);
      return { domain, score };
    })
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || (
      left.domain.id < right.domain.id ? -1 : left.domain.id > right.domain.id ? 1 : 0
    ))
    .slice(0, 6);

  const selected = scored.length > 0
    ? scored
    : brain.domains
      .filter((domain) => ['guidance', 'tasks-workflows-sessions'].includes(domain.id))
      .map((domain) => ({ domain, score: 0 }));

  return {
    task,
    domains: selected.map(({ domain, score }) => ({
      id: domain.id,
      name: domain.name,
      score,
      registeredTools: domain.tools.map((tool) => tool.name),
      health: { ...domain.health },
      authority: domain.authority,
      risk: domain.risk,
      verifyBeforeUse: [...domain.verifyBeforeUse],
    })),
    implementationLoop: brain.implementationLoop.map((step) => ({
      ...step,
      preferredTools: step.preferredTools.filter((name) =>
        brain.domains.some((domain) => domain.tools.some((tool) => tool.name === name))
      ),
    })),
    guardrails: [
      'Registered, configured, reachable, healthy, and authorized are independent facts.',
      'Ruflo coordinates and records; the executor performs implementation.',
      'Learning, optimization, consensus, and claims are capability-plane inputs, never self-authorizing promotion.',
      'External publication requires explicit authority and exact source/build evidence.',
    ],
  };
}
