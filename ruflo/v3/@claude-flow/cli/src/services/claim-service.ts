/**
 * V3 Collaborative Issue Claims Service
 *
 * Implements ADR-016: Collaborative Issue Claims for Human-Agent Workflows
 *
 * Features:
 * - Issue claiming/releasing for humans and agents
 * - Handoff mechanisms between humans and agents
 * - Work stealing for idle agents
 * - Load balancing across swarm
 * - GitHub integration
 *
 * @see /v3/implementation/adrs/ADR-016-collaborative-issue-claims.md
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';

// ============================================================================
// Types
// ============================================================================

export type Claimant =
  | { type: 'human'; userId: string; name: string }
  | { type: 'agent'; agentId: string; agentType: string };

export type ClaimStatus =
  | 'active'
  | 'paused'
  | 'handoff-pending'
  | 'review-requested'
  | 'blocked'
  | 'stealable'
  | 'completed';

export type StealReason =
  | 'overloaded'
  | 'stale'
  | 'blocked-timeout'
  | 'voluntary';

export interface IssueClaim {
  issueId: string;
  claimant: Claimant;
  claimedAt: Date;
  status: ClaimStatus;
  statusChangedAt: Date;
  expiresAt?: Date;
  handoffTo?: Claimant;
  handoffReason?: string;
  blockReason?: string;
  progress: number; // 0-100
  context?: string;
}

export interface StealableInfo {
  reason: StealReason;
  stealableAt: Date;
  preferredTypes?: string[];
  progress: number;
  context?: string;
}

export interface ClaimResult {
  success: boolean;
  claim?: IssueClaim;
  error?: string;
}

export interface StealResult {
  success: boolean;
  claim?: IssueClaim;
  previousOwner?: Claimant;
  context?: StealableInfo;
  error?: string;
}

export interface AgentLoadInfo {
  agentId: string;
  agentType: string;
  claimCount: number;
  maxClaims: number;
  utilization: number;
  claims: IssueClaim[];
  avgCompletionTime: number;
  currentBlockedCount: number;
}

export interface RebalanceResult {
  moved: Array<{
    issueId: string;
    from: Claimant;
    to: Claimant;
  }>;
  suggested: Array<{
    issueId: string;
    currentOwner: Claimant;
    suggestedOwner: Claimant;
    reason: string;
  }>;
}

export interface WorkStealingConfig {
  staleThresholdMinutes: number;
  blockedThresholdMinutes: number;
  overloadThreshold: number;
  gracePeriodMinutes: number;
  minProgressToProtect: number;
  contestWindowMinutes: number;
  requireSameType: boolean;
  allowCrossTypeSteal: string[][];
}

export interface IssueFilters {
  status?: ClaimStatus[];
  labels?: string[];
  agentTypes?: string[];
  priority?: string[];
}

// ============================================================================
// GitHub Integration Types
// ============================================================================

export interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed';
  labels: string[];
  assignees: string[];
  url: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface GitHubSyncConfig {
  enabled: boolean;
  repo?: string; // owner/repo
  syncLabels: boolean;
  claimLabel: string;
  autoAssign: boolean;
  commentOnClaim: boolean;
  commentOnRelease: boolean;
}

export interface GitHubSyncResult {
  success: boolean;
  synced: number;
  errors: string[];
  issues?: GitHubIssue[];
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: WorkStealingConfig = {
  staleThresholdMinutes: 30,
  blockedThresholdMinutes: 60,
  overloadThreshold: 5,
  gracePeriodMinutes: 10,
  minProgressToProtect: 75,
  contestWindowMinutes: 5,
  requireSameType: false,
  allowCrossTypeSteal: [
    ['coder', 'debugger'],
    ['tester', 'reviewer'],
  ],
};

// ============================================================================
// Claim Events
// ============================================================================

export type ClaimEventType =
  | 'issue:claimed'
  | 'issue:released'
  | 'issue:handoff:requested'
  | 'issue:handoff:accepted'
  | 'issue:handoff:rejected'
  | 'issue:status:changed'
  | 'issue:review:requested'
  | 'issue:expired'
  | 'issue:stealable'
  | 'issue:stolen'
  | 'issue:steal:contested'
  | 'issue:steal:resolved'
  | 'swarm:rebalanced'
  | 'agent:overloaded'
  | 'agent:underloaded';

export interface ClaimEvent {
  type: ClaimEventType;
  timestamp: Date;
  issueId?: string;
  claimant?: Claimant;
  previousClaimant?: Claimant;
  data?: Record<string, unknown>;
}

// ============================================================================
// Claim Service Implementation
// ============================================================================

export class ClaimService extends EventEmitter {
  private claims = new Map<string, IssueClaim>();
  private stealableInfo = new Map<string, StealableInfo>();
  private storagePath: string;
  private config: WorkStealingConfig;
  private eventLog: ClaimEvent[] = [];

  constructor(projectRoot: string, config?: Partial<WorkStealingConfig>) {
    super();
    this.storagePath = path.join(projectRoot, '.claude-flow', 'claims');
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ==========================================================================
  // Initialization
  // ==========================================================================

  async initialize(): Promise<void> {
    // Ensure storage directory exists
    if (!fs.existsSync(this.storagePath)) {
      fs.mkdirSync(this.storagePath, { recursive: true });
    }

    // Load existing claims
    await this.loadClaims();
  }

  private async loadClaims(): Promise<void> {
    const claimsFile = path.join(this.storagePath, 'claims.json');
    if (fs.existsSync(claimsFile)) {
      try {
        const data = JSON.parse(fs.readFileSync(claimsFile, 'utf-8'));
        for (const claim of data.claims || []) {
          claim.claimedAt = new Date(claim.claimedAt);
          claim.statusChangedAt = new Date(claim.statusChangedAt);
          if (claim.expiresAt) claim.expiresAt = new Date(claim.expiresAt);
          this.claims.set(claim.issueId, claim);
        }
      } catch {
        // Start fresh if file is corrupted
      }
    }
  }

  private async saveClaims(): Promise<void> {
    const claimsFile = path.join(this.storagePath, 'claims.json');
    const data = {
      claims: Array.from(this.claims.values()),
      savedAt: new Date().toISOString(),
    };
    fs.writeFileSync(claimsFile, JSON.stringify(data, null, 2));
  }

  // ==========================================================================
  // Core Claiming
  // ==========================================================================

  async claim(issueId: string, claimant: Claimant): Promise<ClaimResult> {
    // Check if already claimed
    const existing = this.claims.get(issueId);
    if (existing && existing.status !== 'stealable') {
      return {
        success: false,
        error: `Issue ${issueId} is already claimed by ${this.formatClaimant(existing.claimant)}`,
      };
    }

    const now = new Date();
    const claim: IssueClaim = {
      issueId,
      claimant,
      claimedAt: now,
      status: 'active',
      statusChangedAt: now,
      progress: 0,
    };

    this.claims.set(issueId, claim);
    await this.saveClaims();

    this.emitEvent({
      type: 'issue:claimed',
      timestamp: now,
      issueId,
      claimant,
      previousClaimant: existing?.claimant,
    });

    return { success: true, claim };
  }

  async release(issueId: string, claimant: Claimant): Promise<void> {
    const claim = this.claims.get(issueId);
    if (!claim) {
      throw new Error(`Issue ${issueId} is not claimed`);
    }

    if (!this.isSameClaimant(claim.claimant, claimant)) {
      throw new Error(`Issue ${issueId} is not claimed by ${this.formatClaimant(claimant)}`);
    }

    this.claims.delete(issueId);
    this.stealableInfo.delete(issueId);
    await this.saveClaims();

    this.emitEvent({
      type: 'issue:released',
      timestamp: new Date(),
      issueId,
      claimant,
    });
  }

  // ==========================================================================
  // Handoffs
  // ==========================================================================

  async requestHandoff(
    issueId: string,
    from: Claimant,
    to: Claimant,
    reason: string
  ): Promise<void> {
    const claim = this.claims.get(issueId);
    if (!claim) {
      throw new Error(`Issue ${issueId} is not claimed`);
    }

    if (!this.isSameClaimant(claim.claimant, from)) {
      throw new Error(`Issue ${issueId} is not claimed by ${this.formatClaimant(from)}`);
    }

    claim.status = 'handoff-pending';
    claim.statusChangedAt = new Date();
    claim.handoffTo = to;
    claim.handoffReason = reason;
    await this.saveClaims();

    this.emitEvent({
      type: 'issue:handoff:requested',
      timestamp: new Date(),
      issueId,
      claimant: from,
      data: { to, reason },
    });
  }

  async acceptHandoff(issueId: string, claimant: Claimant): Promise<void> {
    const claim = this.claims.get(issueId);
    if (!claim || claim.status !== 'handoff-pending') {
      throw new Error(`No pending handoff for issue ${issueId}`);
    }

    if (!claim.handoffTo || !this.isSameClaimant(claim.handoffTo, claimant)) {
      throw new Error(`Handoff not addressed to ${this.formatClaimant(claimant)}`);
    }

    const previousClaimant = claim.claimant;
    claim.claimant = claimant;
    claim.status = 'active';
    claim.statusChangedAt = new Date();
    delete claim.handoffTo;
    delete claim.handoffReason;
    await this.saveClaims();

    this.emitEvent({
      type: 'issue:handoff:accepted',
      timestamp: new Date(),
      issueId,
      claimant,
      previousClaimant,
    });
  }

  async rejectHandoff(issueId: string, claimant: Claimant, reason: string): Promise<void> {
    const claim = this.claims.get(issueId);
    if (!claim || claim.status !== 'handoff-pending') {
      throw new Error(`No pending handoff for issue ${issueId}`);
    }

    if (!claim.handoffTo || !this.isSameClaimant(claim.handoffTo, claimant)) {
      throw new Error(`Handoff not addressed to ${this.formatClaimant(claimant)}`);
    }

    claim.status = 'active';
    claim.statusChangedAt = new Date();
    delete claim.handoffTo;
    delete claim.handoffReason;
    await this.saveClaims();

    this.emitEvent({
      type: 'issue:handoff:rejected',
      timestamp: new Date(),
      issueId,
      claimant,
      data: { reason },
    });
  }

  // ==========================================================================
  // Status Updates
  // ==========================================================================

  async updateStatus(issueId: string, status: ClaimStatus, note?: string): Promise<void> {
    const claim = this.claims.get(issueId);
    if (!claim) {
      throw new Error(`Issue ${issueId} is not claimed`);
    }

    const previousStatus = claim.status;
    claim.status = status;
    claim.statusChangedAt = new Date();

    if (status === 'blocked' && note) {
      claim.blockReason = note;
    }
    if (status === 'completed') {
      claim.progress = 100;
    }

    await this.saveClaims();

    this.emitEvent({
      type: 'issue:status:changed',
      timestamp: new Date(),
      issueId,
      data: { previousStatus, newStatus: status, note },
    });
  }

  async updateProgress(issueId: string, progress: number): Promise<void> {
    const claim = this.claims.get(issueId);
    if (!claim) {
      throw new Error(`Issue ${issueId} is not claimed`);
    }

    claim.progress = Math.min(100, Math.max(0, progress));
    await this.saveClaims();
  }

  async requestReview(issueId: string, reviewers: Claimant[]): Promise<void> {
    const claim = this.claims.get(issueId);
    if (!claim) {
      throw new Error(`Issue ${issueId} is not claimed`);
    }

    claim.status = 'review-requested';
    claim.statusChangedAt = new Date();
    await this.saveClaims();

    this.emitEvent({
      type: 'issue:review:requested',
      timestamp: new Date(),
      issueId,
      claimant: claim.claimant,
      data: { reviewers },
    });
  }

  // ==========================================================================
  // Work Stealing
  // ==========================================================================

  async markStealable(issueId: string, info: StealableInfo): Promise<void> {
    const claim = this.claims.get(issueId);
    if (!claim) {
      throw new Error(`Issue ${issueId} is not claimed`);
    }

    claim.status = 'stealable';
    claim.statusChangedAt = new Date();
    claim.context = info.context;
    claim.progress = info.progress;
    this.stealableInfo.set(issueId, info);
    await this.saveClaims();

    this.emitEvent({
      type: 'issue:stealable',
      timestamp: new Date(),
      issueId,
      claimant: claim.claimant,
      data: { info },
    });
  }

  async steal(issueId: string, stealer: Claimant): Promise<StealResult> {
    const claim = this.claims.get(issueId);
    if (!claim) {
      return { success: false, error: `Issue ${issueId} is not claimed` };
    }

    if (claim.status !== 'stealable') {
      return { success: false, error: `Issue ${issueId} is not stealable` };
    }

    const info = this.stealableInfo.get(issueId);
    const previousOwner = claim.claimant;

    // Check if steal is allowed
    if (this.config.requireSameType && stealer.type === 'agent' && previousOwner.type === 'agent') {
      if (stealer.agentType !== previousOwner.agentType) {
        const allowed = this.config.allowCrossTypeSteal.some(
          pair => pair.includes(stealer.agentType) && pair.includes(previousOwner.agentType)
        );
        if (!allowed) {
          return { success: false, error: `Cross-type steal not allowed` };
        }
      }
    }

    // Execute steal
    claim.claimant = stealer;
    claim.status = 'active';
    claim.statusChangedAt = new Date();
    claim.claimedAt = new Date();
    this.stealableInfo.delete(issueId);
    await this.saveClaims();

    this.emitEvent({
      type: 'issue:stolen',
      timestamp: new Date(),
      issueId,
      claimant: stealer,
      previousClaimant: previousOwner,
      data: { context: info },
    });

    return { success: true, claim, previousOwner, context: info };
  }

  async getStealable(agentType?: string): Promise<IssueClaim[]> {
    const stealable: IssueClaim[] = [];

    for (const claim of this.claims.values()) {
      if (claim.status !== 'stealable') continue;

      const info = this.stealableInfo.get(claim.issueId);
      if (agentType && info?.preferredTypes?.length) {
        if (!info.preferredTypes.includes(agentType)) continue;
      }

      stealable.push(claim);
    }

    return stealable;
  }

  async contestSteal(issueId: string, originalClaimant: Claimant, reason: string): Promise<void> {
    const claim = this.claims.get(issueId);
    if (!claim) {
      throw new Error(`Issue ${issueId} is not claimed`);
    }

    this.emitEvent({
      type: 'issue:steal:contested',
      timestamp: new Date(),
      issueId,
      claimant: originalClaimant,
      data: { reason, currentOwner: claim.claimant },
    });

    // Contest resolution would typically be handled by a coordinator or human
  }

  // ==========================================================================
  // Load Balancing
  // ==========================================================================

  async getAgentLoad(agentId: string): Promise<AgentLoadInfo> {
    const claims: IssueClaim[] = [];
    let blockedCount = 0;

    for (const claim of this.claims.values()) {
      if (claim.claimant.type === 'agent' && claim.claimant.agentId === agentId) {
        claims.push(claim);
        if (claim.status === 'blocked') blockedCount++;
      }
    }

    const agentType = claims[0]?.claimant.type === 'agent' ? claims[0].claimant.agentType : 'unknown';

    return {
      agentId,
      agentType,
      claimCount: claims.length,
      maxClaims: this.config.overloadThreshold,
      utilization: claims.length / this.config.overloadThreshold,
      claims,
      avgCompletionTime: 0, // Would need historical data
      currentBlockedCount: blockedCount,
    };
  }

  async rebalance(swarmId: string): Promise<RebalanceResult> {
    const result: RebalanceResult = { moved: [], suggested: [] };

    // Get all agent loads
    const agentLoads = new Map<string, AgentLoadInfo>();
    const agentTypes = new Set<string>();

    for (const claim of this.claims.values()) {
      if (claim.claimant.type !== 'agent') continue;
      const agentId = claim.claimant.agentId;

      if (!agentLoads.has(agentId)) {
        const load = await this.getAgentLoad(agentId);
        agentLoads.set(agentId, load);
        agentTypes.add(load.agentType);
      }
    }

    // For each agent type, calculate average load
    for (const agentType of agentTypes) {
      const typeLoads = Array.from(agentLoads.values()).filter(l => l.agentType === agentType);
      const avgLoad = typeLoads.reduce((sum, l) => sum + l.utilization, 0) / typeLoads.length;

      const overloaded = typeLoads.filter(l => l.utilization > avgLoad * 1.5);
      const underloaded = typeLoads.filter(l => l.utilization < avgLoad * 0.5);

      // Generate suggestions
      for (const over of overloaded) {
        const lowProgressClaims = over.claims
          .filter(c => c.progress < 25)
          .sort((a, b) => a.progress - b.progress);

        for (const claim of lowProgressClaims) {
          const target = underloaded.find(u => u.claimCount < u.maxClaims);
          if (target) {
            result.suggested.push({
              issueId: claim.issueId,
              currentOwner: claim.claimant,
              suggestedOwner: {
                type: 'agent',
                agentId: target.agentId,
                agentType: target.agentType,
              },
              reason: 'Load balancing: redistributing work across swarm',
            });
          }
        }
      }
    }

    return result;
  }

  // ==========================================================================
  // Queries
  // ==========================================================================

  async getClaimedBy(claimant: Claimant): Promise<IssueClaim[]> {
    return Array.from(this.claims.values()).filter(c =>
      this.isSameClaimant(c.claimant, claimant)
    );
  }

  async getAvailableIssues(_filters?: IssueFilters): Promise<string[]> {
    // This would integrate with GitHub API
    // For now, return issues that are not claimed
    return [];
  }

  async getIssueStatus(issueId: string): Promise<IssueClaim | null> {
    return this.claims.get(issueId) || null;
  }

  async getAllClaims(): Promise<IssueClaim[]> {
    return Array.from(this.claims.values());
  }

  async getByStatus(status: ClaimStatus): Promise<IssueClaim[]> {
    return Array.from(this.claims.values()).filter(c => c.status === status);
  }

  // ==========================================================================
  // Auto-Management
  // ==========================================================================

  async expireStale(maxAgeMinutes?: number): Promise<IssueClaim[]> {
    const threshold = maxAgeMinutes ?? this.config.staleThresholdMinutes;
    const now = Date.now();
    const expired: IssueClaim[] = [];

    for (const claim of this.claims.values()) {
      if (claim.status === 'stealable' || claim.status === 'completed') continue;

      const age = (now - claim.statusChangedAt.getTime()) / 60000;
      if (age > threshold) {
        // Mark as stealable
        await this.markStealable(claim.issueId, {
          reason: 'stale',
          stealableAt: new Date(),
          progress: claim.progress,
          context: `Stale: No activity for ${Math.round(age)} minutes`,
        });
        expired.push(claim);
      }
    }

    return expired;
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  private formatClaimant(claimant: Claimant): string {
    return claimant.type === 'human'
      ? `human:${claimant.name}`
      : `agent:${claimant.agentType}:${claimant.agentId}`;
  }

  private isSameClaimant(a: Claimant, b: Claimant): boolean {
    if (a.type !== b.type) return false;
    if (a.type === 'human' && b.type === 'human') {
      return a.userId === b.userId;
    }
    if (a.type === 'agent' && b.type === 'agent') {
      return a.agentId === b.agentId;
    }
    return false;
  }

  private emitEvent(event: ClaimEvent): void {
    this.eventLog.push(event);
    if (this.eventLog.length > 1000) {
      this.eventLog = this.eventLog.slice(-500);
    }
    this.emit(event.type, event);
  }

  getEventLog(limit = 100): ClaimEvent[] {
    return this.eventLog.slice(-limit);
  }
}

// ============================================================================
// GitHub Sync Implementation
// ============================================================================

const DEFAULT_GITHUB_CONFIG: GitHubSyncConfig = {
  enabled: false,
  syncLabels: true,
  claimLabel: 'claimed',
  autoAssign: true,
  commentOnClaim: true,
  commentOnRelease: true,
};

// ============================================================================
// Input Validation (Security)
// ============================================================================

/**
 * Validate GitHub repository format (owner/repo)
 * Prevents command injection via malicious repo names
 */
function isValidRepo(repo: string): boolean {
  // owner/repo format: alphanumeric, hyphens, underscores, dots
  return /^[\w.-]+\/[\w.-]+$/.test(repo) && repo.length <= 100;
}

/**
 * Validate issue number (positive integer)
 */
function isValidIssueNumber(num: number): boolean {
  return Number.isInteger(num) && num > 0 && num < 1000000000;
}

/**
 * Validate claimant name (GitHub username format)
 * Prevents command injection via malicious usernames
 */
function isValidClaimantName(name: string): boolean {
  // GitHub usernames: alphanumeric, hyphens, max 39 chars
  return /^[\w-]+$/.test(name) && name.length >= 1 && name.length <= 39;
}

/**
 * Validate label name
 * Prevents command injection via malicious label names
 */
function isValidLabel(label: string): boolean {
  // Labels: alphanumeric, hyphens, underscores, spaces, max 50 chars
  return /^[\w\s-]+$/.test(label) && label.length >= 1 && label.length <= 50;
}

/**
 * Sanitize error messages to prevent information disclosure
 */
function sanitizeError(error: Error): string {
  const msg = error.message || 'Unknown error';
  // Remove paths and sensitive details
  return msg.replace(/\/[\w./-]+/g, '[path]').substring(0, 200);
}

export class GitHubSync {
  private config: GitHubSyncConfig;
  private claimService: ClaimService;

  constructor(claimService: ClaimService, config?: Partial<GitHubSyncConfig>) {
    this.claimService = claimService;
    this.config = { ...DEFAULT_GITHUB_CONFIG, ...config };
  }

  /**
   * Check if GitHub CLI is available
   */
  isGhAvailable(): boolean {
    try {
      execFileSync('gh', ['--version'], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the current repository from git remote
   */
  getRepo(): string | null {
    if (this.config.repo) {
      return isValidRepo(this.config.repo) ? this.config.repo : null;
    }
    try {
      const remote = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf-8' }).trim();
      const match = remote.match(/github\.com[/:]([\w.-]+\/[\w.-]+)/);
      const repo = match ? match[1].replace('.git', '') : null;
      return repo && isValidRepo(repo) ? repo : null;
    } catch {
      return null;
    }
  }

  /**
   * Sync issues from GitHub
   */
  async syncIssues(state: 'open' | 'closed' | 'all' = 'open'): Promise<GitHubSyncResult> {
    const errors: string[] = [];
    const issues: GitHubIssue[] = [];

    if (!this.isGhAvailable()) {
      return { success: false, synced: 0, errors: ['GitHub CLI (gh) not installed'] };
    }

    const repo = this.getRepo();
    if (!repo) {
      return { success: false, synced: 0, errors: ['Could not determine GitHub repository'] };
    }

    // Validate state parameter (whitelist)
    const validStates = ['open', 'closed', 'all'];
    if (!validStates.includes(state)) {
      return { success: false, synced: 0, errors: ['Invalid state parameter'] };
    }

    try {
      const issuesJson = execFileSync('gh', [
        'issue', 'list',
        '--repo', repo,
        '--state', state,
        '--json', 'number,title,body,state,labels,assignees,url,createdAt,updatedAt',
        '--limit', '100'
      ], { encoding: 'utf-8' });
      const rawIssues = JSON.parse(issuesJson);

      for (const raw of rawIssues) {
        issues.push({
          number: raw.number,
          title: raw.title,
          body: raw.body || '',
          state: raw.state === 'OPEN' ? 'open' : 'closed',
          labels: raw.labels?.map((l: { name: string }) => l.name) || [],
          assignees: raw.assignees?.map((a: { login: string }) => a.login) || [],
          url: raw.url,
          createdAt: new Date(raw.createdAt),
          updatedAt: new Date(raw.updatedAt),
        });
      }

      return { success: true, synced: issues.length, errors, issues };
    } catch (error) {
      errors.push(`Failed to fetch issues: ${sanitizeError(error as Error)}`);
      return { success: false, synced: 0, errors };
    }
  }

  /**
   * Sync a local claim to GitHub (add label/assignee/comment)
   */
  async claimOnGitHub(issueNumber: number, claimant: Claimant): Promise<GitHubSyncResult> {
    const errors: string[] = [];

    if (!this.config.enabled) {
      return { success: true, synced: 0, errors: ['GitHub sync not enabled'] };
    }

    if (!this.isGhAvailable()) {
      return { success: false, synced: 0, errors: ['GitHub CLI (gh) not installed'] };
    }

    // Validate issue number
    if (!isValidIssueNumber(issueNumber)) {
      return { success: false, synced: 0, errors: ['Invalid issue number'] };
    }

    const repo = this.getRepo();
    if (!repo) {
      return { success: false, synced: 0, errors: ['Could not determine repository'] };
    }

    // Validate claim label
    if (!isValidLabel(this.config.claimLabel)) {
      return { success: false, synced: 0, errors: ['Invalid claim label configuration'] };
    }

    try {
      // Add claim label
      if (this.config.syncLabels) {
        try {
          execFileSync('gh', [
            'issue', 'edit', String(issueNumber),
            '--repo', repo,
            '--add-label', this.config.claimLabel
          ], { stdio: 'ignore' });
        } catch {
          errors.push('Failed to add claim label (label may not exist)');
        }
      }

      // Auto-assign if human claimant
      if (this.config.autoAssign && claimant.type === 'human') {
        if (!isValidClaimantName(claimant.name)) {
          errors.push('Invalid claimant name format');
        } else {
          try {
            execFileSync('gh', [
              'issue', 'edit', String(issueNumber),
              '--repo', repo,
              '--add-assignee', claimant.name
            ], { stdio: 'ignore' });
          } catch {
            errors.push('Failed to assign issue');
          }
        }
      }

      // Add comment
      if (this.config.commentOnClaim) {
        const claimantStr = claimant.type === 'human'
          ? `@${claimant.name.replace(/[^a-zA-Z0-9_-]/g, '')}`
          : `Agent: ${(claimant.agentType || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '')}`;
        const comment = `🤖 **Issue claimed** by ${claimantStr}\n\n_Coordinated by Claude Flow V3_`;
        try {
          execFileSync('gh', [
            'issue', 'comment', String(issueNumber),
            '--repo', repo,
            '--body', comment
          ], { stdio: 'ignore' });
        } catch {
          errors.push('Failed to add comment');
        }
      }

      return { success: errors.length === 0, synced: 1, errors };
    } catch (error) {
      errors.push(`GitHub sync failed: ${sanitizeError(error as Error)}`);
      return { success: false, synced: 0, errors };
    }
  }

  /**
   * Release claim on GitHub (remove label/assignee/comment)
   */
  async releaseOnGitHub(issueNumber: number, claimant: Claimant): Promise<GitHubSyncResult> {
    const errors: string[] = [];

    if (!this.config.enabled) {
      return { success: true, synced: 0, errors: ['GitHub sync not enabled'] };
    }

    if (!this.isGhAvailable()) {
      return { success: false, synced: 0, errors: ['GitHub CLI (gh) not installed'] };
    }

    // Validate issue number
    if (!isValidIssueNumber(issueNumber)) {
      return { success: false, synced: 0, errors: ['Invalid issue number'] };
    }

    const repo = this.getRepo();
    if (!repo) {
      return { success: false, synced: 0, errors: ['Could not determine repository'] };
    }

    // Validate claim label
    if (!isValidLabel(this.config.claimLabel)) {
      return { success: false, synced: 0, errors: ['Invalid claim label configuration'] };
    }

    try {
      // Remove claim label
      if (this.config.syncLabels) {
        try {
          execFileSync('gh', [
            'issue', 'edit', String(issueNumber),
            '--repo', repo,
            '--remove-label', this.config.claimLabel
          ], { stdio: 'ignore' });
        } catch {
          // Label might not exist
        }
      }

      // Remove assignee if human claimant
      if (this.config.autoAssign && claimant.type === 'human') {
        if (isValidClaimantName(claimant.name)) {
          try {
            execFileSync('gh', [
              'issue', 'edit', String(issueNumber),
              '--repo', repo,
              '--remove-assignee', claimant.name
            ], { stdio: 'ignore' });
          } catch {
            errors.push('Failed to remove assignee');
          }
        }
      }

      // Add release comment
      if (this.config.commentOnRelease) {
        const claimantStr = claimant.type === 'human'
          ? `@${claimant.name.replace(/[^a-zA-Z0-9_-]/g, '')}`
          : `Agent: ${(claimant.agentType || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '')}`;
        const comment = `🔓 **Issue released** by ${claimantStr}\n\n_This issue is now available for others to claim._`;
        try {
          execFileSync('gh', [
            'issue', 'comment', String(issueNumber),
            '--repo', repo,
            '--body', comment
          ], { stdio: 'ignore' });
        } catch {
          errors.push('Failed to add release comment');
        }
      }

      return { success: errors.length === 0, synced: 1, errors };
    } catch (error) {
      errors.push(`GitHub release sync failed: ${sanitizeError(error as Error)}`);
      return { success: false, synced: 0, errors };
    }
  }

  /**
   * Bulk sync all local claims to GitHub
   */
  async syncAllClaimsToGitHub(): Promise<GitHubSyncResult> {
    const errors: string[] = [];
    let synced = 0;

    const claims = await this.claimService.getAllClaims();
    for (const claim of claims) {
      // Extract issue number from issueId (assumes format like "123" or "issue-123")
      const issueMatch = claim.issueId.match(/(\d+)/);
      if (issueMatch) {
        const result = await this.claimOnGitHub(parseInt(issueMatch[1], 10), claim.claimant);
        if (result.success) synced++;
        else errors.push(...result.errors);
      }
    }

    return { success: errors.length === 0, synced, errors };
  }

  /**
   * Get GitHub issues that are claimed locally
   */
  async getClaimedGitHubIssues(): Promise<GitHubIssue[]> {
    const syncResult = await this.syncIssues('open');
    if (!syncResult.success || !syncResult.issues) return [];

    const localClaims = await this.claimService.getAllClaims();
    const claimedIds = new Set(localClaims.map(c => {
      const match = c.issueId.match(/(\d+)/);
      return match ? parseInt(match[1], 10) : null;
    }).filter(Boolean));

    return syncResult.issues.filter(issue => claimedIds.has(issue.number));
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createClaimService(
  projectRoot: string,
  config?: Partial<WorkStealingConfig>
): ClaimService {
  return new ClaimService(projectRoot, config);
}

export function createGitHubSync(
  claimService: ClaimService,
  config?: Partial<GitHubSyncConfig>
): GitHubSync {
  return new GitHubSync(claimService, config);
}

export default ClaimService;
