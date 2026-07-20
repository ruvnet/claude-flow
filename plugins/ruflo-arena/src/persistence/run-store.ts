// Run persistence. A competition run is a reproducible artifact (Ruflo ADR-147; the local
// stand-in for RuVector ADR-197's payoff/fitness/evolution storage).
//
// Two backends ship here:
//   - FileRunStore     — writes full artifacts to `.ruflo/arena/<runId>.json` (exact replay).
//   - InMemoryRunStore — for tests / ephemeral use.
// AgentDB persistence is handled at the COMMAND layer (Ruflo convention: plugin TS persists
// artifacts; commands call `mcp__plugin_ruflo-core_ruflo__memory_store` with `agentdbRecord(run)`).

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RunKind, RunRecord } from '../domain/types.js';

export interface RunStore {
  save(record: RunRecord): Promise<RunRecord>;
  get(runId: string): Promise<RunRecord | null>;
  list(limit?: number): Promise<RunRecord[]>;
}

let counter = 0;

/** Generate a run id. Uses crypto.randomUUID when available, else a monotonic fallback. */
export function newRunId(kind: RunKind): string {
  const uuid =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID().slice(0, 8)
      : `${(counter++).toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  return `${kind}-${uuid}`;
}

export function makeRecord(
  kind: RunKind,
  game: string,
  seed: number,
  summary: Record<string, unknown>,
  artifact: unknown,
  runId = newRunId(kind),
): RunRecord {
  return { runId, kind, game, seed, createdAt: new Date().toISOString(), summary, artifact };
}

export class InMemoryRunStore implements RunStore {
  private readonly records = new Map<string, RunRecord>();
  private readonly order: string[] = [];

  async save(record: RunRecord): Promise<RunRecord> {
    this.records.set(record.runId, record);
    this.order.unshift(record.runId);
    return record;
  }
  async get(runId: string): Promise<RunRecord | null> {
    return this.records.get(runId) ?? null;
  }
  async list(limit = 20): Promise<RunRecord[]> {
    return this.order.slice(0, limit).map((id) => this.records.get(id)!).filter(Boolean);
  }
}

export class FileRunStore implements RunStore {
  constructor(private readonly baseDir = join(process.cwd(), '.ruflo', 'arena')) {}

  async save(record: RunRecord): Promise<RunRecord> {
    await mkdir(this.baseDir, { recursive: true });
    await writeFile(join(this.baseDir, `${record.runId}.json`), JSON.stringify(record, null, 2), 'utf8');
    return record;
  }

  async get(runId: string): Promise<RunRecord | null> {
    try {
      const raw = await readFile(join(this.baseDir, `${runId}.json`), 'utf8');
      return JSON.parse(raw) as RunRecord;
    } catch {
      return null;
    }
  }

  async list(limit = 20): Promise<RunRecord[]> {
    let files: string[];
    try {
      files = (await readdir(this.baseDir)).filter((f) => f.endsWith('.json'));
    } catch {
      return [];
    }
    const records = await Promise.all(
      files.map(async (f) => {
        try {
          return JSON.parse(await readFile(join(this.baseDir, f), 'utf8')) as RunRecord;
        } catch {
          return null;
        }
      }),
    );
    return records
      .filter((r): r is RunRecord => r !== null)
      .sort((x, y) => y.createdAt.localeCompare(x.createdAt))
      .slice(0, limit);
  }
}

/**
 * Shape a run for AgentDB persistence via `mcp__plugin_ruflo-core_ruflo__memory_store`.
 * The command layer calls the MCP tool with this payload so runs become semantically
 * searchable ("tournaments where grim dominated") and feed the RuVector data layer later.
 *
 * `kind`, `game`, and `seed` are lifted to top-level fields (parallel to `tags`)
 * so RuVector ADR-197 indexers can filter without re-parsing `value`. `value`
 * itself still carries the full summary for body-level semantic search.
 */
export function agentdbRecord(record: RunRecord): {
  namespace: string;
  key: string;
  kind: RunKind;
  game: string;
  seed: number;
  value: string;
  tags: string[];
} {
  return {
    namespace: 'arena',
    key: record.runId,
    kind: record.kind,
    game: record.game,
    seed: record.seed,
    value: JSON.stringify(record.summary),
    tags: ['ruliology', 'competition', record.kind, record.game],
  };
}
