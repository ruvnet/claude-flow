/// <reference types="jest" />

/**
 * Integration tests for terminal functionality
 */

import { TerminalManager } from '../../src/terminal/manager.js';
import { NativeAdapter } from '../../src/terminal/adapters/native.js';
import { VSCodeAdapter } from '../../src/terminal/adapters/vscode.js';
import { TerminalPool } from '../../src/terminal/pool.js';
import { TerminalSession } from '../../src/terminal/session.js';
import { EventBus } from '../../src/core/event-bus.js';
import { Logger } from '../../src/core/logger.js';
import { TerminalConfig, AgentProfile } from '../../src/utils/types.js';
import { delay } from '../../src/utils/helpers.js';

/**
 * Test fixtures
 */
const createTestConfig = (): TerminalConfig => ({
  type: 'native',
  poolSize: 2,
  recycleAfter: 3,
  healthCheckInterval: 5000,
  commandTimeout: 10000,
});

const createTestProfile = (id: string): AgentProfile => ({
  id,
  name: `Test Agent ${id}`,
  type: 'custom',
  capabilities: ['execute', 'test'],
  systemPrompt: 'You are a test agent',
  maxConcurrentTasks: 1,
  priority: 1,
  metadata: {
    workingDirectory: process.cwd(),
    initCommands: ['echo "Test agent initialized"'],
    cleanupCommands: ['echo "Test agent cleanup"'],
  },
});

/**
 * Native adapter tests
 */
Deno.test('NativeAdapter - creates and destroys terminals', async () => {
  const logger = new Logger({ level: 'debug', format: 'text', destination: 'console' });
  const adapter = new NativeAdapter(logger);

  await adapter.initialize();

  // Create terminal
  const terminal = await adapter.createTerminal();
  expect(terminal);
  expect(terminal.id);
  expect(terminal.isAlive()).toBe( true);

  // Execute command
  const output = await terminal.executeCommand('echo "Hello World"');
  expect(output.trim()).toBe( 'Hello World');

  // Destroy terminal
  await adapter.destroyTerminal(terminal);
  expect(terminal.isAlive()).toBe( false);

  await adapter.shutdown();
});

Deno.test('NativeAdapter - handles multiple shells', async () => {
  const logger = new Logger({ level: 'debug', format: 'text', destination: 'console' });
  const adapter = new NativeAdapter(logger);

  await adapter.initialize();

  const terminal = await adapter.createTerminal();
  
  // Test shell-specific commands
  const platform = Deno.build.os;
  if (platform === 'windows') {
    // Windows specific test
    const output = await terminal.executeCommand('echo %CLAUDE_FLOW_TERMINAL%');
    expect(output.trim()).toBe( 'true');
  } else {
    // Unix-like specific test
    const output = await terminal.executeCommand('echo $CLAUDE_FLOW_TERMINAL');
    expect(output.trim()).toBe( 'true');
  }

  await adapter.destroyTerminal(terminal);
  await adapter.shutdown();
});

/**
 * Terminal pool tests
 */
Deno.test('TerminalPool - manages terminal lifecycle', async () => {
  const logger = new Logger({ level: 'debug', format: 'text', destination: 'console' });
  const adapter = new NativeAdapter(logger);
  await adapter.initialize();

  const pool = new TerminalPool(3, 2, adapter, logger);
  await pool.initialize();

  // Acquire terminals
  const term1 = await pool.acquire();
  const term2 = await pool.acquire();
  
  expect(term1);
  expect(term2);
  expect(term1.id !== term2.id).toBe( true);

  // Release terminals
  await pool.release(term1);
  await pool.release(term2);

  // Check health status
  const health = await pool.getHealthStatus();
  expect(health.healthy).toBe( true);
  expect(health.size >= 2).toBe( true);

  await pool.shutdown();
  await adapter.shutdown();
});

Deno.test('TerminalPool - recycles terminals after use count', async () => {
  const logger = new Logger({ level: 'debug', format: 'text', destination: 'console' });
  const adapter = new NativeAdapter(logger);
  await adapter.initialize();

  const pool = new TerminalPool(2, 2, adapter, logger); // Recycle after 2 uses
  await pool.initialize();

  const terminal = await pool.acquire();
  const originalId = terminal.id;

  // Use and release twice to trigger recycling
  await pool.release(terminal);
  const term2 = await pool.acquire();
  expect(term2.id).toBe( originalId); // Should get same terminal
  
  await pool.release(term2);
  const term3 = await pool.acquire();
  expect(term3.id !== originalId).toBe( true); // Should get new terminal after recycling

  await pool.shutdown();
  await adapter.shutdown();
});

/**
 * Terminal session tests
 */
Deno.test('TerminalSession - manages command execution', async () => {
  const logger = new Logger({ level: 'debug', format: 'text', destination: 'console' });
  const adapter = new NativeAdapter(logger);
  await adapter.initialize();

  const terminal = await adapter.createTerminal();
  const profile = createTestProfile('test-1');
  const session = new TerminalSession(terminal, profile, 5000, logger);

  await session.initialize();

  // Execute command
  const output = await session.executeCommand('echo "Session test"');
  expect(output.trim()).toBe( 'Session test');

  // Check command history
  const history = session.getCommandHistory();
  expect(history.length).toBe( 1);
  expect(history[0]).toBe( 'echo "Session test"');

  // Check health
  expect(session.isHealthy()).toBe( true);

  await session.cleanup();
  await adapter.destroyTerminal(terminal);
  await adapter.shutdown();
});

Deno.test('TerminalSession - handles output streaming', async () => {
  const logger = new Logger({ level: 'debug', format: 'text', destination: 'console' });
  const adapter = new NativeAdapter(logger);
  await adapter.initialize();

  const terminal = await adapter.createTerminal();
  const profile = createTestProfile('test-2');
  const session = new TerminalSession(terminal, profile, 5000, logger);

  await session.initialize();

  // Set up output streaming
  const outputs: string[] = [];
  const unsubscribe = session.streamOutput((data) => {
    outputs.push(data);
  });

  // Execute commands
  await session.executeCommand('echo "Line 1"');
  await session.executeCommand('echo "Line 2"');

  // Check streamed output
  await delay(100); // Allow output to be processed
  expect(outputs.length > 0).toBe( true);

  unsubscribe();
  await session.cleanup();
  await adapter.destroyTerminal(terminal);
  await adapter.shutdown();
});

/**
 * Terminal manager tests
 */
Deno.test('TerminalManager - complete workflow', async () => {
  const eventBus = new EventBus();
  const logger = new Logger({ level: 'debug', format: 'text', destination: 'console' });
  const config = createTestConfig();
  
  const manager = new TerminalManager(config, eventBus, logger);
  await manager.initialize();

  // Spawn terminal for agent
  const profile = createTestProfile('manager-test');
  const terminalId = await manager.spawnTerminal(profile);
  expect(terminalId);

  // Execute command
  const output = await manager.executeCommand(terminalId, 'echo "Manager test"');
  expect(output.trim()).toBe( 'Manager test');

  // Get active sessions
  const sessions = manager.getActiveSessions();
  expect(sessions.length).toBe( 1);
  expect(sessions[0].agentId).toBe( profile.id);

  // Check health
  const health = await manager.getHealthStatus();
  expect(health.healthy).toBe( true);
  expect(health.metrics?.activeSessions).toBe( 1);

  // Terminate terminal
  await manager.terminateTerminal(terminalId);
  
  // Verify cleanup
  const sessionsAfter = manager.getActiveSessions();
  expect(sessionsAfter.length).toBe( 0);

  await manager.shutdown();
});

Deno.test('TerminalManager - handles maintenance', async () => {
  const eventBus = new EventBus();
  const logger = new Logger({ level: 'debug', format: 'text', destination: 'console' });
  const config = createTestConfig();
  
  const manager = new TerminalManager(config, eventBus, logger);
  await manager.initialize();

  // Track maintenance events
  let maintenanceEvent: any;
  eventBus.on('terminal:maintenance', (event) => {
    maintenanceEvent = event;
  });

  // Spawn terminal
  const profile = createTestProfile('maintenance-test');
  const terminalId = await manager.spawnTerminal(profile);

  // Perform maintenance
  await manager.performMaintenance();

  // Check event was emitted
  expect(maintenanceEvent);
  expect(maintenanceEvent.activeSessions).toBe( 1);

  await manager.terminateTerminal(terminalId);
  await manager.shutdown();
});

/**
 * Error handling tests
 */
Deno.test('TerminalManager - handles spawn errors gracefully', async () => {
  const eventBus = new EventBus();
  const logger = new Logger({ level: 'debug', format: 'text', destination: 'console' });
  const config: TerminalConfig = {
    ...createTestConfig(),
    poolSize: 0, // Force pool exhaustion
  };
  
  const manager = new TerminalManager(config, eventBus, logger);
  await manager.initialize();

  const profile = createTestProfile('error-test');
  
  // Should throw when pool is exhausted
  await expect(
    async () => await manager.spawnTerminal(profile),
    Error,
  );

  await manager.shutdown();
});

Deno.test('TerminalSession - handles command timeout', async () => {
  const logger = new Logger({ level: 'debug', format: 'text', destination: 'console' });
  const adapter = new NativeAdapter(logger);
  await adapter.initialize();

  const terminal = await adapter.createTerminal();
  const profile = createTestProfile('timeout-test');
  const session = new TerminalSession(terminal, profile, 1000, logger); // 1 second timeout

  await session.initialize();

  // Execute command that takes too long
  await expect(
    async () => await session.executeCommand('sleep 2'),
    Error,
    'timeout',
  );

  await session.cleanup();
  await adapter.destroyTerminal(terminal);
  await adapter.shutdown();
});

/**
 * Cross-platform tests
 */
Deno.test('Terminal - handles cross-platform commands', async () => {
  const logger = new Logger({ level: 'debug', format: 'text', destination: 'console' });
  const adapter = new NativeAdapter(logger);
  await adapter.initialize();

  const terminal = await adapter.createTerminal();
  
  // Platform-agnostic commands
  const outputs = await Promise.all([
    terminal.executeCommand('echo "Test 1"'),
    terminal.executeCommand('echo "Test 2"'),
    terminal.executeCommand('echo "Test 3"'),
  ]);

  expect(outputs[0].trim()).toBe( 'Test 1');
  expect(outputs[1].trim()).toBe( 'Test 2');
  expect(outputs[2].trim()).toBe( 'Test 3');

  await adapter.destroyTerminal(terminal);
  await adapter.shutdown();
});

/**
 * VSCode adapter tests (only run when in VSCode context)
 */
if (typeof (globalThis as any).vscode !== 'undefined') {
  Deno.test('VSCodeAdapter - integrates with VSCode terminals', async () => {
    const logger = new Logger({ level: 'debug', format: 'text', destination: 'console' });
    const adapter = new VSCodeAdapter(logger);

    await adapter.initialize();

    const terminal = await adapter.createTerminal();
    expect(terminal);
    expect(terminal.id);

    const output = await terminal.executeCommand('echo "VSCode test"');
    expect(output.trim()).toBe( 'VSCode test');

    await adapter.destroyTerminal(terminal);
    await adapter.shutdown();
  });
}
