/**
 * @claude-flow/codex - Dual-Mode Tests
 *
 * Covers parseWorkerSpecs (W2), CollaborationTemplates, the `dual`
 * command wiring, and DualModeOrchestrator dependency leveling.
 * No real workers are spawned — only pure logic is exercised.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseWorkerSpecs,
  createDualModeCommand,
  loadWorkerConfig,
} from '../src/dual-mode/cli.js';
import {
  DualModeOrchestrator,
  CollaborationTemplates,
  loadSwarmAutomationConfig,
} from '../src/dual-mode/index.js';
import type { WorkerConfig } from '../src/dual-mode/index.js';

describe('parseWorkerSpecs', () => {
  it('parses a single spec into a WorkerConfig', () => {
    const [w] = parseWorkerSpecs(['claude:architect:Design the API'], false);
    expect(w).toMatchObject({ id: 'architect', platform: 'claude', role: 'architect', prompt: 'Design the API' });
    expect(w.dependsOn).toBeUndefined();
  });

  it('chains workers sequentially by default', () => {
    const ws = parseWorkerSpecs(['claude:architect:Design', 'codex:coder:Build', 'codex:tester:Test'], false);
    expect(ws.map(w => w.id)).toEqual(['architect', 'coder', 'tester']);
    expect(ws.map(w => w.platform)).toEqual(['claude', 'codex', 'codex']);
    expect(ws[0].dependsOn).toBeUndefined();
    expect(ws[1].dependsOn).toEqual(['architect']);
    expect(ws[2].dependsOn).toEqual(['coder']);
  });

  it('runs workers in parallel when parallel=true (no dependsOn)', () => {
    const ws = parseWorkerSpecs(['claude:a:x', 'codex:b:y'], true);
    expect(ws.every(w => w.dependsOn === undefined)).toBe(true);
  });

  it('keeps colons inside the prompt (splits on the first two only)', () => {
    const [w] = parseWorkerSpecs(['codex:coder:Fix bug: handle null in foo:bar'], false);
    expect(w.prompt).toBe('Fix bug: handle null in foo:bar');
    expect(w.role).toBe('coder');
  });

  it('deduplicates ids for repeated roles', () => {
    const ws = parseWorkerSpecs(['codex:coder:a', 'codex:coder:b', 'codex:coder:c'], true);
    expect(ws.map(w => w.id)).toEqual(['coder', 'coder-2', 'coder-3']);
  });

  it('trims whitespace around platform/role/prompt', () => {
    const [w] = parseWorkerSpecs([' claude : architect : Design it '], false);
    expect(w).toMatchObject({ platform: 'claude', role: 'architect', prompt: 'Design it' });
  });

  it('throws on a spec with fewer than two colons', () => {
    expect(() => parseWorkerSpecs(['claude:architect'], false)).toThrow(/Expected/);
    expect(() => parseWorkerSpecs(['justaprompt'], false)).toThrow(/Expected/);
  });

  it('throws on an empty prompt', () => {
    expect(() => parseWorkerSpecs(['claude:architect:   '], false)).toThrow(/Missing prompt/);
  });

  it('throws on an unknown platform', () => {
    expect(() => parseWorkerSpecs(['gemini:coder:do it'], false)).toThrow(/claude.*codex/);
  });
});

describe('loadWorkerConfig', () => {
  it('loads a relative JSON config without import assertions (#2766)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ruflo-dual-config-'));
    writeFileSync(join(root, 'workers.json'), JSON.stringify({
      taskContext: 'JSON collaboration',
      workers: [{ id: 'reader', platform: 'codex', role: 'reader', prompt: 'inspect' }],
    }));
    await expect(loadWorkerConfig('workers.json', root)).resolves.toMatchObject({
      taskContext: 'JSON collaboration',
      workers: [{ id: 'reader', platform: 'codex' }],
    });
  });

  it('rejects configs without a workers array', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ruflo-dual-config-invalid-'));
    writeFileSync(join(root, 'workers.json'), '{}');
    await expect(loadWorkerConfig('workers.json', root)).rejects.toThrow('workers array');
  });
});

describe('CollaborationTemplates', () => {
  it('featureDevelopment: architect -> coder -> tester -> reviewer', () => {
    const ws = CollaborationTemplates.featureDevelopment('Add OAuth');
    expect(ws.map(w => w.id)).toEqual(['architect', 'coder', 'tester', 'reviewer']);
    expect(ws.find(w => w.id === 'architect')!.platform).toBe('claude');
    expect(ws.find(w => w.id === 'coder')!.platform).toBe('codex');
    expect(ws.find(w => w.id === 'coder')!.dependsOn).toEqual(['architect']);
    expect(ws.find(w => w.id === 'tester')!.dependsOn).toEqual(['coder']);
    expect(ws.find(w => w.id === 'reviewer')!.dependsOn).toEqual(['coder', 'tester']);
    expect(ws.some(w => w.prompt.includes('Add OAuth'))).toBe(true);
  });

  it('securityAudit: scanner -> analyzer -> fixer', () => {
    const ws = CollaborationTemplates.securityAudit('./src');
    expect(ws.map(w => w.id)).toEqual(['scanner', 'analyzer', 'fixer']);
    expect(ws.find(w => w.id === 'analyzer')!.dependsOn).toEqual(['scanner']);
    expect(ws.find(w => w.id === 'fixer')!.dependsOn).toEqual(['analyzer']);
  });

  it('refactoring: analyzer -> planner -> refactorer -> validator', () => {
    const ws = CollaborationTemplates.refactoring('./src/legacy');
    expect(ws.map(w => w.id)).toEqual(['analyzer', 'planner', 'refactorer', 'validator']);
    expect(ws.find(w => w.id === 'planner')!.dependsOn).toEqual(['analyzer']);
    expect(ws.find(w => w.id === 'validator')!.dependsOn).toEqual(['refactorer']);
  });
});

describe('dual command wiring', () => {
  it('exposes run / templates / status subcommands', () => {
    const cmd = createDualModeCommand();
    expect(cmd.name()).toBe('dual');
    const subs = cmd.commands.map(c => c.name()).sort();
    expect(subs).toEqual(['run', 'status', 'templates']);
  });

  it('`run` accepts a positional [template] and a repeatable --worker', () => {
    const run = createDualModeCommand().commands.find(c => c.name() === 'run')!;
    const optionNames = run.options.map(o => o.long);
    expect(optionNames).toContain('--worker');
    expect(optionNames).toContain('--parallel-workers');
    expect(optionNames).toContain('--template');
    // a positional argument is registered for [template]
    expect((run as unknown as { _args: unknown[] })._args.length).toBeGreaterThan(0);
  });
});

describe('DualModeOrchestrator', () => {
  it('loads enforceable swarm automation ceilings from config.toml', () => {
    const root = mkdtempSync(join(tmpdir(), 'ruflo-codex-config-'));
    mkdirSync(join(root, '.agents'));
    writeFileSync(join(root, '.agents', 'config.toml'), [
      '[swarm.automation]',
      'enabled = true',
      'max_concurrent = 3',
      'max_writers = 1',
      'worktree_isolation = true',
      'agent_timeout_seconds = 60',
      'max_output_bytes = 4096',
    ].join('\n'));
    expect(loadSwarmAutomationConfig(root)).toEqual({
      enabled: true,
      maxConcurrent: 3,
      maxWriters: 1,
      worktreeIsolation: true,
      agentTimeoutSeconds: 60,
      maxOutputBytes: 4096,
      dependencyFailure: 'cancel',
    });
  });

  it('loads existing Codex project configuration from .codex', () => {
    const root = mkdtempSync(join(tmpdir(), 'ruflo-codex-config-'));
    mkdirSync(join(root, '.codex'));
    writeFileSync(join(root, '.codex', 'config.toml'), [
      '[swarm.automation]',
      'enabled = true',
      'max_concurrent = 2',
    ].join('\n'));
    expect(loadSwarmAutomationConfig(root)).toMatchObject({
      enabled: true,
      maxConcurrent: 2,
    });
  });

  it('rejects invalid concurrency and output ceilings', () => {
    expect(() => new DualModeOrchestrator({
      projectPath: '/tmp',
      maxConcurrent: 0,
    })).toThrow('maxConcurrent must be a positive integer');
    expect(() => new DualModeOrchestrator({
      projectPath: '/tmp',
      maxOutputBytes: 0,
    })).toThrow('maxOutputBytes must be positive');
    expect(() => new DualModeOrchestrator({
      projectPath: '/tmp',
      maxWriters: 0,
    })).toThrow('maxWriters must be a positive integer');
  });

  const orch = () => new DualModeOrchestrator({ projectPath: '/tmp' });

  it('uses safe defaults (codex command, not claude)', () => {
    const o = orch() as unknown as { config: Record<string, unknown> };
    expect(o.config.codexCommand).toBe('codex');
    expect(o.config.claudeCommand).toBe('claude');
    expect(o.config.maxConcurrent).toBe(4);
    expect(o.config.sharedNamespace).toBe('collaboration');
    expect(o.config.memoryDbPath).toBe('/tmp/.claude-flow/dual-mode-memory.db');
  });

  it('pins bootstrap and workers to one shared memory database (#2766)', () => {
    const root = mkdtempSync(join(tmpdir(), 'ruflo-dual-memory-'));
    const memoryDbPath = join(root, 'state', 'shared.db');
    const orchestrator = new DualModeOrchestrator({
      projectPath: root,
      memoryDbPath,
    }) as unknown as {
      sharedEnvironment(): NodeJS.ProcessEnv;
      workerEnvironment(worker: WorkerConfig): NodeJS.ProcessEnv;
    };
    const worker: WorkerConfig = {
      id: 'memory-worker',
      platform: 'codex',
      role: 'researcher',
      prompt: 'search memory',
      readOnly: true,
    };

    expect(orchestrator.sharedEnvironment().CLAUDE_FLOW_DB_PATH).toBe(memoryDbPath);
    expect(orchestrator.workerEnvironment(worker).CLAUDE_FLOW_DB_PATH).toBe(memoryDbPath);
  });

  it('preserves an existing CLAUDE_FLOW_DB_PATH by default', () => {
    const previous = process.env.CLAUDE_FLOW_DB_PATH;
    const root = mkdtempSync(join(tmpdir(), 'ruflo-dual-memory-env-'));
    const configured = join(root, 'existing.db');
    process.env.CLAUDE_FLOW_DB_PATH = configured;
    try {
      const orchestrator = new DualModeOrchestrator({ projectPath: root }) as unknown as {
        config: { memoryDbPath: string };
      };
      expect(orchestrator.config.memoryDbPath).toBe(configured);
    } finally {
      if (previous === undefined) delete process.env.CLAUDE_FLOW_DB_PATH;
      else process.env.CLAUDE_FLOW_DB_PATH = previous;
    }
  });

  it('does not pass policy or provider secrets to workers', () => {
    process.env.CLAUDE_FLOW_POLICY_SIGNING_KEY = 'do-not-leak';
    process.env.OPENROUTER_API_KEY = 'do-not-leak';
    try {
      const environment = (orch() as unknown as {
        workerEnvironment(worker: WorkerConfig): NodeJS.ProcessEnv;
      }).workerEnvironment({
        id: 'safe-worker',
        platform: 'codex',
        role: 'reviewer',
        prompt: 'review',
        readOnly: true,
      });
      expect(environment.CLAUDE_FLOW_POLICY_SIGNING_KEY).toBeUndefined();
      expect(environment.OPENROUTER_API_KEY).toBeUndefined();
      expect(environment.CLAUDE_FLOW_PRINCIPAL_ID).toBe('agent:safe-worker');
      expect(environment.CLAUDE_FLOW_CAPABILITY_ENVELOPE).toContain('"network":false');
    } finally {
      delete process.env.CLAUDE_FLOW_POLICY_SIGNING_KEY;
      delete process.env.OPENROUTER_API_KEY;
    }
  });

  it('enforces worker capability envelopes as reductions', () => {
    const orchestrator = orch() as unknown as {
      resolveWorkerEnvelope(worker: WorkerConfig): Record<string, unknown>;
    };
    const base: WorkerConfig = {
      id: 'bounded',
      platform: 'codex',
      role: 'coder',
      prompt: 'work',
    };
    expect(orchestrator.resolveWorkerEnvelope({
      ...base,
      capabilityEnvelope: { actions: ['memory.read'], maxConcurrency: 1 },
    })).toMatchObject({
      actions: ['memory.read'],
      network: false,
      destructive: false,
    });
    expect(() => orchestrator.resolveWorkerEnvelope({
      ...base,
      capabilityEnvelope: { network: true },
    })).toThrow('capability envelope cannot expand');
  });

  it('buildDependencyLevels groups a linear pipeline one-per-level', () => {
    const ws: WorkerConfig[] = [
      { id: 'a', platform: 'claude', role: 'a', prompt: 'x' },
      { id: 'b', platform: 'codex', role: 'b', prompt: 'y', dependsOn: ['a'] },
      { id: 'c', platform: 'codex', role: 'c', prompt: 'z', dependsOn: ['b'] },
    ];
    const levels = (orch() as unknown as { buildDependencyLevels(w: WorkerConfig[]): WorkerConfig[][] }).buildDependencyLevels(ws);
    expect(levels.map(l => l.map(w => w.id))).toEqual([['a'], ['b'], ['c']]);
  });

  it('buildDependencyLevels puts independent read-only workers in the same level', () => {
    const ws: WorkerConfig[] = [
      { id: 'a', platform: 'claude', role: 'a', prompt: 'x', readOnly: true },
      { id: 'b', platform: 'codex', role: 'b', prompt: 'y', readOnly: true },
      { id: 'c', platform: 'codex', role: 'c', prompt: 'z', dependsOn: ['a', 'b'] },
    ];
    const levels = (orch() as unknown as { buildDependencyLevels(w: WorkerConfig[]): WorkerConfig[][] }).buildDependencyLevels(ws);
    expect(levels.length).toBe(2);
    expect(new Set(levels[0].map(w => w.id))).toEqual(new Set(['a', 'b']));
    expect(levels[1].map(w => w.id)).toEqual(['c']);
  });

  it('buildDependencyLevels rejects circular dependencies', () => {
    const ws: WorkerConfig[] = [
      { id: 'a', platform: 'claude', role: 'a', prompt: 'x', dependsOn: ['b'] },
      { id: 'b', platform: 'codex', role: 'b', prompt: 'y', dependsOn: ['a'] },
    ];
    expect(() => (orch() as unknown as { buildDependencyLevels(w: WorkerConfig[]): WorkerConfig[][] }).buildDependencyLevels(ws))
      .toThrow(/dependency cycle/);
  });

  it('rejects concurrent writers sharing a worktree', () => {
    const ws: WorkerConfig[] = [
      { id: 'a', platform: 'codex', role: 'coder', prompt: 'x', worktreePath: '/tmp/shared' },
      { id: 'b', platform: 'codex', role: 'tester', prompt: 'y', worktreePath: '/tmp/shared' },
    ];
    const isolated = new DualModeOrchestrator({ projectPath: '/tmp', worktreeIsolation: true });
    expect(() => (isolated as unknown as { buildDependencyLevels(w: WorkerConfig[]): WorkerConfig[][] }).buildDependencyLevels(ws))
      .toThrow(/distinct worktrees/);
  });

  it('accepts a wider dependency level and schedules it in bounded batches', () => {
    const orchestrator = new DualModeOrchestrator({ projectPath: '/tmp', maxWriters: 1 });
    const ws: WorkerConfig[] = [
      { id: 'a', platform: 'codex', role: 'coder', prompt: 'x', worktreePath: '/tmp/a' },
      { id: 'b', platform: 'codex', role: 'tester', prompt: 'y', worktreePath: '/tmp/b' },
    ];
    expect((orchestrator as unknown as {
      buildDependencyLevels(w: WorkerConfig[]): WorkerConfig[][];
    }).buildDependencyLevels(ws)[0]).toHaveLength(2);
  });

  it('bounds writers independently without serializing read-only workers', () => {
    const orchestrator = new DualModeOrchestrator({
      projectPath: '/tmp',
      maxConcurrent: 3,
      maxWriters: 1,
    });
    const level: WorkerConfig[] = [
      { id: 'writer-a', platform: 'codex', role: 'coder', prompt: 'x' },
      { id: 'reader-a', platform: 'claude', role: 'reviewer', prompt: 'y', readOnly: true },
      { id: 'writer-b', platform: 'codex', role: 'tester', prompt: 'z' },
      { id: 'reader-b', platform: 'claude', role: 'analyst', prompt: 'q', readOnly: true },
    ];
    const batches = (orchestrator as unknown as {
      partitionLevel(items: WorkerConfig[]): WorkerConfig[][];
    }).partitionLevel(level);
    expect(batches.map((batch) => batch.map((item) => item.id))).toEqual([
      ['writer-a', 'reader-a', 'reader-b'],
      ['writer-b'],
    ]);
  });
});
