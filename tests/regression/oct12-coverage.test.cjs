const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { readCoverageFromDisk } = require('../../v3/@claude-flow/cli/src/commands/coverage-reader.ts');
function fromDisk(relative, data) {
  const cwd = process.cwd();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oct12-reader-'));
  try {
    process.chdir(root);
    fs.mkdirSync(path.dirname(relative), { recursive: true });
    fs.writeFileSync(relative, typeof data === 'string' ? data : JSON.stringify(data));
    return readCoverageFromDisk();
  } finally { process.chdir(cwd); fs.rmSync(root, { recursive: true, force: true }); }
}
const reader = {
  readCoverageFromDisk,
  parseCoverageSummaryJson: data => fromDisk('coverage/coverage-summary.json', data),
  parseLcovInfo: raw => fromDisk('coverage/lcov.info', raw),
};
const metric = (total, covered, pct = total ? covered / total * 100 : 100) => ({ total, covered, pct });
const file = (total, covered) => Object.fromEntries(['lines','branches','functions','statements'].map(k => [k, metric(total, covered)]));
test('#4082 empty instrumented file is fully covered, not a gap', () => {
  const report = reader.parseCoverageSummaryJson({ 'empty.ts': file(0, 0) }, 'fixture');
  assert.equal(report.entries[0].lines, 100);
  assert.equal(report.summary.overallLineCoverage, 100);
});
test('#4082 pct-only summaries preserve explicit zero and nonzero percentages', () => {
  const report = reader.parseCoverageSummaryJson({ 'a.ts': { lines: { pct: 75 } }, 'b.ts': { lines: { pct: 0 } } }, 'fixture');
  assert.equal(report.entries.find(e => e.filePath === 'a.ts').lines, 75);
  assert.equal(report.entries.find(e => e.filePath === 'b.ts').lines, 0);
});
test('#4083 LCOV aggregates counts for every metric, including unterminated last record', () => {
  const raw = 'SF:large.ts\nLF:100\nLH:10\nBRF:100\nBRH:10\nFNF:100\nFNH:10\nend_of_record\nSF:small.ts\nLF:1\nLH:1\nBRF:1\nBRH:1\nFNF:1\nFNH:1';
  const report = reader.parseLcovInfo(raw, 'fixture');
  for (const key of ['overallLineCoverage','overallBranchCoverage','overallFunctionCoverage','overallStatementCoverage']) assert.equal(report.summary[key], 1100 / 101, key);
});
test('#4084 Istanbul final and NYC counters count unique lines and individual branch arms', () => {
  const cwd = process.cwd(); const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oct12-coverage-'));
  const raw = { 'a.ts': { path: 'a.ts', statementMap: { 0: { start: { line: 1 } }, 1: { start: { line: 1 } }, 2: { start: { line: 2 } } }, s: {0: 1, 1: 0, 2: 0}, f: {0: 0}, b: {0: [1,0]} } };
  try {
    process.chdir(root);
    for (const relative of ['coverage/coverage-final.json', '.nyc_output/out.json']) {
      fs.mkdirSync(path.dirname(relative), {recursive: true}); fs.writeFileSync(relative, JSON.stringify(raw));
      const report = reader.readCoverageFromDisk();
      assert.equal(report.found, true); assert.equal(report.entries.length, 1);
      assert.equal(report.entries[0].lines, 50); assert.equal(report.entries[0].branches, 50);
      assert.equal(report.entries[0].functions, 0); assert.ok(Math.abs(report.entries[0].statements - 100 / 3) < 1e-10);
      fs.unlinkSync(relative);
    }
  } finally { process.chdir(cwd); fs.rmSync(root, { recursive: true, force: true }); }
});
test('empty or malformed reports do not hide a valid fallback', () => {
  const cwd = process.cwd(); const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oct12-coverage-'));
  try {
    process.chdir(root); fs.mkdirSync('coverage');
    fs.writeFileSync('coverage/coverage-summary.json', '{}');
    fs.writeFileSync('coverage/lcov.info', 'SF:a.ts\nLF:2\nLH:1\nend_of_record\n');
    const report = reader.readCoverageFromDisk();
    assert.equal(report.source, 'coverage/lcov.info'); assert.equal(report.summary.overallLineCoverage, 50);
  } finally { process.chdir(cwd); fs.rmSync(root, {recursive: true, force: true}); }
});
test('Istanbul empty-file Unknown sentinel yields numeric 100% in totals and entries', () => {
  const empty = Object.fromEntries(['lines', 'branches', 'functions', 'statements'].map(k => [k, { total: 0, covered: 0, pct: 'Unknown' }]));
  const report = reader.parseCoverageSummaryJson({ total: empty, 'empty.ts': empty });
  assert.equal(report.entries[0].lines, 100);
  assert.equal(report.summary.overallLineCoverage, 100);
  assert.equal(report.summary.overallBranchCoverage, 100);
});
test('legacy NYC summary reports remain readable', () => {
  const report = fromDisk('.nyc_output/out.json', { 'old.ts': file(4, 1) });
  assert.equal(report.found, true); assert.equal(report.entries[0].lines, 25);
});
test('pct-only files retain their percentage but unknown aggregate counts stay conservative', () => {
  const report = reader.parseCoverageSummaryJson({ 'a.ts': { lines: { pct: 75 } } });
  assert.equal(report.entries[0].lines, 75);
  for (const key of ['branches', 'functions', 'statements']) assert.equal(report.entries[0][key], 0);
  for (const [key, value] of Object.entries(report.summary)) if (key !== 'totalFiles') assert.equal(value, 0, key);
});
test('mixed counted and uncounted files cannot claim a fully covered aggregate', () => {
  for (const missing of [{ lines: { pct: 0 } }, { branches: { total: 0, covered: 0 } }]) {
    const report = reader.parseCoverageSummaryJson({ 'counted.ts': file(100, 100), 'unknown.ts': missing });
    assert.equal(report.summary.overallLineCoverage, 0);
  }
});
test('valid supplied aggregate percentages including zero take precedence', () => {
  for (const pct of [0, 75]) {
    const report = reader.parseCoverageSummaryJson({ total: { lines: { pct } }, 'a.ts': { lines: { pct: 75 } } });
    assert.equal(report.summary.overallLineCoverage, pct);
  }
});
test('incomplete or invalid counts do not manufacture a percentage', () => {
  for (const lines of [{ total: 10 }, { covered: 4 }, { total: -1, covered: 0 }, { total: 10, covered: -1 }, { total: 10, covered: 11 }, { total: null, covered: 0 }]) {
    const report = reader.parseCoverageSummaryJson({ 'a.ts': { lines } });
    assert.equal(report.entries[0].lines, 0);
    assert.equal(report.summary.overallLineCoverage, 0);
  }
});
test('explicit empty counts across every file remain fully covered', () => {
  const report = reader.parseCoverageSummaryJson({ 'a.ts': file(0, 0), 'b.ts': file(0, 0) });
  for (const [key, value] of Object.entries(report.summary)) if (key !== 'totalFiles') assert.equal(value, 100, key);
});
