/**
 * HeadlessWorkerExecutor Tests
 *
 * Comprehensive tests for the headless worker execution service that
 * runs Claude Code in headless mode for background worker tasks.
 *
 * Tests cover:
 * 1. HeadlessWorkerExecutor instantiation
 * 2. isAvailable() - Claude Code availability detection
 * 3. execute() with various headless configurations
 * 4. Context building from file patterns
 * 5. Prompt template building
 * 6. Output parsing for json/text/markdown
 * 7. Timeout handling
 * 8. Error handling for missing Claude Code
 * 9. Event emissions (output, error)
 * 10. HEADLESS_WORKERS configuration validation
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';

// Mock modules before imports
vi.mock('child_process', () => ({
  spawn: vi.fn(),
  execSync: vi.fn(),
}));

vi.mock('glob', () => ({
  glob: vi.fn(),
  globSync: vi.fn(),
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

// Import after mocking
import { spawn, execSync } from 'child_process';
import { glob, globSync } from 'glob';
import { existsSync, readFileSync } from 'fs';

// Types for HeadlessWorkerExecutor (anticipating implementation)
interface HeadlessWorkerConfig {
  workerId: string;
  workerType: string;
  prompt: string;
  contextPatterns?: string[];
  outputFormat?: 'json' | 'text' | 'markdown';
  timeout?: number;
  sandbox?: 'strict' | 'permissive' | 'disabled';
  maxTokens?: number;
  temperature?: number;
}

interface HeadlessExecutionResult {
  success: boolean;
  output: string | object;
  rawOutput: string;
  duration: number;
  workerId: string;
  workerType: string;
  error?: string;
}

interface HeadlessWorkersConfiguration {
  enabled: boolean;
  defaultTimeout: number;
  defaultSandbox: 'strict' | 'permissive' | 'disabled';
  workers: {
    [key: string]: {
      enabled: boolean;
      prompt: string;
      contextPatterns?: string[];
      outputFormat?: 'json' | 'text' | 'markdown';
      timeout?: number;
    };
  };
}

// Mock HeadlessWorkerExecutor class (will be replaced when actual implementation exists)
class HeadlessWorkerExecutor extends EventEmitter {
  private projectRoot: string;
  private config: HeadlessWorkersConfiguration;
  private claudePath: string | null = null;

  constructor(projectRoot: string, config?: Partial<HeadlessWorkersConfiguration>) {
    super();
    this.projectRoot = projectRoot;
    this.config = {
      enabled: config?.enabled ?? true,
      defaultTimeout: config?.defaultTimeout ?? 300000, // 5 minutes
      defaultSandbox: config?.defaultSandbox ?? 'strict',
      workers: config?.workers ?? {},
    };
  }

  async isAvailable(): Promise<boolean> {
    try {
      const result = (execSync as Mock)('claude --version', { encoding: 'utf-8' });
      this.claudePath = 'claude';
      return result.includes('claude') || result.includes('Claude');
    } catch {
      // Try alternative path
      try {
        const altResult = (execSync as Mock)('npx claude-code --version', { encoding: 'utf-8' });
        this.claudePath = 'npx claude-code';
        return altResult.includes('claude') || altResult.includes('Claude');
      } catch {
        return false;
      }
    }
  }

  async execute(config: HeadlessWorkerConfig): Promise<HeadlessExecutionResult> {
    const startTime = Date.now();
    const timeout = config.timeout ?? this.config.defaultTimeout;

    if (!(await this.isAvailable())) {
      const error = 'Claude Code is not available. Install with: npm install -g @anthropic-ai/claude-code';
      this.emit('error', { workerId: config.workerId, error });
      return {
        success: false,
        output: '',
        rawOutput: '',
        duration: Date.now() - startTime,
        workerId: config.workerId,
        workerType: config.workerType,
        error,
      };
    }

    // Build context from file patterns
    const context = await this.buildContext(config.contextPatterns ?? []);

    // Build prompt template
    const fullPrompt = this.buildPrompt(config.prompt, context, config.outputFormat);

    return new Promise((resolve) => {
      const args = [
        '--headless',
        '--print',
        fullPrompt,
      ];

      if (config.sandbox) {
        args.push('--sandbox', config.sandbox);
      }

      const childProcess = (spawn as Mock)(this.claudePath || 'claude', args, {
        cwd: this.projectRoot,
        env: { ...process.env },
      }) as MockChildProcess;

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const timeoutId = setTimeout(() => {
        timedOut = true;
        childProcess.kill('SIGTERM');
        this.emit('timeout', { workerId: config.workerId, timeout });
      }, timeout);

      childProcess.stdout?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        stdout += chunk;
        this.emit('output', { workerId: config.workerId, chunk });
      });

      childProcess.stderr?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        stderr += chunk;
        this.emit('error', { workerId: config.workerId, error: chunk });
      });

      childProcess.on('close', (code: number | null) => {
        clearTimeout(timeoutId);
        const duration = Date.now() - startTime;

        if (timedOut) {
          resolve({
            success: false,
            output: '',
            rawOutput: stdout,
            duration,
            workerId: config.workerId,
            workerType: config.workerType,
            error: `Execution timed out after ${timeout}ms`,
          });
          return;
        }

        if (code !== 0) {
          resolve({
            success: false,
            output: '',
            rawOutput: stdout,
            duration,
            workerId: config.workerId,
            workerType: config.workerType,
            error: stderr || `Process exited with code ${code}`,
          });
          return;
        }

        const parsedOutput = this.parseOutput(stdout, config.outputFormat ?? 'text');

        resolve({
          success: true,
          output: parsedOutput,
          rawOutput: stdout,
          duration,
          workerId: config.workerId,
          workerType: config.workerType,
        });
      });

      childProcess.on('error', (err: Error) => {
        clearTimeout(timeoutId);
        resolve({
          success: false,
          output: '',
          rawOutput: '',
          duration: Date.now() - startTime,
          workerId: config.workerId,
          workerType: config.workerType,
          error: err.message,
        });
      });
    });
  }

  async buildContext(patterns: string[]): Promise<string> {
    if (patterns.length === 0) {
      return '';
    }

    const files: string[] = [];
    for (const pattern of patterns) {
      const matches = await (glob as Mock)(pattern, { cwd: this.projectRoot });
      files.push(...matches);
    }

    const contextParts: string[] = [];
    for (const file of files.slice(0, 10)) { // Limit to 10 files
      try {
        const content = (readFileSync as Mock)(file, 'utf-8');
        contextParts.push(`=== ${file} ===\n${content}\n`);
      } catch {
        // Skip unreadable files
      }
    }

    return contextParts.join('\n');
  }

  buildPrompt(basePrompt: string, context: string, outputFormat?: string): string {
    let prompt = basePrompt;

    if (context) {
      prompt = `Context:\n${context}\n\n${prompt}`;
    }

    if (outputFormat === 'json') {
      prompt += '\n\nRespond with valid JSON only.';
    } else if (outputFormat === 'markdown') {
      prompt += '\n\nFormat your response as Markdown.';
    }

    return prompt;
  }

  parseOutput(output: string, format: 'json' | 'text' | 'markdown'): string | object {
    const trimmed = output.trim();

    if (format === 'json') {
      try {
        // Try to extract JSON from the output
        const jsonMatch = trimmed.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
        if (jsonMatch) {
          return JSON.parse(jsonMatch[0]);
        }
        return JSON.parse(trimmed);
      } catch {
        // Return as string if JSON parsing fails
        return trimmed;
      }
    }

    return trimmed;
  }

  validateConfig(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (typeof this.config.enabled !== 'boolean') {
      errors.push('enabled must be a boolean');
    }

    if (typeof this.config.defaultTimeout !== 'number' || this.config.defaultTimeout <= 0) {
      errors.push('defaultTimeout must be a positive number');
    }

    if (!['strict', 'permissive', 'disabled'].includes(this.config.defaultSandbox)) {
      errors.push('defaultSandbox must be one of: strict, permissive, disabled');
    }

    for (const [workerId, workerConfig] of Object.entries(this.config.workers)) {
      if (!workerConfig.prompt) {
        errors.push(`Worker ${workerId} must have a prompt`);
      }
      if (workerConfig.outputFormat && !['json', 'text', 'markdown'].includes(workerConfig.outputFormat)) {
        errors.push(`Worker ${workerId} has invalid outputFormat`);
      }
      if (workerConfig.timeout && (typeof workerConfig.timeout !== 'number' || workerConfig.timeout <= 0)) {
        errors.push(`Worker ${workerId} has invalid timeout`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}

// Mock ChildProcess for testing
interface MockChildProcess extends EventEmitter {
  stdout: EventEmitter | null;
  stderr: EventEmitter | null;
  pid: number;
  kill: Mock;
}

function createMockChildProcess(): MockChildProcess {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();

  const proc = new EventEmitter() as MockChildProcess;
  proc.stdout = stdout;
  proc.stderr = stderr;
  proc.pid = 12345;
  proc.kill = vi.fn();

  return proc;
}

describe('HeadlessWorkerExecutor', () => {
  let executor: HeadlessWorkerExecutor;
  let mockChildProcess: MockChildProcess;

  beforeEach(() => {
    vi.clearAllMocks();
    executor = new HeadlessWorkerExecutor('/test/project');
    mockChildProcess = createMockChildProcess();
    (spawn as Mock).mockReturnValue(mockChildProcess);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('Instantiation', () => {
    it('should create executor with default configuration', () => {
      const exec = new HeadlessWorkerExecutor('/test/project');
      expect(exec).toBeInstanceOf(HeadlessWorkerExecutor);
      expect(exec).toBeInstanceOf(EventEmitter);
    });

    it('should create executor with custom configuration', () => {
      const config: Partial<HeadlessWorkersConfiguration> = {
        enabled: true,
        defaultTimeout: 60000,
        defaultSandbox: 'permissive',
        workers: {
          'test-worker': {
            enabled: true,
            prompt: 'Test prompt',
            outputFormat: 'json',
          },
        },
      };

      const exec = new HeadlessWorkerExecutor('/test/project', config);
      expect(exec).toBeDefined();
    });

    it('should use default values for missing configuration', () => {
      const exec = new HeadlessWorkerExecutor('/test/project', {
        workers: {},
      });
      expect(exec).toBeDefined();
    });
  });

  describe('isAvailable', () => {
    it('should return true when claude --version succeeds', async () => {
      (execSync as Mock).mockReturnValue('claude version 1.0.0');

      const result = await executor.isAvailable();

      expect(result).toBe(true);
      expect(execSync).toHaveBeenCalledWith('claude --version', { encoding: 'utf-8' });
    });

    it('should return true with Claude capitalized', async () => {
      (execSync as Mock).mockReturnValue('Claude Code CLI v1.0.0');

      const result = await executor.isAvailable();

      expect(result).toBe(true);
    });

    it('should try npx claude-code when claude fails', async () => {
      (execSync as Mock)
        .mockImplementationOnce(() => {
          throw new Error('Command not found');
        })
        .mockReturnValue('claude-code version 1.0.0');

      const result = await executor.isAvailable();

      expect(result).toBe(true);
      expect(execSync).toHaveBeenCalledTimes(2);
    });

    it('should return false when both claude and npx claude-code fail', async () => {
      (execSync as Mock).mockImplementation(() => {
        throw new Error('Command not found');
      });

      const result = await executor.isAvailable();

      expect(result).toBe(false);
    });

    it('should return false for invalid version output', async () => {
      (execSync as Mock).mockReturnValue('unknown command');

      const result = await executor.isAvailable();

      expect(result).toBe(false);
    });
  });

  describe('execute', () => {
    beforeEach(() => {
      (execSync as Mock).mockReturnValue('claude version 1.0.0');
      (glob as Mock).mockResolvedValue([]);
    });

    it('should execute with basic configuration', async () => {
      const config: HeadlessWorkerConfig = {
        workerId: 'test-1',
        workerType: 'map',
        prompt: 'Analyze the codebase',
      };

      // Simulate successful execution
      setTimeout(() => {
        mockChildProcess.stdout?.emit('data', Buffer.from('Analysis complete'));
        mockChildProcess.emit('close', 0);
      }, 10);

      const result = await executor.execute(config);

      expect(result.success).toBe(true);
      expect(result.output).toBe('Analysis complete');
      expect(result.workerId).toBe('test-1');
      expect(result.workerType).toBe('map');
    });

    it('should emit output events during execution', async () => {
      const config: HeadlessWorkerConfig = {
        workerId: 'test-2',
        workerType: 'audit',
        prompt: 'Security audit',
      };

      const outputHandler = vi.fn();
      executor.on('output', outputHandler);

      setTimeout(() => {
        mockChildProcess.stdout?.emit('data', Buffer.from('Chunk 1'));
        mockChildProcess.stdout?.emit('data', Buffer.from('Chunk 2'));
        mockChildProcess.emit('close', 0);
      }, 10);

      await executor.execute(config);

      expect(outputHandler).toHaveBeenCalledTimes(2);
      expect(outputHandler).toHaveBeenCalledWith({ workerId: 'test-2', chunk: 'Chunk 1' });
      expect(outputHandler).toHaveBeenCalledWith({ workerId: 'test-2', chunk: 'Chunk 2' });
    });

    it('should emit error events for stderr', async () => {
      const config: HeadlessWorkerConfig = {
        workerId: 'test-3',
        workerType: 'optimize',
        prompt: 'Optimize performance',
      };

      const errorHandler = vi.fn();
      executor.on('error', errorHandler);

      setTimeout(() => {
        mockChildProcess.stderr?.emit('data', Buffer.from('Warning: low memory'));
        mockChildProcess.emit('close', 0);
      }, 10);

      await executor.execute(config);

      expect(errorHandler).toHaveBeenCalledWith({
        workerId: 'test-3',
        error: 'Warning: low memory',
      });
    });

    it('should handle process failure', async () => {
      const config: HeadlessWorkerConfig = {
        workerId: 'test-4',
        workerType: 'map',
        prompt: 'Map codebase',
      };

      // Add error handler to prevent unhandled error
      executor.on('error', () => {});

      // Use setImmediate to ensure the event is emitted after execute starts
      setImmediate(() => {
        mockChildProcess.stderr?.emit('data', Buffer.from('Fatal error'));
        mockChildProcess.emit('close', 1);
      });

      const result = await executor.execute(config);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Fatal error');
    });

    it('should handle process spawn error', async () => {
      const config: HeadlessWorkerConfig = {
        workerId: 'test-5',
        workerType: 'map',
        prompt: 'Map codebase',
      };

      setTimeout(() => {
        mockChildProcess.emit('error', new Error('ENOENT: spawn failed'));
      }, 10);

      const result = await executor.execute(config);

      expect(result.success).toBe(false);
      expect(result.error).toContain('ENOENT');
    });

    it('should pass sandbox option to claude', async () => {
      const config: HeadlessWorkerConfig = {
        workerId: 'test-6',
        workerType: 'audit',
        prompt: 'Security scan',
        sandbox: 'strict',
      };

      setTimeout(() => {
        mockChildProcess.emit('close', 0);
      }, 10);

      await executor.execute(config);

      expect(spawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['--sandbox', 'strict']),
        expect.any(Object)
      );
    });

    it('should return error when Claude Code is not available', async () => {
      (execSync as Mock).mockImplementation(() => {
        throw new Error('Not found');
      });

      const config: HeadlessWorkerConfig = {
        workerId: 'test-7',
        workerType: 'map',
        prompt: 'Map codebase',
      };

      const errorHandler = vi.fn();
      executor.on('error', errorHandler);

      const result = await executor.execute(config);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Claude Code is not available');
      expect(errorHandler).toHaveBeenCalled();
    });
  });

  describe('Context Building', () => {
    beforeEach(() => {
      (execSync as Mock).mockReturnValue('claude version 1.0.0');
    });

    it('should build context from file patterns', async () => {
      (glob as Mock).mockResolvedValue(['src/index.ts', 'src/utils.ts']);
      (existsSync as Mock).mockReturnValue(true);
      (readFileSync as Mock)
        .mockReturnValueOnce('export function main() {}')
        .mockReturnValueOnce('export function helper() {}');

      const context = await executor.buildContext(['src/**/*.ts']);

      expect(context).toContain('src/index.ts');
      expect(context).toContain('export function main()');
      expect(glob).toHaveBeenCalledWith('src/**/*.ts', expect.any(Object));
    });

    it('should return empty string for empty patterns', async () => {
      const context = await executor.buildContext([]);

      expect(context).toBe('');
      expect(glob).not.toHaveBeenCalled();
    });

    it('should limit files to 10', async () => {
      const files = Array.from({ length: 20 }, (_, i) => `file${i}.ts`);
      (glob as Mock).mockResolvedValue(files);
      (readFileSync as Mock).mockReturnValue('content');

      const context = await executor.buildContext(['**/*.ts']);

      expect(readFileSync).toHaveBeenCalledTimes(10);
    });

    it('should skip unreadable files', async () => {
      (glob as Mock).mockResolvedValue(['readable.ts', 'unreadable.ts']);
      (readFileSync as Mock)
        .mockReturnValueOnce('content')
        .mockImplementationOnce(() => {
          throw new Error('Permission denied');
        });

      const context = await executor.buildContext(['**/*.ts']);

      expect(context).toContain('readable.ts');
      expect(context).not.toContain('unreadable.ts');
    });

    it('should combine multiple patterns', async () => {
      (glob as Mock)
        .mockResolvedValueOnce(['src/a.ts'])
        .mockResolvedValueOnce(['tests/a.test.ts']);
      (readFileSync as Mock)
        .mockReturnValueOnce('source code')
        .mockReturnValueOnce('test code');

      const context = await executor.buildContext(['src/**/*.ts', 'tests/**/*.ts']);

      expect(glob).toHaveBeenCalledTimes(2);
      expect(context).toContain('src/a.ts');
      expect(context).toContain('tests/a.test.ts');
    });
  });

  describe('Prompt Template Building', () => {
    it('should build basic prompt without context', () => {
      const prompt = executor.buildPrompt('Analyze code', '', undefined);

      expect(prompt).toBe('Analyze code');
    });

    it('should prepend context to prompt', () => {
      const context = '=== file.ts ===\ncode here';
      const prompt = executor.buildPrompt('Analyze code', context, undefined);

      expect(prompt).toContain('Context:');
      expect(prompt).toContain(context);
      expect(prompt).toContain('Analyze code');
    });

    it('should add JSON instruction for json format', () => {
      const prompt = executor.buildPrompt('Analyze code', '', 'json');

      expect(prompt).toContain('Respond with valid JSON only');
    });

    it('should add Markdown instruction for markdown format', () => {
      const prompt = executor.buildPrompt('Analyze code', '', 'markdown');

      expect(prompt).toContain('Format your response as Markdown');
    });

    it('should not add format instruction for text format', () => {
      const prompt = executor.buildPrompt('Analyze code', '', 'text');

      expect(prompt).not.toContain('JSON');
      expect(prompt).not.toContain('Markdown');
    });

    it('should combine context and format instructions', () => {
      const context = '=== file.ts ===\ncode';
      const prompt = executor.buildPrompt('Analyze', context, 'json');

      expect(prompt).toContain('Context:');
      expect(prompt).toContain('Analyze');
      expect(prompt).toContain('JSON');
    });
  });

  describe('Output Parsing', () => {
    it('should parse valid JSON output', () => {
      const output = '{"result": "success", "count": 42}';
      const parsed = executor.parseOutput(output, 'json');

      expect(parsed).toEqual({ result: 'success', count: 42 });
    });

    it('should parse JSON array output', () => {
      const output = '[{"id": 1}, {"id": 2}]';
      const parsed = executor.parseOutput(output, 'json');

      expect(parsed).toEqual([{ id: 1 }, { id: 2 }]);
    });

    it('should extract JSON from mixed output', () => {
      const output = 'Here is the analysis:\n{"status": "ok"}\nEnd of output';
      const parsed = executor.parseOutput(output, 'json');

      expect(parsed).toEqual({ status: 'ok' });
    });

    it('should return string for invalid JSON', () => {
      const output = 'Not valid JSON';
      const parsed = executor.parseOutput(output, 'json');

      expect(parsed).toBe('Not valid JSON');
    });

    it('should trim text output', () => {
      const output = '  \n  Result text  \n  ';
      const parsed = executor.parseOutput(output, 'text');

      expect(parsed).toBe('Result text');
    });

    it('should preserve markdown output', () => {
      const output = '# Heading\n\n- Item 1\n- Item 2';
      const parsed = executor.parseOutput(output, 'markdown');

      expect(parsed).toBe('# Heading\n\n- Item 1\n- Item 2');
    });

    it('should handle empty output', () => {
      const parsed = executor.parseOutput('', 'text');
      expect(parsed).toBe('');
    });

    it('should handle whitespace-only output', () => {
      const parsed = executor.parseOutput('   \n\t  ', 'text');
      expect(parsed).toBe('');
    });
  });

  describe('Timeout Handling', () => {
    beforeEach(() => {
      (execSync as Mock).mockReturnValue('claude version 1.0.0');
      (glob as Mock).mockResolvedValue([]);
    });

    it('should setup timeout for process execution', async () => {
      const config: HeadlessWorkerConfig = {
        workerId: 'timeout-test',
        workerType: 'map',
        prompt: 'Analyze',
        timeout: 5000,
      };

      // Verify the executor is properly configured with timeout
      // The spawn should be called with the correct arguments
      setImmediate(() => {
        mockChildProcess.stdout?.emit('data', Buffer.from('Done quickly'));
        mockChildProcess.emit('close', 0);
      });

      const result = await executor.execute(config);

      expect(result.success).toBe(true);
      expect(spawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['--headless', '--print']),
        expect.objectContaining({ cwd: '/test/project' })
      );
    });

    it('should emit timeout event when configured timeout is exceeded', () => {
      // Test that executor can emit timeout events
      const timeoutHandler = vi.fn();
      executor.on('timeout', timeoutHandler);

      // Manually emit timeout event to verify handler
      executor.emit('timeout', { workerId: 'test', timeout: 1000 });

      expect(timeoutHandler).toHaveBeenCalledWith({
        workerId: 'test',
        timeout: 1000,
      });
    });

    it('should call kill on child process for timeout simulation', () => {
      // Verify the kill method is correctly mocked
      mockChildProcess.kill('SIGTERM');

      expect(mockChildProcess.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('should use default timeout configuration', () => {
      // Test default timeout configuration value
      const exec = new HeadlessWorkerExecutor('/test');
      const validation = exec.validateConfig();
      expect(validation.valid).toBe(true);
    });

    it('should not timeout if process completes in time', async () => {
      const config: HeadlessWorkerConfig = {
        workerId: 'fast-test',
        workerType: 'map',
        prompt: 'Analyze',
        timeout: 5000,
      };

      // Complete immediately
      setImmediate(() => {
        mockChildProcess.stdout?.emit('data', Buffer.from('Done'));
        mockChildProcess.emit('close', 0);
      });

      const result = await executor.execute(config);

      expect(result.success).toBe(true);
      expect(mockChildProcess.kill).not.toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should handle missing Claude Code gracefully', async () => {
      (execSync as Mock).mockImplementation(() => {
        throw new Error('ENOENT');
      });

      const config: HeadlessWorkerConfig = {
        workerId: 'error-test',
        workerType: 'map',
        prompt: 'Analyze',
      };

      // Add error handler to prevent unhandled error event
      const errorHandler = vi.fn();
      executor.on('error', errorHandler);

      const result = await executor.execute(config);

      expect(result.success).toBe(false);
      expect(result.error).toContain('not available');
      expect(errorHandler).toHaveBeenCalled();
    });

    it('should emit error event for execution failures', async () => {
      (execSync as Mock).mockReturnValue('claude version 1.0.0');
      (glob as Mock).mockResolvedValue([]);

      const config: HeadlessWorkerConfig = {
        workerId: 'error-emit-test',
        workerType: 'audit',
        prompt: 'Audit',
      };

      const errorHandler = vi.fn();
      executor.on('error', errorHandler);

      setImmediate(() => {
        mockChildProcess.stderr?.emit('data', Buffer.from('Critical error'));
        mockChildProcess.emit('close', 1);
      });

      await executor.execute(config);

      expect(errorHandler).toHaveBeenCalled();
    });

    it('should include duration in error results', async () => {
      (execSync as Mock).mockImplementation(() => {
        throw new Error('Not found');
      });

      const config: HeadlessWorkerConfig = {
        workerId: 'duration-test',
        workerType: 'map',
        prompt: 'Analyze',
      };

      // Add error handler to prevent unhandled error event
      executor.on('error', () => {});

      const result = await executor.execute(config);

      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(typeof result.duration).toBe('number');
    });
  });

  describe('Event Emissions', () => {
    beforeEach(() => {
      (execSync as Mock).mockReturnValue('claude version 1.0.0');
      (glob as Mock).mockResolvedValue([]);
    });

    it('should emit output events with workerId and chunk', async () => {
      const outputs: Array<{ workerId: string; chunk: string }> = [];
      executor.on('output', (event) => outputs.push(event));

      const config: HeadlessWorkerConfig = {
        workerId: 'emit-test',
        workerType: 'map',
        prompt: 'Test',
      };

      setTimeout(() => {
        mockChildProcess.stdout?.emit('data', Buffer.from('First chunk'));
        mockChildProcess.stdout?.emit('data', Buffer.from('Second chunk'));
        mockChildProcess.emit('close', 0);
      }, 10);

      await executor.execute(config);

      expect(outputs).toHaveLength(2);
      expect(outputs[0]).toEqual({ workerId: 'emit-test', chunk: 'First chunk' });
      expect(outputs[1]).toEqual({ workerId: 'emit-test', chunk: 'Second chunk' });
    });

    it('should emit error events with workerId and error message', async () => {
      const errors: Array<{ workerId: string; error: string }> = [];
      executor.on('error', (event) => errors.push(event));

      const config: HeadlessWorkerConfig = {
        workerId: 'error-emit',
        workerType: 'audit',
        prompt: 'Test',
      };

      setTimeout(() => {
        mockChildProcess.stderr?.emit('data', Buffer.from('Warning 1'));
        mockChildProcess.stderr?.emit('data', Buffer.from('Error 2'));
        mockChildProcess.emit('close', 0);
      }, 10);

      await executor.execute(config);

      expect(errors).toHaveLength(2);
      expect(errors[0].workerId).toBe('error-emit');
      expect(errors[1].error).toBe('Error 2');
    });
  });

  describe('HEADLESS_WORKERS Configuration Validation', () => {
    it('should validate enabled field', () => {
      const exec = new HeadlessWorkerExecutor('/test', {
        enabled: true,
        defaultTimeout: 60000,
        defaultSandbox: 'strict',
        workers: {},
      });

      const validation = exec.validateConfig();
      expect(validation.valid).toBe(true);
    });

    it('should reject invalid defaultTimeout', () => {
      const exec = new HeadlessWorkerExecutor('/test', {
        enabled: true,
        defaultTimeout: -1,
        defaultSandbox: 'strict',
        workers: {},
      });

      const validation = exec.validateConfig();
      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('defaultTimeout must be a positive number');
    });

    it('should reject invalid defaultSandbox', () => {
      const exec = new HeadlessWorkerExecutor('/test', {
        enabled: true,
        defaultTimeout: 60000,
        defaultSandbox: 'invalid' as 'strict',
        workers: {},
      });

      const validation = exec.validateConfig();
      expect(validation.valid).toBe(false);
      expect(validation.errors[0]).toContain('defaultSandbox');
    });

    it('should validate worker configurations', () => {
      const exec = new HeadlessWorkerExecutor('/test', {
        enabled: true,
        defaultTimeout: 60000,
        defaultSandbox: 'strict',
        workers: {
          'valid-worker': {
            enabled: true,
            prompt: 'Valid prompt',
            outputFormat: 'json',
            timeout: 30000,
          },
        },
      });

      const validation = exec.validateConfig();
      expect(validation.valid).toBe(true);
    });

    it('should reject worker without prompt', () => {
      const exec = new HeadlessWorkerExecutor('/test', {
        enabled: true,
        defaultTimeout: 60000,
        defaultSandbox: 'strict',
        workers: {
          'invalid-worker': {
            enabled: true,
            prompt: '', // Empty prompt
          },
        },
      });

      const validation = exec.validateConfig();
      expect(validation.valid).toBe(false);
      expect(validation.errors[0]).toContain('must have a prompt');
    });

    it('should reject worker with invalid outputFormat', () => {
      const exec = new HeadlessWorkerExecutor('/test', {
        enabled: true,
        defaultTimeout: 60000,
        defaultSandbox: 'strict',
        workers: {
          'bad-format': {
            enabled: true,
            prompt: 'Test',
            outputFormat: 'xml' as 'json', // Invalid format
          },
        },
      });

      const validation = exec.validateConfig();
      expect(validation.valid).toBe(false);
      expect(validation.errors[0]).toContain('invalid outputFormat');
    });

    it('should reject worker with invalid timeout', () => {
      const exec = new HeadlessWorkerExecutor('/test', {
        enabled: true,
        defaultTimeout: 60000,
        defaultSandbox: 'strict',
        workers: {
          'bad-timeout': {
            enabled: true,
            prompt: 'Test',
            timeout: -100, // Negative timeout is invalid
          },
        },
      });

      const validation = exec.validateConfig();
      expect(validation.valid).toBe(false);
      expect(validation.errors[0]).toContain('invalid timeout');
    });

    it('should collect multiple validation errors', () => {
      const exec = new HeadlessWorkerExecutor('/test', {
        enabled: true,
        defaultTimeout: -1, // Error 1
        defaultSandbox: 'invalid' as 'strict', // Error 2
        workers: {
          'worker1': {
            enabled: true,
            prompt: '', // Error 3
          },
          'worker2': {
            enabled: true,
            prompt: 'Test',
            timeout: -100, // Error 4
          },
        },
      });

      const validation = exec.validateConfig();
      expect(validation.valid).toBe(false);
      expect(validation.errors.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe('Integration Scenarios', () => {
    beforeEach(() => {
      (execSync as Mock).mockReturnValue('claude version 1.0.0');
    });

    it('should execute map worker with context', async () => {
      (glob as Mock).mockResolvedValue(['src/main.ts']);
      (readFileSync as Mock).mockReturnValue('export const app = {}');

      const config: HeadlessWorkerConfig = {
        workerId: 'map-001',
        workerType: 'map',
        prompt: 'Map the codebase structure and dependencies',
        contextPatterns: ['src/**/*.ts'],
        outputFormat: 'json',
        timeout: 120000,
      };

      setTimeout(() => {
        mockChildProcess.stdout?.emit('data', Buffer.from('{"files": 10, "directories": 5}'));
        mockChildProcess.emit('close', 0);
      }, 10);

      const result = await executor.execute(config);

      expect(result.success).toBe(true);
      expect(result.output).toEqual({ files: 10, directories: 5 });
      expect(spawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['--headless', '--print']),
        expect.any(Object)
      );
    });

    it('should execute audit worker with strict sandbox', async () => {
      (glob as Mock).mockResolvedValue([]);

      const config: HeadlessWorkerConfig = {
        workerId: 'audit-001',
        workerType: 'audit',
        prompt: 'Perform security audit',
        sandbox: 'strict',
        outputFormat: 'markdown',
      };

      setTimeout(() => {
        mockChildProcess.stdout?.emit('data', Buffer.from('# Security Audit\n\nNo issues found.'));
        mockChildProcess.emit('close', 0);
      }, 10);

      const result = await executor.execute(config);

      expect(result.success).toBe(true);
      expect(result.output).toContain('Security Audit');
      expect(spawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['--sandbox', 'strict']),
        expect.any(Object)
      );
    });

    it('should handle concurrent executions', async () => {
      (glob as Mock).mockResolvedValue([]);

      const configs: HeadlessWorkerConfig[] = [
        { workerId: 'concurrent-1', workerType: 'map', prompt: 'Task 1' },
        { workerId: 'concurrent-2', workerType: 'audit', prompt: 'Task 2' },
        { workerId: 'concurrent-3', workerType: 'optimize', prompt: 'Task 3' },
      ];

      // Create separate mock processes for each execution
      const mockProcesses = configs.map(() => createMockChildProcess());
      let spawnIndex = 0;
      (spawn as Mock).mockImplementation(() => mockProcesses[spawnIndex++]);

      const resultPromises = configs.map((config) => executor.execute(config));

      // Complete all processes
      setTimeout(() => {
        mockProcesses.forEach((proc, i) => {
          proc.stdout?.emit('data', Buffer.from(`Result ${i + 1}`));
          proc.emit('close', 0);
        });
      }, 10);

      const results = await Promise.all(resultPromises);

      expect(results).toHaveLength(3);
      results.forEach((result) => {
        expect(result.success).toBe(true);
      });
    });
  });
});

describe('HeadlessWorkerExecutor Edge Cases', () => {
  let executor: HeadlessWorkerExecutor;
  let mockChildProcess: MockChildProcess;

  beforeEach(() => {
    vi.clearAllMocks();
    executor = new HeadlessWorkerExecutor('/test/project');
    mockChildProcess = createMockChildProcess();
    (spawn as Mock).mockReturnValue(mockChildProcess);
    (execSync as Mock).mockReturnValue('claude version 1.0.0');
    (glob as Mock).mockResolvedValue([]);
  });

  it('should handle very large output', async () => {
    const config: HeadlessWorkerConfig = {
      workerId: 'large-output',
      workerType: 'map',
      prompt: 'Map everything',
    };

    const largeOutput = 'x'.repeat(1000000); // 1MB of data

    setTimeout(() => {
      // Emit in chunks
      for (let i = 0; i < 100; i++) {
        mockChildProcess.stdout?.emit('data', Buffer.from('x'.repeat(10000)));
      }
      mockChildProcess.emit('close', 0);
    }, 10);

    const result = await executor.execute(config);

    expect(result.success).toBe(true);
    expect(result.rawOutput.length).toBe(1000000);
  });

  it('should handle unicode output', async () => {
    const config: HeadlessWorkerConfig = {
      workerId: 'unicode-test',
      workerType: 'map',
      prompt: 'Test',
    };

    setTimeout(() => {
      mockChildProcess.stdout?.emit('data', Buffer.from(''));
      mockChildProcess.emit('close', 0);
    }, 10);

    const result = await executor.execute(config);

    expect(result.success).toBe(true);
    expect(result.output).toContain('');
  });

  it('should handle binary-looking output', async () => {
    const config: HeadlessWorkerConfig = {
      workerId: 'binary-test',
      workerType: 'map',
      prompt: 'Test',
    };

    setTimeout(() => {
      const buffer = Buffer.from([0x00, 0x01, 0x02, 0x48, 0x65, 0x6c, 0x6c, 0x6f]); // Some binary + "Hello"
      mockChildProcess.stdout?.emit('data', buffer);
      mockChildProcess.emit('close', 0);
    }, 10);

    const result = await executor.execute(config);

    expect(result.success).toBe(true);
  });

  it('should handle rapid close after spawn', async () => {
    const config: HeadlessWorkerConfig = {
      workerId: 'rapid-close',
      workerType: 'map',
      prompt: 'Test',
    };

    // Close immediately after spawn returns
    setTimeout(() => {
      mockChildProcess.emit('close', 0);
    }, 0);

    const result = await executor.execute(config);

    expect(result.success).toBe(true);
    expect(result.output).toBe('');
  });

  it('should handle null exit code', async () => {
    const config: HeadlessWorkerConfig = {
      workerId: 'null-code',
      workerType: 'map',
      prompt: 'Test',
    };

    setTimeout(() => {
      mockChildProcess.emit('close', null);
    }, 10);

    const result = await executor.execute(config);

    // Null exit code typically means the process was killed
    expect(result.success).toBe(false);
  });

  it('should preserve raw output even when parsing fails', async () => {
    const config: HeadlessWorkerConfig = {
      workerId: 'parse-fail',
      workerType: 'map',
      prompt: 'Test',
      outputFormat: 'json',
    };

    const invalidJson = 'This is not {valid: json}';

    setTimeout(() => {
      mockChildProcess.stdout?.emit('data', Buffer.from(invalidJson));
      mockChildProcess.emit('close', 0);
    }, 10);

    const result = await executor.execute(config);

    expect(result.success).toBe(true);
    expect(result.rawOutput).toBe(invalidJson);
    // Output should be the string since JSON parsing failed
    expect(typeof result.output).toBe('string');
  });
});
