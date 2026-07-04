/**
 * Tests for agenticow speculative branch-and-promote (step 4).
 *
 * Surfaces under test:
 *   1. TOOL SHAPE — `agenticow_speculate` exists with a JSON-schema input + handler
 *      (no package needed).
 *   2. CORE `explore()` HAPPY PATH — 3 candidate branches, a deterministic
 *      scorer; assert the winner is PROMOTED into base (base query returns the
 *      winner's vectors, and only the winner's) and the loser branch files are
 *      DISCARDED. Skipped when the optional `agenticow` dep is absent.
 *   3. MCP HANDLER HAPPY PATH — the declarative `agenticow_speculate` tool
 *      round-trips through a real base .rvf and reports the winner + discards.
 *
 * Mirrors __tests__/agenticow-tools.test.ts conventions (skipIf on package
 * availability; the degraded path is the load-bearing optional-dep rule).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { agenticowSpeculateTools } from '../src/mcp-tools/agenticow-speculate-tools.js';
import { explore } from '../src/agenticow/speculative-exploration.js';

function findTool(name: string) {
  const t = agenticowSpeculateTools.find(t => t.name === name);
  if (!t) throw new Error(`tool not found: ${name}`);
  return t;
}

// Detect agenticow availability at module scope (top-level await allowed in
// vitest ESM). Needed before `it.skipIf(...)`, which evaluates at definition time.
let havePkg = false;
let acow: any = null;
try { acow = await import('agenticow'); havePkg = true; } catch { havePkg = false; }

const DIM = 8;
// Separable one-hot vectors so nearest-neighbour is unambiguous under cosine.
const vSeed = [0, 0, 0, 1, 0, 0, 0, 0];
const vAlpha = [1, 0, 0, 0, 0, 0, 0, 0];
const vBeta = [0, 1, 0, 0, 0, 0, 0, 0];
const vGamma = [0, 0, 1, 0, 0, 0, 0, 0];

describe('agenticow_speculate — tool shape', () => {
  it('exposes exactly 1 tool (agenticow_speculate)', () => {
    expect(agenticowSpeculateTools.map(t => t.name)).toEqual(['agenticow_speculate']);
  });

  it('the tool has a JSON-schema object input + handler', () => {
    const t = findTool('agenticow_speculate');
    expect(t.inputSchema.type).toBe('object');
    expect(t.inputSchema.properties).toBeDefined();
    expect((t.inputSchema.required as string[])).toEqual(['basePath', 'candidates']);
    expect(typeof t.handler).toBe('function');
  });
});

describe('SpeculativeExploration.explore() — core happy path', () => {
  let workdir: string;
  let basePath: string;

  beforeAll(() => {
    workdir = mkdtempSync(join(tmpdir(), 'acow-speculate-'));
    basePath = join(workdir, 'base.rvf');
  });

  afterAll(() => {
    try { rmSync(workdir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('rejects an empty candidate list (no package needed)', async () => {
    // base handle is a harmless stub — validation runs before it is touched
    await expect(explore({} as any, [], () => 0, { branchPath: (l) => l }))
      .rejects.toThrow(/at least one candidate/);
  });

  it.skipIf(!havePkg)(
    'forks 3 branches, promotes the winner into base, discards the losers',
    async () => {
      const base = acow.open(basePath, { dimension: DIM });
      // Seed base so we can prove ONLY the winner (not losers) is promoted on top.
      base.ingest([{ id: 1, vector: vSeed }]);

      const branchPath = (label: string) => join(workdir, `b-${label}.rvf`);

      // Each candidate ingests its own vector into its own COW branch.
      const candidates = [
        { label: 'alpha', fn: (b: any) => { b.ingest([{ id: 101, vector: vAlpha }]); return 'alpha'; } },
        { label: 'beta', fn: (b: any) => { b.ingest([{ id: 102, vector: vBeta }]); return 'beta'; } },
        { label: 'gamma', fn: (b: any) => { b.ingest([{ id: 103, vector: vGamma }]); return 'gamma'; } },
      ];

      // Deterministic scorer: beta is best (3 > 2 > 1).
      const rank: Record<string, number> = { alpha: 1, beta: 3, gamma: 2 };
      const score = (_r: string, label: string) => rank[label];

      const result = await explore(base, candidates, score, { branchPath });

      // Winner is beta; losers were discarded.
      expect(result.winner).toBe('beta');
      expect(result.promoted).toBe(true);
      expect(result.discarded.slice().sort()).toEqual(['alpha', 'gamma']);
      expect(result.scores).toEqual({ alpha: 1, beta: 3, gamma: 2 });

      // Loser branch files (and their manifests) are gone; 162-byte discard.
      expect(existsSync(join(workdir, 'b-alpha.rvf'))).toBe(false);
      expect(existsSync(join(workdir, 'b-gamma.rvf'))).toBe(false);
      expect(existsSync(join(workdir, 'b-alpha.rvf.agenticow.json'))).toBe(false);

      // The winner is promoted INTO base: base now contains seed + beta only.
      expect(base.status().totalVectors).toBe(2);
      const hitB = base.query(vBeta, 1);
      expect(hitB[0].id).toBe(102); // beta's vector lives in base now
      const hitSeed = base.query(vSeed, 1);
      expect(hitSeed[0].id).toBe(1); // original seed preserved
      // alpha's id was NOT promoted — it is nowhere in base.
      const allIds = [vSeed, vAlpha, vBeta, vGamma].flatMap(v => base.query(v, 2).map((h: any) => h.id));
      expect(allIds).not.toContain(101);
      expect(allIds).not.toContain(103);

      base.close?.();
    },
  );
});

describe('agenticow_speculate — MCP handler happy path', () => {
  let workdir: string;
  let basePath: string;

  beforeAll(() => {
    workdir = mkdtempSync(join(tmpdir(), 'acow-speculate-mcp-'));
    basePath = join(workdir, 'base.rvf');
  });

  afterAll(() => {
    try { rmSync(workdir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it.skipIf(!havePkg)(
    "picks the branch whose ingest is nearest the probe and discards the rest",
    async () => {
      const tool = findTool('agenticow_speculate');
      const result: any = await tool.handler({
        basePath,
        dimension: DIM,
        // probe matches beta — beta should win under scoreBy='nearest'
        probe: vBeta,
        candidates: [
          { label: 'alpha', ingest: [{ id: 201, vector: vAlpha }] },
          { label: 'beta', ingest: [{ id: 202, vector: vBeta }] },
          { label: 'gamma', ingest: [{ id: 203, vector: vGamma }] },
        ],
      });

      expect(result.success).toBe(true);
      expect(result.degraded).toBeUndefined();
      expect(result.winner).toBe('beta');
      expect(result.scoreBy).toBe('nearest');
      expect(result.discarded.slice().sort()).toEqual(['alpha', 'gamma']);
      // loser branch files deleted (default path is alongside base)
      expect(existsSync(`${basePath}.spec-alpha.rvf`)).toBe(false);
      expect(existsSync(`${basePath}.spec-gamma.rvf`)).toBe(false);

      // Reopen base and confirm the winner's vector was promoted.
      const base = acow.AgenticMemory.load(`${basePath}.agenticow.json`);
      const hit = base.query(vBeta, 1);
      expect(hit[0].id).toBe(202);
      base.close?.();
    },
  );

  it.skipIf(!havePkg)("rejects scoreBy='nearest' without a probe vector", async () => {
    const tool = findTool('agenticow_speculate');
    await expect(tool.handler({
      basePath: join(workdir, 'noprobe.rvf'),
      dimension: DIM,
      candidates: [{ label: 'a', ingest: [{ id: 1, vector: vAlpha }] }],
    })).rejects.toThrow(/requires a probe vector/);
  });

  // ADR-171 promotion gate (#23) — the acceptance-test invariants.
  it.skipIf(!havePkg)('requireClearance fail-closes: winner ineligible, base unchanged, receipts emitted', async () => {
    const tool = findTool('agenticow_speculate');
    const basePath = join(workdir, 'gate.rvf');
    const r = await tool.handler({
      basePath,
      dimension: DIM,
      probe: vBeta,
      requireClearance: true,
      candidates: [
        { label: 'a', ingest: [{ id: 101, vector: vAlpha }] },
        { label: 'b', ingest: [{ id: 202, vector: vBeta }] },
      ],
    }) as any;
    expect(r.promoted).toBe(false);
    expect(r.promotionDecision).toMatch(/^ineligible:/);
    expect(r.receipts.length).toBeGreaterThan(0);
    // Base must NOT contain any candidate vector — nothing graduated.
    const base = acow.AgenticMemory.load(`${basePath}.agenticow.json`);
    const ids = base.query(vBeta, 5).map((h: any) => h.id);
    expect(ids).not.toContain(202);
    base.close?.();
  });
});

// Core-level gate semantics (exercises explore() directly with clearance fns).
describe('speculative explore() — ADR-171 clearance gate', () => {
  it.skipIf(!havePkg)('proxy:structural can never clear a promote, even claiming cleared:true', async () => {
    const { explore } = await import('../src/agenticow/speculative-exploration.js');
    const dir = mkdtempSync(join(tmpdir(), 'gate-core-'));
    try {
      const base = acow.AgenticMemory.open(join(dir, 'b.rvf'), { dimension: DIM });
      base.ingest([{ id: 1, vector: vAlpha }]);
      const cands = [{ label: 'x', fn: async (br: any) => { br.ingest([{ id: 9, vector: vBeta }]); return 5; } }];
      const r = await explore(base, cands, (res: number) => res, {
        branchPath: (l: string) => join(dir, `br-${l}.rvf`),
        persist: true,
        clearance: async () => ({ cleared: true, by: 'proxy:structural' as const }),
      });
      expect(r.promoted).toBe(false);
      expect(r.promotionDecision).toBe('ineligible:proxy-cannot-clear');
      base.close?.();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(!havePkg)('oracle:test-exec clears the winner into base', async () => {
    const { explore } = await import('../src/agenticow/speculative-exploration.js');
    const dir = mkdtempSync(join(tmpdir(), 'gate-oracle-'));
    try {
      const base = acow.AgenticMemory.open(join(dir, 'b.rvf'), { dimension: DIM });
      base.ingest([{ id: 1, vector: vAlpha }]);
      const cands = [{ label: 'x', fn: async (br: any) => { br.ingest([{ id: 9, vector: vBeta }]); return 5; } }];
      const r = await explore(base, cands, (res: number) => res, {
        branchPath: (l: string) => join(dir, `br-${l}.rvf`),
        persist: true,
        clearance: async () => ({ cleared: true, by: 'oracle:test-exec' as const }),
      });
      expect(r.promoted).toBe(true);
      expect(r.promotedBy).toBe('oracle:test-exec');
      base.close?.();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
