import { LLMAssistantExecutor, LLMAssistantExecutorConfig } from '../../../src/swarm/llm-assistant-executor.ts';
import { TaskDefinition, AgentState, TaskId, AgentId, TaskResult } from '../../../src/swarm/types.ts';
import { Logger } from '../../../src/core/logger.ts';
import { assertEquals, assertExists, assertMatch, assertArrayIncludes } from '../../test.utils.ts'; // Assuming Deno's testing utils
import { mock, Mocker, Stub } from "https://deno.land/x/mocker@v1.0.1/mod.ts"; // Using a Deno mocking library

// Mock Logger
class MockLogger extends Logger {
  constructor() {
    super({ level: 'silent', format: 'text', destination: 'console' });
  }
  info = () => {};
  error = () => {};
  warn = () => {};
  debug = () => {};
}

describe('LLMAssistantExecutor', () => {
  let executor: LLMAssistantExecutor;
  let mockSpawn: Stub<typeof Deno.Command>; // Deno uses Deno.Command, not child_process.spawn directly for testing
  let spawnCallParams: { cmd: string, args: string[], options: any } | null = null;

  const baseConfig: LLMAssistantExecutorConfig = {
    logger: new MockLogger(),
    openCodexModel: 'test-model',
    openCodexBaseUrl: 'http://localhost:8080',
    openCodexApiKey: 'test-api-key',
    openCodexPath: '/usr/bin/open-codex',
    verbose: false,
    timeoutMinutes: 1,
  };

  const sampleTask: TaskDefinition = {
    id: { id: 'task-1', swarmId: 'swarm-1', sequence: 1, priority: 1 } as TaskId,
    type: 'coding',
    name: 'Sample Task',
    description: 'This is a sample task.',
    instructions: 'Please perform the sample action.',
    requirements: { capabilities: [], tools: [], permissions: [] },
    constraints: { dependencies: [], dependents: [], conflicts: [] },
    priority: 'normal',
    input: {},
    context: { targetDir: '/test/workdir' },
    status: 'created',
    createdAt: new Date(),
    updatedAt: new Date(),
    attempts: [],
    statusHistory: [],
  };

  const sampleAgent: AgentState = {
    id: { id: 'agent-1', swarmId: 'swarm-1', type: 'developer', instance: 1 } as AgentId,
    name: 'Test Agent',
    type: 'developer',
    status: 'idle',
    capabilities: {} as any, // Simplified for this test
    metrics: {} as any,
    config: {} as any,
    environment: {} as any,
    endpoints: [],
    lastHeartbeat: new Date(),
    taskHistory: [],
    errorHistory: [],
    childAgents: [],
    collaborators: [],
    workload: 0,
    health: 1,
  };

  beforeEach(() => {
    spawnCallParams = null;
    // Mock Deno.Command
    // This is a simplified mock. A more robust mock would handle stdout/stderr streams.
    mockSpawn = mock(Deno.Command, (cmd, options) => {
      spawnCallParams = { cmd: cmd.toString(), args: options?.args || [], options: options || {} };
      return {
        output: async () => Promise.resolve({
          success: true,
          code: 0,
          stdout: new TextEncoder().encode('Mocked output. Created file: /test/workdir/output.txt'),
          stderr: new TextEncoder().encode(''),
        }),
        spawn: () => ({
            stdout: { pipeThrough: () => ({ read: () => {} }) } as any, // ReadableStream
            stderr: { pipeThrough: () => ({ read: () => {} }) } as any, // ReadableStream
            status: Promise.resolve({ success: true, code: 0 }),
            output: async () => Promise.resolve({
                success: true,
                code: 0,
                stdout: new TextEncoder().encode('Mocked output. Created file: /test/workdir/output.txt'),
                stderr: new TextEncoder().encode(''),
            }),
            kill: () => {},
        }) as any, // Deno.ChildProcess
      } as any; // Deno.Command
    });
    executor = new LLMAssistantExecutor(baseConfig);
  });

  afterEach(() => {
    mockSpawn.restore();
  });

  describe('constructor', () => {
    it('should store openCodex configuration correctly', () => {
      assertEquals((executor as any).openCodexModel, baseConfig.openCodexModel);
      assertEquals((executor as any).openCodexBaseUrl, baseConfig.openCodexBaseUrl);
      assertEquals((executor as any).openCodexApiKey, baseConfig.openCodexApiKey);
      assertEquals((executor as any).openCodexPath, baseConfig.openCodexPath);
      assertEquals((executor as any).verbose, baseConfig.verbose);
      assertEquals((executor as any).timeoutMinutes, baseConfig.timeoutMinutes);
    });
  });

  describe('buildOpenCodexCommand (private method, tested via executeTask)', () => {
    it('should construct the command array correctly', async () => {
      await executor.executeTask(sampleTask, sampleAgent, '/test/workdir');
      assertExists(spawnCallParams);

      const expectedPrompt = `"${sampleTask.description}. ${sampleTask.instructions} (Target directory: /test/workdir)"`;
      const expectedArgs = [
        '--model', baseConfig.openCodexModel,
        '--approval-mode', 'full-auto',
        '--quiet',
        expectedPrompt
      ];
      assertEquals(spawnCallParams?.cmd, baseConfig.openCodexPath);
      assertArrayIncludes(spawnCallParams?.args || [], expectedArgs);
    });

    it('should include --verbose if configured', async () => {
      const verboseConfig = { ...baseConfig, verbose: true };
      const verboseExecutor = new LLMAssistantExecutor(verboseConfig);
      await verboseExecutor.executeTask(sampleTask, sampleAgent, '/test/workdir');
      assertExists(spawnCallParams);
      assertArrayIncludes(spawnCallParams?.args || [], ['--verbose']);
    });
  });

  describe('executeCommand (private method, tested via executeTask)', () => {
    it('should call spawn with correct path, args, cwd, and environment variables', async () => {
      const targetDir = '/specific/target/dir';
      await executor.executeTask(sampleTask, sampleAgent, targetDir);

      assertExists(spawnCallParams);
      assertEquals(spawnCallParams?.cmd, baseConfig.openCodexPath);

      const expectedPrompt = `"${sampleTask.description}. ${sampleTask.instructions} (Target directory: ${targetDir})"`;
      const expectedArgs = [
        '--model', baseConfig.openCodexModel,
        '--approval-mode', 'full-auto',
        '--quiet',
        expectedPrompt
      ];
      assertArrayIncludes(spawnCallParams?.args || [], expectedArgs);

      assertEquals(spawnCallParams?.options.cwd, targetDir);

      assertExists(spawnCallParams?.options.env);
      assertEquals(spawnCallParams?.options.env.OPENAI_API_KEY, baseConfig.openCodexApiKey);
      assertEquals(spawnCallParams?.options.env.OPENAI_API_BASE, baseConfig.openCodexBaseUrl);
    });

    it('should use task.context.targetDir if targetDir argument is not provided', async () => {
      await executor.executeTask(sampleTask, sampleAgent); // No targetDir passed
      assertExists(spawnCallParams);
      assertEquals(spawnCallParams?.options.cwd, sampleTask.context.targetDir);
      const expectedPrompt = `"${sampleTask.description}. ${sampleTask.instructions} (Target directory: ${sampleTask.context.targetDir})"`;
      assertArrayIncludes(spawnCallParams?.args || [], [expectedPrompt]);
    });
  });

  describe('executeTask output/error handling', () => {
    it('should return TaskResult with output and artifacts on successful execution', async () => {
      const result: TaskResult = await executor.executeTask(sampleTask, sampleAgent, '/test/workdir');

      assertExists(result);
      assertMatch(result.output as string, /Mocked output/);
      assertExists(result.artifacts);
      assertEquals(result.artifacts['/test/workdir/output.txt'], true);
      assertEquals(result.metadata?.exitCode, 0);
      assertEquals(result.error, null);
    });

    it('should handle command failure (non-zero exit code)', async () => {
      // Override mock for this test
      mockSpawn.restore();
      mockSpawn = mock(Deno.Command, () => ({
        output: async () => Promise.resolve({
            success: false,
            code: 1,
            stdout: new TextEncoder().encode('Failed output'),
            stderr: new TextEncoder().encode('Error message from command'),
        }),
        spawn: () => ({
            stdout: { pipeThrough: () => ({ read: () => {} }) } as any,
            stderr: { pipeThrough: () => ({ read: () => {} }) } as any,
            status: Promise.resolve({ success: false, code: 1 }),
            output: async () => Promise.resolve({
                success: false,
                code: 1,
                stdout: new TextEncoder().encode('Failed output'),
                stderr: new TextEncoder().encode('Error message from command'),
            }),
            kill: () => {},
        }) as any,
      } as any));
      executor = new LLMAssistantExecutor(baseConfig); // Re-initialize with new mock

      const result: TaskResult = await executor.executeTask(sampleTask, sampleAgent, '/test/workdir');

      assertExists(result);
      assertEquals(result.output, 'Failed output');
      assertEquals(result.metadata?.exitCode, 1);
      assertMatch(result.error as string, /Error message from command/);
    });

    it('should handle spawn error (e.g., command not found)', async () => {
       // Override mock for this test
      mockSpawn.restore();
      mockSpawn = mock(Deno.Command, () => ({
        output: async () => { throw new Error("Command not found"); }, // Simulate Deno.Command failing
        spawn: () => { throw new Error("Command not found"); } // Simulate spawn failing
      } as any));
      executor = new LLMAssistantExecutor(baseConfig); // Re-initialize with new mock

      const result: TaskResult = await executor.executeTask(sampleTask, sampleAgent, '/test/workdir');

      assertExists(result);
      assertEquals(result.output, '');
      assertExists(result.error);
      assertMatch(result.error as string, /Command not found/);
    });
  });
});
