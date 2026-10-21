/**
 * ADR-087 / #3313: the graph database must be opened with the options object,
 * and must refuse to publish a handle that is not backed by the file we asked
 * for.
 *
 * `@ruvector/graph-node` is a native optional dependency and is absent from a
 * plain checkout, so these drive the adapter through a fake module injected at
 * the `createRequire` seam. That is the boundary the defect lives on: the real
 * 2.1.0 constructor accepts a path STRING without throwing and returns a
 * volatile in-memory instance, so a test that only asserts "no exception" would
 * have passed against the bug.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, realpathSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

interface FakeOptions {
  storagePath?: string;
  dimensions?: number;
  distanceMetric?: string;
}

/** Records how it was constructed so a test can assert the call SHAPE. */
class FakeGraphDatabase {
  static constructedWith: unknown[] = [];
  static instances: FakeGraphDatabase[] = [];
  /** Mimics 2.1.0: a string argument yields a volatile handle, silently. */
  static acceptStringAsPersistent = false;

  readonly persistent: boolean;
  readonly storagePath: string | null;
  closed = false;

  constructor(arg?: string | FakeOptions) {
    FakeGraphDatabase.constructedWith.push(arg);
    FakeGraphDatabase.instances.push(this);
    if (typeof arg === 'object' && arg !== null && typeof arg.storagePath === 'string') {
      this.persistent = true;
      this.storagePath = arg.storagePath;
    } else if (typeof arg === 'string' && FakeGraphDatabase.acceptStringAsPersistent) {
      this.persistent = true;
      this.storagePath = arg;
    } else {
      this.persistent = false;
      this.storagePath = null;
    }
  }

  isPersistent(): boolean {
    return this.persistent;
  }

  getStoragePath(): string | null {
    return this.storagePath;
  }

  close(): void {
    this.closed = true;
  }

  createNode(): string {
    return 'node-1';
  }

  stats() {
    return { totalNodes: 1, totalEdges: 0, avgDegree: 0 };
  }
}

/** Replaces the module `createRequire` hands back for '@ruvector/graph-node'. */
function injectGraphNode(impl: unknown): void {
  vi.doMock('module', async (importOriginal) => {
    const actual = await importOriginal<typeof import('module')>();
    return {
      ...actual,
      default: actual,
      createRequire: () => (id: string) => {
        if (id === '@ruvector/graph-node') return impl;
        throw new Error(`unexpected require: ${id}`);
      },
    };
  });
}

async function loadBackend() {
  return import('../src/ruvector/graph-backend.js');
}

describe('#3313 graph database construction', () => {
  let cwd: string;
  let tmp: string;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    FakeGraphDatabase.constructedWith = [];
    FakeGraphDatabase.instances = [];
    FakeGraphDatabase.acceptStringAsPersistent = false;
    // The adapter writes `.claude-flow/graph` under cwd; keep that out of the repo.
    cwd = process.cwd();
    // realpath: on macOS `tmpdir()` is /var/... but `process.cwd()` reports
    // the /private/var target, and the adapter builds its path from cwd.
    tmp = realpathSync(mkdtempSync(join(tmpdir(), 'cf-graph-')));
    process.chdir(tmp);
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    process.chdir(cwd);
    rmSync(tmp, { recursive: true, force: true });
    warn.mockRestore();
    vi.doUnmock('module');
  });

  it('constructs with an options object carrying the storage path', async () => {
    injectGraphNode({ GraphDatabase: FakeGraphDatabase });
    const { addNode } = await loadBackend();

    await addNode({ id: 'a', type: 'agent' });

    expect(FakeGraphDatabase.constructedWith).toHaveLength(1);
    const arg = FakeGraphDatabase.constructedWith[0] as FakeOptions;
    expect(typeof arg).toBe('object');
    expect(arg.storagePath).toBe(join(tmp, '.claude-flow', 'graph', 'agents.db'));
  });

  it('asks for the embedding dimension the adapter actually writes', async () => {
    injectGraphNode({ GraphDatabase: FakeGraphDatabase });
    const { addNode } = await loadBackend();

    await addNode({ id: 'a', type: 'agent' });

    // `textToMiniEmbedding` produces 8 floats; a database opened at another
    // dimension rejects or truncates every node this module creates.
    expect((FakeGraphDatabase.constructedWith[0] as FakeOptions).dimensions).toBe(8);
  });

  it('refuses a handle that reports itself non-persistent', async () => {
    class VolatileGraphDatabase extends FakeGraphDatabase {
      constructor(arg?: string | FakeOptions) {
        super(arg);
        // Mimics 2.1.0 ignoring what it was given.
        (this as { persistent: boolean }).persistent = false;
        (this as { storagePath: string | null }).storagePath = null;
      }
    }
    injectGraphNode({ GraphDatabase: VolatileGraphDatabase });
    const { addNode, getGraphStats } = await loadBackend();

    expect(await addNode({ id: 'a', type: 'agent' })).toBeNull();
    expect((await getGraphStats()).backend).toBe('unavailable');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/non-persistent/);
  });

  it('refuses a handle whose storage path is not the one requested', async () => {
    class ElsewhereGraphDatabase extends FakeGraphDatabase {
      constructor(arg?: string | FakeOptions) {
        super(arg);
        (this as { storagePath: string | null }).storagePath = '/somewhere/else.db';
      }
    }
    injectGraphNode({ GraphDatabase: ElsewhereGraphDatabase });
    const { addNode } = await loadBackend();

    expect(await addNode({ id: 'a', type: 'agent' })).toBeNull();
  });

  it('reports an open failure instead of substituting an empty in-memory graph', async () => {
    class UnopenableGraphDatabase {
      constructor() {
        throw new Error('EACCES: permission denied');
      }
    }
    injectGraphNode({ GraphDatabase: UnopenableGraphDatabase });
    const { addNode, getGraphStats } = await loadBackend();

    expect(await addNode({ id: 'a', type: 'agent' })).toBeNull();
    expect((await getGraphStats()).backend).toBe('unavailable');
    expect(String(warn.mock.calls[0][0])).toMatch(/EACCES/);
  });

  it('warns once, not once per call', async () => {
    class UnopenableGraphDatabase {
      constructor() {
        throw new Error('EACCES: permission denied');
      }
    }
    injectGraphNode({ GraphDatabase: UnopenableGraphDatabase });
    const { addNode } = await loadBackend();

    for (let i = 0; i < 5; i++) await addNode({ id: `a${i}`, type: 'agent' });

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('opens once for concurrent first callers', async () => {
    injectGraphNode({ GraphDatabase: FakeGraphDatabase });
    const { addNode } = await loadBackend();

    await Promise.all(
      Array.from({ length: 8 }, (_, i) => addNode({ id: `a${i}`, type: 'agent' })),
    );

    console.log('CONSTRUCTIONS=', FakeGraphDatabase.constructedWith.length);
    expect(FakeGraphDatabase.constructedWith).toHaveLength(1);
  });

  it('every concurrent first caller gets a usable handle', async () => {
    injectGraphNode({ GraphDatabase: FakeGraphDatabase });
    const { addNode } = await loadBackend();

    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => addNode({ id: `a${i}`, type: 'agent' })),
    );

    // Every caller, not just the count of opens: a shared handle that the
    // second caller cannot use is no better than eight of them.
    expect(results).toEqual(Array(8).fill('node-1'));
  });

  it('does not substitute a working in-memory graph when the file cannot be opened', async () => {
    class NoFileGraphDatabase extends FakeGraphDatabase {
      constructor(arg?: string | FakeOptions) {
        if (arg !== undefined) throw new Error('EACCES: permission denied');
        super(arg);
      }
    }
    injectGraphNode({ GraphDatabase: NoFileGraphDatabase });
    const { addNode, getGraphStats } = await loadBackend();

    // The no-argument constructor here SUCCEEDS and yields a volatile graph --
    // exactly the old fallback. Taking it would make a permission error
    // indistinguishable from a healthy database that simply has no data.
    expect(await addNode({ id: 'a', type: 'agent' })).toBeNull();
    expect((await getGraphStats()).backend).toBe('unavailable');
  });

  it('accepts a build that exposes neither accessor', async () => {
    class OldGraphDatabase {
      createNode(): string {
        return 'node-1';
      }
    }
    injectGraphNode({ GraphDatabase: OldGraphDatabase });
    const { addNode } = await loadBackend();

    // Nothing to interrogate is not the same as a failed interrogation: the
    // guard exists to catch a silent downgrade, not to refuse an unfamiliar
    // version.
    expect(await addNode({ id: 'a', type: 'agent' })).toBe('node-1');
    expect(warn).not.toHaveBeenCalled();
  });

  it('stays unavailable when the optional dependency is absent', async () => {
    vi.doMock('module', async (importOriginal) => {
      const actual = await importOriginal<typeof import('module')>();
      return {
        ...actual,
        default: actual,
        createRequire: () => () => {
          throw new Error("Cannot find module '@ruvector/graph-node'");
        },
      };
    });
    const { isGraphBackendAvailable, addNode } = await loadBackend();

    expect(await isGraphBackendAvailable()).toBe(false);
    expect(await addNode({ id: 'a', type: 'agent' })).toBeNull();
  });
});
