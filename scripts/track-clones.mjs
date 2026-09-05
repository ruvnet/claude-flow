#!/usr/bin/env node
/**
 * Clone tracker — fetches 14-day GitHub clone numbers for the ruflo
 * ecosystem repos and appends a snapshot to `data/clone-data.rvf`
 * (a RuVector RVF vector store).
 *
 * Scheduled by `.github/workflows/clone-tracker.yml` every ~13 days,
 * which is just inside GitHub's 14-day clone-data retention window.
 *
 * Each snapshot is a 10-dimensional vector:
 *   [ruflo_clones,      ruflo_uniques,
 *    agentdb_clones,    agentdb_uniques,
 *    agentic_clones,    agentic_uniques,
 *    ruvector_clones,   ruvector_uniques,
 *    ruv-FANN_clones,   ruv-FANN_uniques]
 *
 * Vector ID: `<ISO-date>-<run-id>`.
 * Metadata: full per-repo breakdown JSON + npm download totals at the
 * time of the snapshot.
 *
 * Why a vector store and not just JSON?  The RVF lets us answer
 * "find the days in history whose traffic pattern most resembles
 * today" via `query()`, which is the more useful question than
 * "what was the count on date X" for understanding cyclic / event-
 * driven growth.  A parallel `data/clone-data.ledger.json` is also
 * written so the raw chronology is human-readable in PR reviews.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve as path_resolve, dirname as path_dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path_dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path_resolve(__dirname, '..');
const DATA_DIR = path_resolve(REPO_ROOT, 'data');
const RVF_PATH = path_resolve(DATA_DIR, 'clone-data.rvf');
const LEDGER_PATH = path_resolve(DATA_DIR, 'clone-data.ledger.json');
const PROOF_PATH = path_resolve(DATA_DIR, 'clone-data.proof.json');

const REPOS = [
  'ruvnet/ruflo',
  'ruvnet/agentdb',
  'ruvnet/agentic-flow',
  'ruvnet/ruvector',
  'ruvnet/ruv-FANN',
];

const NPM_PKGS_HEADLINE = [
  'claude-flow',
  'ruflo',
  '@claude-flow/cli',
  '@claude-flow/memory',
  'agentdb',
  'agentic-flow',
];

// ============================================================
// Collection
// ============================================================

function fetchClones(repo) {
  try {
    // Use execFileSync with array args — repo name is program-controlled but
    // array form prevents accidental shell metacharacter expansion (CWE-78).
    const out = execFileSync('gh', ['api', `repos/${repo}/traffic/clones`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const j = JSON.parse(out);
    return { count: j.count ?? 0, uniques: j.uniques ?? 0, days: j.clones ?? [] };
  } catch (err) {
    console.error(`  [warn] failed to fetch clones for ${repo}: ${err.message?.slice(0, 80)}`);
    return { count: 0, uniques: 0, days: [], error: 'fetch-failed' };
  }
}

async function fetchNpmDownloads(pkg) {
  try {
    const r = await fetch(`https://api.npmjs.org/downloads/range/last-year/${encodeURIComponent(pkg)}`);
    if (!r.ok) return 0;
    const j = await r.json();
    return (j.downloads || []).reduce((a, b) => a + b.downloads, 0);
  } catch {
    return 0;
  }
}

// ============================================================
// RVF + Ledger I/O
// ============================================================

async function loadOrCreateRvf() {
  const rvfModule = await import('@ruvector/rvf').catch((err) => {
    console.error(`  [warn] @ruvector/rvf import failed: ${err.message?.slice(0, 80)}`);
    console.error('  [warn] Falling back to JSON ledger only; RVF write skipped.');
    return null;
  });
  if (!rvfModule) return null;

  const { RvfDatabase } = rvfModule;
  const dimensions = 10; // 5 repos × {count, uniques}

  if (existsSync(RVF_PATH)) {
    return RvfDatabase.open(RVF_PATH).catch(async (err) => {
      console.error(`  [warn] could not open existing RVF (${err.message?.slice(0, 60)}); recreating`);
      return RvfDatabase.create(RVF_PATH, { dimensions });
    });
  }
  return RvfDatabase.create(RVF_PATH, { dimensions });
}

function readLedger() {
  if (!existsSync(LEDGER_PATH)) {
    return {
      schema: 'ruflo-clone-tracker-ledger/v1',
      created_at: new Date().toISOString(),
      repos: REPOS,
      vector_layout: [
        'ruflo_clones', 'ruflo_uniques',
        'agentdb_clones', 'agentdb_uniques',
        'agentic_flow_clones', 'agentic_flow_uniques',
        'ruvector_clones', 'ruvector_uniques',
        'ruv_FANN_clones', 'ruv_FANN_uniques',
      ],
      snapshots: [],
    };
  }
  return JSON.parse(readFileSync(LEDGER_PATH, 'utf8'));
}

function writeLedger(ledger) {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2) + '\n');
}

// ============================================================
// Main
// ============================================================

async function main() {
  mkdirSync(DATA_DIR, { recursive: true });

  console.error('--- fetching GitHub clones (last 14 days) ---');
  const clones = {};
  const vector = [];
  for (const repo of REPOS) {
    const c = fetchClones(repo);
    clones[repo] = c;
    vector.push(c.count, c.uniques);
    console.error(`  ${repo.padEnd(24)} count=${String(c.count).padStart(8)}  uniques=${String(c.uniques).padStart(6)}`);
  }

  console.error('--- fetching npm download totals (last year, headline pkgs) ---');
  const npm = {};
  for (const pkg of NPM_PKGS_HEADLINE) {
    npm[pkg] = await fetchNpmDownloads(pkg);
    console.error(`  ${pkg.padEnd(22)} ${npm[pkg].toLocaleString().padStart(12)}`);
    await new Promise((r) => setTimeout(r, 350));
  }
  const npmHeadlineTotal = Object.values(npm).reduce((a, b) => a + b, 0);

  const now = new Date().toISOString();
  const runId = createHash('sha256').update(now).digest('hex').slice(0, 8);
  const snapshotId = `${now}-${runId}`;

  const totalClones = REPOS.reduce((a, r) => a + clones[r].count, 0);
  const totalUniques = REPOS.reduce((a, r) => a + clones[r].uniques, 0);

  console.error('');
  console.error('=== snapshot summary ===');
  console.error(`  snapshot_id:     ${snapshotId}`);
  console.error(`  total_clones:    ${totalClones.toLocaleString()}`);
  console.error(`  total_uniques:   ${totalUniques.toLocaleString()}`);
  console.error(`  npm_headline:    ${npmHeadlineTotal.toLocaleString()}`);

  // ---- Append to ledger (JSON, append-only chronology) ----
  const ledger = readLedger();
  ledger.snapshots.push({
    id: snapshotId,
    captured_at: now,
    vector,
    totals: { clones: totalClones, uniques: totalUniques },
    repos: clones,
    npm_headline_total: npmHeadlineTotal,
    npm: npm,
  });
  ledger.updated_at = now;
  ledger.snapshot_count = ledger.snapshots.length;
  writeLedger(ledger);
  console.error(`  ledger:          ${LEDGER_PATH} (snapshot #${ledger.snapshot_count})`);

  // ---- Append to RVF (RuVector vector store) ----
  const db = await loadOrCreateRvf();
  if (db) {
    try {
      const result = await db.ingestBatch([
        {
          id: snapshotId,
          vector: new Float32Array(vector),
          metadata: {
            captured_at: now,
            total_clones: totalClones,
            total_uniques: totalUniques,
            npm_headline_total: npmHeadlineTotal,
            repos_json: JSON.stringify(clones),
            npm_json: JSON.stringify(npm),
          },
        },
      ]);
      const status = await db.status();
      console.error(`  rvf:             ${RVF_PATH} (vectors=${status.vectorCount ?? '?'}, accepted=${result.accepted ?? '?'})`);
      await db.close();
    } catch (err) {
      console.error(`  [warn] RVF ingest failed: ${err.message?.slice(0, 120)}`);
    }
  }

  // ---- Write proof (SHA-256 over ledger) ----
  const ledgerBytes = readFileSync(LEDGER_PATH);
  const ledgerSha = createHash('sha256').update(ledgerBytes).digest('hex');
  const proof = {
    schema: 'ruflo-ecosystem-proof/v2',
    generated_at: now,
    sources: {
      github_clones: 'https://api.github.com/repos/{owner}/{repo}/traffic/clones (14-day rolling window)',
      npm_downloads: 'https://api.npmjs.org/downloads/range/last-year/{pkg}',
    },
    latest_snapshot: {
      id: snapshotId,
      captured_at: now,
      clones_14d: totalClones,
      unique_cloners_14d: totalUniques,
      npm_downloads_12mo_headline: npmHeadlineTotal,
      headline: `${(npmHeadlineTotal / 1e6).toFixed(1)}M npm downloads · ${Math.round(totalClones / 1000)}k git clones (14d)`,
    },
    ledger_snapshot_count: ledger.snapshot_count,
    ledger_sha256: ledgerSha,
    ledger_path: 'data/clone-data.ledger.json',
    rvf_path: 'data/clone-data.rvf',
  };
  writeFileSync(PROOF_PATH, JSON.stringify(proof, null, 2) + '\n');
  console.error(`  proof:           ${PROOF_PATH} (ledger sha256: ${ledgerSha.slice(0, 16)}…)`);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
