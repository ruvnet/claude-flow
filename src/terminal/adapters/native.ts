/**
 * Native terminal adapter implementation
 */

import { spawn, ChildProcess } from 'child_process';
import { platform } from 'os';
import { ITerminalAdapter, Terminal } from './base.js';
import { ILogger } from '../../core/logger.js';
import { TerminalError, TerminalCommandError } from '../../utils/errors.js';
import { generateId, delay, timeout, createDeferred } from '../../utils/helpers.js';

/**
 * Platform-specific shell configuration
 */
interface ShellConfig {
  path: string;
  args: string[];
  env?: Record<string, string>;
}

/**
 * Native terminal implementation using Deno subprocess
 */
class NativeTerminal implements Terminal {
  id: string;
  pid?: number;
  private process?: ChildProcess | undefined;
  private encoder = new TextEncoder();
  private decoder = new TextDecoder();
  private shell: string;
  private outputBuffer = '';
  private errorBuffer = '';
  private commandMarker: string;
  private commandDeferred?: ReturnType<typeof createDeferred<string>> | undefined;
  private outputListeners = new Set<(data: string) => void>();
  private alive = true;
  private stdoutData = '';
  private stderrData = '';

  constructor(shell: string, private logger: ILogger) {
    this.id = generateId('native-term');
    this.shell = shell;
    this.commandMarker = `__CLAUDE_FLOW_${this.id}__`;
  }

  async initialize(): Promise<void> {
    try {
      const shellConfig = this.getShellConfig();
      
      // Start shell process
      this.process = spawn(shellConfig.path, shellConfig.args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          ...shellConfig.env,
          CLAUDE_FLOW_TERMINAL: 'true',
          CLAUDE_FLOW_TERMINAL_ID: this.id,
        },
      });
      
      // Get PID
      if (this.process.pid !== undefined) {
        this.pid = this.process.pid;
      }

      // Set up output handlers
      this.setupOutputHandlers();

      // Monitor process status
      this.monitorProcess();

      // Wait for shell to be ready
      await this.waitForReady();
      
      this.logger.debug('Native terminal initialized', { 
        id: this.id, 
        pid: this.pid,
        shell: this.shell,
      });
    } catch (error) {
      this.alive = false;
      throw new TerminalError('Failed to create native terminal', { error });
    }
  }

  async executeCommand(command: string): Promise<string> {
    if (!this.process || !this.isAlive()) {
      throw new TerminalError('Terminal is not alive');
    }

    try {
      // Create deferred for this command
      this.commandDeferred = createDeferred<string>();

      // Clear output buffer
      this.outputBuffer = '';

      // Send command with marker
      const markedCommand = this.wrapCommand(command);
      await this.write(markedCommand + '\n');

      // Wait for command to complete
      const output = await timeout(
        this.commandDeferred.promise,
        30000,
        'Command execution timeout',
      );
      
      return output;
    } catch (error) {
      throw new TerminalCommandError('Failed to execute command', { command, error });
    }
  }

  async write(data: string): Promise<void> {
    if (!this.process || !this.isAlive()) {
      throw new TerminalError('Terminal is not alive');
    }

    return new Promise((resolve, reject) => {
      if (!this.process?.stdin) {
        reject(new TerminalError('Process stdin not available'));
        return;
      }
      
      this.process.stdin.write(data, (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  async read(): Promise<string> {
    if (!this.process || !this.isAlive()) {
      throw new TerminalError('Terminal is not alive');
    }

    // Return buffered output
    const output = this.outputBuffer;
    this.outputBuffer = '';
    return output;
  }

  isAlive(): boolean {
    return this.alive && this.process !== undefined;
  }

  async kill(): Promise<void> {
    if (!this.process) return;

    try {
      this.alive = false;

      // Close streams
      if (this.process.stdin && !this.process.stdin.destroyed) {
        this.process.stdin.end();
      }

      // Try graceful shutdown first
      try {
        await this.write('exit\n');
        await delay(500);
      } catch {
        // Ignore write errors during shutdown
      }

      // Force kill if still alive
      try {
        this.process.kill('SIGTERM');
        await delay(500);
        
        // Use SIGKILL if SIGTERM didn't work
        if (!this.process.killed) {
          this.process.kill('SIGKILL');
        }
      } catch {
        // Process might already be dead
      }
    } catch (error) {
      this.logger.warn('Error killing native terminal', { id: this.id, error });
    } finally {
      this.process = undefined;
    }
  }

  /**
   * Add output listener
   */
  addOutputListener(listener: (data: string) => void): void {
    this.outputListeners.add(listener);
  }

  /**
   * Remove output listener
   */
  removeOutputListener(listener: (data: string) => void): void {
    this.outputListeners.delete(listener);
  }

  private getShellConfig(): ShellConfig {
    const osplatform = platform();
    
    switch (this.shell) {
      case 'bash':
        return {
          path: osplatform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : '/bin/bash',
          args: ['--norc', '--noprofile'],
          env: { PS1: '$ ' },
        };
      
      case 'zsh':
        return {
          path: '/bin/zsh',
          args: ['--no-rcs'],
          env: { PS1: '$ ' },
        };
      
      case 'powershell':
        return {
          path: osplatform === 'win32' ? 'powershell.exe' : 'pwsh',
          args: ['-NoProfile', '-NonInteractive', '-NoLogo'],
        };
      
      case 'cmd':
        return {
          path: 'cmd.exe',
          args: ['/Q', '/K', 'prompt $G'],
        };
      
      case 'sh':
      default:
        return {
          path: '/bin/sh',
          args: [],
          env: { PS1: '$ ' },
        };
    }
  }

  private wrapCommand(command: string): string {
    const osplatform = platform();
    
    if (this.shell === 'powershell') {
      // PowerShell command wrapping
      return `${command}; Write-Host "${this.commandMarker}"`;
    } else if (this.shell === 'cmd' && osplatform === 'win32') {
      // Windows CMD command wrapping
      return `${command} & echo ${this.commandMarker}`;
    } else {
      // Unix-like shell command wrapping
      return `${command} && echo "${this.commandMarker}" || (echo "${this.commandMarker}"; false)`;
    }
  }

  private setupOutputHandlers(): void {
    if (!this.process) return;

    // Handle stdout
    this.process.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      this.processOutput(text);
    });

    // Handle stderr
    this.process.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      this.errorBuffer += text;
      
      // Also send stderr to output listeners
      this.notifyListeners(text);
    });

    // Handle process errors
    this.process.on('error', (error) => {
      if (this.alive) {
        this.logger.error('Process error', { id: this.id, error });
      }
    });
  }

  private processOutput(text: string): void {
    this.outputBuffer += text;
    
    // Notify listeners
    this.notifyListeners(text);
    
    // Check for command completion marker
    const markerIndex = this.outputBuffer.indexOf(this.commandMarker);
    if (markerIndex !== -1 && this.commandDeferred) {
      // Extract output before marker
      const output = this.outputBuffer.substring(0, markerIndex).trim();
      
      // Include any stderr output
      const fullOutput = this.errorBuffer ? `${output}\n${this.errorBuffer}` : output;
      this.errorBuffer = '';
      
      // Clear buffer up to after marker
      this.outputBuffer = this.outputBuffer.substring(
        markerIndex + this.commandMarker.length,
      ).trim();
      
      // Resolve pending command
      this.commandDeferred.resolve(fullOutput);
      this.commandDeferred = undefined;
    }
  }

  private notifyListeners(data: string): void {
    this.outputListeners.forEach(listener => {
      try {
        listener(data);
      } catch (error) {
        this.logger.error('Error in output listener', { id: this.id, error });
      }
    });
  }

  private async monitorProcess(): Promise<void> {
    if (!this.process) return;

    this.process.on('exit', (code, signal) => {
      this.logger.info('Terminal process exited', { 
        id: this.id, 
        code,
        signal,
      });
      this.alive = false;
      
      // Reject any pending command
      if (this.commandDeferred) {
        this.commandDeferred.reject(new Error('Terminal process exited'));
      }
    });

    this.process.on('error', (error) => {
      this.logger.error('Error monitoring process', { id: this.id, error });
      this.alive = false;
      
      // Reject any pending command
      if (this.commandDeferred) {
        this.commandDeferred.reject(error);
      }
    });
  }

  private async waitForReady(): Promise<void> {
    // Send a test command to ensure shell is ready
    const testCommand = this.shell === 'powershell' 
      ? 'Write-Host "READY"'
      : 'echo "READY"';
    
    await this.write(testCommand + '\n');
    
    const startTime = Date.now();
    while (Date.now() - startTime < 5000) {
      if (this.outputBuffer.includes('READY')) {
        this.outputBuffer = '';
        return;
      }
      await delay(100);
    }
    
    throw new TerminalError('Terminal failed to become ready');
  }
}

/**
 * Native terminal adapter
 */
export class NativeAdapter implements ITerminalAdapter {
  private terminals = new Map<string, NativeTerminal>();
  private shell: string;

  constructor(private logger: ILogger) {
    // Detect available shell
    this.shell = this.detectShell();
  }

  async initialize(): Promise<void> {
    this.logger.info('Initializing native terminal adapter', { shell: this.shell });
    
    // Verify shell is available
    try {
      const testConfig = this.getTestCommand();
      const { spawnSync } = require('child_process');
      const result = spawnSync(testConfig.cmd, testConfig.args, { stdio: 'ignore' });
      
      if (result.status !== 0) {
        throw new Error('Shell test failed');
      }
    } catch (error) {
      this.logger.warn(`Shell ${this.shell} not available, falling back to sh`, { error });
      this.shell = 'sh';
    }
  }

  async shutdown(): Promise<void> {
    this.logger.info('Shutting down native terminal adapter');
    
    // Kill all terminals
    const terminals = Array.from(this.terminals.values());
    await Promise.all(terminals.map(term => term.kill()));
    
    this.terminals.clear();
  }

  async createTerminal(): Promise<Terminal> {
    const terminal = new NativeTerminal(this.shell, this.logger);
    
    await terminal.initialize();
    this.terminals.set(terminal.id, terminal);
    
    return terminal;
  }

  async destroyTerminal(terminal: Terminal): Promise<void> {
    await terminal.kill();
    this.terminals.delete(terminal.id);
  }

  private detectShell(): string {
    const osplatform = platform();
    
    if (osplatform === 'win32') {
      // Windows shell detection
      const comspec = process.env['COMSPEC'];
      if (comspec?.toLowerCase().includes('powershell')) {
        return 'powershell';
      }
      
      // Check if PowerShell is available
      try {
        const { spawnSync } = require('child_process');
        const result = spawnSync('powershell', ['-Version'], { stdio: 'ignore' });
        if (result.status === 0) {
          return 'powershell';
        }
      } catch {
        // PowerShell not available
      }
      
      return 'cmd';
    } else {
      // Unix-like shell detection
      const shell = process.env['SHELL'];
      if (shell) {
        const shellName = shell.split('/').pop();
        if (shellName && this.isShellSupported(shellName)) {
          return shellName;
        }
      }

      // Try common shells in order of preference
      const shells = ['bash', 'zsh', 'sh'];
      for (const shell of shells) {
        try {
          const { spawnSync } = require('child_process');
          const result = spawnSync('which', [shell], { stdio: 'ignore' });
          if (result.status === 0) {
            return shell;
          }
        } catch {
          // Continue to next shell
        }
      }

      // Default to sh
      return 'sh';
    }
  }

  private isShellSupported(shell: string): boolean {
    return ['bash', 'zsh', 'sh', 'fish', 'dash', 'powershell', 'cmd'].includes(shell);
  }

  private getTestCommand(): { cmd: string; args: string[] } {
    switch (this.shell) {
      case 'powershell':
        return { cmd: 'powershell', args: ['-Version'] };
      case 'cmd':
        return { cmd: 'cmd', args: ['/C', 'echo test'] };
      default:
        return { cmd: this.shell, args: ['--version'] };
    }
  }
}