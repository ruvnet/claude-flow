/**
 * #655 follow-up: hive-mind_init's persistence contract.
 *
 * The handler read `persist`, `maxAgents` and `memoryBackend` out of the
 * input and echoed them in `config`, but the MCP schema declared none of
 * them, and `saveHiveState()` ran unconditionally. A caller that passed
 * `persist:false` was told persistence was off while state.json (and the
 * bootstrap secret) were still written. The status fallback also drifted to
 * "byzantine" for legacy state even though init's documented default is raft.
 *
 * #3241 covers the separate hiveId round-trip defect.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hiveMindTools } from '../src/mcp-tools/hive-mind-tools.js';

const initTool = hiveMindTools.find(t => t.name === 'hive-mind_init')!;
const statusTool = hiveMindTools.find(t => t.name === 'hive-mind_status')!;
const statePath = (dir: string) => join(dir, '.claude-flow', 'hive-mind', 'state.json');
const hiveDir = (dir: string) => join(dir, '.claude-flow', 'hive-mind');

describe('hive-mind_init persistence contract (#655)', () => {
  let dir: string;
  let prevCwd: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hive-mind-persist-'));
    prevCwd = process.env.CLAUDE_FLOW_CWD;
    process.env.CLAUDE_FLOW_CWD = dir;
  });

  afterEach(() => {
    if (prevCwd === undefined) delete process.env.CLAUDE_FLOW_CWD;
    else process.env.CLAUDE_FLOW_CWD = prevCwd;
    rmSync(dir, { recursive: true, force: true });
  });

  it('declares the options the handler already consumes', () => {
    const props = initTool.inputSchema.properties as Record<string, Record<string, unknown>>;

    expect(props.maxAgents).toMatchObject({ type: 'number', minimum: 1, maximum: 1000, default: 15 });
    expect(props.memoryBackend).toMatchObject({ type: 'string', enum: ['agentdb', 'sqlite', 'hybrid'], default: 'hybrid' });
    expect(props.persist).toMatchObject({ type: 'boolean', default: true });
  });

  it('persist:false writes neither state.json nor the bootstrap secret', async () => {
    const result = await initTool.handler({ persist: false, maxAgents: 7, memoryBackend: 'sqlite' }) as Record<string, any>;

    expect(result.success).toBe(true);
    expect(result.persisted).toBe(false);
    expect(result.config).toMatchObject({ maxAgents: 7, memoryBackend: 'sqlite', persist: false });
    expect(existsSync(hiveDir(dir))).toBe(false);
    expect(existsSync(statePath(dir))).toBe(false);
  });

  it('persist:false leaves an existing state.json byte-for-byte unchanged', async () => {
    await initTool.handler({ maxAgents: 5, memoryBackend: 'hybrid' });
    const before = readFileSync(statePath(dir));

    await initTool.handler({ persist: false, maxAgents: 99, memoryBackend: 'agentdb' });

    expect(readFileSync(statePath(dir))).toEqual(before);
  });

  it('default init persists the requested config and status reports it', async () => {
    const init = await initTool.handler({ maxAgents: 12, memoryBackend: 'agentdb' }) as Record<string, any>;
    const status = await statusTool.handler({}) as Record<string, any>;
    const persisted = JSON.parse(readFileSync(statePath(dir), 'utf8'));

    expect(init.persisted).toBe(true);
    expect(persisted).toMatchObject({ maxAgents: 12, memoryBackend: 'agentdb', persist: true });
    expect(status.maxAgents).toBe(12);
    expect(status.memoryBackend).toBe('agentdb');
  });

  it('rejects invalid values before creating any durable state', async () => {
    for (const input of [{ maxAgents: 0 }, { maxAgents: 1001 }, { maxAgents: 2.5 }, { memoryBackend: 'redis' }, { persist: 'false' }]) {
      const result = await initTool.handler(input) as Record<string, any>;
      expect(result.success, JSON.stringify(input)).toBe(false);
    }
    expect(existsSync(hiveDir(dir))).toBe(false);
  });

  it('legacy state without a strategy reports raft, not byzantine', async () => {
    await initTool.handler({});
    const persisted = JSON.parse(readFileSync(statePath(dir), 'utf8'));
    delete persisted.consensusStrategy;
    const { writeFileSync } = await import('node:fs');
    writeFileSync(statePath(dir), JSON.stringify(persisted, null, 2));

    const status = await statusTool.handler({}) as Record<string, any>;
    expect(status.consensus).toBe('raft');
  });
});
