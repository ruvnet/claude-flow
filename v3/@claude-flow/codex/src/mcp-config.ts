/**
 * Shared Ruflo MCP configuration for Codex generators, migrations, and init.
 */

import type { McpServerConfig } from './types.js';

export const RUFLO_MCP_SERVER_NAME = 'ruflo';
export const RUFLO_MCP_PACKAGE = 'ruflo@latest';
export const RUFLO_MCP_STARTUP_TIMEOUT_SEC = 120;

export interface CodexMcpRegistration {
  name?: unknown;
  transport?: {
    type?: unknown;
    command?: unknown;
    args?: unknown;
  } | null;
  startup_timeout_sec?: unknown;
}

export interface CodexCliInvocation {
  command: string;
  prefixArgs: string[];
}

export function getCodexCliInvocation(
  lookupOutput: string,
  platform: NodeJS.Platform = process.platform,
  commandShell = process.env.ComSpec || 'cmd.exe',
): CodexCliInvocation {
  const matches = lookupOutput.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
  if (matches.length === 0) {
    throw new Error('Codex CLI path not found');
  }

  if (platform !== 'win32') {
    return { command: matches[0]!, prefixArgs: [] };
  }

  const executable = matches.find(match => /\.exe$/i.test(match));
  if (executable) {
    return { command: executable, prefixArgs: [] };
  }

  // npm installs expose extensionless and .cmd shims, neither of which can
  // be launched reliably with execFileSync on Windows. Resolve the shim via
  // cmd.exe without interpolating any user-controlled arguments.
  return { command: commandShell, prefixArgs: ['/d', '/s', '/c', 'codex'] };
}

export function getRufloMcpServerConfig(
  platform: NodeJS.Platform = process.platform,
  toolTimeout = 120,
): McpServerConfig {
  const args = ['-y', RUFLO_MCP_PACKAGE, 'mcp', 'start'];

  return platform === 'win32'
    ? {
        name: RUFLO_MCP_SERVER_NAME,
        command: 'cmd',
        args: ['/c', 'npx', ...args],
        enabled: true,
        startupTimeout: RUFLO_MCP_STARTUP_TIMEOUT_SEC,
        toolTimeout,
      }
    : {
        name: RUFLO_MCP_SERVER_NAME,
        command: 'npx',
        args,
        enabled: true,
        startupTimeout: RUFLO_MCP_STARTUP_TIMEOUT_SEC,
        toolTimeout,
      };
}

export function renderMcpServerToml(server: McpServerConfig): string[] {
  const lines = [
    `[mcp_servers.${server.name}]`,
    `command = ${tomlString(server.command)}`,
  ];

  if (server.args && server.args.length > 0) {
    lines.push(`args = [${server.args.map(tomlString).join(', ')}]`);
  }

  lines.push(`enabled = ${server.enabled ?? true}`);

  if (server.startupTimeout !== undefined) {
    lines.push(`startup_timeout_sec = ${server.startupTimeout}`);
  }

  if (server.toolTimeout !== undefined) {
    lines.push(`tool_timeout_sec = ${server.toolTimeout}`);
  }

  if (server.env && Object.keys(server.env).length > 0) {
    lines.push('', `[mcp_servers.${server.name}.env]`);
    for (const [key, value] of Object.entries(server.env)) {
      lines.push(`${key} = ${tomlString(value)}`);
    }
  }

  return lines;
}

export function getRufloMcpAddCommand(platform: NodeJS.Platform = process.platform): string {
  const server = getRufloMcpServerConfig(platform);
  return ['codex', 'mcp', 'add', RUFLO_MCP_SERVER_NAME, '--', server.command, ...(server.args ?? [])].join(' ');
}

export function hasExpectedRufloMcpTransport(
  registration: CodexMcpRegistration,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const expected = getRufloMcpServerConfig(platform);
  const transport = registration.transport;
  if (!transport || transport.type !== 'stdio' || transport.command !== expected.command) {
    return false;
  }

  return Array.isArray(transport.args)
    && transport.args.length === expected.args?.length
    && transport.args.every((arg, index) => arg === expected.args?.[index]);
}

export function hasExpectedRufloMcpTimeout(registration: CodexMcpRegistration): boolean {
  return typeof registration.startup_timeout_sec === 'number'
    && registration.startup_timeout_sec >= RUFLO_MCP_STARTUP_TIMEOUT_SEC;
}

export function upsertMcpServerStartupTimeout(
  config: string,
  serverName = RUFLO_MCP_SERVER_NAME,
  timeoutSec = RUFLO_MCP_STARTUP_TIMEOUT_SEC,
): string {
  const eol = config.includes('\r\n') ? '\r\n' : '\n';
  const lines = config.split(/\r?\n/);
  const header = `[mcp_servers.${serverName}]`;
  const start = lines.findIndex(line => line.trim() === header);

  if (start < 0) {
    throw new Error(`${header} not found in Codex config`);
  }

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (lines[index]?.trim().startsWith('[')) {
      end = index;
      break;
    }
  }

  const timeoutPattern = /^\s*startup_timeout_sec\s*=/;
  for (let index = start + 1; index < end; index += 1) {
    const line = lines[index] ?? '';
    if (timeoutPattern.test(line)) {
      const parsed = line.match(/^(\s*startup_timeout_sec\s*=\s*)([0-9][0-9_]*)(.*)$/);
      const currentValue = parsed ? Number(parsed[2]!.replace(/_/g, '')) : Number.NaN;
      if (Number.isFinite(currentValue) && currentValue >= timeoutSec) {
        return config;
      }
      lines[index] = parsed
        ? `${parsed[1]}${timeoutSec}${parsed[3]}`
        : `startup_timeout_sec = ${timeoutSec}`;
      return lines.join(eol);
    }
  }

  lines.splice(end, 0, `startup_timeout_sec = ${timeoutSec}`);
  return lines.join(eol);
}

function tomlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
