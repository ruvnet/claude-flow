/**
 * Tests for the SwarmMemoryBranches service (per-agent COW memory).
 *
 * Two surfaces, mirroring agenticow-tools.test.ts:
 *   1. HAPPY PATH — agenticow installed: a real branch → ingest → promote /
 *      discard lifecycle against a temp .rvf, asserting the 162-byte branch,
 *      isolation, and that promote merges edits while discard throws them away.
 *   2. DEGRADED / KILL-SWITCH PATH — always runs: the service must return
 *      `{degraded:true}` (no throw) when agenticow is absent or when
 *      CLAUDE_FLOW_NO_COW_MEMORY=1, and promote/discard on an unknown agent
 *      must be pure-fs no-ops. This is the load-bearing architectural rule
 *      (zero hard runtime dep, operator kill switch).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  SwarmMemoryBranches,
  cowMemoryEnabled,
  COW_KILL_SWITCH_ENV,
} from '../src/services/swarm-memory-branches.js';
import { agenticowTools } from '../src/mcp-tools/agenticow-tools.js';

function findTool(name: string) {
  const t = agenticowTools.find(t => t.name === name);
  if (!t) throw new Error(`tool not found: ${name}`);
  return t;
}

function dirBytes(p: string): number {
  if (!existsSync(p)) return 0;
  const st = statSync(p);
  if (st.isFile()) return st.size;
  let total = 0;
  for (const e of readdirSync(p)) total += dirBytes(join(p, e));
  return total;
}

const v = (s: number) => Array.from({ length: 8 }, (_, i) => Math.sin(s + i));

// Detect agenticow availability before the `it.skipIf(...)` calls evaluate.
let havePkg = false;
try { await import('agenticow'); havePkg = true; } catch { havePkg = false; }

describe('SwarmMemoryBranches', () => {
  let workdir: string;
  let registryPath: string;

  beforeAll(() => {
    workdir = mkdtempSync(join(tmpdir(), 'acow-swarm-'));
    registryPath = join(workdir, 'registry.json');
  });

  afterAll(() => {
    try { rmSync(workdir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  beforeEach(() => {
    delete process.env[COW_KILL_SWITCH_ENV];
  });

  // ---- always-on contract tests --------------------------------------------

  it('cowMemoryEnabled honors the kill switch env var', () => {
    delete process.env[COW_KILL_SWITCH_ENV];
    expect(cowMemoryEnabled()).toBe(true);
    process.env[COW_KILL_SWITCH_ENV] = '1';
    expect(cowMemoryEnabled()).toBe(false);
    delete process.env[COW_KILL_SWITCH_ENV];
  });

  it('branchForAgent is a no-op when the kill switch is set', async () => {
    process.env[COW_KILL_SWITCH_ENV] = '1';
    const svc = new SwarmMemoryBranches(registryPath);
    const r = await svc.branchForAgent(join(workdir, 'ks-base.rvf'), 'agent-ks', { dimension: 8 });
    expect(r.success).toBe(true);
    expect(r.degraded).toBe(true);
    expect(r.reason).toBe('cow-memory-disabled');
    expect(r.branchPath).toBeUndefined();
    expect(svc.getBranch('agent-ks')).toBeUndefined();
  });

  it.skipIf(havePkg)('branchForAgent degrades when agenticow is absent', async () => {
    const svc = new SwarmMemoryBranches(registryPath);
    const r = await svc.branchForAgent(join(workdir, 'no-pkg-base.rvf'), 'agent-nopkg', { dimension: 8 });
    expect(r.success).toBe(true);
    expect(r.degraded).toBe(true);
    expect(r.reason).toBe('agenticow-not-found');
    expect(svc.getBranch('agent-nopkg')).toBeUndefined();
  });

  it('promoteAgent / discardAgent are no-ops for an unknown agent (pure fs, no agenticow)', async () => {
    const svc = new SwarmMemoryBranches(registryPath);
    const p = await svc.promoteAgent('never-spawned');
    expect(p.success).toBe(true);
    expect(p.promoted).toBe(false);
    expect(p.reason).toBe('no-branch');

    const d = await svc.discardAgent('never-spawned');
    expect(d.success).toBe(true);
    expect(d.discarded).toBe(false);
    expect(d.reason).toBe('no-branch');
  });

  // ---- happy-path lifecycle (real package) ---------------------------------

  it.skipIf(!havePkg)('branch → ingest → promote merges the agent\'s edits into the shared base', async () => {
    const svc = new SwarmMemoryBranches(registryPath);
    const ingest = findTool('agenticow_ingest');
    const query = findTool('agenticow_query');
    const base = join(workdir, 'promote-base.rvf');
    const agentId = 'agent-promote-1';

    // Seed the shared base with one vector, then fork a per-agent branch.
    await ingest.handler({ path: base, records: [{ id: 1, vector: v(1), text: 'base-seed' }], dimension: 8 });
    const br = await svc.branchForAgent(base, agentId, { dimension: 8 });
    expect(br.degraded).toBeUndefined();
    expect(br.branchPath).toBeDefined();
    expect(existsSync(br.branchPath!)).toBe(true);
    // The 162-byte win is the whole point — a fork must NOT be a full copy.
    expect(dirBytes(br.branchPath!)).toBeLessThan(4096);
    expect(svc.getBranch(agentId)?.branchPath).toBe(br.branchPath);

    // Agent writes into its OWN branch (isolated from base).
    await ingest.handler({ path: br.branchPath!, records: [{ id: 99, vector: v(9), text: 'agent-edit' }] });

    // Base does not see the branch-only vector before promote.
    const baseBefore = await query.handler({ path: base, vector: v(9), k: 5 }) as any;
    expect(baseBefore.hits.some((h: any) => h.id === 99)).toBe(false);

    // Promote → merge the agent's edits back; branch file removed, registry cleared.
    const pr = await svc.promoteAgent(agentId);
    expect(pr.success).toBe(true);
    expect(pr.promoted).toBe(true);
    expect(svc.getBranch(agentId)).toBeUndefined();
    expect(existsSync(br.branchPath!)).toBe(false);

    // Base now sees the promoted vector.
    const baseAfter = await query.handler({ path: base, vector: v(9), k: 5 }) as any;
    expect(baseAfter.hits.some((h: any) => h.id === 99)).toBe(true);
  });

  it.skipIf(!havePkg)('discardAgent throws the branch away without touching base', async () => {
    const svc = new SwarmMemoryBranches(registryPath);
    const ingest = findTool('agenticow_ingest');
    const query = findTool('agenticow_query');
    const base = join(workdir, 'discard-base.rvf');
    const agentId = 'agent-discard-1';

    await ingest.handler({ path: base, records: [{ id: 1, vector: v(1), text: 'keep' }], dimension: 8 });
    const br = await svc.branchForAgent(base, agentId, { dimension: 8 });
    await ingest.handler({ path: br.branchPath!, records: [{ id: 77, vector: v(7), text: 'doomed' }] });

    const d = await svc.discardAgent(agentId);
    expect(d.discarded).toBe(true);
    expect(existsSync(br.branchPath!)).toBe(false);
    expect(svc.getBranch(agentId)).toBeUndefined();

    // The discarded edit never reached base.
    const baseAfter = await query.handler({ path: base, vector: v(7), k: 5 }) as any;
    expect(baseAfter.hits.some((h: any) => h.id === 77)).toBe(false);
  });

  it.skipIf(!havePkg)('branchForAgent is idempotent for the same agent', async () => {
    const svc = new SwarmMemoryBranches(registryPath);
    const base = join(workdir, 'idem-base.rvf');
    const agentId = 'agent-idem-1';
    const first = await svc.branchForAgent(base, agentId, { dimension: 8 });
    const second = await svc.branchForAgent(base, agentId, { dimension: 8 });
    expect(second.branchPath).toBe(first.branchPath);
  });
});
