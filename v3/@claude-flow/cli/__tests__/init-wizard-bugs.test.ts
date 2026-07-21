/**
 * Init wizard regression tests for #2206, #2207, #2208.
 *
 * #2206 — mcp-generator must register the server under the 'claude-flow' key
 *          (not 'ruflo') so all plugins resolve as mcp__claude-flow__*.
 * #2207 — detectExistingRufloMCP must accept both 'claude-flow' and 'ruflo' keys;
 *          a bare .claude/settings.json must NOT be a false positive.
 * #2208 — writeClaudeMd (--force) must back up an existing CLAUDE.md to
 *          CLAUDE.md.pre-ruflo before overwriting it.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync, rmSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

// ─── #2206: mcp-generator server key ─────────────────────────────────────────

import { generateMCPConfig, generateMCPCommands } from '../src/init/mcp-generator.js';
import type { InitOptions } from '../src/init/types.js';
import { DEFAULT_INIT_OPTIONS } from '../src/init/types.js';

function makeMCPOptions(overrides: Partial<InitOptions> = {}): InitOptions {
  return {
    ...DEFAULT_INIT_OPTIONS,
    mcp: {
      claudeFlow: true,
      ruvSwarm: false,
      flowNexus: false,
      autoStart: false,
      port: 3000,
    },
    runtime: {
      topology: 'hierarchical',
      maxAgents: 8,
      memoryBackend: 'hybrid',
      enableHNSW: true,
      enableNeural: true,
    },
    ...overrides,
  };
}

describe('#2206 — mcp-generator server key', () => {
  it('registers the ruflo MCP server under the claude-flow key', () => {
    const config = generateMCPConfig(makeMCPOptions()) as { mcpServers: Record<string, unknown> };
    expect(config.mcpServers).toHaveProperty('claude-flow');
  });

  it('does NOT register the server under the bare ruflo key', () => {
    const config = generateMCPConfig(makeMCPOptions()) as { mcpServers: Record<string, unknown> };
    expect(config.mcpServers).not.toHaveProperty('ruflo');
  });

  it('still invokes ruflo@latest mcp start as the command args', () => {
    const config = generateMCPConfig(makeMCPOptions()) as { mcpServers: Record<string, unknown> };
    const entry = config.mcpServers['claude-flow'] as { command: string; args: string[] };
    expect(entry.args).toContain('ruflo@latest');
    expect(entry.args).toContain('mcp');
    expect(entry.args).toContain('start');
  });

  it('generateMCPCommands uses claude-flow as the registration name', () => {
    const cmds = generateMCPCommands(makeMCPOptions());
    expect(cmds.length).toBeGreaterThan(0);
    // Every command that adds the main server must use 'claude-flow', not 'ruflo'
    const mainCmd = cmds.find(c => c.includes('ruflo@latest'));
    expect(mainCmd).toBeDefined();
    expect(mainCmd).toMatch(/claude mcp add claude-flow/);
    expect(mainCmd).not.toMatch(/claude mcp add ruflo\b/);
  });
});

// ─── #2207: detectExistingRufloMCP — both keys + no false positive ───────────
// We test the function indirectly via its effect on writeMCPConfig behaviour.
// Direct export is not available, so we exercise it through executeInit which
// calls writeMCPConfig → detectExistingRufloMCP.

// Mock heavy I/O that executeInit performs (skills/agents/helpers copy) so the
// test only exercises the MCP-detection branch we care about.
vi.mock('node:child_process', () => ({ execSync: vi.fn() }));

describe('#2207 — init detector accepts both server keys', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), 'wizard-2207-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('detects a prior install registered under the new claude-flow key', async () => {
    // Write a parent .mcp.json with the 'claude-flow' key (post-#2206 install)
    const parentDir = mkdtempSync(path.join(tmpdir(), 'wizard-2207-parent-'));
    try {
      writeFileSync(
        path.join(parentDir, '.mcp.json'),
        JSON.stringify({ mcpServers: { 'claude-flow': { command: 'npx', args: ['-y', 'ruflo@latest', 'mcp', 'start'] } } }),
      );
      // Target is a sub-directory so the parent .mcp.json is in the walk path
      const subDir = path.join(parentDir, 'sub');
      mkdirSync(subDir, { recursive: true });

      // Import executeInit dynamically so the tmp HOME is picked up
      const { executeInit } = await import('../src/init/executor.js');
      const opts: InitOptions = {
        ...makeMCPOptions(),
        targetDir: subDir,
        force: false,
        interactive: false,
        components: {
          settings: false,
          skills: false,
          commands: false,
          agents: false,
          helpers: false,
          statusline: false,
          mcp: true,
          runtime: false,
          claudeMd: false,
        },
        skipGlobalClaudeMd: true,
      };
      const result = await executeInit(opts);
      // Because a 'claude-flow' key was found in the parent .mcp.json, init should
      // skip writing a new .mcp.json (duplicate detection).
      const skipMsg = result.skipped.find(s => s.includes('.mcp.json'));
      expect(skipMsg).toBeDefined();
    } finally {
      rmSync(parentDir, { recursive: true, force: true });
    }
  });

  it('detects a prior install registered under the legacy ruflo key', async () => {
    const parentDir = mkdtempSync(path.join(tmpdir(), 'wizard-2207-legacy-'));
    try {
      writeFileSync(
        path.join(parentDir, '.mcp.json'),
        JSON.stringify({ mcpServers: { ruflo: { command: 'npx', args: ['-y', 'ruflo@latest', 'mcp', 'start'] } } }),
      );
      const subDir = path.join(parentDir, 'sub');
      mkdirSync(subDir, { recursive: true });

      const { executeInit } = await import('../src/init/executor.js');
      const opts: InitOptions = {
        ...makeMCPOptions(),
        targetDir: subDir,
        force: false,
        interactive: false,
        components: {
          settings: false,
          skills: false,
          commands: false,
          agents: false,
          helpers: false,
          statusline: false,
          mcp: true,
          runtime: false,
          claudeMd: false,
        },
        skipGlobalClaudeMd: true,
      };
      const result = await executeInit(opts);
      const skipMsg = result.skipped.find(s => s.includes('.mcp.json'));
      expect(skipMsg).toBeDefined();
    } finally {
      rmSync(parentDir, { recursive: true, force: true });
    }
  });

  it('does NOT false-positive on a bare .claude/settings.json with no MCP registration', async () => {
    // Simulate Claude Code's own project settings.json (no MCP keys at all)
    const projectDir = mkdtempSync(path.join(tmpdir(), 'wizard-2207-fp-'));
    try {
      mkdirSync(path.join(projectDir, '.claude'), { recursive: true });
      writeFileSync(
        path.join(projectDir, '.claude', 'settings.json'),
        JSON.stringify({ env: {}, hooks: {} }),
      );

      const { executeInit } = await import('../src/init/executor.js');
      const opts: InitOptions = {
        ...makeMCPOptions(),
        targetDir: projectDir,
        force: false,
        interactive: false,
        components: {
          settings: false,
          skills: false,
          commands: false,
          agents: false,
          helpers: false,
          statusline: false,
          mcp: true,
          runtime: false,
          claudeMd: false,
        },
        skipGlobalClaudeMd: true,
      };
      // Override HOME so we don't accidentally match the real user's ~/.claude.json
      const origHome = process.env.HOME;
      process.env.HOME = projectDir;
      try {
        const result = await executeInit(opts);
        // No pre-existing ruflo/claude-flow key → init must NOT skip .mcp.json
        const mcpSkipped = result.skipped.find(s => s.startsWith('.mcp.json') && !s.includes('existing'));
        expect(mcpSkipped).toBeUndefined();
      } finally {
        process.env.HOME = origHome;
      }
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});

// ─── #2208 — CLAUDE.md backup on --force ─────────────────────────────────────

describe('#2208 — CLAUDE.md backup before overwrite', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), 'wizard-2208-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('backs up existing CLAUDE.md to CLAUDE.md.pre-ruflo when --force is used', async () => {
    const sentinel = '# Sentinel Project Content\nDo not lose this.\n';
    writeFileSync(path.join(tmp, 'CLAUDE.md'), sentinel, 'utf-8');

    const { executeInit } = await import('../src/init/executor.js');
    const opts: InitOptions = {
      ...makeMCPOptions(),
      targetDir: tmp,
      force: true,
      interactive: false,
      components: {
        settings: false,
        skills: false,
        commands: false,
        agents: false,
        helpers: false,
        statusline: false,
        mcp: false,
        runtime: false,
        claudeMd: true,
      },
      skipGlobalClaudeMd: true,
    };

    await executeInit(opts);

    const backupPath = path.join(tmp, 'CLAUDE.md.pre-ruflo');
    expect(existsSync(backupPath)).toBe(true);
    expect(readFileSync(backupPath, 'utf-8')).toBe(sentinel);
  });

  it('uses a timestamped backup name when CLAUDE.md.pre-ruflo already exists', async () => {
    writeFileSync(path.join(tmp, 'CLAUDE.md'), '# First content\n', 'utf-8');
    writeFileSync(path.join(tmp, 'CLAUDE.md.pre-ruflo'), '# Previous backup\n', 'utf-8');

    const { executeInit } = await import('../src/init/executor.js');
    const opts: InitOptions = {
      ...makeMCPOptions(),
      targetDir: tmp,
      force: true,
      interactive: false,
      components: {
        settings: false,
        skills: false,
        commands: false,
        agents: false,
        helpers: false,
        statusline: false,
        mcp: false,
        runtime: false,
        claudeMd: true,
      },
      skipGlobalClaudeMd: true,
    };

    await executeInit(opts);

    // The original .pre-ruflo must still have its old content
    expect(readFileSync(path.join(tmp, 'CLAUDE.md.pre-ruflo'), 'utf-8')).toBe('# Previous backup\n');
    // A timestamped backup must have been created
    const entries = readdirSync(tmp);
    const timestamped = entries.find(e => e.startsWith('CLAUDE.md.pre-ruflo.') && e !== 'CLAUDE.md.pre-ruflo');
    expect(timestamped).toBeDefined();
  });

  it('does NOT create a backup when no pre-existing CLAUDE.md exists', async () => {
    const { executeInit } = await import('../src/init/executor.js');
    const opts: InitOptions = {
      ...makeMCPOptions(),
      targetDir: tmp,
      force: true,
      interactive: false,
      components: {
        settings: false,
        skills: false,
        commands: false,
        agents: false,
        helpers: false,
        statusline: false,
        mcp: false,
        runtime: false,
        claudeMd: true,
      },
      skipGlobalClaudeMd: true,
    };

    await executeInit(opts);

    expect(existsSync(path.join(tmp, 'CLAUDE.md.pre-ruflo'))).toBe(false);
    expect(existsSync(path.join(tmp, 'CLAUDE.md'))).toBe(true);
  });

  it('skips CLAUDE.md entirely when it exists and --force is not set', async () => {
    const sentinel = '# My project\n';
    writeFileSync(path.join(tmp, 'CLAUDE.md'), sentinel, 'utf-8');

    const { executeInit } = await import('../src/init/executor.js');
    const opts: InitOptions = {
      ...makeMCPOptions(),
      targetDir: tmp,
      force: false,
      interactive: false,
      components: {
        settings: false,
        skills: false,
        commands: false,
        agents: false,
        helpers: false,
        statusline: false,
        mcp: false,
        runtime: false,
        claudeMd: true,
      },
      skipGlobalClaudeMd: true,
    };

    const result = await executeInit(opts);

    // Must skip, not overwrite
    expect(result.skipped).toContain('CLAUDE.md');
    // Original must be untouched
    expect(readFileSync(path.join(tmp, 'CLAUDE.md'), 'utf-8')).toBe(sentinel);
    expect(existsSync(path.join(tmp, 'CLAUDE.md.pre-ruflo'))).toBe(false);
  });
});

describe('persistent memory ON BY DEFAULT — .swarm/memory.db created during init', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), 'wizard-memdefault-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('eagerly creates .swarm/memory.db when runtime.memoryBackend is persistent (hybrid)', async () => {
    // DEFAULT_INIT_OPTIONS already declares memoryBackend: 'hybrid' — this
    // pins that the DB file itself gets created at init time, not left for
    // a separate `memory init --force` the user has to remember to run.
    const { executeInit } = await import('../src/init/executor.js');
    const opts: InitOptions = {
      ...makeMCPOptions(),
      targetDir: tmp,
      force: true,
      interactive: false,
      components: {
        settings: false,
        skills: false,
        commands: false,
        agents: false,
        helpers: true,
        statusline: false,
        mcp: false,
        runtime: false,
        claudeMd: false,
      },
      skipGlobalClaudeMd: true,
    };

    const result = await executeInit(opts);

    expect(existsSync(path.join(tmp, '.swarm', 'memory.db'))).toBe(true);
    expect(result.created.files).toContain('.swarm/memory.db');
  }, 20000);

  it('does NOT create .swarm/memory.db when runtime.memoryBackend is "memory" (non-persistent opt-out)', async () => {
    // MINIMAL_INIT_OPTIONS uses memoryBackend: 'memory' deliberately — this
    // pins that the opt-out is respected, not overridden by the new eager path.
    const { executeInit } = await import('../src/init/executor.js');
    const opts: InitOptions = {
      ...makeMCPOptions(),
      targetDir: tmp,
      force: true,
      interactive: false,
      components: {
        settings: false,
        skills: false,
        commands: false,
        agents: false,
        helpers: true,
        statusline: false,
        mcp: false,
        runtime: false,
        claudeMd: false,
      },
      runtime: {
        topology: 'mesh',
        maxAgents: 5,
        memoryBackend: 'memory',
        enableHNSW: false,
        enableNeural: false,
      },
      skipGlobalClaudeMd: true,
    };

    await executeInit(opts);

    expect(existsSync(path.join(tmp, '.swarm', 'memory.db'))).toBe(false);
  }, 20000);
});
