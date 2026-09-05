/**
 * @claude-flow/browser
 * Browser automation for AI agents - integrates agent-browser with claude-flow swarms
 *
 * Features:
 * - 50+ MCP tools for browser automation
 * - AI-optimized snapshots with element refs (@e1, @e2)
 * - Multi-session support for swarm coordination
 * - Trajectory tracking for ReasoningBank/SONA learning
 * - Integration with agentic-flow optimizations
 *
 * @example
 * ```typescript
 * import { createBrowserService, browserTools } from '@claude-flow/browser';
 *
 * // Create a browser service
 * const browser = createBrowserService({ sessionId: 'my-session' });
 *
 * // Start a trajectory for learning
 * const trajectoryId = browser.startTrajectory('Login to dashboard');
 *
 * // Perform actions
 * await browser.open('https://example.com/login');
 * await browser.snapshot({ interactive: true });
 * await browser.fill('@e1', 'user@example.com');
 * await browser.fill('@e2', 'password');
 * await browser.click('@e3');
 *
 * // End trajectory
 * const trajectory = browser.endTrajectory(true, 'Login successful');
 * ```
 */

// Domain types
export * from './domain/types.js';

// Infrastructure
export { AgentBrowserAdapter } from './infrastructure/agent-browser-adapter.js';
export type { AgentBrowserAdapterOptions } from './infrastructure/agent-browser-adapter.js';

// ReasoningBank integration
export {
  ReasoningBankAdapter,
  getReasoningBank,
  type BrowserPattern,
  type PatternStep,
} from './infrastructure/reasoningbank-adapter.js';

// Hooks integration
export {
  preBrowseHook,
  postBrowseHook,
  browserHooks,
  type PreBrowseInput,
  type PreBrowseResult,
  type PostBrowseInput,
  type PostBrowseResult,
} from './infrastructure/hooks-integration.js';

// Memory integration (HNSW semantic search)
export {
  ClaudeFlowMemoryAdapter,
  BrowserMemoryManager,
  createMemoryManager,
  getMemoryAdapter,
  type BrowserMemoryEntry,
  type MemorySearchResult,
  type MemoryStats,
  type MemorySearchOptions,
  type MemoryFilter,
  type IMemoryAdapter,
} from './infrastructure/memory-integration.js';

// Security integration (AIDefence)
export {
  BrowserSecurityScanner,
  getSecurityScanner,
  isUrlSafe,
  containsPII,
  type ThreatScanResult,
  type Threat,
  type ThreatType,
  type PIIMatch,
  type PIIType,
  type SecurityConfig,
} from './infrastructure/security-integration.js';

// Workflow templates
export {
  WorkflowManager,
  getWorkflowManager,
  listWorkflows,
  getWorkflow,
  WORKFLOW_TEMPLATES,
  type WorkflowTemplate,
  type WorkflowCategory,
  type WorkflowStep,
  type WorkflowVariable,
  type WorkflowExecution,
  type WorkflowStepResult,
  type BrowserAction,
} from './infrastructure/workflow-templates.js';

// Application services
export {
  BrowserService,
  BrowserSwarmCoordinator,
  createBrowserService,
  createBrowserSwarm,
  type BrowserServiceConfig,
} from './application/browser-service.js';

// Signed trajectory containers (ADR-122 Phase 1)
export {
  sealTrajectory,
  verifySealedTrajectory,
  writeSealedTrajectory,
  readSealedTrajectory,
  planReplay,
  buildReplayDelta,
  type SealTrajectoryInput,
  type SealedTrajectory,
} from './application/signed-trajectory-service.js';
export {
  generateWitnessKey,
  loadWitnessKey,
  resolveWitnessKey,
  signTrajectory,
  verifyTrajectory,
  canonicalJSON,
  sha256Hex,
  type WitnessKey,
} from './infrastructure/witness-signer.js';
export {
  SIGNED_TRAJECTORY_ENVELOPE_VERSION,
  SIGNED_TRAJECTORY_KIND,
  SignedTrajectoryEnvelopeSchema,
  SignedTrajectoryPayloadSchema,
  type SignedTrajectoryEnvelope,
  type SignedTrajectoryPayload,
  type VerificationResult,
  type ReplayDelta,
  type ReplayMutation,
} from './domain/signed-trajectory.js';

// Causal-graph self-healing selectors (ADR-122 Phase 2)
export {
  CausalRecoveryService,
  type CausalRecoveryServiceOptions,
  type AnnotatedSnapshot,
} from './application/causal-recovery-service.js';
export {
  InMemoryBreakStore,
  JsonFileBreakStore,
  classifyBreak,
  parseUrl,
  type IBreakStore,
} from './infrastructure/causal-recovery-store.js';
export {
  SelectorBreakEventSchema,
  SelectorBreakKindSchema,
  CausalRiskAnnotationSchema,
  type SelectorBreakEvent,
  type SelectorBreakKind,
  type CausalRiskAnnotation,
  type RecoveryExplanation,
} from './domain/causal-recovery.js';

// Workflow Compiler + Production-Aware UCT (ADR-122 Phase 7)
export {
  WorkflowCompiler,
  type CompileInput,
} from './application/workflow-compiler.js';
export {
  productionUct,
  blendQ,
  type ProductionUctInput,
} from './application/production-uct.js';
export {
  WORKFLOW_VERSION,
  CompiledWorkflowSchema,
  WorkflowStepSchema as CompiledWorkflowStepSchema,
  WorkflowRequirementsSchema as CompiledWorkflowRequirementsSchema,
  WorkflowGuardsSchema as CompiledWorkflowGuardsSchema,
  WorkflowReplaySchema as CompiledWorkflowReplaySchema,
  SelectorStrategySchema,
  SelectorSpecSchema,
  DEFAULT_PRODUCTION_UCT_WEIGHTS,
  type CompiledWorkflow,
  type WorkflowStep as CompiledWorkflowStep,
  type WorkflowRequirements as CompiledWorkflowRequirements,
  type WorkflowGuards as CompiledWorkflowGuards,
  type WorkflowReplay as CompiledWorkflowReplay,
  type SelectorSpec,
  type SelectorStrategy,
  type ProductionUctSignals,
  type ProductionUctWeights,
} from './domain/workflow.js';

// Session Capsule + Risk Classifier + Browser Execution Adapter (ADR-122 Phase 6 — substrate)
export {
  SessionCapsuleService,
  RiskClassifier,
  type CreateCapsuleInput,
} from './application/session-capsule-service.js';
export {
  CAPSULE_ENVELOPE_VERSION,
  CAPSULE_ENVELOPE_KIND,
  SessionCapsuleEnvelopeSchema,
  SessionCapsulePayloadSchema,
  ReusePolicySchema,
  OriginPolicySchema,
  ConsentProofSchema,
  BrowserProfileSchema,
  StateRefSchema,
  InlineStateSchema,
  RiskClassSchema,
  AUTONOMOUS_CLASSES,
  type SessionCapsuleEnvelope,
  type SessionCapsulePayload,
  type ReusePolicy,
  type OriginPolicy,
  type ConsentProof,
  type BrowserProfile,
  type StateRef,
  type InlineState,
  type RiskClass,
  type RiskClassification,
  type CapsuleVerificationResult,
} from './domain/session-capsule.js';
export {
  AgentBrowserExecutionAdapter,
} from './infrastructure/agent-browser-execution-adapter.js';
export type {
  BrowserExecutionAdapter,
  Observation,
  AdapterBackend,
} from './domain/browser-adapter.js';

// Cost-aware action routing + GOAP preflight (ADR-122 Phase 5)
export {
  ActionRouter,
  type ActionRouterOptions,
} from './application/action-router.js';
export {
  ActionTierSchema,
  type ActionTier,
  type RoutingDecision,
  type ActionRoutingInput,
  type TrajectoryCostReport,
} from './domain/action-routing.js';
export {
  GoapPreflightService,
  type GoapPreflightServiceOptions,
  type GoapPreflightInput,
  type GoapPreflightResult,
  type GoapPreflightFinding,
  type PlannedStep,
} from './application/goap-preflight.js';

// Federated MCTS branch exploration (ADR-122 Phase 4)
export {
  MctsExplorer,
  ucb1,
  type MctsExplorerOptions,
  type RootAction,
  type ExpansionPolicy,
} from './application/mcts-explorer.js';
export {
  McTsBranchSchema,
  BranchStatusSchema,
  type McTsBranch,
  type BranchStatus,
  type MctsRunResult,
  type PeerAdapter,
  type UcbParams,
  type ValueScorer,
} from './domain/mcts-branch.js';

// AIDefence-attested cookie vault (ADR-122 Phase 3)
export {
  CookieVaultService,
  type CookieVaultServiceOptions,
  type CookieVaultScannerInfo,
} from './application/cookie-vault-service.js';
export {
  VAULT_ENVELOPE_VERSION,
  VAULT_ENVELOPE_KIND,
  VaultEntryEnvelopeSchema,
  VaultEntryPayloadSchema,
  CookieValueSchema,
  ScanAttestationSchema,
  VaultRefusalSchema,
  type CookieValue,
  type ScanAttestation,
  type VaultEntryEnvelope,
  type VaultEntryPayload,
  type VaultVerificationResult,
  type VaultRefusal,
} from './domain/cookie-vault.js';

// MCP tools
export { browserTools } from './mcp-tools/browser-tools.js';
export type { MCPTool } from './mcp-tools/browser-tools.js';

// Re-export main classes as defaults
import { BrowserService, createBrowserService, createBrowserSwarm } from './application/browser-service.js';
import { browserTools } from './mcp-tools/browser-tools.js';
import { browserHooks, preBrowseHook, postBrowseHook } from './infrastructure/hooks-integration.js';
import { getReasoningBank } from './infrastructure/reasoningbank-adapter.js';
import { getMemoryAdapter, createMemoryManager } from './infrastructure/memory-integration.js';
import { getSecurityScanner, isUrlSafe, containsPII } from './infrastructure/security-integration.js';
import { getWorkflowManager, listWorkflows, getWorkflow } from './infrastructure/workflow-templates.js';

export default {
  // Services
  BrowserService,
  createBrowserService,
  createBrowserSwarm,

  // MCP tools
  browserTools,

  // Hooks
  browserHooks,
  preBrowseHook,
  postBrowseHook,

  // Learning
  getReasoningBank,

  // Memory (HNSW-indexed)
  getMemoryAdapter,
  createMemoryManager,

  // Security (AIDefence)
  getSecurityScanner,
  isUrlSafe,
  containsPII,

  // Workflows
  getWorkflowManager,
  listWorkflows,
  getWorkflow,
};
