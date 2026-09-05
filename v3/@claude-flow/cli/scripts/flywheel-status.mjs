#!/usr/bin/env node
/**
 * Flywheel status endpoint (ADR-176 A-P3b) — reconstruct the persisted lineage
 * for a project and answer: how many generations, promotions, cumulative
 * improvement, rejection rate, has it plateaued, is it genuinely compounding?
 *
 * Usage: node scripts/flywheel-status.mjs [--dir <projectRoot>] [--json]
 */
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(SCRIPT_DIR, '..');
const { flywheelStatus } = await import(`file://${join(CLI_ROOT, 'dist/src/services/harness-flywheel-generations.js')}`);

const argDir = process.argv.indexOf('--dir');
const root = argDir > -1 ? resolve(process.argv[argDir + 1]) : process.cwd();
const s = flywheelStatus(root);

if (process.argv.includes('--json')) { console.log(JSON.stringify(s, null, 2)); process.exit(0); }

console.log(`flywheel status — ${root}`);
console.log('='.repeat(64));
console.log(`generations (promotions) : ${s.generations}`);
console.log(`attempts (incl. refusals): ${s.attempts}`);
console.log(`cumulative held-out Δ    : ${s.lineage.cumulativeHeldOutImprovement.toFixed(4)}`);
// Anti-overfitting view: proxy (self-supervised) gain vs FROZEN human-relevance gain.
const bench = s.cumulativeBenchmarkDelta ?? 0, human = s.cumulativeHumanRelevanceDelta ?? 0;
const overfit = bench > 0.02 && human <= 0.005;
console.log(`cumulative proxy Δ       : ${bench.toFixed(4)}  (self-supervised self-retrieval)`);
console.log(`cumulative HUMAN Δ       : ${human.toFixed(4)}  (frozen human-labeled eval)${overfit ? '   ⚠️  proxy up but human flat → OVERFITTING' : ''}`);
console.log(`frozen human eval        : ${s.humanEvalHash ? s.humanEvalHash.slice(0, 26) + '…' : '(none)'}`);
console.log(`lineage intact           : ${s.lineage.lineageIntact}   replayable: ${s.lineage.allReplayable}`);
console.log(`immutable root           : ${(s.lineage.rootHash || '(none yet)').slice(0, 26)}…`);
console.log(`plateau                  : ${s.plateau.status} — ${s.plateau.rationale}`);
console.log(`served champion          : ${s.served.championHash ? s.served.championHash.slice(0, 26) + '…' : '(none — all in shadow)'}`);
console.log(`current champion config  : ${JSON.stringify(s.champion.config)}`);
console.log('mutation effectiveness   :');
for (const m of s.mutation) console.log(`  ${m.mutationClass.padEnd(22)} attempts=${m.attempts} promotions=${m.promotions} meanΔ=${m.meanDelta.toFixed(4)}`);
console.log('axis payoff (meta-learn) :');
for (const a of s.axisEffectiveness) console.log(`  ${a.axis.padEnd(18)} promotions=${a.promotions} meanΔ=${a.meanDelta.toFixed(4)}${a.meanDelta > 0 ? '  ← biased toward' : ''}`);
console.log('lineage:');
for (const n of s.lineage.nodes) console.log(`  gen ${n.generation} [${n.branch}] ${n.promoted ? '✓' : '✗'} Δ=${n.delta.toFixed(4)} ${n.mutationClass} replay=${n.replayable}`);
process.exit(0);
