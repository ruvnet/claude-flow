/**
 * Workspace-scoped permission model for swarm subagents (dream-cycle #2768,
 * ClawArena finding: privilege granting is the #1 orchestration bottleneck,
 * no LLM > 50% workspace-permission precision as team lead).
 *
 * SCOPE (honest): this is a METADATA + AUDIT layer, not a runtime sandbox.
 * Claude Code's Task tool owns the actual subprocess sandbox; ruflo cannot
 * enforce at the syscall boundary. What we CAN do:
 *   1. Publish a per-role capability manifest that Task-tool prompts can
 *      consult ("your workspace-scoped tools are X, Y, Z; you may not use W").
 *   2. Record every grant/check/deny/revoke to an append-only audit trail
 *      so the swarm has a reviewable permission history.
 *
 * That is enough to close the "permission-hygiene" half of the ClawArena
 * finding — the "50% precision as team lead" number is about the LLM's
 * decision QUALITY, which no runtime layer fixes.
 */

import type { PathValidator } from '@claude-flow/security';

/** A single agent role's capability envelope. */
export interface PermissionSet {
  /** Symbolic role name — matches ruflo agent-type names (coder, tester, reviewer, …). */
  role: string;
  /** Tools this role MAY use. Empty array = deny-all-tools. */
  allowedTools: string[];
  /** Tools this role MUST NOT use (evaluated after allow — deny wins). */
  deniedTools: string[];
  /** Glob patterns this role MAY read/write, relative to swarm cwd. */
  allowedPaths: string[];
  /** Glob patterns this role MUST NOT touch (deny wins). */
  deniedPaths: string[];
  /** Exact-host allowlist for outbound network. Empty = deny-all-network. */
  allowedNetworkHosts: string[];
  /** Human-readable note explaining the intent of this envelope. */
  notes?: string;
}

/** Built-in presets, ordered narrow → wide. Each preset ships per-role sets. */
export const PRESETS: Record<'strict' | 'standard' | 'permissive', PermissionSet[]> = {
  /**
   * strict — read-only file access, no network, no bash. Suitable for
   * research / review / planning agents. Denies every destructive surface.
   */
  strict: [
    {
      role: 'researcher',
      allowedTools: ['Read', 'Grep', 'Glob'],
      deniedTools: ['Bash', 'Edit', 'Write', 'NotebookEdit'],
      allowedPaths: ['**/*'],
      deniedPaths: ['**/.env', '**/.env.*', '**/secrets/**', '**/*.key', '**/*.pem'],
      allowedNetworkHosts: [],
      notes: 'Read-only research role; no filesystem writes, no network, no shell.',
    },
    {
      role: 'reviewer',
      allowedTools: ['Read', 'Grep', 'Glob'],
      deniedTools: ['Bash', 'Edit', 'Write', 'NotebookEdit'],
      allowedPaths: ['**/*'],
      deniedPaths: ['**/.env', '**/.env.*', '**/secrets/**', '**/*.key', '**/*.pem'],
      allowedNetworkHosts: [],
      notes: 'Read-only code review; findings emitted via return message, not filesystem writes.',
    },
    {
      role: 'planner',
      allowedTools: ['Read', 'Grep', 'Glob'],
      deniedTools: ['Bash', 'Edit', 'Write', 'NotebookEdit'],
      allowedPaths: ['**/*'],
      deniedPaths: ['**/.env', '**/.env.*', '**/secrets/**', '**/*.key', '**/*.pem'],
      allowedNetworkHosts: [],
      notes: 'Read-only planning; produces plan text, no side effects.',
    },
  ],

  /**
   * standard — the default. Read + edit under cwd, no bash, allowlisted
   * network hosts for common dev workflows (github, npm registry, docs).
   * Suitable for implementation agents doing bounded file changes.
   */
  standard: [
    {
      role: 'coder',
      allowedTools: ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'NotebookEdit'],
      deniedTools: ['Bash'],
      allowedPaths: ['src/**', 'tests/**', '__tests__/**', 'lib/**', 'plugins/**', 'v3/**', 'docs/**', 'CHANGELOG.md', 'package.json'],
      deniedPaths: ['**/.env', '**/.env.*', '**/secrets/**', '**/*.key', '**/*.pem', '**/.git/**', '**/node_modules/**'],
      allowedNetworkHosts: ['api.github.com', 'registry.npmjs.org', 'docs.rs', 'crates.io'],
      notes: 'Bounded code writer; edits under source directories, no shell, allowlist network.',
    },
    {
      role: 'tester',
      allowedTools: ['Read', 'Grep', 'Glob', 'Edit', 'Write'],
      deniedTools: ['Bash', 'NotebookEdit'],
      allowedPaths: ['tests/**', '__tests__/**', '**/*.test.*', '**/*.spec.*'],
      deniedPaths: ['**/.env', '**/.env.*', '**/secrets/**', '**/*.key', '**/*.pem'],
      allowedNetworkHosts: [],
      notes: 'Tests-only writer; scope pinned to test directories and .test/.spec files.',
    },
    {
      role: 'reviewer',
      allowedTools: ['Read', 'Grep', 'Glob'],
      deniedTools: ['Bash', 'Edit', 'Write', 'NotebookEdit'],
      allowedPaths: ['**/*'],
      deniedPaths: ['**/.env', '**/.env.*', '**/secrets/**', '**/*.key', '**/*.pem'],
      allowedNetworkHosts: [],
      notes: 'Read-only reviewer; identical to strict-reviewer.',
    },
  ],

  /**
   * permissive — the pre-#2768 baseline. Full toolset, no path fencing.
   * Kept for compatibility so users can opt back in explicitly. NOT a
   * good default — the entire point of this feature is that the LLM's
   * unaided permission decisions land under 50% precision.
   */
  permissive: [
    {
      role: '*',
      allowedTools: ['*'],
      deniedTools: [],
      allowedPaths: ['**/*'],
      deniedPaths: [],
      allowedNetworkHosts: ['*'],
      notes: 'No restriction. Kept for opt-in compatibility; see #2768 for why this is not the default.',
    },
  ],
};

export type PresetName = keyof typeof PRESETS;

/**
 * Resolve a preset name to its per-role sets. Throws on unknown preset —
 * fail loud so a typo doesn't silently degrade to permissive.
 */
export function resolvePreset(name: string): PermissionSet[] {
  if (!(name in PRESETS)) {
    const valid = Object.keys(PRESETS).join(', ');
    throw new Error(`Unknown permissions preset: ${name}. Valid presets: ${valid}`);
  }
  return PRESETS[name as PresetName];
}

/**
 * Sanity-check a permission set: role name shape, no null entries.
 * Path validation is deferred to the enforcement side (PathValidator)
 * so this module has no @claude-flow/security runtime dep beyond a
 * type-only import.
 */
export function validatePermissionSet(set: PermissionSet, _validator?: PathValidator): string[] {
  const errors: string[] = [];
  if (!set.role || typeof set.role !== 'string') errors.push('role must be a non-empty string');
  const arrays: [keyof PermissionSet, unknown][] = [
    ['allowedTools', set.allowedTools],
    ['deniedTools', set.deniedTools],
    ['allowedPaths', set.allowedPaths],
    ['deniedPaths', set.deniedPaths],
    ['allowedNetworkHosts', set.allowedNetworkHosts],
  ];
  for (const [key, val] of arrays) {
    if (!Array.isArray(val)) errors.push(`${String(key)} must be an array`);
    else if ((val as unknown[]).some((v) => typeof v !== 'string')) errors.push(`${String(key)} must contain only strings`);
  }
  return errors;
}
