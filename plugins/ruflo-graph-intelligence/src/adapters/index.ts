/**
 * ruflo-graph-intelligence — Adapter barrel export
 *
 * Each adapter lives in its own file and is opted into by the owning plugin
 * at init time. Phase-1 ships zero adapters; Phase 2+ adds them one at a time.
 */

export {
  BrowserCausalAdapter,
  browserCausalGraphId,
  registerBrowserCausalAdapter,
  type BreakEventSource,
  type BreakEventLike,
  type BrowserCausalAdapterOptions,
} from './browser-causal-adapter.js';

export {
  FederationTrustAdapter,
  FEDERATION_TRUST_GRAPH_ID,
  registerFederationTrustAdapter,
  type PeerTrustEdge,
  type PeerTrustSource,
  type FederationTrustAdapterOptions,
} from './federation-trust-adapter.js';

export {
  CostAttributionAdapter,
  costAttributionGraphId,
  registerCostAttributionAdapter,
  type CostCausationEdge,
  type CostCausationSource,
  type CostAttributionAdapterOptions,
} from './cost-attribution-adapter.js';

export {
  ObservabilitySpanAdapter,
  observabilityGraphId,
  registerObservabilitySpanAdapter,
  type SpanRecord,
  type ObservabilitySpanSource,
  type ObservabilitySpanAdapterOptions,
} from './observability-span-adapter.js';

export {
  KnowledgeGraphAdapter,
  KNOWLEDGE_GRAPH_ID,
  registerKnowledgeGraphAdapter,
  type KGEdge,
  type KnowledgeGraphSource,
  type KnowledgeGraphAdapterOptions,
} from './knowledge-graph-adapter.js';

export {
  RagMemoryAdapter,
  ragMemoryGraphId,
  registerRagMemoryAdapter,
  type ChunkEdge,
  type RagMemorySource,
  type RagMemoryAdapterOptions,
} from './rag-memory-adapter.js';

export {
  PortfolioCovarianceAdapter,
  portfolioGraphId,
  registerPortfolioCovarianceAdapter,
  type CovarianceEntry,
  type PortfolioSource,
  type PortfolioAdapterOptions,
} from './portfolio-cg-adapter.js';

export {
  AIDefenceSuspicionAdapter,
  AIDEFENCE_CALL_GRAPH_ID,
  registerAIDefenceSuspicionAdapter,
  type CallEdge,
  type AIDefenceSource,
  type AIDefenceAdapterOptions,
} from './aidefence-suspicion-adapter.js';

export {
  JujutsuBlastRadiusAdapter,
  JUJUTSU_IMPORT_GRAPH_ID,
  registerJujutsuBlastRadiusAdapter,
  type ImportEdge,
  type JujutsuSource,
  type JujutsuAdapterOptions,
} from './jujutsu-blast-radius-adapter.js';
