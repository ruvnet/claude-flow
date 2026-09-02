/**
 * V3 CLI Start Command
 * System startup for Claude Flow orchestration
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { confirm, select } from '../prompt.js';
import { callMCPTool, MCPClientError } from '../mcp-client.js';
import * as fs from 'fs';
import * as path from 'path';

// Default configuration
const DEFAULT_PORT = 3000;
const DEFAULT_TOPOLOGY = 'hierarchical-mesh';
const DEFAULT_MAX_AGENTS = 15;

// Check if project is initialized
function isInitialized(cwd: string): boolean {
  const configPath = path.join(cwd, '.claude-flow', 'config.yaml');
  return fs.existsSync(configPath);
}

// Simple YAML parser for config (basic implementation)
function parseSimpleYaml(content: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = content.split('\n');
  const stack: Array<{ indent: number; obj: Record<string, unknown>; key?: string }> = [
    { indent: -1, obj: result }
  ];

  for (const line of lines) {
    // Skip comments and empty lines
    if (line.trim().startsWith('#') || line.trim() === '') continue;

    const match = line.match(/^(\s*)(\w+):\s*(.*)$/);
    if (!match) continue;

    const indent = match[1].length;
    const key = match[2];
    let value: unknown = match[3].trim();

    // Parse value
    if (value === '' || value === undefined) {
      value = {};
    } else if (value === 'true') {
      value = true;
    } else if (value === 'false') {
      value = false;
    } else if (value === 'null') {
      value = null;
    } else if (!isNaN(Number(value as string)) && value !== '') {
      value = Number(value);
    } else if (typeof value === 'string' && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }

    // Find parent based on indentation
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    const parent = stack[stack.length - 1].obj;

    if (typeof value === 'object' && value !== null) {
      parent[key] = value;
      stack.push({ indent, obj: value as Record<string, unknown>, key });
    } else {
      parent[key] = value;
    }
  }

  return result;
}

// Load configuration
function loadConfig(cwd: string): Record<string, unknown> | null {
  const configPath = path.join(cwd, '.claude-flow', 'config.yaml');
  if (!fs.existsSync(configPath)) return null;

  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    return parseSimpleYaml(content);
  } catch {
    return null;
  }
}

// Main start action
const startAction = async (ctx: CommandContext): Promise<CommandResult> => {
  const daemon = ctx.flags.daemon as boolean;
  const port = (ctx.flags.port as number) || DEFAULT_PORT;
  const topology = (ctx.flags.topology as string) || DEFAULT_TOPOLOGY;
  const skipMcp = ctx.flags['skip-mcp'] as boolean;
  const cwd = ctx.cwd;

  // Check initialization
  if (!isInitialized(cwd)) {
    output.printError('Claude Flow is not initialized in this directory');
    output.printInfo('Run "claude-flow init" first to initialize');
    return { success: false, exitCode: 1 };
  }

  // Load configuration
  const config = loadConfig(cwd);
  const swarmConfig = (config?.swarm as Record<string, unknown>) || {};
  const mcpConfig = (config?.mcp as Record<string, unknown>) || {};

  const finalTopology = topology || (swarmConfig.topology as string) || DEFAULT_TOPOLOGY;
  const maxAgents = (swarmConfig.maxAgents as number) || DEFAULT_MAX_AGENTS;
  const autoStartMcp = (mcpConfig.autoStart as boolean) !== false && !skipMcp;
  const mcpPort = port || (mcpConfig.serverPort as number) || DEFAULT_PORT;

  output.writeln();
  output.writeln(output.bold('Starting Claude Flow V3'));
  output.writeln();

  const spinner = output.createSpinner({ text: 'Initializing system...' });

  try {
    // Step 1: Initialize swarm
    spinner.start();
    spinner.setText('Initializing V3 swarm...');

    const swarmResult = await callMCPTool<{
      swarmId: string;
      topology: string;
      initializedAt: string;
      config: Record<string, unknown>;
    }>('swarm/init', {
      topology: finalTopology,
      maxAgents,
      autoScaling: swarmConfig.autoScale !== false,
      v3Mode: true
    });

    spinner.succeed(`Swarm initialized (${finalTopology})`);

    // Step 2: Start MCP server if configured
    let mcpResult: Record<string, unknown> | null = null;
    if (autoStartMcp) {
      spinner.setText('Starting MCP server...');
      spinner.start();

      try {
        mcpResult = await callMCPTool<{
          serverId: string;
          port: number;
          transport: string;
          startedAt: string;
        }>('mcp/start', {
          port: mcpPort,
          transport: mcpConfig.transportType || 'stdio',
          tools: mcpConfig.tools || ['agent', 'swarm', 'memory', 'task']
        });

        spinner.succeed(`MCP server started on port ${mcpPort}`);
      } catch (error) {
        spinner.fail('MCP server failed to start');
        output.printWarning(
          error instanceof MCPClientError
            ? error.message
            : String(error)
        );
        // Continue without MCP
      }
    }

    // Step 3: Run health check
    spinner.setText('Running health checks...');
    spinner.start();

    const healthResult = await callMCPTool<{
      status: 'healthy' | 'degraded' | 'unhealthy';
      checks: Array<{ name: string; status: string; message?: string }>;
    }>('swarm/health', {
      swarmId: swarmResult.swarmId
    });

    if (healthResult.status === 'healthy') {
      spinner.succeed('Health checks passed');
    } else {
      spinner.fail(`Health check: ${healthResult.status}`);
    }

    // Success output
    output.writeln();
    output.printSuccess('Claude Flow V3 is running!');
    output.writeln();

    // Status display
    output.printBox(
      [
        `Swarm ID:  ${swarmResult.swarmId}`,
        `Topology:  ${finalTopology}`,
        `Max Agents: ${maxAgents}`,
        `MCP Server: ${autoStartMcp ? `localhost:${mcpPort}` : 'disabled'}`,
        `Mode:      ${daemon ? 'Daemon' : 'Foreground'}`,
        `Health:    ${healthResult.status}`
      ].join('\n'),
      'System Status'
    );

    output.writeln();
    output.writeln(output.bold('Quick Commands:'));
    output.printList([
      `${output.highlight('claude-flow status')} - View system status`,
      `${output.highlight('claude-flow agent spawn -t coder')} - Spawn an agent`,
      `${output.highlight('claude-flow swarm status')} - View swarm details`,
      `${output.highlight('claude-flow stop')} - Stop the system`
    ]);

    // Daemon mode
    if (daemon) {
      output.writeln();
      output.printInfo('Running in daemon mode. Use "claude-flow stop" to stop.');

      // Store PID for daemon management
      const daemonPidPath = path.join(cwd, '.claude-flow', 'daemon.pid');
      fs.writeFileSync(daemonPidPath, String(process.pid));

      // Detach from parent process for true daemon behavior
      if (process.platform !== 'win32') {
        // Unix-like systems: create new session
        try {
          process.stdin.unref?.();
          process.stdout.unref?.();
          process.stderr.unref?.();
        } catch {
          // Ignore errors if streams can't be unref'd
        }
      }

      // Keep process alive in daemon mode
      const keepAlive = setInterval(() => {
        // Heartbeat - check if we should still be running
        if (!fs.existsSync(daemonPidPath)) {
          clearInterval(keepAlive);
          process.exit(0);
        }
      }, 5000);
      keepAlive.unref(); // Don't prevent process from exiting if no other work
    }

    const result = {
      swarmId: swarmResult.swarmId,
      topology: finalTopology,
      maxAgents,
      mcp: mcpResult ? {
        port: mcpPort,
        transport: mcpConfig.transportType || 'stdio'
      } : null,
      health: healthResult.status,
      daemon,
      startedAt: new Date().toISOString()
    };

    if (ctx.flags.format === 'json') {
      output.printJson(result);
    }

    return { success: true, data: result };
  } catch (error) {
    spinner.fail('Startup failed');
    if (error instanceof MCPClientError) {
      output.printError(`Failed to start: ${error.message}`);
    } else {
      output.printError(`Unexpected error: ${String(error)}`);
    }
    return { success: false, exitCode: 1 };
  }
};

// Stop subcommand
const stopCommand: Command = {
  name: 'stop',
  description: 'Stop the Claude Flow system',
  options: [
    {
      name: 'force',
      short: 'f',
      description: 'Force stop without graceful shutdown',
      type: 'boolean',
      default: false
    },
    {
      name: 'timeout',
      description: 'Shutdown timeout in seconds',
      type: 'number',
      default: 30
    }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const force = ctx.flags.force as boolean;
    const timeout = ctx.flags.timeout as number;

    output.writeln();
    output.writeln(output.bold('Stopping Claude Flow'));
    output.writeln();

    if (!force && ctx.interactive) {
      const confirmed = await confirm({
        message: 'Are you sure you want to stop Claude Flow?',
        default: false
      });

      if (!confirmed) {
        output.printInfo('Operation cancelled');
        return { success: true };
      }
    }

    const spinner = output.createSpinner({ text: 'Stopping system...' });
    spinner.start();

    try {
      // Stop MCP server
      spinner.setText('Stopping MCP server...');
      try {
        await callMCPTool('mcp/stop', { graceful: !force, timeout });
        spinner.succeed('MCP server stopped');
      } catch {
        spinner.fail('MCP server was not running');
      }

      // Stop swarm
      spinner.setText('Stopping swarm...');
      spinner.start();
      try {
        await callMCPTool('swarm/stop', {
          graceful: !force,
          timeout,
          saveState: true
        });
        spinner.succeed('Swarm stopped');
      } catch {
        spinner.fail('Swarm was not running');
      }

      // Clean up daemon PID
      const daemonPidPath = path.join(ctx.cwd, '.claude-flow', 'daemon.pid');
      if (fs.existsSync(daemonPidPath)) {
        fs.unlinkSync(daemonPidPath);
      }

      output.writeln();
      output.printSuccess('Claude Flow stopped successfully');

      return {
        success: true,
        data: { stopped: true, force, stoppedAt: new Date().toISOString() }
      };
    } catch (error) {
      spinner.fail('Stop failed');
      output.printError(`Failed to stop: ${error instanceof Error ? error.message : String(error)}`);
      return { success: false, exitCode: 1 };
    }
  }
};

// Restart subcommand
const restartCommand: Command = {
  name: 'restart',
  description: 'Restart the Claude Flow system',
  options: [
    {
      name: 'force',
      short: 'f',
      description: 'Force restart',
      type: 'boolean',
      default: false
    }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    output.writeln();
    output.writeln(output.bold('Restarting Claude Flow'));
    output.writeln();

    // Stop first
    const stopCtx = { ...ctx, flags: { ...ctx.flags } };
    const stopResult = await stopCommand.action!(stopCtx);

    if (stopResult && !stopResult.success) {
      output.printWarning('Stop failed, attempting to start anyway...');
    }

    // Wait briefly
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Start again
    const startResult = await startAction(ctx);

    return {
      success: startResult.success,
      data: {
        restarted: startResult.success,
        restartedAt: new Date().toISOString()
      }
    };
  }
};

// Quick start subcommand
const quickCommand: Command = {
  name: 'quick',
  aliases: ['q'],
  description: 'Quick start with default settings',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    // Initialize if needed
    if (!isInitialized(ctx.cwd)) {
      output.printInfo('Project not initialized, running init first...');
      output.writeln();

      // Call init with minimal settings
      const { initCommand } = await import('./init.js');
      const initCtx = {
        ...ctx,
        flags: { ...ctx.flags, minimal: true }
      };
      await initCommand.action!(initCtx);
      output.writeln();
    }

    // Start with defaults
    return startAction({
      ...ctx,
      flags: { ...ctx.flags, topology: 'mesh' }
    });
  }
};

// Main start command
export const startCommand: Command = {
  name: 'start',
  description: 'Start the Claude Flow orchestration system',
  subcommands: [stopCommand, restartCommand, quickCommand],
  options: [
    {
      name: 'daemon',
      short: 'd',
      description: 'Run as daemon in background',
      type: 'boolean',
      default: false
    },
    {
      name: 'port',
      short: 'p',
      description: 'MCP server port',
      type: 'number',
      default: DEFAULT_PORT
    },
    {
      name: 'topology',
      short: 't',
      description: 'Swarm topology (hierarchical-mesh, mesh, hierarchical, ring, star)',
      type: 'string',
      choices: ['hierarchical-mesh', 'mesh', 'hierarchical', 'ring', 'star']
    },
    {
      name: 'skip-mcp',
      description: 'Skip starting MCP server',
      type: 'boolean',
      default: false
    }
  ],
  examples: [
    { command: 'claude-flow start', description: 'Start with configuration defaults' },
    { command: 'claude-flow start --daemon', description: 'Start as background daemon' },
    { command: 'claude-flow start --port 3001', description: 'Start MCP on custom port' },
    { command: 'claude-flow start --topology mesh', description: 'Start with mesh topology' },
    { command: 'claude-flow start --skip-mcp', description: 'Start without MCP server' },
    { command: 'claude-flow start quick', description: 'Quick start with defaults' },
    { command: 'claude-flow start stop', description: 'Stop the running system' }
  ],
  action: startAction
};

export default startCommand;
