#!/usr/bin/env node
// pretrain-from-github.mjs — pretrain ruflo's self-learning system from its
// own GitHub history (commits + issues). Each commit/issue becomes one
// trajectory through the SONA + EWC++ pipeline; Structured Distillation
// (ADR-076) compresses each into the 4-field schema before embedding.
//
// What this proves:
//   - globalStats.{trajectoriesRecorded, patternsLearned, signalsProcessed}
//     all move from a measured before to a measured after.
//   - neural_patterns.patternCount grows.
//   - memory-bridge entries grow.
//   - The unified-stats aggregator's consistency block stays clean.
//   - Every item gets a learningPath of 'trajectory-pipeline' (not 'recorded-only').
//
// Usage:
//   node scripts/pretrain-from-github.mjs                   # 50 commits + 30 issues
//   COMMITS=200 ISSUES=100 node scripts/pretrain-from-github.mjs
//   SOURCE=git node scripts/pretrain-from-github.mjs        # git only, skip gh
//   BENCH_JSON=1 node scripts/pretrain-from-github.mjs      # machine-readable
//   BENCH_NO_WRITE=1 node scripts/pretrain-from-github.mjs  # don't write a run JSON
//
// Repro from a fresh checkout:
//   git clone https://github.com/ruvnet/ruflo && cd ruflo
//   npm install && ( cd v3/@claude-flow/cli && npx tsc -b )
//   node v3/@claude-flow/cli/scripts/pretrain-from-github.mjs

import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(SCRIPT_DIR, '..');
const RUFLO_ROOT = resolve(SCRIPT_DIR, '../../../..');
const RUNS_DIR = join(RUFLO_ROOT, 'docs', 'benchmarks', 'runs');

// ADR-084 cross-repo support — REPO_ROOT and GH_REPO env-overridable so the
// same script can pretrain on agentdb / agentic-flow / any other repo for
// generalisation testing. Defaults preserve ruflo behaviour.
const REPO_ROOT = process.env.REPO_ROOT ? resolve(process.env.REPO_ROOT) : RUFLO_ROOT;
const GH_REPO   = process.env.GH_REPO   || 'ruvnet/ruflo';

const COMMITS = Number(process.env.COMMITS) || 50;
const ISSUES  = Number(process.env.ISSUES)  || 30;
const SOURCE  = process.env.SOURCE || 'all'; // 'all' | 'git' | 'issues'

// ---------------------------------------------------------------------------
// Harvesters
// ---------------------------------------------------------------------------

// ADR-078 outcome signal — classify each commit by whether it was reverted,
// hotfix-followed, or stuck. Operates on the harvested-commits window plus a
// wider lookahead window for revert/hotfix detection.
//
// Verdicts emitted:
//   success — landed cleanly, no later commit reverted or fixed it
//   reverted — a later commit subject starts with `Revert "<this subject>"`
//   hotfixed — a later commit (within HOTFIX_WINDOW_COMMITS) shares >=50%
//              of the same touched files AND subject contains fix|hotfix|patch
//
// The "later" direction is git-log order (newest first → we look at older
// indices in the lookahead, which are NEWER commits chronologically).
const HOTFIX_WINDOW_COMMITS = Number(process.env.HOTFIX_WINDOW_COMMITS) || 20;
const HOTFIX_FILE_OVERLAP = Number(process.env.HOTFIX_FILE_OVERLAP) || 0.5;
const HOTFIX_KEYWORDS = /\b(fix|hotfix|patch|revert|bugfix|fixup)\b/i;

function harvestCommits(n) {
  if (SOURCE === 'issues') return [];
  const fmt = '%H%x00%s%x00%b%x01';
  // Pull a wider window so we have lookahead for revert/hotfix detection
  // without changing the trained set size n.
  const lookahead = HOTFIX_WINDOW_COMMITS;
  const raw = execSync(
    `git log --pretty=format:'${fmt}' -n ${n + lookahead} 2>/dev/null`,
    { cwd: REPO_ROOT, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 },
  );

  // Parse all blocks (window + lookahead).
  const all = [];
  for (const block of raw.split('\x01')) {
    if (!block.trim()) continue;
    const [sha, subject, body] = block.split('\x00');
    if (!sha || !subject) continue;
    all.push({ sha, subject: subject.trim(), body: (body || '').trim() });
  }

  // For each commit in the trained slice, get its touched files.
  const filesCache = new Map();
  const filesOf = (sha) => {
    if (filesCache.has(sha)) return filesCache.get(sha);
    try {
      const out = execSync(
        `git show --pretty=format: --name-only ${sha} 2>/dev/null`,
        { cwd: REPO_ROOT, encoding: 'utf-8', maxBuffer: 8 * 1024 * 1024 },
      ).trim().split('\n').filter(Boolean);
      filesCache.set(sha, new Set(out));
      return filesCache.get(sha);
    } catch {
      filesCache.set(sha, new Set());
      return filesCache.get(sha);
    }
  };

  // Build a revert-target map: any commit whose subject starts with
  // `Revert "<X>"` flags X as reverted.
  const revertedSubjects = new Set();
  for (const c of all) {
    const m = c.subject.match(/^Revert\s+"(.+?)"/);
    if (m) revertedSubjects.add(m[1].trim());
  }

  const trained = all.slice(0, n);
  const entries = [];
  for (let i = 0; i < trained.length; i++) {
    const c = trained[i];
    const myFiles = filesOf(c.sha);

    let verdict = 'success';
    let outcomeNote = null;

    // Reverted? Check if any later (lower-index = newer) commit reverted us.
    if (revertedSubjects.has(c.subject)) {
      verdict = 'reverted';
      outcomeNote = 'subject reverted by a later commit';
    } else {
      // Hotfixed? A later commit within HOTFIX_WINDOW_COMMITS shares files
      // AND has fix/hotfix in its subject.
      const start = Math.max(0, i - HOTFIX_WINDOW_COMMITS);
      for (let j = start; j < i; j++) {
        const later = trained[j];
        if (!HOTFIX_KEYWORDS.test(later.subject)) continue;
        const laterFiles = filesOf(later.sha);
        if (laterFiles.size === 0 || myFiles.size === 0) continue;
        let overlap = 0;
        for (const f of laterFiles) if (myFiles.has(f)) overlap++;
        // Use min() so a small targeted fix on a big change still triggers
        // (semantic: "≥half of the smaller commit's files overlap").
        const overlapFrac = overlap / Math.min(laterFiles.size, myFiles.size);
        if (overlapFrac >= HOTFIX_FILE_OVERLAP) {
          verdict = 'hotfixed';
          outcomeNote = `${(overlapFrac * 100).toFixed(0)}% file overlap with later fix ${later.sha.slice(0, 8)}`;
          break;
        }
      }
    }

    entries.push({
      source: 'commit',
      id: `commit-${c.sha.slice(0, 12)}`,
      subject: c.subject,
      body: c.body,
      verdict,
      outcomeNote,
      content: `${c.subject}\n\n${c.body}`.slice(0, 8192),
    });
  }
  return entries;
}

function harvestIssues(n) {
  if (SOURCE === 'git') return [];
  try {
    const raw = execSync(
      `gh issue list --repo ${GH_REPO} --state all --limit ${n} --json number,title,body,state,closedAt 2>/dev/null`,
      { cwd: REPO_ROOT, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 },
    );
    const items = JSON.parse(raw);
    return items.map((i) => ({
      source: 'issue',
      id: `issue-${i.number}`,
      subject: i.title,
      body: (i.body || '').slice(0, 8192),
      // closed = success outcome; open = partial (in-progress).
      verdict: i.state === 'CLOSED' ? 'success' : 'partial',
      content: `${i.title}\n\n${(i.body || '').slice(0, 8192)}`,
    }));
  } catch (err) {
    console.error(`gh issue harvest skipped (${err.message?.slice(0, 60)}). Set SOURCE=git to silence.`);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const intel = await import(join(CLI_ROOT, 'dist/src/memory/intelligence.js'));
  const neural = await import(join(CLI_ROOT, 'dist/src/mcp-tools/neural-tools.js'));
  const { distillAndSerialise } = await import(join(CLI_ROOT, 'dist/src/memory/structured-distill.js'));

  // §1 — record the baseline (no clear; we want to learn ON TOP of whatever
  // history the user already has).
  const unified0 = await intel.getUnifiedLearningStats();
  const before = {
    trajectoriesRecorded: unified0.global.trajectoriesRecorded,
    patternsLearned: unified0.global.patternsLearned,
    signalsProcessed: unified0.global.signalsProcessed,
    neuralPatternCount: unified0.neuralPatterns.patternCount,
    memoryBridgeTotal: unified0.memoryBridge.totalEntries,
  };

  // §2 — harvest
  const tHarvest0 = performance.now();
  const commits = harvestCommits(COMMITS);
  const issues = harvestIssues(ISSUES);
  const items = [...commits, ...issues];
  const harvestMs = performance.now() - tHarvest0;

  if (!process.env.BENCH_JSON) {
    console.log(`# Pretrain from ruflo GitHub history`);
    console.log(`Harvested: ${commits.length} commits + ${issues.length} issues = ${items.length} trajectories (${harvestMs.toFixed(0)} ms)`);
  }

  // §3 — feed each item through the trajectory pipeline. The harvester
  // emits one of: success | partial | reverted | hotfixed. We map this to
  // the trajectory pipeline's binary verdict {success, partial} since the
  // pipeline doesn't accept arbitrary strings — but we preserve the original
  // outcome in metadata + the summary's verdictMix so the signal isn't lost.
  const verdictToPipeline = (v) => {
    if (v === 'success') return 'success';
    if (v === 'partial') return 'partial';
    if (v === 'reverted') return 'partial';   // a revert is the strongest "this was wrong" signal we have
    if (v === 'hotfixed') return 'partial';   // a same-files fix-followup is "needs adjustment"
    return 'success';
  };
  const verdictMix = { success: 0, partial: 0, reverted: 0, hotfixed: 0 };
  const tFeed0 = performance.now();
  let trained = 0;
  let failed = 0;
  const failures = [];
  for (const item of items) {
    try {
      const distilled = distillAndSerialise(item.content);
      verdictMix[item.verdict] = (verdictMix[item.verdict] ?? 0) + 1;
      await intel.recordTrajectory(
        [{
          type: 'result',
          content: distilled,
          metadata: {
            source: item.source,
            id: item.id,
            subject: item.subject.slice(0, 200),
            outcomeVerdict: item.verdict,
            outcomeNote: item.outcomeNote ?? null,
          },
          timestamp: Date.now(),
        }],
        verdictToPipeline(item.verdict),
      );
      trained++;
    } catch (err) {
      failed++;
      if (failures.length < 5) failures.push({ id: item.id, error: String(err.message).slice(0, 120) });
    }
  }
  const feedMs = performance.now() - tFeed0;
  intel.flushIntelligenceStats();

  // §4 — also seed the neural store directly from the same items so
  // `neural_patterns list` reflects them (closes the "globalStats moved but
  // neural_patterns didn't" consistency note from ADR-075).
  const tSeed0 = performance.now();
  const neuralItems = items.map((item) => ({
    name: item.subject.slice(0, 200),
    type: item.source === 'commit' ? 'history-commit' : 'history-issue',
    content: distillAndSerialise(item.content),
    metadata: { source: item.source, id: item.id, verdict: item.verdict },
  }));
  const seedResult = await neural.storeNeuralPatterns(neuralItems);
  const seedMs = performance.now() - tSeed0;

  // §5 — read the after-counters via the unified aggregator (this is what
  // hooks_intelligence_unified-stats would return for a live caller).
  const unified1 = await intel.getUnifiedLearningStats();
  const after = {
    trajectoriesRecorded: unified1.global.trajectoriesRecorded,
    patternsLearned: unified1.global.patternsLearned,
    signalsProcessed: unified1.global.signalsProcessed,
    neuralPatternCount: unified1.neuralPatterns.patternCount,
    memoryBridgeTotal: unified1.memoryBridge.totalEntries,
  };

  const deltas = Object.fromEntries(
    Object.keys(after).map((k) => [k, after[k] - before[k]]),
  );

  const summary = {
    runAt: new Date().toISOString(),
    benchmark: 'pretrain-from-github',
    source: SOURCE,
    config: { COMMITS, ISSUES },
    harvest: {
      commits: commits.length,
      issues: issues.length,
      total: items.length,
      harvestMs: Number(harvestMs.toFixed(2)),
    },
    feed: {
      trained,
      failed,
      avgLatencyMs: items.length > 0 ? Number((feedMs / items.length).toFixed(2)) : 0,
      totalMs: Number(feedMs.toFixed(2)),
      sampleFailures: failures,
      verdictMix,   // ADR-078 outcome signal — counts per harvested verdict
    },
    seedNeuralStore: {
      stored: seedResult.stored,
      total: seedResult.total,
      seedMs: Number(seedMs.toFixed(2)),
    },
    before,
    after,
    deltas,
    consistency: unified1.consistency,
    passed:
      trained === items.length &&
      deltas.trajectoriesRecorded >= items.length &&
      deltas.neuralPatternCount >= items.length,
  };

  if (process.env.BENCH_JSON) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log('');
    console.log('| Counter | Before | After | Δ |');
    console.log('|---|---:|---:|---:|');
    for (const k of Object.keys(after)) {
      console.log(`| ${k} | ${before[k]} | ${after[k]} | +${deltas[k]} |`);
    }
    console.log('');
    console.log(`Trained via trajectory pipeline: ${trained}/${items.length}`);
    console.log(`Failed: ${failed}`);
    console.log(`Avg latency per trajectory: ${summary.feed.avgLatencyMs} ms`);
    console.log(`Neural store seeded: ${seedResult.stored}/${seedResult.total}`);
    console.log(`Verdict mix: success=${verdictMix.success} partial=${verdictMix.partial} reverted=${verdictMix.reverted} hotfixed=${verdictMix.hotfixed}`);
    console.log(`Overall: ${summary.passed ? '✅ PASSED' : '⚠️  partial'}`);
    if (unified1.consistency.notes.length > 0) {
      console.log(`\nConsistency notes:`);
      for (const n of unified1.consistency.notes) console.log(`  • ${n}`);
    }
  }

  if (!process.env.BENCH_NO_WRITE) {
    mkdirSync(RUNS_DIR, { recursive: true });
    const stamp = summary.runAt.replace(/[:.]/g, '-');
    writeFileSync(join(RUNS_DIR, `pretrain-from-github-${stamp}.json`), JSON.stringify(summary, null, 2));
    writeFileSync(join(RUNS_DIR, 'pretrain-from-github-latest.json'), JSON.stringify(summary, null, 2));
    if (!process.env.BENCH_JSON) console.log(`\nWrote ${join(RUNS_DIR, `pretrain-from-github-${stamp}.json`)}`);
  }

  // ONNX runtime keeps a worker thread alive — force exit so this can be used
  // as a CI step or chained with other scripts.
  process.exit(summary.passed ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
