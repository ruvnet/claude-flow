import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

// Models the real store: without upsert an existing key is rejected.
const layer = vi.hoisted(() => ({ rows: new Map<string, string>() }));
vi.mock('../src/memory/memory-initializer.js', () => ({
  storeEntry: vi.fn(async (o: { key: string; value: string; namespace: string; upsert?: boolean }) => {
    const id = `${o.namespace}/${o.key}`;
    if (layer.rows.has(id) && !o.upsert) return { success: false, id: '', error: `Key already exists: ${o.key}` };
    layer.rows.set(id, o.value);
    return { success: true, id };
  }),
  searchEntries: vi.fn(), listEntries: vi.fn(), getEntry: vi.fn(), deleteEntry: vi.fn(),
  checkMemoryInitialization: vi.fn(async () => ({ initialized: true })),
  initializeMemoryDatabase: vi.fn(async () => ({ success: true })),
  generateEmbedding: vi.fn(async () => ({ backend: 'mock' })),
}));
vi.mock('../src/mcp-tools/validate-input.js', () => ({ validateIdentifier: () => ({ valid: true }) }));

const { memoryTools } = await import('../src/mcp-tools/memory-tools.js');
const importer = memoryTools.find(t => t.name === 'memory_import_claude')!;

let home: string;
let originalHome: string | undefined;
let originalCwd: string;
let originalProject: string | undefined;
const writeMemory = (contents: string) => {
  const memoryDir = join(home, '.claude', 'projects', '-test-project', 'memory');
  mkdirSync(memoryDir, { recursive: true });
  writeFileSync(join(memoryDir, 'MEMORY.md'), contents);
};

beforeEach(() => {
  originalHome = process.env.HOME;
  originalCwd = process.cwd();
  originalProject = process.env.CLAUDE_FLOW_CWD;
  delete process.env.CLAUDE_FLOW_CWD;
  home = mkdtempSync(join(tmpdir(), 'ruflo-claude-reimport-4197-'));
  process.env.HOME = home;
  layer.rows.clear();
});
afterEach(() => {
  process.chdir(originalCwd);
  if (originalProject === undefined) delete process.env.CLAUDE_FLOW_CWD;
  else process.env.CLAUDE_FLOW_CWD = originalProject;
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(home, { recursive: true, force: true });
});

describe('memory_import_claude re-import (#4197)', () => {
  it('imports the shared main-project memory from a linked Git worktree', async () => {
    const main = join(home, 'main-repo');
    const linked = join(home, 'linked-checkout');
    mkdirSync(main);
    const git = (args: string[]) => execFileSync('git', args, { cwd: main, stdio: 'pipe', timeout: 5000 });
    git(['init']);
    git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-m', 'fixture']);
    git(['worktree', 'add', '--detach', linked]);
    const slug = realpathSync(main).replace(/\//g, '-');
    const shared = join(home, '.claude', 'projects', slug, 'memory');
    mkdirSync(shared, { recursive: true });
    writeFileSync(join(shared, 'MEMORY.md'), `## Shared workflow\n${'main project memory '.repeat(15)}`);
    process.chdir(linked);
    expect(await importer.handler({})).toMatchObject({ success: true, imported: 1 });
    expect([...layer.rows.values()][0]).toContain('main project memory');
    // A caller-supplied project remains authoritative; do not import unrelated memories.
    layer.rows.clear();
    expect(await importer.handler({ projectPath: '/explicit/unrelated' })).toMatchObject({ success: true, imported: 0 });
    expect(layer.rows.size).toBe(0);
  });

  it('resolves the configured MCP project instead of the server working directory', async () => {
    const project = join(home, 'configured-project');
    mkdirSync(project);
    const slug = project.replace(/\//g, '-');
    const memory = join(home, '.claude', 'projects', slug, 'memory');
    mkdirSync(memory, { recursive: true });
    writeFileSync(join(memory, 'MEMORY.md'), `## Configuration\n${'configured project context '.repeat(15)}`);
    process.env.CLAUDE_FLOW_CWD = project;
    expect(await importer.handler({})).toMatchObject({ success: true, imported: 1 });
    expect([...layer.rows.values()][0]).toContain('configured project context');
  });

  it('imports an already-imported, edited file again instead of failing', async () => {
    writeMemory(`## Workflow\n${'first version of the note '.repeat(10)}`);
    expect(await importer.handler({ projectPath: '/test/project' })).toMatchObject({ success: true, imported: 1, skipped: 0 });

    writeMemory(`## Workflow\n${'edited version of the note '.repeat(10)}`);
    const again = await importer.handler({ projectPath: '/test/project' }) as { success: boolean; imported: number; skipped: number };
    expect(again).toMatchObject({ success: true, imported: 1, skipped: 0 });
    expect([...layer.rows.values()][0]).toContain('edited version');
  });

  it('says why a file was skipped when the store rejects it', async () => {
    writeMemory(`## Workflow\n${'a long memory section '.repeat(20)}`);
    const { storeEntry } = await import('../src/memory/memory-initializer.js');
    (storeEntry as any).mockResolvedValueOnce({ success: false, id: '', error: 'store unavailable' });
    const result = await importer.handler({ projectPath: '/test/project' }) as { success: boolean; skipped: number; errors?: string[] };
    expect(result.success).toBe(false);
    expect(result.skipped).toBe(1);
    expect(result.errors?.[0]).toContain('store unavailable');
  });
});
