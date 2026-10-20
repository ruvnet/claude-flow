/**
 * ADR-472: the intelligence hook logs WHICH ranked entries each recall surfaced (ids, scores, ranks, the router's pick),
 * keyed by a one-way digest of the prompt. These tests run the real shipped helpers in a throwaway project.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const HELPERS = resolve(__dirname, '../.claude/helpers');
const INTEL = join(HELPERS, 'intelligence.cjs');
const HANDLER = join(HELPERS, 'hook-handler.cjs');
const PROMPT = 'please refactor the swarm coordination planner for the zebra topology';
const SHORT_SECRET_ID = 'mem-ghp_abcdefghijkl-notes';
const SECRET_ID = 'mem-sk-abcdefghijklmnopqrstuvwxyz0123456789ABCDEF-token';

let root: string;
const logPath = () => join(root, '.claude-flow', 'data', 'recall-log.jsonl');
const records = () => readFileSync(logPath(), 'utf-8').split('\n').filter(Boolean).map(line => JSON.parse(line) as Record<string, any>);

const entry = (id: string, summary: string, words: string[], pageRank: number) => ({ id, summary, content: summary, category: 'project_notes', confidence: 0.8, pageRank, accessCount: 2, words });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ruflo-472-'));
  mkdirSync(join(root, '.claude-flow', 'data'), { recursive: true });
  writeFileSync(
    join(root, '.claude-flow', 'data', 'ranked-context.json'),
    JSON.stringify({
      computedAt: new Date().toISOString(),
      entries: [
        entry('mem-swarm-planner-1', 'Swarm coordination planner notes', ['swarm', 'coordination', 'planner', 'zebra', 'topology'], 0.4),
        entry(SECRET_ID, 'Secret-looking id', ['swarm', 'planner', 'refactor', 'zebra'], 0.3),
        entry(SHORT_SECRET_ID, 'Short secret id', ['swarm', 'planner', 'zebra'], 0.2),
        entry('mem-unrelated-3', 'Cooking notes', ['pasta', 'tomato'], 0.0),
      ],
    }),
  );
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

const runIntel = (code: string, env: Record<string, string> = {}) =>
  execFileSync(process.execPath, ['-e', `const i=require(${JSON.stringify(INTEL)});${code}`], { cwd: root, env: { ...process.env, CLAUDE_PROJECT_DIR: root, ...env }, encoding: 'utf-8' });

const recallCode = (meta = '{}') => `const d=i.getContextDetailed(${JSON.stringify(PROMPT)});console.log(JSON.stringify({wrote:i.appendRecall(d,${meta}),text:d&&d.text}))`;

describe('ADR-472 recall log', () => {
  it('appends one record with ids, scores, ranks, router pick and a digest, and never the prompt text', () => {
    const out = JSON.parse(runIntel(recallCode('{sessionId:"sess-1",agent:"coder",confidence:0.8123456}')));
    const [record] = records();

    expect(out.wrote).toBe(true)
    expect(records()).toHaveLength(1)
    expect(record?.v).toBe(1)
    expect(record?.sid).toBe('sess-1')
    expect(record?.digest).toBe(createHash('sha256').update(PROMPT).digest('hex').slice(0, 16))
    expect(record?.surfaced.map((s: any) => s.rank)).toEqual([1, 2, 3])
    expect(record?.surfaced[0].id).toBe('mem-swarm-planner-1')
    expect(record?.surfaced[0].score).toBeGreaterThan(0.05)
    expect(record?.router).toEqual({ agent: 'coder', confidence: 0.812 })
    expect(record?.at).toBeGreaterThan(1_700_000_000_000)

    const raw = readFileSync(logPath(), 'utf-8');

    for (const word of ['refactor', 'zebra', 'coordination planner', 'Swarm coordination planner notes']) expect(raw).not.toContain(word);
  });

  it('masks a credential-shaped id and writes null for a missing session id', () => {
    runIntel(recallCode());
    const raw = readFileSync(logPath(), 'utf-8');

    expect(raw).not.toContain('sk-abcdefghijklmnop');
    expect(raw).not.toContain('ghp_abcdefghijkl');
    expect(raw).toContain('[masked]');
    expect(records()[0]?.sid).toBeNull();
    expect(records()[0]?.router).toBeUndefined();
  });

  it('leaves getContext printing exactly the text getContextDetailed returns', () => {
    const detailed = JSON.parse(runIntel(recallCode())).text;
    const plain = runIntel(`console.log(JSON.stringify(i.getContext(${JSON.stringify(PROMPT)})))`);

    expect(JSON.parse(plain)).toBe(detailed);
  });

  it('is off with RUFLO_RECALL_LOG=0 and with recallLog.enabled=false in claude-flow.config.json, on otherwise', () => {
    expect(JSON.parse(runIntel(recallCode(), { RUFLO_RECALL_LOG: '0' })).wrote).toBe(false);
    expect(existsSync(logPath())).toBe(false);

    writeFileSync(join(root, 'claude-flow.config.json'), JSON.stringify({ recallLog: { enabled: false } }));
    expect(JSON.parse(runIntel(recallCode())).wrote).toBe(false);
    expect(existsSync(logPath())).toBe(false);
    // the env var wins over the file: an explicit "on" re-enables it
    expect(JSON.parse(runIntel(recallCode(), { RUFLO_RECALL_LOG: '1' })).wrote).toBe(true);

    rmSync(join(root, 'claude-flow.config.json'));
    rmSync(logPath());
    expect(JSON.parse(runIntel(recallCode())).wrote).toBe(true);
  });

  it('writes nothing when nothing surfaced, and never throws on a bad record', () => {
    const out = runIntel(`console.log(JSON.stringify([i.appendRecall(null,{}),i.appendRecall({surfaced:[]},{}),i.appendRecall({surfaced:[{id:null,score:NaN,rank:1}],digest:'d'},{})]))`);

    expect(JSON.parse(out)).toEqual([false, false, true]);
    expect(records()).toHaveLength(1);
  });

  it('rotates by record count: past the cap the newest half is kept', () => {
    const line = (n: number) => JSON.stringify({ v: 1, at: 1_800_000_000_000 + n, sid: null, digest: `d${n}`, surfaced: [{ id: `x${n}`, score: 0.5, rank: 1, cat: 'c' }] });

    writeFileSync(logPath(), Array.from({ length: 1100 }, (_, n) => line(n)).join('\n') + '\n');
    runIntel(recallCode());
    const kept = records();

    expect(kept.length).toBeLessThanOrEqual(501);
    expect(kept.length).toBeGreaterThan(400);
    expect(kept[0]?.digest).toBe('d600');
    expect(kept.at(-1)?.surfaced[0].id).toBe('mem-swarm-planner-1');
  });

  it('rotates by bytes too: a log over 1 MB is cut', () => {
    const fat = JSON.stringify({ v: 1, at: 1, sid: null, digest: 'f', surfaced: [{ id: 'y'.repeat(70), score: 0.1, rank: 1, cat: 'c'.repeat(40) }], pad: 'p'.repeat(5000) });

    writeFileSync(logPath(), Array.from({ length: 300 }, () => fat).join('\n') + '\n');
    runIntel(recallCode());
    expect(readFileSync(logPath(), 'utf-8').length).toBeLessThan(1024 * 1024);
    expect(records().length).toBeLessThanOrEqual(501);
  });

  it('hook-handler route: one record per prompt with the stdin session id and the router pick; the printed context is unchanged', () => {
    const run = (env: Record<string, string> = {}) =>
      execFileSync(process.execPath, [HANDLER, 'route'], { cwd: root, input: JSON.stringify({ prompt: PROMPT, session_id: 'abc-123' }), env: { ...process.env, CLAUDE_PROJECT_DIR: root, RUFLO_FUNNEL: '0', RUFLO_MODS_OWNS: '', ...env }, encoding: 'utf-8' });
    const out = run();

    expect(out).toContain('[INTELLIGENCE] Relevant patterns for this task:');
    expect(records()).toHaveLength(1);
    expect(records()[0]?.sid).toBe('abc-123');
    expect(typeof records()[0]?.router?.agent).toBe('string');

    const off = run({ RUFLO_RECALL_LOG: 'off' });

    expect(off).toContain('[INTELLIGENCE]');
    expect(records()).toHaveLength(1);
  });
});
