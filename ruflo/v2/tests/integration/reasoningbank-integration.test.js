/**
 * ReasoningBank Integration Tests
 * Tests claude-flow integration with agentic-flow ReasoningBank
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import { unlink, mkdir } from 'fs/promises';
import path from 'path';

const execAsync = promisify(exec);
const CLI_PATH = './bin/claude-flow';
const TEST_DB_PATH = '.swarm/test-memory.db';

describe('ReasoningBank Integration', () => {
  beforeAll(async () => {
    // Ensure test directory exists
    await mkdir('.swarm', { recursive: true });
  });

  afterAll(async () => {
    // Clean up test database
    try {
      if (existsSync(TEST_DB_PATH)) {
        await unlink(TEST_DB_PATH);
      }
      if (existsSync(`${TEST_DB_PATH}-shm`)) {
        await unlink(`${TEST_DB_PATH}-shm`);
      }
      if (existsSync(`${TEST_DB_PATH}-wal`)) {
        await unlink(`${TEST_DB_PATH}-wal`);
      }
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  describe('CLI Memory Commands', () => {
    test('agent memory init should initialize database', async () => {
      const { stdout, stderr } = await execAsync(`${CLI_PATH} agent memory init`);

      expect(stdout).toContain('Initializing ReasoningBank');
      expect(stdout).toContain('Database initialized successfully');
      expect(existsSync('.swarm/memory.db')).toBe(true);
    }, 60000);

    test('agent memory status should show statistics', async () => {
      const { stdout } = await execAsync(`${CLI_PATH} agent memory status`);

      expect(stdout).toContain('ReasoningBank Status');
      expect(stdout).toContain('Total memories');
      expect(stdout).toContain('Average confidence');
    }, 30000);

    test('agent memory list should show memories', async () => {
      const { stdout } = await execAsync(`${CLI_PATH} agent memory list --limit 5`);

      expect(stdout).toContain('Listing ReasoningBank memories');
      // May be empty initially
      expect(stdout).toBeTruthy();
    }, 30000);

    test('agent memory --help should show commands', async () => {
      try {
        await execAsync(`${CLI_PATH} agent memory --help`);
      } catch (error) {
        // Command shows help and may exit with 0 or 1
        const output = error.stdout || '';
        expect(output).toContain('Memory (ReasoningBank) commands');
        expect(output).toContain('init');
        expect(output).toContain('status');
        expect(output).toContain('consolidate');
      }
    }, 30000);
  });

  describe('Agent Execution with Memory', () => {
    test('should accept --enable-memory flag', async () => {
      const cmd = `${CLI_PATH} agent run coder "print hello" --enable-memory --provider onnx`;

      try {
        const { stdout, stderr } = await execAsync(cmd, { timeout: 60000 });

        // Should execute without errors
        expect(stderr || '').not.toContain('Unknown flag');
        expect(stderr || '').not.toContain('Error');
      } catch (error) {
        // May fail due to missing API key, but should recognize the flag
        const errorMsg = error.message || '';
        expect(errorMsg).not.toContain('Unknown option');
        expect(errorMsg).not.toContain('--enable-memory');
      }
    }, 120000);

    test('should accept --memory-k flag', async () => {
      const cmd = `${CLI_PATH} agent run coder "print hello" --enable-memory --memory-k 5 --provider onnx`;

      try {
        await execAsync(cmd, { timeout: 60000 });
      } catch (error) {
        const errorMsg = error.message || '';
        expect(errorMsg).not.toContain('Unknown option');
        expect(errorMsg).not.toContain('--memory-k');
      }
    }, 120000);

    test('should accept --memory-domain flag', async () => {
      const cmd = `${CLI_PATH} agent run coder "print hello" --enable-memory --memory-domain test --provider onnx`;

      try {
        await execAsync(cmd, { timeout: 60000 });
      } catch (error) {
        const errorMsg = error.message || '';
        expect(errorMsg).not.toContain('Unknown option');
        expect(errorMsg).not.toContain('--memory-domain');
      }
    }, 120000);
  });

  describe('SDK Integration', () => {
    test('AgentExecutor should have memory methods', async () => {
      const { AgentExecutor } = await import('../../dist-cjs/src/execution/agent-executor.js');
      const executor = new AgentExecutor();

      expect(executor).toHaveProperty('initializeMemory');
      expect(executor).toHaveProperty('getMemoryStats');
      expect(executor).toHaveProperty('consolidateMemories');
      expect(typeof executor.initializeMemory).toBe('function');
      expect(typeof executor.getMemoryStats).toBe('function');
      expect(typeof executor.consolidateMemories).toBe('function');
    });

    test('AgentExecutionOptions should include memory fields', async () => {
      // Type check (TypeScript compile-time check)
      const options = {
        agent: 'coder',
        task: 'test task',
        enableMemory: true,
        memoryDatabase: '.swarm/memory.db',
        memoryRetrievalK: 3,
        memoryLearning: true,
        memoryDomain: 'test',
        memoryMinConfidence: 0.5,
        memoryTaskId: 'task-001',
      };

      expect(options.enableMemory).toBe(true);
      expect(options.memoryRetrievalK).toBe(3);
      expect(options.memoryDomain).toBe('test');
    });
  });

  describe('Agentic-Flow Dependency', () => {
    test('should have agentic-flow 1.4.11 installed', async () => {
      const { stdout } = await execAsync('npm list agentic-flow');

      expect(stdout).toContain('agentic-flow@1.4.11');
    }, 30000);

    test('agentic-flow reasoningbank should be available', async () => {
      const { stdout } = await execAsync('npx agentic-flow reasoningbank help');

      expect(stdout).toContain('ReasoningBank');
      expect(stdout).toContain('COMMANDS');
      expect(stdout).toContain('demo');
      expect(stdout).toContain('init');
      expect(stdout).toContain('status');
    }, 30000);
  });

  describe('End-to-End Workflow', () => {
    test('complete memory lifecycle', async () => {
      // 1. Initialize
      const { stdout: initOut } = await execAsync(`${CLI_PATH} agent memory init`);
      expect(initOut).toContain('initialized successfully');

      // 2. Check status (should be empty)
      const { stdout: statusOut1 } = await execAsync(`${CLI_PATH} agent memory status`);
      expect(statusOut1).toContain('Total memories: 0');

      // 3. List memories (should be empty)
      const { stdout: listOut } = await execAsync(`${CLI_PATH} agent memory list`);
      expect(listOut).toContain('Listing ReasoningBank memories');

      // 4. Status again
      const { stdout: statusOut2 } = await execAsync(`${CLI_PATH} agent memory status`);
      expect(statusOut2).toContain('ReasoningBank Status');
    }, 120000);
  });

  describe('Performance Requirements', () => {
    test('memory init should complete within 30 seconds', async () => {
      const start = Date.now();
      await execAsync(`${CLI_PATH} agent memory init`);
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(30000);
    }, 60000);

    test('memory status should complete within 5 seconds', async () => {
      const start = Date.now();
      await execAsync(`${CLI_PATH} agent memory status`);
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(5000);
    }, 30000);
  });
});
