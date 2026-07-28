/**
 * MCP Tool Types for CLI
 *
 * Local type definitions to avoid external imports outside package boundary.
 */

import { homedir } from 'node:os';

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

// ── Project-directory resolution (Windows MCP safety, issue #1577) ──
//
// AI agents that launch MCP servers as child processes on Windows do not
// always inherit a usable cwd. When they don't, Node resolves process.cwd()
// to C:\Windows\System32 — a read-only system directory — and every storage
// path that joins against it fails with EPERM. Unix has an analogous case
// where global/npx installs leave cwd at '/'. The resolver below guards
// against both, is agent-agnostic (no hardcoded dependency on any specific
// AI platform), and is memoized so repeated calls on the hot path are cheap.

const SYSTEM_DIR_PREFIXES = [
  'c:\\windows',
  'c:/windows',
  '/system32',     // rarely seen, but cheap to check
];

/**
 * Treat C:\Windows\* and '/' as system dirs that must not be used as
 * project roots. Case-insensitive to match Windows path semantics.
 */
function isSystemDir(dir: string | undefined | null): boolean {
  if (!dir) return true;
  if (dir === '/' || dir === '\\') return true;
  const lower = dir.toLowerCase();
  return SYSTEM_DIR_PREFIXES.some((p) => lower.startsWith(p));
}

// Env var chain checked in order. Agent-agnostic: the first three cover
// common conventions used by Claude Code, Codex, and generic npm tooling;
// CLAUDE_FLOW_CWD is preserved for back-compat with older installs.
const PROJECT_DIR_ENV_VARS = [
  'CLAUDE_FLOW_PROJECT_DIR',
  'CLAUDE_PROJECT_DIR',
  'INIT_CWD',
  'CLAUDE_FLOW_CWD',
] as const;

let _cachedProjectCwd: string | undefined;

/**
 * Returns the effective project working directory for storage-path
 * resolution. Falls back through an agent-agnostic env var chain,
 * then process.cwd(), then $HOME — skipping any candidate that points
 * at a system directory.
 *
 * Use this ONLY for storage paths (state files, databases, caches).
 * For runtime concerns where the real shell cwd matters (child process
 * spawns, status reporting), call process.cwd() directly.
 */
export function getProjectCwd(): string {
  if (_cachedProjectCwd !== undefined) return _cachedProjectCwd;

  // 1. Agent-agnostic env var chain
  for (const key of PROJECT_DIR_ENV_VARS) {
    const val = process.env[key];
    if (val && !isSystemDir(val)) {
      _cachedProjectCwd = val;
      return _cachedProjectCwd;
    }
  }

  // 2. Real cwd — works on macOS/Linux and most non-MCP Windows contexts
  let cwd: string | undefined;
  try {
    cwd = process.cwd();
  } catch {
    cwd = undefined;
  }
  if (cwd && !isSystemDir(cwd)) {
    _cachedProjectCwd = cwd;
    return _cachedProjectCwd;
  }

  // 3. Last resort: user home. Better than writing into System32.
  _cachedProjectCwd = homedir();
  return _cachedProjectCwd;
}

/**
 * Reset the memoized project cwd. Intended for tests; not for app code.
 * @internal
 */
export function _resetProjectCwdCache(): void {
  _cachedProjectCwd = undefined;
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
