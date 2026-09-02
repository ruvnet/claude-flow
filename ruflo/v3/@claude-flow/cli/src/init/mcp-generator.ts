/**
 * MCP Configuration Generator
 * Creates .mcp.json for Claude Code MCP server integration
 * Handles cross-platform compatibility (Windows requires cmd /c wrapper)
 */

import type { InitOptions, MCPConfig } from './types.js';

/**
 * Check if running on Windows
 */
function isWindows(): boolean {
  return process.platform === 'win32';
}

/**
 * Generate platform-specific MCP server entry
 * Windows requires 'cmd /c' wrapper to execute npx commands
 */
function createMCPServerEntry(
  npxArgs: string[],
  env: Record<string, string>,
  additionalProps: Record<string, unknown> = {}
): object {
  if (isWindows()) {
    return {
      command: 'cmd',
      args: ['/c', 'npx', ...npxArgs],
      env,
      ...additionalProps,
    };
  }

  return {
    command: 'npx',
    args: npxArgs,
    env,
    ...additionalProps,
  };
}

/**
 * Generate MCP configuration
 */
export function generateMCPConfig(options: InitOptions): object {
  const config = options.mcp;
  const mcpServers: Record<string, object> = {};

  // Claude Flow MCP server (core)
  if (config.claudeFlow) {
    mcpServers['claude-flow'] = createMCPServerEntry(
      ['@claude-flow/cli@latest', 'mcp', 'start'],
      {
        CLAUDE_FLOW_MODE: 'v3',
        CLAUDE_FLOW_HOOKS_ENABLED: 'true',
        CLAUDE_FLOW_TOPOLOGY: options.runtime.topology,
        CLAUDE_FLOW_MAX_AGENTS: String(options.runtime.maxAgents),
        CLAUDE_FLOW_MEMORY_BACKEND: options.runtime.memoryBackend,
      },
      { autoStart: config.autoStart }
    );
  }

  // Ruv-Swarm MCP server (enhanced coordination)
  if (config.ruvSwarm) {
    mcpServers['ruv-swarm'] = createMCPServerEntry(
      ['ruv-swarm', 'mcp', 'start'],
      {},
      { optional: true }
    );
  }

  // Flow Nexus MCP server (cloud features)
  if (config.flowNexus) {
    mcpServers['flow-nexus'] = createMCPServerEntry(
      ['flow-nexus@latest', 'mcp', 'start'],
      {},
      { optional: true, requiresAuth: true }
    );
  }

  return { mcpServers };
}

/**
 * Generate .mcp.json as formatted string
 */
export function generateMCPJson(options: InitOptions): string {
  const config = generateMCPConfig(options);
  return JSON.stringify(config, null, 2);
}

/**
 * Generate MCP server add commands for manual setup
 * Windows uses 'cmd /c' wrapper for npx execution
 */
export function generateMCPCommands(options: InitOptions): string[] {
  const commands: string[] = [];
  const config = options.mcp;

  // Windows requires different command format
  const prefix = isWindows() ? 'cmd /c ' : '';

  if (config.claudeFlow) {
    commands.push(`claude mcp add claude-flow -- ${prefix}npx @claude-flow/cli@latest mcp start`);
  }

  if (config.ruvSwarm) {
    commands.push(`claude mcp add ruv-swarm -- ${prefix}npx ruv-swarm mcp start`);
  }

  if (config.flowNexus) {
    commands.push(`claude mcp add flow-nexus -- ${prefix}npx flow-nexus@latest mcp start`);
  }

  return commands;
}

/**
 * Get platform-specific setup instructions
 */
export function getPlatformInstructions(): { platform: string; note: string } {
  if (isWindows()) {
    return {
      platform: 'Windows',
      note: 'MCP configuration uses cmd /c wrapper for npx compatibility.',
    };
  }
  return {
    platform: process.platform === 'darwin' ? 'macOS' : 'Linux',
    note: 'MCP configuration uses native npx execution.',
  };
}
