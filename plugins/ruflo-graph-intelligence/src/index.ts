/**
 * ruflo-graph-intelligence — RuFlo Graph Intelligence Engine (ADR-123)
 *
 * Real-time relationship intelligence with complexity-aware execution.
 *
 * Three-layer architecture:
 *   Neural Layer        — adaptive learning (existing — @claude-flow/neural)
 *   Graph Intelligence  — relationship reasoning (this plugin)
 *   Complexity Layer    — runtime governance (this plugin)
 *
 * Built on `sublinear-time-solver@1.7.0`.
 */

// Domain
export * from './domain/types.js';
export {
  AdapterRegistry,
  getRegistry,
  resetRegistry,
  noopUnsubscribe,
  type SublinearAdapter,
} from './domain/adapter.js';

// Infrastructure
export {
  coherenceScore,
  checkCoherence,
  singleEntryPageRank,
  conjugateGradient,
  neumann,
  solveOnChange,
  hashResult,
  observedComplexity,
  runPageRank,
  runSolve,
  runSolveOnChange,
} from './infrastructure/solver-bridge.js';

// MCP tools
export { graphIntelligenceTools, type MCPTool } from './mcp-tools/index.js';

// Adapters (per-wedge integrations)
export * from './adapters/index.js';

// JL embedding (ADR-121 follow-up)
export { jlEmbed, computeTargetDim, type JLEmbedOptions, type JLEmbedResult } from './infrastructure/jl-embed.js';

// Streaming bridge (Wedge 12)
export {
  StreamingBridge,
  type StreamingBridgeOptions,
  type StreamingUpdate,
} from './application/streaming-bridge.js';

// Federation protocol (Phase 8 — beyond-SOTA)
export {
  PrArtifactRequestSchema,
  PrArtifactResponseSchema,
  PrArtifactDeltaSchema,
  PrArtifactStaleSchema,
  FederationMessageSchema,
  type PrArtifactRequest,
  type PrArtifactResponse,
  type PrArtifactDelta,
  type PrArtifactStale,
  type FederationMessage,
  type FederationTransport,
} from './domain/federation-protocol.js';
export {
  FederationServer,
  type FederationServerOptions,
} from './application/federation-server.js';
export {
  FederationClient,
  inProcessTransport,
  type FederationClientOptions,
  type FetchPrResult,
} from './application/federation-client.js';

// Signed PR artifacts (Phase 7 — beyond-SOTA)
export {
  ARTIFACT_ENVELOPE_VERSION,
  ARTIFACT_ENVELOPE_KIND,
  SignedPageRankEnvelopeSchema,
  SignedPageRankPayloadSchema,
  type SignedPageRankEnvelope,
  type SignedPageRankPayload,
  type ArtifactVerificationResult,
} from './domain/signed-artifact.js';
export {
  generateWitnessKey,
  loadWitnessKey,
  resolveWitnessKey,
  sealArtifact,
  verifyArtifact,
  canonicalJSON,
  sha256Hex,
  type WitnessKey,
  type SealArtifactInput,
} from './infrastructure/witness-signer.js';

// Default export
import { graphIntelligenceTools } from './mcp-tools/index.js';
import { getRegistry } from './domain/adapter.js';
export default { tools: graphIntelligenceTools, registry: getRegistry };
