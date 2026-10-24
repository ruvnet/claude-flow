/**
 * V3 Session Management Hooks
 *
 * Provides session-end and session-restore hooks for state persistence.
 * Enables cross-session memory and state recovery.
 *
 * @module v3/shared/hooks/session-hooks
 */

import {
  HookEvent,
  HookContext,
  HookResult,
  HookPriority,
  SessionInfo,
} from './types.js';
import { HookRegistry } from './registry.js';

/**
 * Session state to persist
 */
export interface SessionState {
  /** Session ID */
  sessionId: string;
  /** Session start time */
  startTime: Date;
  /** Session end time */
  endTime?: Date;
  /** Working directory */
  workingDirectory?: string;
  /** Active tasks */
  activeTasks?: Array<{
    id: string;
    description: string;
    status: 'pending' | 'in_progress' | 'completed' | 'failed';
  }>;
  /** Spawned agents */
  spawnedAgents?: Array<{
    id: string;
    type: string;
    status: 'active' | 'idle' | 'terminated';
  }>;
  /** Memory entries */
  memoryEntries?: Array<{
    key: string;
    namespace: string;
    type: string;
  }>;
  /** Git state */
  gitState?: {
    branch: string;
    uncommittedChanges: number;
    lastCommit?: string;
  };
  /** Learning metrics */
  learningMetrics?: {
    patternsLearned: number;
    trajectoryCount: number;
    avgConfidence: number;
  };
  /** Custom metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Session-end hook result
 */
export interface SessionEndHookResult extends HookResult {
  /** Session state that was persisted */
  persistedState?: SessionState;
  /** File path where state was saved */
  statePath?: string;
  /** Duration of the session in ms */
  duration?: number;
  /** Summary of session activity */
  summary?: SessionSummary;
}

/**
 * Session-restore hook result
 */
export interface SessionRestoreHookResult extends HookResult {
  /** Restored session state */
  restoredState?: SessionState;
  /** Number of tasks restored */
  tasksRestored?: number;
  /** Number of agents restored */
  agentsRestored?: number;
  /** Memory entries restored */
  memoryRestored?: number;
  /** Warnings during restoration */
  warnings?: string[];
}

/**
 * Session summary
 */
export interface SessionSummary {
  /** Total tasks executed */
  tasksExecuted: number;
  /** Successful tasks */
  tasksSucceeded: number;
  /** Failed tasks */
  tasksFailed: number;
  /** Commands executed */
  commandsExecuted: number;
  /** Files modified */
  filesModified: number;
  /** Agents spawned */
  agentsSpawned: number;
  /** Duration in ms */
  duration: number;
}

/**
 * Session storage interface
 */
export interface SessionStorage {
  /** Save session state */
  save(sessionId: string, state: SessionState): Promise<void>;
  /** Load session state */
  load(sessionId: string): Promise<SessionState | null>;
  /** List available sessions */
  list(): Promise<Array<{ id: string; startTime: Date; summary?: SessionSummary }>>;
  /** Delete session */
  delete(sessionId: string): Promise<boolean>;
  /** Get latest session ID */
  getLatest(): Promise<string | null>;
}

/**
 * In-memory session storage (for testing and fallback)
 */
export class InMemorySessionStorage implements SessionStorage {
  private sessions: Map<string, SessionState> = new Map();

  async save(sessionId: string, state: SessionState): Promise<void> {
    this.sessions.set(sessionId, state);
  }

  async load(sessionId: string): Promise<SessionState | null> {
    return this.sessions.get(sessionId) || null;
  }

  async list(): Promise<Array<{ id: string; startTime: Date; summary?: SessionSummary }>> {
    return Array.from(this.sessions.entries()).map(([id, state]) => ({
      id,
      startTime: state.startTime,
    }));
  }

  async delete(sessionId: string): Promise<boolean> {
    return this.sessions.delete(sessionId);
  }

  async getLatest(): Promise<string | null> {
    let latest: { id: string; time: number } | null = null;

    for (const [id, state] of this.sessions) {
      const time = state.startTime.getTime();
      if (!latest || time > latest.time) {
        latest = { id, time };
      }
    }

    return latest?.id || null;
  }
}

/**
 * Session activity tracker
 */
interface SessionActivity {
  tasksExecuted: number;
  tasksSucceeded: number;
  tasksFailed: number;
  commandsExecuted: number;
  filesModified: Set<string>;
  agentsSpawned: Set<string>;
}

/**
 * Session Hooks Manager
 *
 * Manages session lifecycle hooks with state persistence.
 */
export class SessionHooksManager {
  private registry: HookRegistry;
  private storage: SessionStorage;
  private currentSessionId: string | null = null;
  private sessionStartTime: Date | null = null;
  private activity: SessionActivity = {
    tasksExecuted: 0,
    tasksSucceeded: 0,
    tasksFailed: 0,
    commandsExecuted: 0,
    filesModified: new Set(),
    agentsSpawned: new Set(),
  };

  constructor(registry: HookRegistry, storage?: SessionStorage) {
    this.registry = registry;
    this.storage = storage || new InMemorySessionStorage();
    this.registerDefaultHooks();
  }

  /**
   * Register default session hooks
   */
  private registerDefaultHooks(): void {
    // Session start hook
    this.registry.register(
      HookEvent.SessionStart,
      this.handleSessionStart.bind(this),
      HookPriority.High,
      { name: 'session-hooks:start' }
    );

    // Session end hook
    this.registry.register(
      HookEvent.SessionEnd,
      this.handleSessionEnd.bind(this),
      HookPriority.High,
      { name: 'session-hooks:end' }
    );

    // Session resume hook (for restoration)
    this.registry.register(
      HookEvent.SessionResume,
      this.handleSessionResume.bind(this),
      HookPriority.High,
      { name: 'session-hooks:resume' }
    );

    // Track tasks
    this.registry.register(
      HookEvent.PostTaskExecute,
      this.trackTaskExecution.bind(this),
      HookPriority.Low,
      { name: 'session-hooks:track-task' }
    );

    // Track commands
    this.registry.register(
      HookEvent.PostCommand,
      this.trackCommandExecution.bind(this),
      HookPriority.Low,
      { name: 'session-hooks:track-command' }
    );

    // Track file modifications
    this.registry.register(
      HookEvent.PostEdit,
      this.trackFileModification.bind(this),
      HookPriority.Low,
      { name: 'session-hooks:track-file' }
    );

    // Track agent spawns
    this.registry.register(
      HookEvent.PostAgentSpawn,
      this.trackAgentSpawn.bind(this),
      HookPriority.Low,
      { name: 'session-hooks:track-agent' }
    );
  }

  /**
   * Handle session start
   */
  async handleSessionStart(context: HookContext): Promise<HookResult> {
    this.currentSessionId = context.session?.id || `session-${Date.now()}`;
    this.sessionStartTime = new Date();
    this.resetActivity();

    return {
      success: true,
      data: {
        session: {
          id: this.currentSessionId,
          startTime: this.sessionStartTime,
        },
      },
    };
  }

  /**
   * Handle session end
   */
  async handleSessionEnd(context: HookContext): Promise<SessionEndHookResult> {
    if (!this.currentSessionId || !this.sessionStartTime) {
      return { success: true }; // No active session to end
    }

    const endTime = new Date();
    const duration = endTime.getTime() - this.sessionStartTime.getTime();

    // Build session summary
    const summary: SessionSummary = {
      tasksExecuted: this.activity.tasksExecuted,
      tasksSucceeded: this.activity.tasksSucceeded,
      tasksFailed: this.activity.tasksFailed,
      commandsExecuted: this.activity.commandsExecuted,
      filesModified: this.activity.filesModified.size,
      agentsSpawned: this.activity.agentsSpawned.size,
      duration,
    };

    // Build session state
    const state: SessionState = {
      sessionId: this.currentSessionId,
      startTime: this.sessionStartTime,
      endTime,
      workingDirectory: context.metadata?.workingDirectory as string | undefined,
      activeTasks: context.metadata?.activeTasks as SessionState['activeTasks'],
      spawnedAgents: context.metadata?.spawnedAgents as SessionState['spawnedAgents'],
      memoryEntries: context.metadata?.memoryEntries as SessionState['memoryEntries'],
      gitState: context.metadata?.gitState as SessionState['gitState'],
      learningMetrics: context.metadata?.learningMetrics as SessionState['learningMetrics'],
      metadata: {
        summary,
        ...(context.metadata || {}),
      },
    };

    // Persist state
    await this.storage.save(this.currentSessionId, state);

    // Reset session tracking
    const sessionId = this.currentSessionId;
    this.currentSessionId = null;
    this.sessionStartTime = null;
    this.resetActivity();

    return {
      success: true,
      persistedState: state,
      statePath: `sessions/${sessionId}.json`,
      duration,
      summary,
    };
  }

  /**
   * Handle session resume (restoration)
   */
  async handleSessionResume(context: HookContext): Promise<SessionRestoreHookResult> {
    let sessionId = context.session?.id;

    // If 'latest' is requested, get the most recent session
    if (sessionId === 'latest' || !sessionId) {
      sessionId = await this.storage.getLatest() || undefined;
    }

    if (!sessionId) {
      return {
        success: false,
        error: new Error('No session ID provided and no previous sessions found'),
        warnings: ['No sessions available for restoration'],
      };
    }

    // Load session state
    const state = await this.storage.load(sessionId);

    if (!state) {
      return {
        success: false,
        error: new Error(`Session ${sessionId} not found`),
        warnings: [`Session ${sessionId} does not exist or has been deleted`],
      };
    }

    const warnings: string[] = [];

    // Validate state age
    const stateAge = Date.now() - state.startTime.getTime();
    const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days
    if (stateAge > maxAge) {
      warnings.push(`Session is ${Math.floor(stateAge / (24 * 60 * 60 * 1000))} days old, some state may be stale`);
    }

    // Count restorable items
    const tasksRestored = state.activeTasks?.length || 0;
    const agentsRestored = state.spawnedAgents?.length || 0;
    const memoryRestored = state.memoryEntries?.length || 0;

    // Check for incomplete tasks
    const incompleteTasks = state.activeTasks?.filter(
      t => t.status === 'pending' || t.status === 'in_progress'
    );
    if (incompleteTasks && incompleteTasks.length > 0) {
      warnings.push(`${incompleteTasks.length} tasks were incomplete when session ended`);
    }

    // Update current session tracking
    this.currentSessionId = `session-${Date.now()}-restored`;
    this.sessionStartTime = new Date();
    this.resetActivity();

    return {
      success: true,
      restoredState: state,
      tasksRestored,
      agentsRestored,
      memoryRestored,
      warnings: warnings.length > 0 ? warnings : undefined,
      data: {
        session: {
          id: this.currentSessionId,
          startTime: this.sessionStartTime,
          metadata: {
            restoredFrom: sessionId,
            originalStartTime: state.startTime,
          },
        },
      },
    };
  }

  /**
   * Track task execution
   */
  private async trackTaskExecution(context: HookContext): Promise<HookResult> {
    this.activity.tasksExecuted++;
    if (context.metadata?.success !== false) {
      this.activity.tasksSucceeded++;
    } else {
      this.activity.tasksFailed++;
    }
    return { success: true };
  }

  /**
   * Track command execution
   */
  private async trackCommandExecution(context: HookContext): Promise<HookResult> {
    this.activity.commandsExecuted++;
    return { success: true };
  }

  /**
   * Track file modification
   */
  private async trackFileModification(context: HookContext): Promise<HookResult> {
    if (context.file?.path) {
      this.activity.filesModified.add(context.file.path);
    }
    return { success: true };
  }

  /**
   * Track agent spawn
   */
  private async trackAgentSpawn(context: HookContext): Promise<HookResult> {
    if (context.agent?.id) {
      this.activity.agentsSpawned.add(context.agent.id);
    }
    return { success: true };
  }

  /**
   * Reset activity tracking
   */
  private resetActivity(): void {
    this.activity = {
      tasksExecuted: 0,
      tasksSucceeded: 0,
      tasksFailed: 0,
      commandsExecuted: 0,
      filesModified: new Set(),
      agentsSpawned: new Set(),
    };
  }

  /**
   * Execute session-end hook manually
   */
  async executeSessionEnd(metadata?: Record<string, unknown>): Promise<SessionEndHookResult> {
    const context: HookContext = {
      event: HookEvent.SessionEnd,
      timestamp: new Date(),
      session: this.currentSessionId
        ? {
            id: this.currentSessionId,
            startTime: this.sessionStartTime!,
          }
        : undefined,
      metadata,
    };

    return this.handleSessionEnd(context);
  }

  /**
   * Execute session-restore hook manually
   */
  async executeSessionRestore(
    sessionId?: string,
    metadata?: Record<string, unknown>
  ): Promise<SessionRestoreHookResult> {
    const context: HookContext = {
      event: HookEvent.SessionResume,
      timestamp: new Date(),
      session: {
        id: sessionId || 'latest',
        startTime: new Date(),
      },
      metadata,
    };

    return this.handleSessionResume(context);
  }

  /**
   * List available sessions
   */
  async listSessions(): Promise<Array<{ id: string; startTime: Date; summary?: SessionSummary }>> {
    return this.storage.list();
  }

  /**
   * Delete a session
   */
  async deleteSession(sessionId: string): Promise<boolean> {
    return this.storage.delete(sessionId);
  }

  /**
   * Get current session ID
   */
  getCurrentSessionId(): string | null {
    return this.currentSessionId;
  }

  /**
   * Get current session activity
   */
  getCurrentActivity(): SessionActivity {
    return { ...this.activity };
  }

  /**
   * Set storage backend
   */
  setStorage(storage: SessionStorage): void {
    this.storage = storage;
  }
}

/**
 * Create session hooks manager
 */
export function createSessionHooksManager(
  registry: HookRegistry,
  storage?: SessionStorage
): SessionHooksManager {
  return new SessionHooksManager(registry, storage);
}
