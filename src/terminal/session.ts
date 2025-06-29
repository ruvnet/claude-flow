/**
 * Terminal session management
 */

import { Terminal } from './adapters/base.js';
import { AgentProfile } from '../utils/types.js';
import { ILogger } from '../core/logger.js';
import { TerminalCommandError } from '../utils/errors.js';
import { generateId, timeout } from '../utils/helpers.js';

/**
 * Terminal session wrapper
 */
export class TerminalSession {
  readonly id: string;
  readonly startTime: Date;
  private initialized = false;
  private commandHistory: string[] = [];
  private lastCommandTime?: Date;
  private outputListeners = new Set<(output: string) => void>();

  constructor(
    public readonly terminal: Terminal,
    public readonly profile: AgentProfile,
    private commandTimeout: number,
    private logger: ILogger,
  ) {
    this.id = generateId('session');
    this.startTime = new Date();
  }

  get lastActivity(): Date {
    return this.lastCommandTime || this.startTime;
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.logger.debug('Initializing terminal session', { 
      sessionId: this.id,
      agentId: this.profile.id,
    });

    try {
      // Set up environment
      await this.setupEnvironment();

      // Run initialization commands
      await this.runInitializationCommands();

      this.initialized = true;
      
      this.logger.info('Terminal session initialized', { 
        sessionId: this.id,
        agentId: this.profile.id,
      });
    } catch (error) {
      this.logger.error('Failed to initialize terminal session', error);
      throw error;
    }
  }

  async executeCommand(command: string): Promise<string> {
    if (!this.initialized) {
      throw new TerminalCommandError('Session not initialized');
    }

    if (!this.terminal.isAlive()) {
      throw new TerminalCommandError('Terminal is not alive');
    }

    this.logger.debug('Executing command', { 
      sessionId: this.id,
      command: command.substring(0, 100),
    });

    try {
      // Notify listeners of command
      this.notifyOutputListeners(`$ ${command}\n`);

      // Execute with timeout
      const result = await timeout(
        this.terminal.executeCommand(command),
        this.commandTimeout,
        `Command timeout after ${this.commandTimeout}ms`,
      );

      // Notify listeners of output
      this.notifyOutputListeners(result);

      // Update history
      this.commandHistory.push(command);
      this.lastCommandTime = new Date();

      this.logger.debug('Command executed successfully', { 
        sessionId: this.id,
        outputLength: result.length,
      });

      return result;
    } catch (error) {
      this.logger.error('Command execution failed', { 
        sessionId: this.id,
        command,
        error,
      });
      throw new TerminalCommandError('Command execution failed', { 
        command,
        error,
      });
    }
  }

  async cleanup(): Promise<void> {
    this.logger.debug('Cleaning up terminal session', { sessionId: this.id });

    try {
      // Run cleanup commands
      await this.runCleanupCommands();
    } catch (error) {
      this.logger.warn('Error during session cleanup', { 
        sessionId: this.id,
        error,
      });
    }
  }

  isHealthy(): boolean {
    if (!this.terminal.isAlive()) {
      return false;
    }

    // Check if terminal is responsive
    if (this.lastCommandTime) {
      const timeSinceLastCommand = Date.now() - this.lastCommandTime.getTime();
      if (timeSinceLastCommand > 300000) { // 5 minutes
        // Terminal might be stale, do a health check
        this.performHealthCheck().catch((error) => {
          this.logger.warn('Health check failed', { sessionId: this.id, error });
        });
      }
    }

    return true;
  }

  getCommandHistory(): string[] {
    return [...this.commandHistory];
  }

  private async setupEnvironment(): Promise<void> {
    // Set environment variables
    const envVars = {
      CLAUDE_FLOW_SESSION: this.id,
      CLAUDE_FLOW_AGENT: this.profile.id,
      CLAUDE_FLOW_AGENT_TYPE: this.profile.type,
    };

    for (const [key, value] of Object.entries(envVars)) {
      await this.terminal.executeCommand(`export ${key}="${value}"`);
    }

    // Set working directory if specified
    if (this.profile.metadata?.['workingDirectory']) {
      await this.terminal.executeCommand(
        `cd "${this.profile.metadata['workingDirectory']}"`,
      );
    }
  }

  private async runInitializationCommands(): Promise<void> {
    // Run any profile-specific initialization commands
    if (this.profile.metadata?.['initCommands']) {
      const commands = this.profile.metadata['initCommands'] as string[];
      for (const command of commands) {
        await this.terminal.executeCommand(command);
      }
    }

    // Set up command prompt
    await this.terminal.executeCommand('export PS1="[claude-flow]$ "');
  }

  private async runCleanupCommands(): Promise<void> {
    // Run any profile-specific cleanup commands
    if (this.profile.metadata?.['cleanupCommands']) {
      const commands = this.profile.metadata['cleanupCommands'] as string[];
      for (const command of commands) {
        try {
          await this.terminal.executeCommand(command);
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  }

  private async performHealthCheck(): Promise<void> {
    try {
      const result = await timeout(
        this.terminal.executeCommand('echo "HEALTH_CHECK_OK"'),
        5000,
        'Health check timeout',
      );

      if (!result.includes('HEALTH_CHECK_OK')) {
        throw new Error('Invalid health check response');
      }

      this.lastCommandTime = new Date();
    } catch (error) {
      throw new Error(`Health check failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Stream terminal output
   */
  streamOutput(callback: (output: string) => void): () => void {
    this.outputListeners.add(callback);
    
    // Set up terminal output listener if supported
    if (this.terminal.addOutputListener) {
      this.terminal.addOutputListener(callback);
    }
    
    // Return unsubscribe function
    return () => {
      this.outputListeners.delete(callback);
      if (this.terminal.removeOutputListener) {
        this.terminal.removeOutputListener(callback);
      }
    };
  }

  /**
   * Notify output listeners
   */
  private notifyOutputListeners(output: string): void {
    this.outputListeners.forEach(listener => {
      try {
        listener(output);
      } catch (error) {
        this.logger.error('Error in output listener', { sessionId: this.id, error });
      }
    });
  }
}