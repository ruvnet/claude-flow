/**
 * VSCode terminal adapter implementation
 */

import { platform } from 'os';
import { ITerminalAdapter, Terminal } from './base.js';
import { ILogger } from '../../core/logger.js';
import { TerminalError } from '../../utils/errors.js';
import { generateId, delay, timeout, createDeferred } from '../../utils/helpers.js';

/**
 * VSCode API interface (injected via extension)
 */
interface VSCodeAPI {
  window: {
    createTerminal(options: {
      name: string;
      shellPath?: string;
      shellArgs?: string[];
      env?: Record<string, string>;
    }): VSCodeTerminal;
    onDidCloseTerminal(listener: (terminal: VSCodeTerminal) => void): { dispose(): void };
  };
}

interface VSCodeTerminal {
  name: string;
  processId: Promise<number | undefined>;
  sendText(text: string, addNewLine?: boolean): void;
  show(preserveFocus?: boolean): void;
  hide(): void;
  dispose(): void;
}

/**
 * VSCode terminal implementation
 */
class VSCodeTerminalWrapper implements Terminal {
  id: string;
  pid?: number;
  private vscodeTerminal?: VSCodeTerminal;
  private outputBuffer = '';
  private commandMarker: string;
  private outputDeferred = createDeferred<string>();
  private isDisposed = false;

  constructor(
    private vscodeApi: VSCodeAPI,
    private shellType: string,
    private logger: ILogger,
  ) {
    this.id = generateId('vscode-term');
    this.commandMarker = `__CLAUDE_FLOW_${this.id}__`;
  }

  async initialize(): Promise<void> {
    try {
      // Create VSCode terminal
      const shellPath = this.getShellPath();
      const terminalOptions: any = {
        name: `Claude-Flow Terminal ${this.id}`,
        shellArgs: this.getShellArgs(),
        env: {
          CLAUDE_FLOW_TERMINAL: 'true',
          CLAUDE_FLOW_TERMINAL_ID: this.id,
          PS1: '$ ', // Simple prompt
        },
      };
      if (shellPath !== undefined) {
        terminalOptions.shellPath = shellPath;
      }
      this.vscodeTerminal = this.vscodeApi.window.createTerminal(terminalOptions);

      // Get process ID
      const processId = await this.vscodeTerminal.processId;
      if (processId !== undefined) {
        this.pid = processId;
      }

      // Show terminal (but don't steal focus)
      this.vscodeTerminal.show(true);

      // Wait for terminal to be ready
      await this.waitForReady();

      this.logger.debug('VSCode terminal initialized', { id: this.id, pid: this.pid });
    } catch (error) {
      throw new TerminalError('Failed to create VSCode terminal', { error });
    }
  }

  async executeCommand(command: string): Promise<string> {
    if (!this.vscodeTerminal || !this.isAlive()) {
      throw new TerminalError('Terminal is not alive');
    }

    try {
      // Clear output buffer
      this.outputBuffer = '';
      this.outputDeferred = createDeferred<string>();

      // Send command with marker
      const markedCommand = `${command} && echo "${this.commandMarker}"`;
      this.vscodeTerminal.sendText(markedCommand, true);

      // Wait for command to complete
      const output = await timeout(
        this.outputDeferred.promise,
        30000,
        'Command execution timeout',
      );

      return output;
    } catch (error) {
      throw new TerminalError('Failed to execute command', { command, error });
    }
  }

  async write(data: string): Promise<void> {
    if (!this.vscodeTerminal || !this.isAlive()) {
      throw new TerminalError('Terminal is not alive');
    }

    this.vscodeTerminal.sendText(data, false);
  }

  async read(): Promise<string> {
    if (!this.vscodeTerminal || !this.isAlive()) {
      throw new TerminalError('Terminal is not alive');
    }

    // Return buffered output
    const output = this.outputBuffer;
    this.outputBuffer = '';
    return output;
  }

  isAlive(): boolean {
    return !this.isDisposed && this.vscodeTerminal !== undefined;
  }

  async kill(): Promise<void> {
    if (this.vscodeTerminal && !this.isDisposed) {
      try {
        // Try graceful shutdown first
        this.vscodeTerminal.sendText('exit', true);
        await delay(500);

        // Dispose terminal
        this.vscodeTerminal.dispose();
        this.isDisposed = true;
      } catch (error) {
        this.logger.warn('Error killing VSCode terminal', { id: this.id, error });
      }
    }
  }

  /**
   * Process terminal output (called by extension)
   */
  processOutput(data: string): void {
    this.outputBuffer += data;

    // Check for command completion marker
    const markerIndex = this.outputBuffer.indexOf(this.commandMarker);
    if (markerIndex !== -1) {
      // Extract output before marker
      const output = this.outputBuffer.substring(0, markerIndex).trim();
      
      // Clear buffer up to after marker
      this.outputBuffer = this.outputBuffer.substring(
        markerIndex + this.commandMarker.length,
      ).trim();

      // Resolve pending command
      this.outputDeferred.resolve(output);
    }
  }

  private getShellPath(): string | undefined {
    switch (this.shellType) {
      case 'bash':
        return '/bin/bash';
      case 'zsh':
        return '/bin/zsh';
      case 'powershell':
        return platform() === 'win32' ? 'powershell.exe' : 'pwsh';
      case 'cmd':
        return platform() === 'win32' ? 'cmd.exe' : undefined;
      default:
        return undefined;
    }
  }

  private getShellArgs(): string[] {
    switch (this.shellType) {
      case 'bash':
        return ['--norc', '--noprofile'];
      case 'zsh':
        return ['--no-rcs'];
      case 'powershell':
        return ['-NoProfile', '-NonInteractive'];
      case 'cmd':
        return ['/Q'];
      default:
        return [];
    }
  }

  private async waitForReady(): Promise<void> {
    // Send a test command to ensure terminal is ready
    this.vscodeTerminal!.sendText('echo "READY"', true);
    
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
 * VSCode terminal adapter
 */
export class VSCodeAdapter implements ITerminalAdapter {
  private terminals = new Map<string, VSCodeTerminalWrapper>();
  private vscodeApi?: VSCodeAPI;
  private shellType: string;
  private terminalCloseListener?: { dispose(): void };

  constructor(private logger: ILogger) {
    this.shellType = this.detectShell();
  }

  async initialize(): Promise<void> {
    this.logger.info('Initializing VSCode terminal adapter');
    
    // Check if running in VSCode extension context
    if (!this.isVSCodeExtensionContext()) {
      throw new TerminalError('Not running in VSCode extension context');
    }

    // Get VSCode API from global
    this.vscodeApi = (globalThis as any).vscode;
    if (!this.vscodeApi) {
      throw new TerminalError('VSCode API not available');
    }

    // Register terminal close listener
    this.terminalCloseListener = this.vscodeApi.window.onDidCloseTerminal((terminal) => {
      // Find and clean up closed terminal
      for (const [id, wrapper] of this.terminals.entries()) {
        if ((wrapper as any).vscodeTerminal === terminal) {
          this.logger.info('VSCode terminal closed', { id });
          this.terminals.delete(id);
          break;
        }
      }
    });

    this.logger.info('VSCode terminal adapter initialized');
  }

  async shutdown(): Promise<void> {
    this.logger.info('Shutting down VSCode terminal adapter');
    
    // Dispose listener
    if (this.terminalCloseListener) {
      this.terminalCloseListener.dispose();
    }

    // Kill all terminals
    const terminals = Array.from(this.terminals.values());
    await Promise.all(terminals.map(term => term.kill()));
    
    this.terminals.clear();
  }

  async createTerminal(): Promise<Terminal> {
    if (!this.vscodeApi) {
      throw new TerminalError('VSCode API not initialized');
    }

    const terminal = new VSCodeTerminalWrapper(
      this.vscodeApi,
      this.shellType,
      this.logger,
    );
    
    await terminal.initialize();
    this.terminals.set(terminal.id, terminal);
    
    // Register output processor if extension provides it
    const outputProcessor = (globalThis as any).registerTerminalOutputProcessor;
    if (outputProcessor) {
      outputProcessor(terminal.id, (data: string) => terminal.processOutput(data));
    }
    
    return terminal;
  }

  async destroyTerminal(terminal: Terminal): Promise<void> {
    await terminal.kill();
    this.terminals.delete(terminal.id);
  }

  private isVSCodeExtensionContext(): boolean {
    // Check for VSCode extension environment
    return typeof (globalThis as any).vscode !== 'undefined' &&
           typeof (globalThis as any).vscode.window !== 'undefined';
  }

  private detectShell(): string {
    // Get default shell from VSCode settings or environment
    const osplatform = platform();
    
    if (osplatform === 'win32') {
      // Windows defaults
      const comspec = process.env.COMSPEC;
      if (comspec?.toLowerCase().includes('powershell')) {
        return 'powershell';
      }
      return 'cmd';
    } else {
      // Unix-like defaults
      const shell = process.env.SHELL;
      if (shell) {
        const shellName = shell.split('/').pop();
        if (shellName && ['bash', 'zsh', 'fish', 'sh'].includes(shellName)) {
          return shellName;
        }
      }
      return 'bash';
    }
  }
}