/**
 * ADR-406 M0 exit gate — state replay, torn-tail repair, chain tamper
 * detection, and a real SIGKILL of a writer process mid-stream.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { MissionService, MissionStore, parseLog, replay } from '../../src/missions/index.js';
import { plan } from './helpers.js';

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'ruflo-missions-store-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

async function seeded(): Promise<{ service: MissionService; store: MissionStore; missionId: string; revision: number }> {
  const service = new MissionService({ projectRoot: root, channel: 'cli' });
  const c = await service.create({ requestId: 'r1', objective: 'replay me' });
  if (!c.ok) throw new Error(c.message);
  const p = await service.plan({ requestId: 'r2', missionId: c.data.missionId, expectedRevision: 1, plan: plan() });
  if (!p.ok) throw new Error(p.message);
  return { service, store: new MissionStore(root), missionId: c.data.missionId, revision: p.data.revision };
}

describe('mission store', () => {
  it('snapshot + tail and full replay reconstruct the same state', async () => {
    const { service, store, missionId } = await seeded();
    const r = await service.requestAction({ requestId: 'r3', missionId, expectedRevision: 2, action: 'requestAuthorization' });
    expect(r.ok).toBe(true);
    const log = store.readLog(missionId);
    const fromSnapshot = store.loadView(missionId, log);
    const full = replay(log.events);
    expect(JSON.parse(JSON.stringify(fromSnapshot))).toEqual(JSON.parse(JSON.stringify(full)));
    // A stale snapshot (older sequence) is still a valid base: tail is folded on top.
    const snapPath = join(store.missionDir(missionId), 'snapshot.json');
    store.writeSnapshot(missionId, replay(log.events.slice(0, 1))!);
    expect(JSON.parse(JSON.stringify(store.loadView(missionId)))).toEqual(JSON.parse(JSON.stringify(full)));
    // A snapshot that disagrees with the log is ignored, never trusted.
    const forged = JSON.parse(readFileSync(snapPath, 'utf8'));
    forged.view.record.state = 'completed';
    forged.hash = 'sha256:'.padEnd(71, '1');
    writeFileSync(snapPath, JSON.stringify(forged));
    expect(store.loadView(missionId)!.record.state).toBe('awaitingAuthorization');
  });

  it('ignores a torn final line and the next locked writer truncates it', async () => {
    const { service, store, missionId, revision } = await seeded();
    const logPath = join(store.missionDir(missionId), 'events.jsonl');
    const goodSize = store.logSize(missionId);
    appendFileSync(logPath, '{"contract":"ruflo.mission-event/1","seq":3,"type":"plan.rev');
    expect(store.readLog(missionId).tornTail).toBe(true);
    expect(store.loadView(missionId)!.record.revision).toBe(revision);
    const r = await service.requestAction({ requestId: 'after-tear', missionId, expectedRevision: revision, action: 'requestAuthorization' });
    expect(r.ok).toBe(true);
    const log = store.readLog(missionId);
    expect(log.tornTail).toBe(false);
    expect(log.events.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(store.logSize(missionId)).toBeGreaterThan(goodSize);
  });

  it('a modified middle event breaks the hash chain and is refused', async () => {
    const { service, store, missionId } = await seeded();
    const logPath = join(store.missionDir(missionId), 'events.jsonl');
    const lines = readFileSync(logPath, 'utf8').trimEnd().split('\n');
    const first = JSON.parse(lines[0]);
    first.payload.objective = 'rewritten history';
    lines[0] = JSON.stringify(first);
    writeFileSync(logPath, `${lines.join('\n')}\n`);
    rmSync(join(store.missionDir(missionId), 'snapshot.json'));
    expect(() => store.loadView(missionId)).toThrow(/hash mismatch/);
    const ev = await service.events({ missionId });
    expect(ev.ok).toBe(false);
    expect(() => parseLog(Buffer.from('not json\n'))).toThrow(/mission-log-corrupt/);
  });

  it('survives SIGKILL of a writer mid-stream: state reconstructs and the next writer continues', async () => {
    const child = spawn(process.execPath, ['--import', 'tsx', resolve(__dirname, 'kill-writer.ts'), root], {
      cwd: resolve(__dirname, '../..'), stdio: ['ignore', 'pipe', 'pipe'],
    });
    let missionId = '';
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += String(d); });
    await new Promise<void>((done, fail) => {
      child.stdout.on('data', (d) => { const m = String(d).match(/ready (msn_[a-f0-9]{24})/); if (m) { missionId = m[1]; done(); } });
      child.on('exit', (code) => fail(new Error(`writer exited early (${code}): ${stderr}`)));
    });
    const store = new MissionStore(root);
    const deadline = Date.now() + 20_000;
    while (store.readLog(missionId).events.length < 25 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
    child.kill('SIGKILL');
    await new Promise((r) => child.on('exit', r));

    const log = store.readLog(missionId);
    expect(log.events.length).toBeGreaterThanOrEqual(25);
    const view = store.loadView(missionId, log)!;
    expect(JSON.parse(JSON.stringify(view))).toEqual(JSON.parse(JSON.stringify(replay(log.events))));
    expect(view.record.lastEventSequence).toBe(log.events.length);
    // The killed writer may have died holding the lock; a new writer recovers it.
    const service = new MissionService({ projectRoot: root, channel: 'mcp' });
    const r = await service.plan({ requestId: 'after-kill', missionId, expectedRevision: view.record.revision, plan: plan({ budget: { currency: 'USD', ceilingMinor: 99_999 } }) });
    expect(r.ok).toBe(true);
    expect(store.readLog(missionId).tornTail).toBe(false);
    expect(existsSync(join(root, '.claude-flow', 'missions', 'observation.json'))).toBe(true);
  }, 60_000);
});
