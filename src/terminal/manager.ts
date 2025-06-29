/**
 * Terminal manager interface and implementation
 */

import { AgentProfile, AgentSession, TerminalConfig } from '../utils/types.js';
import { IEventBus } from '../core/event-bus.js';
import { ILogger } from '../core/logger.js';
import { TerminalError, TerminalSpawnError } from '../utils/errors.js';
import { ITerminalAdapter } from './adapters/base.js';
import { VSCodeAdapter } from './adapters/vscode.js';
import { NativeAdapter } from './adapters/native.js';
import { TerminalPool } from './pool.js';
import { TerminalSession } from './session.js';

export interface ITerminalManager {
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  spawnTerminal(profile: AgentProfile): Promise<string>;
  terminateTerminal(terminalId: string): Promise<void>;
  executeCommand(terminalId: string, command: string): Promise<string>;
  getHealthStatus(): Promise<{ healthy: boolean; error?: string; metrics?: Record<string, number> }>;
  performMaintenance(): Promise<void>;
}

/**
 * Terminal manager implementation
 */
export class TerminalManager implements ITerminalManager {
  private adapter: ITerminalAdapter;
  private pool: TerminalPool;
  private sessions = new Map<string, TerminalSession>();
  private initialized = false;

  constructor(
    private config: TerminalConfig,
    private eventBus: IEventBus,
    private logger: ILogger,
  ) {
    // Select adapter based on configuration
    this.adapter = this.createAdapter();
    
    // Create terminal pool
    this.pool = new TerminalPool(
      this.config.poolSize,
      this.config.recycleAfter,
      this.adapter,
      this.logger,
    );
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.logger.info('Initializing terminal manager...');

    try {
      // Initialize adapter
      await this.adapter.initialize();

      // Initialize pool
      await this.pool.initialize();

      this.initialized = true;
      this.logger.info('Terminal manager initialized');
    } catch (error) {
      this.logger.error('Failed to initialize terminal manager', error);
      throw new TerminalError('Terminal manager initialization failed', { error });
    }
  }

  async shutdown(): Promise<void> {
    if (!this.initialized) {
      return;
    }

    this.logger.info('Shutting down terminal manager...');

    try {
      // Terminate all sessions
      const sessionIds = Array.from(this.sessions.keys());
      await Promise.all(
        sessionIds.map((id) => this.terminateTerminal(id)),
      );

      // Shutdown pool
      await this.pool.shutdown();

      // Shutdown adapter
      await this.adapter.shutdown();

      this.initialized = false;
      this.logger.info('Terminal manager shutdown complete');
    } catch (error) {
      this.logger.error('Error during terminal manager shutdown', error);
      throw error;
    }
  }

  async spawnTerminal(profile: AgentProfile): Promise<string> {
    if (!this.initialized) {
      throw new TerminalError('Terminal manager not initialized');
    }

    this.logger.debug('Spawning terminal', { agentId: profile.id });

    try {
      // Get terminal from pool
      const terminal = await this.pool.acquire();

      // Create session
      const session = new TerminalSession(
        terminal,
        profile,
        this.config.commandTimeout,
        this.logger,
      );

      // Initialize session
      await session.initialize();

      // Store session
      this.sessions.set(session.id, session);

      this.logger.info('Terminal spawned', { 
        terminalId: session.id, 
        agentId: profile.id,
      });

      return session.id;
    } catch (error) {
      this.logger.error('Failed to spawn terminal', error);
      throw new TerminalSpawnError('Failed to spawn terminal', { error });
    }
  }

  async terminateTerminal(terminalId: string): Promise<void> {
    const session = this.sessions.get(terminalId);
    if (!session) {
      throw new TerminalError(`Terminal not found: ${terminalId}`);
    }

    this.logger.debug('Terminating terminal', { terminalId });

    try {
      // Cleanup session
      await session.cleanup();

      // Return terminal to pool
      await this.pool.release(session.terminal);

      // Remove session
      this.sessions.delete(terminalId);

      this.logger.info('Terminal terminated', { terminalId });
    } catch (error) {
      this.logger.error('Failed to terminate terminal', error);
      throw error;
    }
  }

  async executeCommand(terminalId: string, command: string): Promise<string> {
    const session = this.sessions.get(terminalId);
    if (!session) {
      throw new TerminalError(`Terminal not found: ${terminalId}`);
    }

    return await session.executeCommand(command);
  }

  async getHealthStatus(): Promise<{ 
    healthy: boolean; 
    error?: string; 
    metrics?: Record<string, number>;
  }> {
    try {
      const poolHealth = await this.pool.getHealthStatus();
      const activeSessions = this.sessions.size;
      const healthySessions = Array.from(this.sessions.values())
        .filter((session) => session.isHealthy()).length;

      const metrics = {
        activeSessions,
        healthySessions,
        poolSize: poolHealth.size,
        availableTerminals: poolHealth.available,
        recycledTerminals: poolHealth.recycled,
      };

      const healthy = poolHealth.healthy && healthySessions === activeSessions;

      if (healthy) {
        return {
          healthy,
          metrics,
        };
      } else {
        return {
          healthy,
          metrics,
          error: 'Some terminals are unhealthy',
        };
      }
    } catch (error) {
      return {
        healthy: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async performMaintenance(): Promise<void> {
    if (!this.initialized) {
      return;
    }

    this.logger.debug('Performing terminal manager maintenance');

    try {
      // Clean up dead sessions
      const deadSessions = Array.from(this.sessions.entries())
        .filter(([_, session]) => !session.isHealthy());

      for (const [terminalId, _] of deadSessions) {
        this.logger.warn('Cleaning up dead terminal session', { terminalId });
        await this.terminateTerminal(terminalId).catch(error => 
          this.logger.error('Failed to clean up terminal', { terminalId, error })
        );
      }

      // Perform pool maintenance
      await this.pool.performMaintenance();

      // Emit maintenance event
      this.eventBus.emit('terminal:maintenance', {
        deadSessions: deadSessions.length,
        activeSessions: this.sessions.size,
        poolStatus: await this.pool.getHealthStatus(),
      });

      this.logger.debug('Terminal manager maintenance completed');
    } catch (error) {
      this.logger.error('Error during terminal manager maintenance', error);
    }
  }

  /**
   * Get all active sessions
   */
  getActiveSessions(): AgentSession[] {
    return Array.from(this.sessions.values()).map(session => ({
      id: session.id,
      agentId: session.profile.id,
      terminalId: session.terminal.id,
      startTime: session.startTime,
      status: session.isHealthy() ? 'active' : 'error',
      lastActivity: session.lastActivity,
      memoryBankId: '', // TODO: Link to memory bank
    }));
  }

  /**
   * Get session by ID
   */
  getSession(sessionId: string): TerminalSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Stream terminal output
   */
  async streamOutput(terminalId: string, callback: (output: string) => void): Promise<() => void> {
    const session = this.sessions.get(terminalId);
    if (!session) {
      throw new TerminalError(`Terminal not found: ${terminalId}`);
    }

    return session.streamOutput(callback);
  }

  private createAdapter(): ITerminalAdapter {
    switch (this.config.type) {
      case 'vscode':
        return new VSCodeAdapter(this.logger);
      case 'native':
        return new NativeAdapter(this.logger);
      case 'auto':
        // Detect environment and choose appropriate adapter
        if (this.isVSCodeEnvironment()) {
          this.logger.info('Detected VSCode environment, using VSCode adapter');
          return new VSCodeAdapter(this.logger);
        } else {
          this.logger.info('Using native terminal adapter');
          return new NativeAdapter(this.logger);
        }
      default:
        throw new TerminalError(`Unknown terminal type: ${this.config.type}`);
    }
  }

  private isVSCodeEnvironment(): boolean {
    // Check for VSCode-specific environment variables
    return process.env['TERM_PROGRAM'] === 'vscode' ||
           process.env['VSCODE_PID'] !== undefined ||
           process.env['VSCODE_IPC_HOOK'] !== undefined;
  }
}