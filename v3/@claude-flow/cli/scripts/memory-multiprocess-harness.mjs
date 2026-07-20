#!/usr/bin/env node
/**
 * Real multi-process memory durability harness — 2026-07-18 corruption incident.
 *
 * Proves the writer-ownership contract in the topology that actually corrupted
 * production: one workspace daemon + multiple REAL MCP server OS processes +
 * per-invocation CLI writers (the Stop-hook shape), all sharing one
 * .swarm/memory.db, plus failure injection (client SIGKILL mid-write, daemon
 * restart). Concurrent promises inside one process prove nothing about
 * cross-process WAL behavior — every actor here is a separate OS process.
 *
 * Gates verified at the end (numbers from the incident's acceptance list):
 *   15/16/17 — mixed workload completes; every acknowledged write present;
 *              no duplicate or lost keys
 *   18/19    — memory.db inode NEVER changes (single generation; no process
 *              attached to an obsolete generation)
 *   20/21    — DB/WAL/SHM coherent; quick_check AND integrity_check ok
 *   22       — HNSW metadata reconciles with SQL (no orphan ids)
 *   23/24    — SIGKILL an MCP client mid-write; SIGTERM+restart the daemon;
 *              no acknowledged write disappears either way
 *   29       — no whole-image swap artifacts (".tmp-", ".recovering-", ".restoring-")
 *
 * Usage: node scripts/memory-multiprocess-harness.mjs [--keep] [--workspace <dir>]
 * Exits 0 only if every gate passes; prints a JSON report either way.
 */
import { spawn, execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, '..', 'bin', 'cli.js');
const NODE = process.execPath;

const args = process.argv.slice(2);
const KEEP = args.includes('--keep');
const wsArg = args.indexOf('--workspace');
const WS = wsArg >= 0 ? path.resolve(args[wsArg + 1]) : fs.mkdtempSync(path.join(os.tmpdir(), 'mem-harness-'));
const DB = path.join(WS, '.swarm', 'memory.db');

const report = { workspace: WS, gates: {}, counts: {}, failures: [] };
const gate = (name, ok, detail) => {
  report.gates[name] = { ok, detail };
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) report.failures.push(name);
};

// ---------- helpers ----------

function cliSync(argv, opts = {}) {
  return execFileSync(NODE, [CLI, ...argv], {
    cwd: WS, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120_000, ...opts,
  });
}

/** Minimal newline-JSON-RPC client over a spawned `mcp start` process. */
class McpClient {
  constructor(label) {
    this.label = label;
    this.nextId = 1;
    this.pending = new Map();
    this.proc = spawn(NODE, [CLI, 'mcp', 'start'], {
      cwd: WS, stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.buffer = '';
    this.proc.stdout.on('data', (d) => {
      this.buffer += d.toString();
      const lines = this.buffer.split('\n');
      this.buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          const { resolve } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          resolve(msg);
        }
      }
    });
    this.proc.stderr.on('data', () => {});
  }

  request(method, params, timeoutMs = 60_000) {
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${this.label}: ${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve: (m) => { clearTimeout(timer); resolve(m); } });
      this.proc.stdin.write(payload);
    });
  }

  async initialize() {
    const res = await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: `harness-${this.label}`, version: '1.0.0' },
    });
    if (!res.result) throw new Error(`${this.label}: initialize failed: ${JSON.stringify(res.error)}`);
    this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    return res.result;
  }

  async callTool(name, args, timeoutMs = 60_000) {
    const res = await this.request('tools/call', { name, arguments: args }, timeoutMs);
    if (res.error) throw new Error(`${this.label}: ${name} → ${res.error.message}`);
    const content = res.result?.content?.[0]?.text ?? '';
    let parsed = null;
    try { parsed = JSON.parse(content); } catch { /* non-JSON tool output */ }
    return { raw: res.result, parsed, text: content };
  }

  end() { try { this.proc.stdin.end(); } catch { /* */ } }
  kill(sig = 'SIGKILL') { try { this.proc.kill(sig); } catch { /* */ } }
}

const inodeOf = (p) => fs.statSync(p).ino;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Continuous generation watcher: polling stat() at two instants cannot rule
 * out an even number of rename-swaps (freed inode numbers get reused — the
 * live incident showed the DB alternating between two inodes). Poll fast and
 * also record every file that ever appears in .swarm, so a tmp+rename that
 * completes between stat()s still leaves a trace.
 */
function watchGeneration(dbPath) {
  const events = [];
  let last = null;
  const timer = setInterval(() => {
    try {
      const ino = fs.statSync(dbPath).ino;
      if (last !== null && ino !== last) {
        events.push({ t: new Date().toISOString(), kind: 'inode-change', from: last, to: ino });
      }
      last = ino;
    } catch { /* transiently absent = a swap in progress */ }
  }, 20);
  let watcher = null;
  try {
    watcher = fs.watch(path.dirname(dbPath), (ev, name) => {
      if (name && /\.tmp-|\.recovering-|\.restoring-|\.corrupt-/.test(name)) {
        events.push({ t: new Date().toISOString(), kind: 'artifact', name, ev });
      }
    });
  } catch { /* fs.watch unavailable — poller still covers inode changes */ }
  return {
    events,
    stop() { clearInterval(timer); try { watcher?.close(); } catch { /* */ } },
  };
}

/** Interim integrity probe — WAL-mode readers snapshot safely under writers. */
function integritySnapshot(Database, dbPath, label, phases) {
  try {
    const db = new Database(dbPath);
    db.pragma('busy_timeout = 10000');
    const quick = String(db.pragma('quick_check', { simple: true }) ?? '');
    db.close();
    phases.push({ label, quick: quick === 'ok' ? 'ok' : quick.split('\n').slice(0, 3).join(' | ') });
    console.log(`  [integrity @ ${label}] ${quick === 'ok' ? 'ok' : 'CORRUPT: ' + quick.split('\n')[0]}`);
    return quick === 'ok';
  } catch (e) {
    phases.push({ label, quick: `probe-error: ${e.message}` });
    console.log(`  [integrity @ ${label}] probe error: ${e.message}`);
    return false;
  }
}

async function main() {
  // ---------- Phase 0: fixture ----------
  fs.mkdirSync(path.join(WS, '.swarm'), { recursive: true });
  cliSync(['memory', 'init']);
  if (!fs.existsSync(DB)) throw new Error('memory init produced no DB');
  const inode0 = inodeOf(DB);
  console.log(`workspace ${WS} — memory.db inode ${inode0}`);
  const requireSqlite0 = (await import('node:module')).createRequire(import.meta.url);
  const DatabaseProbe = requireSqlite0(path.join(HERE, '..', 'node_modules', 'better-sqlite3'));
  const phases = [];
  report.integrityPhases = phases;
  const genWatch = watchGeneration(DB);
  report.generationEvents = genWatch.events;
  integritySnapshot(DatabaseProbe, DB, 'after-init', phases);

  // ---------- Phase 1: daemon ----------
  const daemon1 = spawn(NODE, [CLI, 'daemon', 'start', '--foreground', '--quiet', '--workspace', WS], {
    cwd: WS, stdio: 'ignore',
  });
  await sleep(1500);
  integritySnapshot(DatabaseProbe, DB, 'after-daemon-start', phases);

  // ---------- Phase 2: two real MCP server processes ----------
  const A = new McpClient('A');
  const B = new McpClient('B');
  await A.initialize();
  await B.initialize();

  const tools = await A.request('tools/list', {});
  const toolNames = (tools.result?.tools ?? []).map(t => t.name);
  const need = ['memory_store', 'memory_retrieve', 'memory_search', 'memory_delete'];
  const missing = need.filter(n => !toolNames.includes(n));
  if (missing.length) throw new Error(`MCP servers lack tools: ${missing.join(', ')} (have ${toolNames.length})`);
  integritySnapshot(DatabaseProbe, DB, 'after-mcp-init', phases);

  // ---------- Phase 3: mixed concurrent workload ----------
  const acked = [];   // { actor, ns, key, value }
  const deleted = []; // { ns, key }

  // STRICT ack: only a parsed `success: true` counts. (Substring matching once
  // recorded `"success": false` duplicate-key refusals as acks and produced
  // phantom "lost write" verdicts — the ledger must never be looser than the
  // protocol.)
  const storeVia = async (client, ns, key, value) => {
    const r = await client.callTool('memory_store', { key, value, namespace: ns });
    const ok = r.parsed?.success === true || r.parsed?.stored === true;
    if (ok) acked.push({ actor: client.label, ns, key, value });
    return ok;
  };

  const workloadA = (async () => {
    for (let i = 0; i < 30; i++) await storeVia(A, 'mcpA', `a-key-${i}`, `a-val-${i}`);
    for (let i = 0; i < 5; i++) {
      await A.callTool('memory_delete', { key: `a-key-${i}`, namespace: 'mcpA' });
      deleted.push({ ns: 'mcpA', key: `a-key-${i}` });
    }
    for (let i = 0; i < 5; i++) await A.callTool('memory_search', { query: 'a-val', namespace: 'mcpA', limit: 5 });
  })();

  const dupRefusals = [];
  const workloadB = (async () => {
    for (let i = 0; i < 30; i++) await storeVia(B, 'mcpB', `b-key-${i}`, `b-val-${i}`);
    // The MCP memory_store refuses duplicate keys (no upsert semantics); the
    // refusal must be explicit (success:false) and must not touch the row.
    for (let i = 0; i < 5; i++) {
      const r = await B.callTool('memory_store', { key: `b-key-${i}`, value: `b-val-${i}-updated`, namespace: 'mcpB' });
      dupRefusals.push(r.parsed?.success === false);
    }
    for (let i = 0; i < 5; i++) await B.callTool('memory_retrieve', { key: `b-key-${i}`, namespace: 'mcpB' });
  })();

  const workloadCli = (async () => {
    for (let i = 0; i < 15; i++) {
      try {
        cliSync(['memory', 'store', '--namespace', 'cli', '--key', `cli-key-${i}`, '--value', `cli-val-${i}`]);
        acked.push({ actor: 'cli', ns: 'cli', key: `cli-key-${i}`, value: `cli-val-${i}` });
      } catch (e) {
        report.counts.cliStoreFailures = (report.counts.cliStoreFailures ?? 0) + 1;
      }
    }
    // CLI storeEntry defaults to upsert — same key again must UPDATE in place.
    try {
      cliSync(['memory', 'store', '--namespace', 'cli', '--key', 'cli-key-0', '--value', 'cli-val-0-updated']);
      const idx = acked.findIndex(a => a.ns === 'cli' && a.key === 'cli-key-0');
      if (idx >= 0) acked[idx] = { actor: 'cli', ns: 'cli', key: 'cli-key-0', value: 'cli-val-0-updated' };
    } catch { report.counts.cliUpsertFailed = true; }
  })();

  // Gate 26: an online backup taken WHILE the writers run must itself verify.
  // Runs in its own OS process (like the daemon backup worker), via the same
  // backupMemoryDb implementation.
  const backupDuring = (async () => {
    await sleep(400); // land mid-workload
    const script = `
      const { backupMemoryDb } = await import(${JSON.stringify('file://' + path.join(HERE, '..', 'dist', 'src', 'services', 'memory-backup.js'))});
      const r = await backupMemoryDb({ dbPath: ${JSON.stringify(DB)} });
      console.log(JSON.stringify(r));
    `;
    return new Promise((resolve) => {
      const p = spawn(NODE, ['--input-type=module', '-e', script], { cwd: WS, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      p.stdout.on('data', d => { out += d.toString(); });
      p.on('exit', () => { try { resolve(JSON.parse(out.trim().split('\n').pop())); } catch { resolve(null); } });
      setTimeout(() => { try { p.kill('SIGKILL'); } catch { /* */ } resolve(null); }, 60_000);
    });
  })();

  // Bisection mode: run the three writer populations one at a time with an
  // integrity probe between each, so a corrupting actor is named, not guessed.
  if (args.includes('--bisect')) {
    await workloadA;
    integritySnapshot(DatabaseProbe, DB, 'after-workload-A', phases);
    await workloadB;
    integritySnapshot(DatabaseProbe, DB, 'after-workload-B', phases);
    await workloadCli;
    integritySnapshot(DatabaseProbe, DB, 'after-workload-CLI', phases);
  } else {
    await Promise.all([workloadA, workloadB, workloadCli]);
    integritySnapshot(DatabaseProbe, DB, 'after-concurrent-workload', phases);
  }

  // ---------- Phase 4a: SIGKILL an MCP client mid-write (gate 23) ----------
  const C = new McpClient('C');
  await C.initialize();
  await storeVia(C, 'mcpC', 'c-acked-before-kill', 'c-val');       // acknowledged — must survive
  C.callTool('memory_store', { key: 'c-inflight', value: 'x', namespace: 'mcpC' }).catch(() => {});
  await sleep(20);                                                  // let the write get in flight
  C.kill('SIGKILL');                                                // die mid-operation
  integritySnapshot(DatabaseProbe, DB, 'after-sigkill-C', phases);

  // ---------- Phase 4b: daemon restart across acknowledged ops (gate 24) ----------
  daemon1.kill('SIGTERM');
  await sleep(800);
  const daemon2 = spawn(NODE, [CLI, 'daemon', 'start', '--foreground', '--quiet', '--workspace', WS], {
    cwd: WS, stdio: 'ignore',
  });
  await sleep(1200);
  integritySnapshot(DatabaseProbe, DB, 'after-daemon-restart', phases);
  await storeVia(A, 'mcpA', 'post-daemon-restart', 'still-writing'); // system keeps working
  const postRestartAcked = acked[acked.length - 1]?.key === 'post-daemon-restart';
  console.log(`  post-restart store acked: ${postRestartAcked}`);

  // Gates 34/35: health must separate read availability from write readiness
  // and offer a real CRUD-roundtrip readiness proof.
  let healthResult = null;
  try {
    const hr = await A.callTool('agentdb_health', { probe: 'rw' }, 90_000);
    healthResult = hr.parsed;
  } catch (e) {
    healthResult = { error: String(e.message) };
  }

  // ---------- Phase 5: orderly teardown ----------
  A.end(); B.end();
  await sleep(1200);
  A.kill('SIGTERM'); B.kill('SIGTERM');
  daemon2.kill('SIGTERM');
  await sleep(800);

  // ---------- Phase 6: verification with a fresh native connection ----------
  genWatch.stop();
  const inodeEnd = inodeOf(DB);
  const genEvents = genWatch.events.filter(e => e.kind === 'inode-change');
  gate('18/19 single-generation inode', inodeEnd === inode0 && genEvents.length === 0,
    `start=${inode0} end=${inodeEnd} changes-observed=${genEvents.length}`);

  const swapDroppings = fs.readdirSync(path.join(WS, '.swarm'))
    .filter(f => /\.tmp-|\.recovering-|\.restoring-/.test(f));
  gate('29 no whole-image swap artifacts', swapDroppings.length === 0, swapDroppings.join(', ') || 'clean');

  const requireSqlite = (await import('node:module')).createRequire(import.meta.url);
  const Database = requireSqlite(path.join(HERE, '..', 'node_modules', 'better-sqlite3'));
  const db = new Database(DB, { readonly: true });
  const quick = db.pragma('quick_check', { simple: true });
  const integ = db.pragma('integrity_check', { simple: true });
  gate('20/21 native integrity', quick === 'ok' && integ === 'ok', `quick=${quick} integrity=${integ}`);

  const deletedSet = new Set(deleted.map(d => `${d.ns} ${d.key}`));
  const expected = acked.filter(a => !deletedSet.has(`${a.ns} ${a.key}`));
  const lost = [];
  for (const e of expected) {
    const row = db.prepare('SELECT content FROM memory_entries WHERE namespace=? AND key=?').get(e.ns, e.key);
    if (!row) lost.push(`${e.ns}/${e.key}`);
  }
  gate('16 every acknowledged write present', lost.length === 0,
    lost.length ? `LOST: ${lost.slice(0, 10).join(', ')}${lost.length > 10 ? '…' : ''}` : `${expected.length} rows verified`);

  const stillDeleted = deleted.filter(d =>
    db.prepare('SELECT 1 FROM memory_entries WHERE namespace=? AND key=? AND status != ?').get(d.ns, d.key, 'deleted'));
  gate('12/13 deletes effective', stillDeleted.length === 0,
    stillDeleted.length ? `resurrected: ${stillDeleted.map(d => d.key).join(',')}` : `${deleted.length} deletions verified`);

  const dups = db.prepare(
    'SELECT namespace, key, COUNT(*) c FROM memory_entries GROUP BY namespace, key HAVING c > 1').all();
  gate('17 no duplicate keys', dups.length === 0, dups.length ? JSON.stringify(dups.slice(0, 5)) : 'unique');

  const dupRow = db.prepare('SELECT content FROM memory_entries WHERE namespace=? AND key=?').get('mcpB', 'b-key-0');
  const mcpDupOk = dupRefusals.length === 5 && dupRefusals.every(Boolean)
    && !!dupRow && String(dupRow.content) === 'b-val-0';
  const upRow = db.prepare('SELECT content FROM memory_entries WHERE namespace=? AND key=?').get('cli', 'cli-key-0');
  const cliUpsertOk = !!upRow && String(upRow.content) === 'cli-val-0-updated';
  gate('11 update behavior', mcpDupOk && cliUpsertOk,
    `mcp-dup-refusals=${dupRefusals.filter(Boolean).length}/5 row=${dupRow ? dupRow.content : 'missing'}; cli-upsert=${upRow ? upRow.content : 'missing'}`);

  // HNSW ↔ SQL reconciliation (soft when no embeddings were generated)
  const metaPath = path.join(WS, '.swarm', 'hnsw.metadata.json');
  if (fs.existsSync(metaPath)) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      const metaIds = new Set(meta.map(e => e[0]));
      const sqlIds = new Set(db.prepare('SELECT id FROM memory_entries').all().map(r => r.id));
      const orphans = [...metaIds].filter(id => !sqlIds.has(id));
      gate('22 HNSW has no orphan ids', orphans.length === 0,
        orphans.length ? `orphans: ${orphans.slice(0, 5).join(',')}` : `${metaIds.size} indexed / ${sqlIds.size} rows`);
    } catch (e) {
      gate('22 HNSW has no orphan ids', false, `metadata unreadable: ${e.message}`);
    }
  } else {
    gate('22 HNSW has no orphan ids', true, 'no HNSW metadata produced (no embeddings in run)');
  }

  const backupResult = await backupDuring;
  const backupFile = backupResult?.path ?? backupResult?.backupPath;
  if (backupResult?.backedUp && backupFile && fs.existsSync(backupFile)) {
    let bq = '';
    try {
      const bdb = new Database(backupFile, { readonly: true });
      bq = String(bdb.pragma('quick_check', { simple: true }));
      bdb.close();
    } catch (e) { bq = `ERR ${e.message}`; }
    gate('26 online backup during concurrency verifies', bq === 'ok', `${path.basename(backupFile)} quick=${bq}`);
  } else {
    gate('26 online backup during concurrency verifies', false, `backup did not run: ${JSON.stringify(backupResult)}`);
  }

  const st = healthResult?.storage;
  gate('34 health separates read/write readiness', st?.integrity === 'ok' && st?.writeReady === true,
    st ? `integrity=${String(st.integrity).slice(0, 60)} writeReady=${st.writeReady}` : JSON.stringify(healthResult)?.slice(0, 120));
  const rwp = healthResult?.rwProbe;
  gate('35 real CRUD roundtrip in readiness proof', rwp?.stored === true && rwp?.retrieved === true && rwp?.deleted === true,
    rwp ? `stored=${rwp.stored} retrieved=${rwp.retrieved} deleted=${rwp.deleted}` : 'no rwProbe in health result');

  report.counts.acked = acked.length;
  report.counts.deleted = deleted.length;
  db.close();

  // ---------- report ----------
  console.log('\n' + JSON.stringify(report, null, 2));
  if (!KEEP) { try { fs.rmSync(WS, { recursive: true, force: true }); } catch { /* */ } }
  process.exit(report.failures.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('HARNESS ERROR:', e);
  console.log(JSON.stringify(report, null, 2));
  process.exit(2);
});
