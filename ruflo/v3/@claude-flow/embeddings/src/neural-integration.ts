/**
 * Neural Substrate Integration
 *
 * Integrates agentic-flow's neural embedding features:
 * - Semantic drift detection
 * - Memory physics (hippocampal dynamics)
 * - Embedding state machine
 * - Swarm coordination
 * - Coherence monitoring
 *
 * These features treat embeddings as a synthetic nervous system.
 */

// Types from agentic-flow/embeddings
export interface DriftResult {
  distance: number;
  velocity: number;
  acceleration: number;
  trend: 'stable' | 'drifting' | 'accelerating' | 'recovering';
  shouldEscalate: boolean;
  shouldTriggerReasoning: boolean;
}

export interface MemoryEntry {
  id: string;
  embedding: Float32Array;
  content: string;
  strength: number;
  timestamp: number;
  accessCount: number;
  associations: string[];
}

export interface AgentState {
  id: string;
  position: Float32Array;
  velocity: Float32Array;
  attention: Float32Array;
  energy: number;
  lastUpdate: number;
}

export interface CoherenceResult {
  isCoherent: boolean;
  anomalyScore: number;
  stabilityScore: number;
  driftDirection: Float32Array | null;
  warnings: string[];
}

export interface SubstrateHealth {
  memoryCount: number;
  activeAgents: number;
  avgDrift: number;
  avgCoherence: number;
  lastConsolidation: number;
  uptime: number;
}

export interface NeuralSubstrateConfig {
  dimension?: number;
  driftThreshold?: number;
  decayRate?: number;
}

/**
 * Lazy-loaded Neural Substrate wrapper
 *
 * Wraps agentic-flow's NeuralSubstrate with graceful fallback
 */
export class NeuralEmbeddingService {
  private substrate: any = null;
  private initialized = false;
  private available = false;

  constructor(private config: NeuralSubstrateConfig = {}) {}

  /**
   * Initialize neural substrate
   */
  async init(): Promise<boolean> {
    if (this.initialized) return this.available;

    try {
      const { getNeuralSubstrate } = await import('agentic-flow/embeddings');
      this.substrate = await getNeuralSubstrate(this.config);
      await this.substrate.init();
      this.available = true;
    } catch (error) {
      console.warn('[neural] Neural substrate not available:', error instanceof Error ? error.message : error);
      this.available = false;
    }

    this.initialized = true;
    return this.available;
  }

  /**
   * Check if neural features are available
   */
  isAvailable(): boolean {
    return this.available;
  }

  /**
   * Detect semantic drift from baseline
   */
  async detectDrift(input: string): Promise<DriftResult | null> {
    if (!this.available || !this.substrate) return null;
    return this.substrate.drift.detect(input);
  }

  /**
   * Set baseline for drift detection
   */
  async setDriftBaseline(context: string): Promise<void> {
    if (!this.available || !this.substrate) return;
    await this.substrate.drift.setBaseline(context);
  }

  /**
   * Store memory with interference detection
   */
  async storeMemory(id: string, content: string): Promise<{ stored: boolean; interference: string[] } | null> {
    if (!this.available || !this.substrate) return null;
    return this.substrate.memory.store(id, content);
  }

  /**
   * Recall memories by similarity
   */
  async recallMemories(query: string, topK = 5): Promise<Array<MemoryEntry & { relevance: number }> | null> {
    if (!this.available || !this.substrate) return null;
    return this.substrate.memory.recall(query, topK);
  }

  /**
   * Consolidate memories (merge similar, forget weak)
   */
  consolidateMemories(): { merged: number; forgotten: number; remaining: number } | null {
    if (!this.available || !this.substrate) return null;
    return this.substrate.memory.consolidate();
  }

  /**
   * Register agent for state tracking
   */
  async registerAgent(id: string, role: string): Promise<AgentState | null> {
    if (!this.available || !this.substrate) return null;
    return this.substrate.states.registerAgent(id, role);
  }

  /**
   * Update agent state based on observation
   */
  async updateAgentState(agentId: string, observation: string): Promise<{
    newState: AgentState;
    nearestRegion: string;
    regionProximity: number;
  } | null> {
    if (!this.available || !this.substrate) return null;
    return this.substrate.states.updateState(agentId, observation);
  }

  /**
   * Get agent state
   */
  getAgentState(agentId: string): AgentState | null {
    if (!this.available || !this.substrate) return null;
    return this.substrate.states.getAgent(agentId);
  }

  /**
   * Coordinate swarm for task
   */
  async coordinateSwarm(task: string): Promise<Array<{
    agentId: string;
    taskAlignment: number;
    bestCollaborator: string | null;
    collaborationScore: number;
  }> | null> {
    if (!this.available || !this.substrate) return null;
    return this.substrate.swarm.coordinate(task);
  }

  /**
   * Add agent to swarm
   */
  async addSwarmAgent(id: string, role: string): Promise<AgentState | null> {
    if (!this.available || !this.substrate) return null;
    return this.substrate.swarm.addAgent(id, role);
  }

  /**
   * Calibrate coherence monitor
   */
  async calibrateCoherence(goodOutputs: string[]): Promise<{ calibrated: boolean; sampleCount: number } | null> {
    if (!this.available || !this.substrate) return null;
    return this.substrate.coherence.calibrate(goodOutputs);
  }

  /**
   * Check output coherence
   */
  async checkCoherence(output: string): Promise<CoherenceResult | null> {
    if (!this.available || !this.substrate) return null;
    return this.substrate.coherence.check(output);
  }

  /**
   * Process input through full neural substrate
   */
  async process(input: string, context?: {
    agentId?: string;
    memoryId?: string;
    checkCoherence?: boolean;
  }): Promise<{
    drift: DriftResult;
    state?: { nearestRegion: string; regionProximity: number };
    coherence?: CoherenceResult;
    stored?: boolean;
  } | null> {
    if (!this.available || !this.substrate) return null;
    return this.substrate.process(input, context);
  }

  /**
   * Get substrate health
   */
  health(): SubstrateHealth | null {
    if (!this.available || !this.substrate) return null;
    return this.substrate.health();
  }

  /**
   * Full consolidation pass
   */
  consolidate(): { memory: { merged: number; forgotten: number; remaining: number } } | null {
    if (!this.available || !this.substrate) return null;
    return this.substrate.consolidate();
  }
}

/**
 * Create neural embedding service
 */
export function createNeuralService(config: NeuralSubstrateConfig = {}): NeuralEmbeddingService {
  return new NeuralEmbeddingService(config);
}

/**
 * Check if neural features are available
 */
export async function isNeuralAvailable(): Promise<boolean> {
  try {
    await import('agentic-flow/embeddings');
    return true;
  } catch {
    return false;
  }
}

/**
 * List available ONNX embedding models
 */
export async function listEmbeddingModels(): Promise<Array<{
  id: string;
  dimension: number;
  size: string;
  quantized: boolean;
  downloaded: boolean;
}>> {
  try {
    const { listAvailableModels } = await import('agentic-flow/embeddings');
    return listAvailableModels();
  } catch {
    // Return default models if agentic-flow not available
    return [
      { id: 'all-MiniLM-L6-v2', dimension: 384, size: '23MB', quantized: false, downloaded: false },
      { id: 'all-mpnet-base-v2', dimension: 768, size: '110MB', quantized: false, downloaded: false },
    ];
  }
}

/**
 * Download embedding model
 */
export async function downloadEmbeddingModel(
  modelId: string,
  targetDir?: string,
  onProgress?: (progress: { percent: number; bytesDownloaded: number; totalBytes: number }) => void
): Promise<string> {
  const { downloadModel } = await import('agentic-flow/embeddings');
  return downloadModel(modelId, targetDir ?? '.models', onProgress);
}
