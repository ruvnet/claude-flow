/**
 * @claude-flow/browser - ReasoningBank Integration
 * Connects browser trajectories to agentic-flow's learning system
 */

import type { BrowserTrajectory, BrowserTrajectoryStep, Snapshot } from '../domain/types.js';

// ============================================================================
// ReasoningBank Pattern Types
// ============================================================================

export interface BrowserPattern {
  id: string;
  type: 'navigation' | 'interaction' | 'extraction' | 'form' | 'auth' | 'test';
  goal: string;
  steps: PatternStep[];
  successRate: number;
  avgDuration: number;
  lastUsed: string;
  usageCount: number;
  embedding?: number[];
}

export interface PatternStep {
  action: string;
  selector?: string;
  value?: string;
  condition?: string;
}

// ============================================================================
// ReasoningBank Adapter
// ============================================================================

export class ReasoningBankAdapter {
  private patterns: Map<string, BrowserPattern> = new Map();
  private trajectoryBuffer: BrowserTrajectory[] = [];
  private readonly maxBufferSize = 100;

  /**
   * Store a completed trajectory for learning
   */
  async storeTrajectory(trajectory: BrowserTrajectory): Promise<void> {
    this.trajectoryBuffer.push(trajectory);

    // Process buffer when full
    if (this.trajectoryBuffer.length >= this.maxBufferSize) {
      await this.processBuffer();
    }

    // Extract pattern from successful trajectories
    if (trajectory.success) {
      const pattern = this.extractPattern(trajectory);
      if (pattern) {
        this.patterns.set(pattern.id, pattern);
      }
    }
  }

  /**
   * Extract a reusable pattern from a trajectory
   */
  private extractPattern(trajectory: BrowserTrajectory): BrowserPattern | null {
    if (trajectory.steps.length < 2) return null;

    const patternId = this.generatePatternId(trajectory.goal);
    const existing = this.patterns.get(patternId);

    const steps: PatternStep[] = trajectory.steps.map(step => ({
      action: step.action,
      selector: this.normalizeSelector(step.input.target as string),
      value: step.input.value as string,
      condition: step.input.waitUntil as string || step.input.text as string,
    }));

    const avgDuration = trajectory.steps.reduce((sum, s) => sum + (s.result.duration || 0), 0) / trajectory.steps.length;

    if (existing) {
      // Update existing pattern
      return {
        ...existing,
        successRate: (existing.successRate * existing.usageCount + 1) / (existing.usageCount + 1),
        avgDuration: (existing.avgDuration * existing.usageCount + avgDuration) / (existing.usageCount + 1),
        lastUsed: new Date().toISOString(),
        usageCount: existing.usageCount + 1,
      };
    }

    return {
      id: patternId,
      type: this.inferPatternType(trajectory),
      goal: trajectory.goal,
      steps,
      successRate: 1,
      avgDuration,
      lastUsed: new Date().toISOString(),
      usageCount: 1,
    };
  }

  /**
   * Infer pattern type from trajectory
   */
  private inferPatternType(trajectory: BrowserTrajectory): BrowserPattern['type'] {
    const actions = trajectory.steps.map(s => s.action);
    const goal = trajectory.goal.toLowerCase();

    if (goal.includes('login') || goal.includes('auth') || actions.includes('state-save')) {
      return 'auth';
    }
    if (goal.includes('test') || goal.includes('verify') || goal.includes('assert')) {
      return 'test';
    }
    if (goal.includes('extract') || goal.includes('scrape') || actions.filter(a => a === 'getText').length > 3) {
      return 'extraction';
    }
    if (goal.includes('form') || goal.includes('submit') || actions.filter(a => a === 'fill').length > 2) {
      return 'form';
    }
    if (actions.filter(a => a === 'click').length > 3) {
      return 'interaction';
    }
    return 'navigation';
  }

  /**
   * Normalize selector for pattern matching
   */
  private normalizeSelector(selector?: string): string | undefined {
    if (!selector) return undefined;

    // Keep refs as-is (they're from snapshots)
    if (selector.startsWith('@e')) {
      return '{ref}'; // Placeholder for any ref
    }

    // Keep semantic locators
    if (selector.startsWith('text=') || selector.startsWith('role=')) {
      return selector;
    }

    // Generalize CSS selectors
    return selector
      .replace(/\[data-testid="[^"]+"\]/g, '[data-testid="{testid}"]')
      .replace(/#\w+/g, '#{id}')
      .replace(/\.\w+/g, '.{class}');
  }

  /**
   * Generate pattern ID from goal
   */
  private generatePatternId(goal: string): string {
    // Must be a pure function of the goal: extractPattern() merges a repeated
    // trajectory into its existing pattern by looking this id up.
    const normalized = goal.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    let hash = 0x811c9dc5;
    for (let i = 0; i < normalized.length; i++) {
      hash = Math.imul(hash ^ normalized.charCodeAt(i), 0x01000193);
    }
    return `pattern-${normalized.slice(0, 50)}-${(hash >>> 0).toString(36)}`;
  }

  /**
   * Process buffered trajectories (batch learning)
   */
  private async processBuffer(): Promise<void> {
    const successful = this.trajectoryBuffer.filter(t => t.success);
    const failed = this.trajectoryBuffer.filter(t => !t.success);

    // Learn from failures
    for (const failure of failed) {
      await this.analyzeFailure(failure);
    }

    // Clear buffer
    this.trajectoryBuffer = [];
  }

  /**
   * Analyze a failed trajectory to learn what went wrong
   */
  private async analyzeFailure(trajectory: BrowserTrajectory): Promise<void> {
    const failedStep = trajectory.steps.find(s => !s.result.success);
    if (!failedStep) return;

    // Store failure pattern for avoidance
    const failureId = `failure-${failedStep.action}-${Date.now().toString(36)}`;
    console.log(`[ReasoningBank] Learned from failure: ${failureId} - ${failedStep.result.error}`);
  }

  /**
   * Find similar patterns for a goal
   */
  async findSimilarPatterns(goal: string, limit = 5): Promise<BrowserPattern[]> {
    const patterns = Array.from(this.patterns.values());

    // Simple text similarity for now
    // In production, use HNSW with embeddings
    const scored = patterns.map(p => ({
      pattern: p,
      score: this.textSimilarity(goal.toLowerCase(), p.goal.toLowerCase()),
    }));

    return scored
      .filter(s => s.score > 0.3)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(s => s.pattern);
  }

  /**
   * Simple text similarity
   */
  private textSimilarity(a: string, b: string): number {
    const wordsA = new Set(a.split(/\s+/));
    const wordsB = new Set(b.split(/\s+/));
    const intersection = new Set([...wordsA].filter(w => wordsB.has(w)));
    const union = new Set([...wordsA, ...wordsB]);
    return intersection.size / union.size;
  }

  /**
   * Get recommended steps for a goal
   */
  async getRecommendedSteps(goal: string): Promise<PatternStep[]> {
    const similar = await this.findSimilarPatterns(goal, 1);
    if (similar.length === 0) return [];

    return similar[0].steps;
  }

  /**
   * Record verdict for SONA learning
   */
  async recordVerdict(trajectoryId: string, success: boolean, feedback?: string): Promise<void> {
    // In production, this would update SONA weights
    console.log(`[ReasoningBank] Verdict for ${trajectoryId}: ${success ? 'SUCCESS' : 'FAILURE'}${feedback ? ` - ${feedback}` : ''}`);
  }

  /**
   * Get pattern stats
   */
  getStats(): { totalPatterns: number; avgSuccessRate: number; bufferedTrajectories: number } {
    const patterns = Array.from(this.patterns.values());
    const avgSuccessRate = patterns.length > 0
      ? patterns.reduce((sum, p) => sum + p.successRate, 0) / patterns.length
      : 0;

    return {
      totalPatterns: patterns.length,
      avgSuccessRate,
      bufferedTrajectories: this.trajectoryBuffer.length,
    };
  }

  /**
   * Export patterns for persistence
   */
  exportPatterns(): BrowserPattern[] {
    return Array.from(this.patterns.values());
  }

  /**
   * Import patterns from storage
   */
  importPatterns(patterns: BrowserPattern[]): void {
    for (const pattern of patterns) {
      this.patterns.set(pattern.id, pattern);
    }
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let instance: ReasoningBankAdapter | null = null;

export function getReasoningBank(): ReasoningBankAdapter {
  if (!instance) {
    instance = new ReasoningBankAdapter();
  }
  return instance;
}

export default ReasoningBankAdapter;
