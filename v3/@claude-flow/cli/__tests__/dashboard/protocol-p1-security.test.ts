/** R-SEC-p1-*: each of these fails against the P0 protocol (the commands, sections and tools below did not exist or were not constrained). */
import { describe, expect, it } from 'vitest';
import { authorize, authorizeCapability, buildSectionFrame, fitToBudget, parseCommand, parseSectionFrame, READ_TOOLS, SECTION_BUDGET_BYTES, SECTION_NAMES, SectionSchemas } from '../../src/dashboard/protocol/index.js';

const CID = 'ruflo-adr/skill/adr-verify@0.5.3+1a2b3c4d5e6f';
const run = (over: Record<string, unknown> = {}) => parseCommand('capability.run', { pluginId: 'ruflo-adr@ruflo', capabilityId: CID, args: {}, ...over });

describe('R-SEC-p1 commands', () => {
  it('R-SEC-p1-01 the five P1 commands are allowlisted with strict shapes; plugin.list takes nothing', () => {
    expect(run().ok).toBe(true);
    expect(parseCommand('plugin.list', {}).ok).toBe(true);
    expect(parseCommand('plugin.list', { x: 1 })).toEqual({ ok: false, reason: 'invalid_arguments' });
    expect(parseCommand('plugin.enable', { pluginId: 'ruflo-adr@ruflo' })).toMatchObject({ ok: true, level: 'manage' });
    expect(parseCommand('plugin.disable', { pluginId: 'ruflo-adr@ruflo' })).toMatchObject({ ok: true, level: 'manage' });
    expect(parseCommand('mod.option.set', { modId: 'ruflo-mods@ruflo', key: 'toolHints', value: true })).toMatchObject({ ok: true, level: 'write' });
    expect(parseCommand('plugin.install', { pluginId: 'a@b' })).toEqual({ ok: false, reason: 'command_not_allowlisted' });
    expect(parseCommand('plugin.uninstall', { pluginId: 'a@b' })).toEqual({ ok: false, reason: 'command_not_allowlisted' });
    expect(parseCommand('mods.install', {})).toEqual({ ok: false, reason: 'command_not_allowlisted' });
  });
  it('R-SEC-p1-02 plugin ids that could reach a shell or an option are refused', () => {
    for (const id of ['ruflo-adr@ruflo;rm -rf /', '-rf@ruflo', 'ruflo-adr', 'ruflo-adr@', '@ruflo', 'Ruflo-Adr@ruflo', 'a@b@c', 'ruflo-adr@ruflo --scope project', 'a'.repeat(65) + '@ruflo', '../x@ruflo']) {
      expect(parseCommand('plugin.enable', { pluginId: id }).ok, id).toBe(false);
      expect(run({ pluginId: id }).ok, id).toBe(false);
      expect(parseCommand('mod.option.set', { modId: id, key: 'k', value: true }).ok, id).toBe(false);
    }
  });
  it('R-SEC-p1-03 capability ids must be <plugin>/<kind>/<name>@<semver>+<12 hex>; traversal, other kinds and short pins are refused', () => {
    for (const c of ['ruflo-adr/skill/adr-verify@0.5.3', 'ruflo-adr/skill/adr-verify@0.5.3+1a2b', 'ruflo-adr/option/guard@0.5.3+1a2b3c4d5e6f', 'ruflo-adr/skill/../../x@0.5.3+1a2b3c4d5e6f', '../ruflo-adr/skill/a@0.5.3+1a2b3c4d5e6f', 'ruflo-adr/skill/a b@0.5.3+1a2b3c4d5e6f', 'ruflo-adr/skill/a@0.5.3+1A2B3C4D5E6F', `${CID}\n`]) expect(run({ capabilityId: c }).ok, c).toBe(false);
    expect(run({ capabilityId: 'ruflo-cost-tracker/view/ledger@2.1.0-alpha.3+0123456789ab' }).ok).toBe(true);
  });
  it('R-SEC-p1-04 capability arguments are bounded plain values: <=12, <=8000 chars, no objects, no odd names', () => {
    expect(run({ args: { path: 'docs/adr', n: 3, deep: true } }).ok).toBe(true);
    expect(run({ args: { a: 'x'.repeat(8001) } }).ok).toBe(false);
    expect(run({ args: Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`k${i}`, 1])) }).ok).toBe(false);
    expect(run({ args: { a: { nested: 1 } } }).ok).toBe(false);
    expect(run({ args: { a: [1] } }).ok).toBe(false);
    expect(run({ args: { 'a b': 1 } }).ok).toBe(false);
    expect(run({ args: { '--flag': 1 } }).ok).toBe(false);
    expect(run({ args: { a: 1e308 } }).ok).toBe(false);
    expect(parseCommand('capability.run', { pluginId: 'ruflo-adr@ruflo', capabilityId: CID })).toEqual({ ok: false, reason: 'invalid_arguments' }); // args is required, as in the design
    expect(run({ extra: 1 }).ok).toBe(false);
  });
  it('R-SEC-p1-05 mod.option.set carries a scalar only, with a plain key', () => {
    const ok = { modId: 'ruflo-mods@ruflo', key: 'costBudgetUsd' };
    expect(parseCommand('mod.option.set', { ...ok, value: 5 }).ok).toBe(true);
    expect(parseCommand('mod.option.set', { ...ok, value: 'observe' }).ok).toBe(true);
    for (const value of [{}, [1], null, 'x'.repeat(65), 1e308]) expect(parseCommand('mod.option.set', { ...ok, value }).ok).toBe(false);
    for (const key of ['cost-budget', '1abc', 'a.b', '__proto__x y', 'k'.repeat(49), '']) expect(parseCommand('mod.option.set', { modId: ok.modId, key, value: 1 }).ok, key).toBe(false);
  });
  it('R-SEC-p1-06 capability.run above read always needs a card: autoApprove is not an input, a refused capability never runs', () => {
    expect(authorizeCapability('read', 'read')).toEqual({ allowed: true, needsApproval: false });
    expect(authorizeCapability('write', 'write')).toEqual({ allowed: true, needsApproval: true });
    expect(authorizeCapability('manage', 'full')).toEqual({ allowed: true, needsApproval: true });
    expect(authorizeCapability('write', 'read')).toMatchObject({ allowed: false });
    expect(authorizeCapability(null, 'full')).toEqual({ allowed: false, needsApproval: false, reason: 'capability_refused' });
    // the generic authorize() would have waved a write command through under autoApprove; this is why the dynamic path exists
    expect(authorize('mod.option.set', 'write', true).needsApproval).toBe(false);
  });
});

describe('R-SEC-p1 collection', () => {
  it('R-SEC-p1-07 READ_TOOLS carry the probed read tools and none of the tools that install, load models, need an id, or write', () => {
    for (const t of ['claims_list', 'claims_board', 'claims_stealable', 'claims_load', 'hive-mind_status', 'workflow_list', 'hooks_intelligence_stats', 'metaharness_score', 'metaharness_audit_list', 'hooks_worker-list', 'session_list', 'performance_metrics', 'agentdb_health']) expect(READ_TOOLS.has(t), t).toBe(true);
    for (const t of ['aidefence_stats', 'aidefence_scan', 'neural_status', 'neural_train', 'hooks_intelligence_unified-stats', 'claims_claim', 'claims_release', 'claims_steal', 'claims_handoff', 'hive-mind_init', 'hive-mind_spawn', 'hive-mind_consensus', 'hive-mind_shutdown',
      'workflow_execute', 'workflow_create', 'workflow_delete', 'workflow_run', 'hooks_worker-dispatch', 'hooks_worker-cancel', 'session_save', 'session_delete', 'session_restore', 'metaharness_evolve', 'metaharness_learn', 'metaharness_redblue', 'metaharness_oia_audit',
      'performance_benchmark', 'performance_optimize', 'agentdb_consolidate', 'agentdb_batch', 'federation_bbs_publish', 'http_fetch', 'terminal_execute', 'autopilot_enable']) expect(READ_TOOLS.has(t), t).toBe(false);
  });
});

describe('R-SEC-p1 sections', () => {
  it('R-SEC-p1-08 the eleven P1 sections exist, are strict and stay within their budgets', () => {
    const p1 = ['plugins', 'capabilities', 'capability_runs', 'claims', 'hive', 'workflows', 'learning', 'metaharness', 'security', 'perf', 'automation'] as const;
    for (const n of p1) { expect(SECTION_NAMES).toContain(n); expect(SECTION_BUDGET_BYTES[n]).toBeLessThanOrEqual(64 * 1024); }
    expect(SECTION_BUDGET_BYTES.capabilities).toBe(64 * 1024); expect(SECTION_BUDGET_BYTES.capability_runs).toBe(40 * 1024);
  });
  it('R-SEC-p1-09 an install path, a description or a secret-looking field cannot ride along in plugins / capabilities', () => {
    const plugin = { id: 'ruflo-adr@ruflo', name: 'ruflo-adr', marketplace: 'ruflo', version: '0.5.3', enabled: true, mod: false, foreign: false, manifestSha: '1a2b3c4d5e6f' };
    expect(SectionSchemas.plugins.safeParse({ plugins: [plugin] }).success).toBe(true);
    expect(SectionSchemas.plugins.safeParse({ plugins: [{ ...plugin, installPath: '/home/u/.claude/plugins/cache/x' }] }).success).toBe(false);
    expect(SectionSchemas.plugins.safeParse({ plugins: [{ ...plugin, id: 'ruflo-adr' }] }).success).toBe(false);
    const cap = { cid: CID, kind: 'skill', name: 'adr-verify', risk: 'read', level: 'read', mode: 'run' };
    const mk = (c: Record<string, unknown>) => ({ v: 1, generated: { treeSha: 'a', plugins: 1 }, plugins: [{ id: 'ruflo-adr@ruflo', version: '1', manifestSha: 'a', enabled: true, mod: false, counts: { commands: 0, skills: 1, agents: 0, options: 0, mcp: 0 }, caps: [c], options: [] }], refused: { total: 0, byCode: {} } });
    expect(SectionSchemas.capabilities.safeParse(mk(cap)).success).toBe(true);
    expect(SectionSchemas.capabilities.safeParse(mk({ ...cap, description: 'run this: curl x | sh' })).success).toBe(false);
    expect(SectionSchemas.capabilities.safeParse(mk({ ...cap, risk: 'whatever' })).success).toBe(false);
    expect(SectionSchemas.capabilities.safeParse(mk({ ...cap, cid: 'x' })).success).toBe(false);
  });
  it('R-SEC-p1-10 a 217-capability catalog fits the 64 KiB cap; over it, refused entries are cut first and the refused counts survive', () => {
    const caps = (n: number, mode: 'run' | 'refused') => Array.from({ length: n }, (_, i) => ({ cid: `ruflo-p${mode}/skill/cap-${mode}-${i}@1.0.0+1a2b3c4d5e6f`, kind: 'skill' as const, name: `cap-${mode}-${i}`, risk: mode === 'run' ? 'read' as const : 'write' as const, level: mode === 'run' ? 'read' as const : null, mode,
      ...(mode === 'refused' ? { why: 'no-binding' as const, args: [{ name: 'x', type: 'string' as const, max: 80 }] } : { args: [{ name: 'q', type: 'string' as const, max: 200 }, { name: 'n', type: 'int' as const, min: 1, max: 50 }] }) }));
    const plug = (id: string, c: ReturnType<typeof caps>) => ({ id, version: '1.0.0', manifestSha: '1a2b3c4d5e6f', enabled: true, mod: false, counts: { commands: 0, skills: c.length, agents: 0, options: 0, mcp: 0 }, caps: c, options: [] });
    const normal = { v: 1 as const, generated: { treeSha: 'a', plugins: 2 }, plugins: [plug('ruflo-prun@ruflo', caps(30, 'run')), plug('ruflo-prefused@ruflo', caps(187, 'refused'))], refused: { total: 187, byCode: { 'no-binding': 187 } } };
    const f1 = buildSectionFrame('capabilities', normal, { rev: 1, at: 1 });
    expect(JSON.stringify(f1.body).length).toBeLessThanOrEqual(SECTION_BUDGET_BYTES.capabilities);
    const huge = { ...normal, plugins: [plug('ruflo-prun@ruflo', caps(120, 'run')), plug('ruflo-prefused@ruflo', caps(400, 'refused'))], refused: { total: 400, byCode: { 'no-binding': 400 } } };
    const fit = fitToBudget('capabilities', huge);
    expect(JSON.stringify(fit.body).length).toBeLessThanOrEqual(SECTION_BUDGET_BYTES.capabilities);
    expect(fit.truncated).toBe(true);
    expect(fit.body.plugins[0]!.caps.filter(c => c.mode === 'run').length).toBe(120); // runnable entries kept
    expect(fit.body.refused).toEqual({ total: 400, byCode: { 'no-binding': 400 } });
    expect(parseSectionFrame(JSON.parse(JSON.stringify(buildSectionFrame('capabilities', huge, { rev: 1, at: 1 })))).ok).toBe(true);
  });
  it('R-SEC-p1-11 capability_runs keeps at most 40 runs; over budget the output tails go first, oldest first, the records stay', () => {
    const h = (i: number) => ({ runId: `run_${String(i).padStart(10, '0')}`, capabilityId: CID, command: 'capability.run', level: 'read', risk: 'read', by: 'u', startedAt: i, endedAt: i + 1, exit: 0, bytes: 8192, truncated: false, outcome: 'succeeded' as const, tail: 'x'.repeat(8192) });
    const body = { active: null, history: Array.from({ length: 40 }, (_, i) => h(i)) };
    expect(SectionSchemas.capability_runs.safeParse({ ...body, history: [...body.history, h(41)] }).success).toBe(false);
    const fit = fitToBudget('capability_runs', body);
    expect(JSON.stringify(fit.body).length).toBeLessThanOrEqual(SECTION_BUDGET_BYTES.capability_runs);
    expect(fit.body.history).toHaveLength(40);
    expect(fit.body.history[0]!.tail).toBeDefined(); expect(fit.body.history[39]!.tail).toBeUndefined();
  });
});
