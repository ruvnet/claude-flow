#!/usr/bin/env node
/**
 * Deterministic baseline-vs-candidate evaluation for the settings-risk-scanner
 * candidate (Ruflo Dream Cycle 2026-08-16, security).
 *
 * Baseline = no scanner (every existing hook/allow-rule reported clean, the
 * status quo before tonight's candidate). Candidate = scanSettingsForRisk().
 * Corpus: ../../settings-risk-corpus.json (hand-written, provenance recorded
 * in the corpus file itself — see STEP 7/STEP 10 fairness-check discipline).
 *
 * Run: node v3/@claude-flow/cli/benchmarks/results/scripts/settings-risk-benchmark.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../../../..');
const corpusPath = path.join(repoRoot, 'v3/@claude-flow/cli/benchmarks/settings-risk-corpus.json');
const scannerPath = path.join(repoRoot, 'v3/@claude-flow/cli/src/init/settings-risk-scanner.ts');

const { scanCommandStringForRisk, scanAllowRuleForRisk } = await import(scannerPath);
const corpus = JSON.parse(readFileSync(corpusPath, 'utf-8'));

function evaluate(name, classify) {
  let tp = 0, fp = 0, tn = 0, fn = 0;
  const misclassified = [];

  for (const sample of corpus.hookCommands) {
    const flagged = classify.command(sample.value);
    if (flagged && sample.malicious) tp++;
    else if (flagged && !sample.malicious) { fp++; misclassified.push({ type: 'command', ...sample }); }
    else if (!flagged && sample.malicious) { fn++; misclassified.push({ type: 'command', ...sample }); }
    else tn++;
  }
  for (const sample of corpus.allowRules) {
    const flagged = classify.allow(sample.value);
    if (flagged && sample.malicious) tp++;
    else if (flagged && !sample.malicious) { fp++; misclassified.push({ type: 'allow', ...sample }); }
    else if (!flagged && sample.malicious) { fn++; misclassified.push({ type: 'allow', ...sample }); }
    else tn++;
  }

  const precision = tp + fp === 0 ? null : tp / (tp + fp);
  const recall = tp + fn === 0 ? null : tp / (tp + fn);
  const f1 = precision === null || recall === null || precision + recall === 0
    ? null
    : (2 * precision * recall) / (precision + recall);

  return { name, tp, fp, tn, fn, precision, recall, f1, falsePositiveRate: fp / (fp + tn), misclassified };
}

const baseline = evaluate('baseline (no scanner)', {
  command: () => false,
  allow: () => false,
});

const candidate = evaluate('candidate (scanSettingsForRisk)', {
  command: (v) => scanCommandStringForRisk(v).length > 0,
  allow: (v) => scanAllowRuleForRisk(v).length > 0,
});

const receipt = {
  timestamp: '2026-08-16',
  corpusProvenance: corpus._provenance,
  corpusSize: corpus.hookCommands.length + corpus.allowRules.length,
  maliciousCount: [...corpus.hookCommands, ...corpus.allowRules].filter((s) => s.malicious).length,
  benignCount: [...corpus.hookCommands, ...corpus.allowRules].filter((s) => !s.malicious).length,
  baseline,
  candidate,
};

const outDir = path.join(repoRoot, 'v3/@claude-flow/cli/benchmarks/results');
writeFileSync(path.join(outDir, 'receipt-baseline.json'), JSON.stringify(baseline, null, 2));
writeFileSync(path.join(outDir, 'receipt-candidate.json'), JSON.stringify(candidate, null, 2));
writeFileSync(path.join(outDir, 'comparison-settings-risk-final.json'), JSON.stringify(receipt, null, 2));

console.log(JSON.stringify(receipt, null, 2));
