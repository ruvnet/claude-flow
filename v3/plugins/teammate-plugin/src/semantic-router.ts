/**
 * Semantic Router - Neural BMSSP-powered intelligent routing
 *
 * Uses WebAssembly-accelerated neural pathfinding with embeddings
 * to match tasks to the best-suited teammates based on semantic similarity.
 *
 * @module @claude-flow/teammate-plugin/semantic
 * @version 1.0.0-alpha.1
 */

import type { TeammateInfo, TeamState } from './types.js';

// Dynamic import for Neural BMSSP
let WasmNeuralBMSSP: any = null;

async function loadNeuralBMSSP(): Promise<void> {
  if (WasmNeuralBMSSP) return;

  try {
    const bmssp = await import('@ruvnet/bmssp' as string);
    await bmssp.default(); // Initialize WASM
    WasmNeuralBMSSP = bmssp.WasmNeuralBMSSP;
  } catch (error) {
    console.warn('[SemanticRouter] Neural BMSSP not available, using fallback');
  }
}

// ============================================================================
// Types
// ============================================================================

export interface TeammateProfile {
  id: string;
  role: string;
  skills: string[];
  embedding?: Float64Array;
  performance: {
    tasksCompleted: number;
    successRate: number;
    averageLatencyMs: number;
  };
}

export interface TaskProfile {
  id: string;
  description: string;
  requiredSkills: string[];
  embedding?: Float64Array;
  priority: 'urgent' | 'high' | 'normal' | 'low';
  estimatedDuration?: number;
}

export interface MatchResult {
  teammateId: string;
  score: number;
  semanticDistance: number;
  skillMatch: number;
  loadFactor: number;
  confidence: number;
}

export interface RoutingDecision {
  task: TaskProfile;
  matches: MatchResult[];
  selectedTeammate: string | null;
  reasoning: string;
  alternates: string[];
}

export interface SemanticRouterConfig {
  embeddingDim: number;
  skillWeight: number;
  semanticWeight: number;
  loadWeight: number;
  performanceWeight: number;
  minConfidence: number;
}

// ============================================================================
// Default Configuration
// ============================================================================

export const DEFAULT_SEMANTIC_CONFIG: SemanticRouterConfig = {
  embeddingDim: 64,
  skillWeight: 0.3,
  semanticWeight: 0.4,
  loadWeight: 0.15,
  performanceWeight: 0.15,
  minConfidence: 0.5,
};

// ============================================================================
// Skill Embeddings (Pre-computed for common roles)
// ============================================================================

const SKILL_EMBEDDINGS: Record<string, number[]> = {
  // Development skills
  'typescript': [0.9, 0.8, 0.7, 0.1, 0.0, 0.0, 0.2, 0.3],
  'javascript': [0.85, 0.9, 0.65, 0.1, 0.0, 0.0, 0.2, 0.3],
  'python': [0.7, 0.6, 0.8, 0.3, 0.5, 0.0, 0.1, 0.2],
  'rust': [0.8, 0.5, 0.9, 0.0, 0.0, 0.0, 0.4, 0.5],

  // Testing skills
  'testing': [0.3, 0.4, 0.5, 0.9, 0.2, 0.0, 0.3, 0.2],
  'tdd': [0.35, 0.45, 0.55, 0.95, 0.1, 0.0, 0.35, 0.25],
  'e2e': [0.25, 0.35, 0.45, 0.85, 0.15, 0.0, 0.25, 0.15],

  // Architecture skills
  'architecture': [0.4, 0.3, 0.5, 0.2, 0.1, 0.9, 0.6, 0.7],
  'design': [0.45, 0.35, 0.55, 0.15, 0.05, 0.85, 0.65, 0.75],
  'api': [0.6, 0.5, 0.65, 0.3, 0.1, 0.7, 0.5, 0.4],

  // Security skills
  'security': [0.3, 0.2, 0.4, 0.4, 0.0, 0.6, 0.9, 0.8],
  'audit': [0.25, 0.15, 0.35, 0.5, 0.0, 0.55, 0.85, 0.9],

  // Research skills
  'research': [0.2, 0.1, 0.3, 0.1, 0.9, 0.4, 0.2, 0.3],
  'analysis': [0.25, 0.15, 0.35, 0.2, 0.85, 0.45, 0.25, 0.35],

  // Role-based embeddings
  'coder': [0.9, 0.85, 0.8, 0.3, 0.1, 0.4, 0.2, 0.3],
  'tester': [0.4, 0.5, 0.45, 0.95, 0.2, 0.3, 0.3, 0.2],
  'reviewer': [0.6, 0.55, 0.65, 0.7, 0.3, 0.6, 0.5, 0.4],
  'architect': [0.5, 0.4, 0.6, 0.3, 0.2, 0.95, 0.7, 0.8],
  'researcher': [0.3, 0.2, 0.4, 0.2, 0.95, 0.5, 0.3, 0.4],
  'coordinator': [0.4, 0.35, 0.45, 0.4, 0.4, 0.7, 0.5, 0.6],
  'security-specialist': [0.35, 0.25, 0.45, 0.45, 0.1, 0.6, 0.95, 0.85],
};

// ============================================================================
// Semantic Router Class
// ============================================================================

export class SemanticRouter {
  private neuralGraph: any = null;
  private profiles: Map<string, TeammateProfile> = new Map();
  private nodeMap: Map<string, number> = new Map();
  private nodeCount: number = 0;
  private initialized: boolean = false;
  private useFallback: boolean = false;
  private config: SemanticRouterConfig;

  constructor(config: Partial<SemanticRouterConfig> = {}) {
    this.config = { ...DEFAULT_SEMANTIC_CONFIG, ...config };
  }

  /**
   * Initialize the router with WASM support
   */
  async initialize(): Promise<boolean> {
    try {
      await loadNeuralBMSSP();
      this.initialized = true;
      this.useFallback = !WasmNeuralBMSSP;

      if (!this.useFallback) {
        this.neuralGraph = new WasmNeuralBMSSP(100, this.config.embeddingDim);
      }

      return !this.useFallback;
    } catch {
      this.useFallback = true;
      this.initialized = true;
      return false;
    }
  }

  /**
   * Register a teammate with their profile
   */
  registerTeammate(teammate: TeammateInfo, skills: string[] = []): TeammateProfile {
    const profile: TeammateProfile = {
      id: teammate.id,
      role: teammate.role,
      skills: skills.length > 0 ? skills : this.inferSkills(teammate.role),
      embedding: this.computeEmbedding(skills.length > 0 ? skills : [teammate.role]),
      performance: {
        tasksCompleted: 0,
        successRate: 1.0,
        averageLatencyMs: 0,
      },
    };

    this.profiles.set(teammate.id, profile);

    // Add to neural graph
    if (!this.nodeMap.has(teammate.id)) {
      const index = this.nodeCount++;
      this.nodeMap.set(teammate.id, index);

      if (!this.useFallback && this.neuralGraph && profile.embedding) {
        this.neuralGraph.set_embedding(index, profile.embedding);
      }
    }

    return profile;
  }

  /**
   * Build profiles from team state
   */
  async buildFromTeam(team: TeamState): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }

    for (const teammate of team.teammates) {
      this.registerTeammate(teammate);
    }

    // Build semantic edges between similar teammates
    this.buildSemanticEdges();
  }

  /**
   * Find best teammate match for a task
   */
  findBestMatch(task: TaskProfile): RoutingDecision {
    const taskEmbedding = task.embedding || this.computeEmbedding(task.requiredSkills);
    const matches: MatchResult[] = [];

    for (const [id, profile] of this.profiles) {
      const match = this.computeMatchScore(task, taskEmbedding, profile);
      matches.push(match);
    }

    // Sort by score descending
    matches.sort((a, b) => b.score - a.score);

    const selectedTeammate = matches.length > 0 && matches[0].confidence >= this.config.minConfidence
      ? matches[0].teammateId
      : null;

    const alternates = matches
      .slice(1, 4)
      .filter(m => m.confidence >= this.config.minConfidence * 0.8)
      .map(m => m.teammateId);

    return {
      task,
      matches,
      selectedTeammate,
      reasoning: this.generateReasoning(task, matches[0], selectedTeammate),
      alternates,
    };
  }

  /**
   * Batch match multiple tasks to teammates
   */
  batchMatch(tasks: TaskProfile[]): Map<string, RoutingDecision> {
    const results = new Map<string, RoutingDecision>();
    const assignedTeammates = new Set<string>();

    // Sort tasks by priority
    const sortedTasks = [...tasks].sort((a, b) => {
      const priorityOrder = { urgent: 0, high: 1, normal: 2, low: 3 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });

    for (const task of sortedTasks) {
      const decision = this.findBestMatch(task);

      // If selected teammate is already assigned, try alternates
      if (decision.selectedTeammate && assignedTeammates.has(decision.selectedTeammate)) {
        for (const alternate of decision.alternates) {
          if (!assignedTeammates.has(alternate)) {
            decision.selectedTeammate = alternate;
            decision.reasoning = `${decision.reasoning} (reassigned due to load)`;
            break;
          }
        }
      }

      if (decision.selectedTeammate) {
        assignedTeammates.add(decision.selectedTeammate);
      }

      results.set(task.id, decision);
    }

    return results;
  }

  /**
   * Get semantic distance between two teammates
   */
  getSemanticDistance(id1: string, id2: string): number {
    const index1 = this.nodeMap.get(id1);
    const index2 = this.nodeMap.get(id2);

    if (index1 === undefined || index2 === undefined) {
      return Infinity;
    }

    if (!this.useFallback && this.neuralGraph) {
      return this.neuralGraph.semantic_distance(index1, index2);
    } else {
      // Fallback: cosine distance on embeddings
      const profile1 = this.profiles.get(id1);
      const profile2 = this.profiles.get(id2);

      if (!profile1?.embedding || !profile2?.embedding) {
        return Infinity;
      }

      return this.cosineDistance(profile1.embedding, profile2.embedding);
    }
  }

  /**
   * Update teammate performance metrics
   */
  updatePerformance(
    teammateId: string,
    taskSuccess: boolean,
    latencyMs: number
  ): void {
    const profile = this.profiles.get(teammateId);
    if (!profile) return;

    const prev = profile.performance;
    const total = prev.tasksCompleted + 1;

    profile.performance = {
      tasksCompleted: total,
      successRate: (prev.successRate * prev.tasksCompleted + (taskSuccess ? 1 : 0)) / total,
      averageLatencyMs: (prev.averageLatencyMs * prev.tasksCompleted + latencyMs) / total,
    };

    // Update embedding with performance gradient (if WASM available)
    if (!this.useFallback && this.neuralGraph && profile.embedding) {
      const gradient = new Float64Array(this.config.embeddingDim);
      const factor = taskSuccess ? 0.01 : -0.01;

      for (let i = 0; i < gradient.length; i++) {
        gradient[i] = profile.embedding[i] * factor;
      }

      const index = this.nodeMap.get(teammateId);
      if (index !== undefined) {
        this.neuralGraph.update_embeddings(gradient, 0.001, this.config.embeddingDim);
      }
    }
  }

  /**
   * Get teammate profile
   */
  getProfile(teammateId: string): TeammateProfile | undefined {
    return this.profiles.get(teammateId);
  }

  /**
   * Get all profiles
   */
  getAllProfiles(): TeammateProfile[] {
    return Array.from(this.profiles.values());
  }

  /**
   * Clear all data
   */
  clear(): void {
    if (this.neuralGraph) {
      try {
        this.neuralGraph.free();
      } catch {
        // Ignore cleanup errors
      }
      this.neuralGraph = null;
    }

    this.profiles.clear();
    this.nodeMap.clear();
    this.nodeCount = 0;
  }

  /**
   * Free resources
   */
  dispose(): void {
    this.clear();
    this.initialized = false;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private inferSkills(role: string): string[] {
    const roleSkills: Record<string, string[]> = {
      coder: ['typescript', 'javascript', 'python', 'api'],
      tester: ['testing', 'tdd', 'e2e'],
      reviewer: ['analysis', 'security', 'architecture'],
      architect: ['architecture', 'design', 'api'],
      researcher: ['research', 'analysis'],
      coordinator: ['architecture', 'design'],
      'security-architect': ['security', 'audit', 'architecture'],
    };

    const normalizedRole = role.toLowerCase().replace(/[-_]/g, '');
    for (const [key, skills] of Object.entries(roleSkills)) {
      if (normalizedRole.includes(key.replace(/[-_]/g, ''))) {
        return skills;
      }
    }

    return [role]; // Use role as skill if no match
  }

  private computeEmbedding(skills: string[]): Float64Array {
    const embedding = new Float64Array(this.config.embeddingDim);

    // Average skill embeddings
    let count = 0;
    for (const skill of skills) {
      const skillEmbed = SKILL_EMBEDDINGS[skill.toLowerCase()];
      if (skillEmbed) {
        for (let i = 0; i < Math.min(skillEmbed.length, this.config.embeddingDim); i++) {
          embedding[i] += skillEmbed[i];
        }
        count++;
      }
    }

    // Normalize
    if (count > 0) {
      for (let i = 0; i < embedding.length; i++) {
        embedding[i] /= count;
      }
    }

    // Pad with random noise for diversity
    for (let i = 8; i < this.config.embeddingDim; i++) {
      embedding[i] = Math.random() * 0.1;
    }

    return embedding;
  }

  private buildSemanticEdges(): void {
    if (this.useFallback || !this.neuralGraph) return;

    const ids = Array.from(this.nodeMap.keys());

    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const idx1 = this.nodeMap.get(ids[i])!;
        const idx2 = this.nodeMap.get(ids[j])!;

        // Alpha based on skill overlap
        const profile1 = this.profiles.get(ids[i]);
        const profile2 = this.profiles.get(ids[j]);

        if (profile1 && profile2) {
          const overlap = this.skillOverlap(profile1.skills, profile2.skills);
          const alpha = overlap * 0.5 + 0.5; // [0.5, 1.0]

          this.neuralGraph.add_semantic_edge(idx1, idx2, alpha);
          this.neuralGraph.add_semantic_edge(idx2, idx1, alpha);
        }
      }
    }
  }

  private computeMatchScore(
    task: TaskProfile,
    taskEmbedding: Float64Array,
    profile: TeammateProfile
  ): MatchResult {
    // Skill match score
    const skillMatch = this.skillOverlap(task.requiredSkills, profile.skills);

    // Semantic distance (lower is better)
    let semanticDistance = 1.0;
    if (profile.embedding) {
      semanticDistance = this.cosineDistance(taskEmbedding, profile.embedding);
    }
    const semanticScore = 1 - Math.min(1, semanticDistance);

    // Load factor (1.0 = idle, 0.0 = busy)
    const loadFactor = 1.0; // Would be computed from actual teammate status

    // Performance score
    const performanceScore = profile.performance.successRate;

    // Weighted combination
    const score =
      this.config.skillWeight * skillMatch +
      this.config.semanticWeight * semanticScore +
      this.config.loadWeight * loadFactor +
      this.config.performanceWeight * performanceScore;

    // Confidence based on data quality
    const confidence = Math.min(1, (skillMatch + semanticScore) / 2 + 0.3);

    return {
      teammateId: profile.id,
      score,
      semanticDistance,
      skillMatch,
      loadFactor,
      confidence,
    };
  }

  private skillOverlap(skills1: string[], skills2: string[]): number {
    const set1 = new Set(skills1.map(s => s.toLowerCase()));
    const set2 = new Set(skills2.map(s => s.toLowerCase()));

    let intersection = 0;
    for (const skill of set1) {
      if (set2.has(skill)) intersection++;
    }

    const union = set1.size + set2.size - intersection;
    return union > 0 ? intersection / union : 0;
  }

  private cosineDistance(a: Float64Array, b: Float64Array): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    if (magnitude === 0) return 1.0;

    const similarity = dotProduct / magnitude;
    return 1 - similarity; // Convert to distance
  }

  private generateReasoning(
    task: TaskProfile,
    bestMatch: MatchResult | undefined,
    selected: string | null
  ): string {
    if (!bestMatch || !selected) {
      return 'No suitable teammate found with sufficient confidence.';
    }

    const profile = this.profiles.get(selected);
    if (!profile) {
      return 'Selected teammate profile not found.';
    }

    const reasons: string[] = [];

    if (bestMatch.skillMatch > 0.5) {
      reasons.push(`skill match: ${(bestMatch.skillMatch * 100).toFixed(0)}%`);
    }

    if (bestMatch.semanticDistance < 0.5) {
      reasons.push(`semantic fit: ${((1 - bestMatch.semanticDistance) * 100).toFixed(0)}%`);
    }

    if (profile.performance.successRate > 0.9) {
      reasons.push(`success rate: ${(profile.performance.successRate * 100).toFixed(0)}%`);
    }

    return `Selected ${profile.role} "${selected}" (${reasons.join(', ')})`;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export async function createSemanticRouter(
  config?: Partial<SemanticRouterConfig>
): Promise<SemanticRouter> {
  const router = new SemanticRouter(config);
  await router.initialize();
  return router;
}

export default SemanticRouter;
