/**
 * MCP Tool Types for CLI
 *
 * Local type definitions to avoid external imports outside package boundary.
 */

import * as os from 'node:os';
import * as path from 'node:path';

export interface MCPToolInputSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
}

export interface MCPToolResult {
  content: Array<{
    type: 'text' | 'image' | 'resource';
    text?: string;
    data?: string;
    mimeType?: string;
  }>;
  isError?: boolean;
}

function comparablePath(p: string): string {
  // resolve() normalises separators and drops trailing slashes (except on a root).
  const r = path.resolve(p);
  return process.platform === 'win32' ? r.toLowerCase() : r;
}

/**
 * True when `dir` cannot be a project root: a filesystem root ('/', 'C:\')
 * or the user's home directory. Home is checked via os.homedir() as well as
 * $HOME/$USERPROFILE — $HOME is normally unset on Windows, so a $HOME-only
 * comparison never matched there.
 */
export function isNonProjectDir(dir: string): boolean {
  const target = comparablePath(dir);
  if (target === comparablePath(path.parse(target).root)) return true;
  for (const home of [os.homedir(), process.env.HOME, process.env.USERPROFILE]) {
    if (home && comparablePath(home) === target) return true;
  }
  return false;
}

/**
 * Returns the effective project working directory.
 * Prefers CLAUDE_FLOW_CWD (set by the MCP launcher / install script for
 * global and MCP installs where process.cwd() may not be the project) over
 * the real process.cwd(), unless it names a root or home directory.
 */
export function getProjectCwd(): string {
  const envCwd = process.env.CLAUDE_FLOW_CWD;
  if (envCwd && !isNonProjectDir(envCwd)) {
    return envCwd;
  }
  return process.cwd();
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: MCPToolInputSchema;
  category?: string;
  tags?: string[];
  version?: string;
  cacheable?: boolean;
  cacheTTL?: number;
  handler: (input: Record<string, unknown>, context?: Record<string, unknown>) => Promise<MCPToolResult | unknown>;
}
