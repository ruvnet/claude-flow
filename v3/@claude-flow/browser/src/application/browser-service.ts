/**
 * @claude-flow/browser - Browser Service
 * Core application service integrating agent-browser with agentic-flow
 */

import { AgentBrowserAdapter } from '../infrastructure/agent-browser-adapter.js';
import { createMemoryManager, type BrowserMemoryManager } from '../infrastructure/memory-integration.js';
import { getSecurityScanner, type BrowserSecurityScanner, type ThreatScanResult } from '../infrastructure/security-integration.js';
import { sealTrajectory, type SealedTrajectory } from './signed-trajectory-service.js';
import type { WitnessKey } from '../infrastructure/witness-signer.js';
import type {
  Snapshot,
  SnapshotOptions,
  ActionResult,
  BrowserSession,
  BrowserTrajectory,
  BrowserTrajectoryStep,
  BrowserSwarmConfig,
  BrowserAgentConfig,
} from '../domain/types.js';

// ============================================================================
// Trajectory Tracking for ReasoningBank Integration
// ============================================================================

interface TrajectoryTracker {
  id: string;
  sessionId: string;
  goal: string;
  steps: BrowserTrajectoryStep[];
  startedAt: string;
  lastSnapshot?: Snapshot;
}

const activeTrajectories = new Map<string, TrajectoryTracker>();

// ============================================================================
// Browser Service Class
// ============================================================================

export interface BrowserServiceConfig extends Partial<BrowserAgentConfig> {
  enableMemory?: boolean;
  enableSecurity?: boolean;
  requireHttps?: boolean;
  blockedDomains?: string[];
  allowedDomains?: string[];
  /** ADR-122 Phase 1: sign every completed trajectory with Ed25519 witness. */
  signTrajectories?: boolean;
  /** Override the witness key (else resolved from RUFLO_BROWSER_WITNESS_KEY or generated). */
  witnessKey?: WitnessKey;
  /** Project ID embedded in signed envelopes (federation trust boundary). */
  projectId?: string;
}

export class BrowserService {
  private adapter: AgentBrowserAdapter;
  private sessionId: string;
  private currentTrajectory?: string;
  private snapshots: Map<string, Snapshot> = new Map();
  private memoryManager?: BrowserMemoryManager;
  private securityScanner?: BrowserSecurityScanner;
  private config: BrowserServiceConfig;

  constructor(config: BrowserServiceConfig = {}) {
    this.config = config;
    this.sessionId = config.sessionId || `browser-${Date.now()}`;
    this.adapter = new AgentBrowserAdapter({
      session: this.sessionId,
      timeout: config.defaultTimeout || 30000,
      headless: config.headless !== false,
    });

    // Initialize memory integration if enabled (default: true)
    if (config.enableMemory !== false) {
      this.memoryManager = createMemoryManager(this.sessionId);
    }

    // Initialize security scanning if enabled (default: true)
    if (config.enableSecurity !== false) {
      this.securityScanner = getSecurityScanner({
        requireHttps: config.requireHttps,
        blockedDomains: config.blockedDomains,
        allowedDomains: config.allowedDomains,
      });
    }
  }

  // ===========================================================================
  // Trajectory Management (for ReasoningBank/SONA learning)
  // ===========================================================================

  /**
   * Start a new trajectory for learning
   */
  startTrajectory(goal: string): string {
    const id = `traj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    activeTrajectories.set(id, {
      id,
      sessionId: this.sessionId,
      goal,
      steps: [],
      startedAt: new Date().toISOString(),
    });
    this.currentTrajectory = id;
    return id;
  }

  /**
   * Record a step in the current trajectory
   */
  private recordStep(action: string, input: Record<string, unknown> | object, result: ActionResult): void {
    if (!this.currentTrajectory) return;

    const trajectory = activeTrajectories.get(this.currentTrajectory);
    if (!trajectory) return;

    trajectory.steps.push({
      action,
      input: input as Record<string, unknown>,
      result,
      snapshot: trajectory.lastSnapshot,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * End trajectory and return for learning (also stores in memory).
   *
   * When `signTrajectories: true` is configured, the completed trajectory is
   * also sealed into an Ed25519-signed envelope (ADR-122 Phase 1). The signed
   * envelope is attached to the returned object as `__sealed` so callers can
   * persist it to disk or distribute via federation.
   */
  async endTrajectory(success: boolean, verdict?: string): Promise<(BrowserTrajectory & { __sealed?: SealedTrajectory }) | null> {
    if (!this.currentTrajectory) return null;

    const trajectory = activeTrajectories.get(this.currentTrajectory);
    if (!trajectory) return null;

    const completed: BrowserTrajectory = {
      id: trajectory.id,
      sessionId: trajectory.sessionId,
      goal: trajectory.goal,
      steps: trajectory.steps,
      startedAt: trajectory.startedAt,
      completedAt: new Date().toISOString(),
      success,
      verdict,
    };

    // Store in memory for learning
    if (this.memoryManager) {
      await this.memoryManager.storeTrajectory(completed);
    }

    activeTrajectories.delete(this.currentTrajectory);
    this.currentTrajectory = undefined;

    // ADR-122 Phase 1: optionally seal the trajectory.
    let sealed: SealedTrajectory | undefined;
    if (this.config.signTrajectories) {
      sealed = sealTrajectory({
        trajectory: completed,
        witnessKey: this.config.witnessKey,
        projectId: this.config.projectId,
      });
    }

    return sealed ? { ...completed, __sealed: sealed } : completed;
  }

  /**
   * Get current trajectory for inspection
   */
  getCurrentTrajectory(): TrajectoryTracker | null {
    if (!this.currentTrajectory) return null;
    return activeTrajectories.get(this.currentTrajectory) || null;
  }

  // ===========================================================================
  // Core Browser Operations
  // ===========================================================================

  /**
   * Navigate to URL with trajectory tracking and security scanning
   */
  async open(url: string, options?: { waitUntil?: 'load' | 'domcontentloaded' | 'networkidle'; headers?: Record<string, string>; skipSecurityCheck?: boolean }): Promise<ActionResult> {
    // Security check before navigation
    if (this.securityScanner && !options?.skipSecurityCheck) {
      const scanResult = await this.securityScanner.scanUrl(url);
      if (!scanResult.safe) {
        const threats = scanResult.threats.map(t => `${t.type}: ${t.description}`).join('; ');
        return {
          success: false,
          error: `Security scan failed: ${threats}`,
          data: { scanResult },
        };
      }
    }

    const result = await this.adapter.open({
      url,
      waitUntil: options?.waitUntil,
      headers: options?.headers,
    });
    this.recordStep('open', { url, ...options }, result);
    return result;
  }

  /**
   * Scan URL for security threats without navigating
   */
  async scanUrl(url: string): Promise<ThreatScanResult> {
    if (!this.securityScanner) {
      return { safe: true, threats: [], pii: [], score: 1, scanDuration: 0 };
    }
    return this.securityScanner.scanUrl(url);
  }

  /**
   * Get snapshot with automatic caching
   */
  async snapshot(options: SnapshotOptions = {}): Promise<ActionResult<Snapshot>> {
    const result = await this.adapter.snapshot({
      interactive: options.interactive !== false,
      compact: options.compact !== false,
      ...options,
    });

    if (result.success && result.data) {
      // Cache snapshot and update trajectory
      const snapshot = result.data as Snapshot;
      this.snapshots.set('latest', snapshot);

      if (this.currentTrajectory) {
        const trajectory = activeTrajectories.get(this.currentTrajectory);
        if (trajectory) {
          trajectory.lastSnapshot = snapshot;
        }
      }
    }

    this.recordStep('snapshot', options, result);
    return result as ActionResult<Snapshot>;
  }

  /**
   * Click with trajectory tracking
   */
  async click(target: string, options?: { button?: 'left' | 'right' | 'middle'; force?: boolean }): Promise<ActionResult> {
    const result = await this.adapter.click({
      target,
      ...options,
    });
    this.recordStep('click', { target, ...options }, result);
    return result;
  }

  /**
   * Fill input with trajectory tracking and PII scanning
   */
  async fill(target: string, value: string, options?: { force?: boolean; skipPIICheck?: boolean }): Promise<ActionResult> {
    // Check for PII in the value
    if (this.securityScanner && !options?.skipPIICheck) {
      const scanResult = this.securityScanner.scanContent(value, target);
      if (scanResult.pii.length > 0) {
        // Log masked values for security
        const maskedPII = scanResult.pii.map(p => `${p.type}: ${p.masked}`).join(', ');
        console.log(`[security] PII detected in form field ${target}: ${maskedPII}`);
      }
    }

    const result = await this.adapter.fill({
      target,
      value,
      ...options,
    });
    this.recordStep('fill', { target, value: this.securityScanner ? '[REDACTED]' : value, ...options }, result);
    return result;
  }

  /**
   * Check if content contains PII
   */
  scanForPII(content: string, context?: string): ThreatScanResult {
    if (!this.securityScanner) {
      return { safe: true, threats: [], pii: [], score: 1, scanDuration: 0 };
    }
    return this.securityScanner.scanContent(content, context);
  }

  /**
   * Type text with trajectory tracking
   */
  async type(target: string, text: string, options?: { delay?: number }): Promise<ActionResult> {
    const result = await this.adapter.type({
      target,
      text,
      ...options,
    });
    this.recordStep('type', { target, text, ...options }, result);
    return result;
  }

  /**
   * Press key with trajectory tracking
   */
  async press(key: string, delay?: number): Promise<ActionResult> {
    const result = await this.adapter.press(key, delay);
    this.recordStep('press', { key, delay }, result);
    return result;
  }

  /**
   * Wait for condition
   */
  async wait(options: { selector?: string; timeout?: number; text?: string; url?: string; load?: 'load' | 'domcontentloaded' | 'networkidle'; fn?: string }): Promise<ActionResult> {
    const result = await this.adapter.wait(options);
    this.recordStep('wait', options, result);
    return result;
  }

  /**
   * Get element text
   */
  async getText(target: string): Promise<ActionResult<string>> {
    const result = await this.adapter.getText(target);
    this.recordStep('getText', { target }, result);
    return result;
  }

  /**
   * Execute JavaScript
   */
  async eval<T = unknown>(script: string): Promise<ActionResult<T>> {
    const result = await this.adapter.eval<T>({ script });
    this.recordStep('eval', { script }, result);
    return result;
  }

  /**
   * Take screenshot
   */
  async screenshot(options?: { path?: string; fullPage?: boolean }): Promise<ActionResult<string>> {
    const result = await this.adapter.screenshot(options || {});
    this.recordStep('screenshot', options || {}, result);
    return result;
  }

  /**
   * Close browser
   */
  async close(): Promise<ActionResult> {
    const result = await this.adapter.close();
    this.recordStep('close', {}, result);
    return result;
  }

  // ===========================================================================
  // High-Level Workflow Operations
  // ===========================================================================

  /**
   * Authenticate using header injection (skips login UI)
   */
  async authenticateWithHeaders(url: string, headers: Record<string, string>): Promise<ActionResult> {
    return this.open(url, { headers });
  }

  /**
   * Fill and submit a form
   */
  async submitForm(fields: Array<{ target: string; value: string }>, submitButton: string): Promise<ActionResult> {
    // Fill all fields
    for (const field of fields) {
      const result = await this.fill(field.target, field.value);
      if (!result.success) return result;
    }

    // Click submit
    return this.click(submitButton);
  }

  /**
   * Extract data using snapshot refs
   */
  async extractData(refs: string[]): Promise<Record<string, string>> {
    const data: Record<string, string> = {};
    for (const ref of refs) {
      const result = await this.getText(ref);
      if (result.success && result.data) {
        data[ref] = result.data;
      }
    }
    return data;
  }

  /**
   * Navigate and wait for specific element
   */
  async navigateAndWait(url: string, selector: string, timeout?: number): Promise<ActionResult> {
    const navResult = await this.open(url);
    if (!navResult.success) return navResult;

    return this.wait({ selector, timeout });
  }

  // ===========================================================================
  // Session State
  // ===========================================================================

  /**
   * Get cached snapshot
   */
  getLatestSnapshot(): Snapshot | null {
    return this.snapshots.get('latest') || null;
  }

  /**
   * Get session ID
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Get underlying adapter for advanced operations
   */
  getAdapter(): AgentBrowserAdapter {
    return this.adapter;
  }

  /**
   * Get memory manager for direct memory operations
   */
  getMemoryManager(): BrowserMemoryManager | undefined {
    return this.memoryManager;
  }

  /**
   * Get security scanner for direct security operations
   */
  getSecurityScanner(): BrowserSecurityScanner | undefined {
    return this.securityScanner;
  }

  /**
   * Find similar trajectories for a goal (uses HNSW search)
   */
  async findSimilarTrajectories(goal: string, topK = 5): Promise<BrowserTrajectory[]> {
    if (!this.memoryManager) return [];
    return this.memoryManager.findSimilarTrajectories(goal, topK);
  }

  /**
   * Get session memory statistics
   */
  async getMemoryStats(): Promise<{
    trajectories: number;
    patterns: number;
    snapshots: number;
    errors: number;
    successRate: number;
  } | null> {
    if (!this.memoryManager) return null;
    return this.memoryManager.getSessionStats();
  }
}

// ============================================================================
// Browser Swarm Coordinator
// ============================================================================

export class BrowserSwarmCoordinator {
  private config: BrowserSwarmConfig;
  private services: Map<string, BrowserService> = new Map();
  private sharedData: Map<string, unknown> = new Map();

  constructor(config: BrowserSwarmConfig) {
    this.config = config;
  }

  /**
   * Spawn a new browser agent in the swarm
   */
  async spawnAgent(role: 'navigator' | 'scraper' | 'validator' | 'tester' | 'monitor'): Promise<BrowserService> {
    if (this.services.size >= this.config.maxSessions) {
      throw new Error(`Max sessions (${this.config.maxSessions}) reached`);
    }

    const sessionId = `${this.config.sessionPrefix}-${role}-${Date.now()}`;
    const service = new BrowserService({
      sessionId,
      role,
      capabilities: this.getCapabilitiesForRole(role),
      defaultTimeout: 30000,
      headless: true,
    });

    this.services.set(sessionId, service);
    return service;
  }

  /**
   * Get capabilities for a role
   */
  private getCapabilitiesForRole(role: string): string[] {
    switch (role) {
      case 'navigator':
        return ['navigation', 'authentication', 'session-management'];
      case 'scraper':
        return ['snapshot', 'extraction', 'pagination'];
      case 'validator':
        return ['assertions', 'state-checks', 'screenshots'];
      case 'tester':
        return ['forms', 'interactions', 'assertions'];
      case 'monitor':
        return ['network', 'console', 'errors'];
      default:
        return [];
    }
  }

  /**
   * Share data between agents
   */
  shareData(key: string, value: unknown): void {
    this.sharedData.set(key, value);
  }

  /**
   * Get shared data
   */
  getSharedData<T>(key: string): T | undefined {
    return this.sharedData.get(key) as T | undefined;
  }

  /**
   * Get all active sessions
   */
  getSessions(): string[] {
    return Array.from(this.services.keys());
  }

  /**
   * Get a specific service
   */
  getService(sessionId: string): BrowserService | undefined {
    return this.services.get(sessionId);
  }

  /**
   * Close all sessions
   */
  async closeAll(): Promise<void> {
    const closePromises = Array.from(this.services.values()).map(s => s.close());
    await Promise.all(closePromises);
    this.services.clear();
  }

  /**
   * Get coordinator stats
   */
  getStats(): { activeSessions: number; maxSessions: number; topology: string } {
    return {
      activeSessions: this.services.size,
      maxSessions: this.config.maxSessions,
      topology: this.config.topology,
    };
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a standalone browser service
 */
export function createBrowserService(options?: Partial<BrowserAgentConfig>): BrowserService {
  return new BrowserService(options);
}

/**
 * Create a browser swarm coordinator
 */
export function createBrowserSwarm(config?: Partial<BrowserSwarmConfig>): BrowserSwarmCoordinator {
  return new BrowserSwarmCoordinator({
    topology: config?.topology || 'hierarchical',
    maxSessions: config?.maxSessions || 5,
    sessionPrefix: config?.sessionPrefix || 'swarm',
    sharedCookies: config?.sharedCookies,
    coordinatorSession: config?.coordinatorSession,
  });
}

export default BrowserService;
