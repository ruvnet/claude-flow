import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

interface CoverageFileEntry {
  filePath: string;
  lines: number;
  branches: number;
  functions: number;
  statements: number;
}

interface CoverageData {
  found: boolean;
  source: string;
  entries: CoverageFileEntry[];
  summary: {
    totalFiles: number;
    overallLineCoverage: number;
    overallBranchCoverage: number;
    overallFunctionCoverage: number;
    overallStatementCoverage: number;
  };
}

/**
 * Read coverage data from disk. Checks these locations in order:
 * 1. coverage/coverage-summary.json (Jest/Istanbul)
 * 2. coverage/lcov.info (lcov format)
 * 3. coverage/coverage-final.json (Istanbul counters)
 * 4. .nyc_output/out.json (nyc counters or legacy summary)
 */
export function readCoverageFromDisk(): CoverageData {
  const cwd = process.cwd();
  const noData: CoverageData = {
    found: false,
    source: 'none',
    entries: [],
    summary: { totalFiles: 0, overallLineCoverage: 0, overallBranchCoverage: 0, overallFunctionCoverage: 0, overallStatementCoverage: 0 },
  };

  // 1. Try coverage-summary.json (Jest/Istanbul)
  for (const relPath of ['coverage/coverage-summary.json', 'coverage-summary.json']) {
    const summaryPath = join(cwd, relPath);
    if (existsSync(summaryPath)) {
      try {
        const raw = JSON.parse(readFileSync(summaryPath, 'utf-8'));
        const report = parseCoverageSummaryJson(raw, relPath);
        if (report.found) return report;
      } catch {
        // malformed, try next
      }
    }
  }

  // 2. Try lcov.info
  for (const relPath of ['coverage/lcov.info', 'lcov.info']) {
    const lcovPath = join(cwd, relPath);
    if (existsSync(lcovPath)) {
      try {
        const raw = readFileSync(lcovPath, 'utf-8');
        const report = parseLcovInfo(raw, relPath);
        if (report.found) return report;
      } catch {
        // malformed, try next
      }
    }
  }

  // Istanbul's raw counter map (Jest, Vitest, nyc).
  for (const relPath of ['coverage/coverage-final.json', 'coverage-final.json', '.nyc_output/out.json']) {
    try {
      const raw = JSON.parse(readFileSync(join(cwd, relPath), 'utf-8'));
      const report = parseIstanbulCoverage(raw, relPath);
      if (report.found) return report;
      const legacy = parseCoverageSummaryJson(raw, relPath);
      if (legacy.found) return legacy;
    } catch {
      // Missing or malformed, try the next supported report.
    }
  }

  return noData;
}

function parseCoverageSummaryJson(data: Record<string, unknown>, source: string): CoverageData {
  const entries: CoverageFileEntry[] = [];
  const metricsByFile: Record<string, Metric>[] = [];

  for (const [filePath, metrics] of Object.entries(data)) {
    if (filePath === 'total') continue;
    const m = metrics as Record<string, Metric>;
    if (!m || typeof m !== 'object') continue;

    if (!['lines', 'branches', 'functions', 'statements'].some(key => m[key])) continue;
    metricsByFile.push(m);
    const linePct = percentage(m.lines) ?? 0;
    const branchPct = (percentage(m.branches) ?? 0);
    const funcPct = (percentage(m.functions) ?? 0);
    const stmtPct = (percentage(m.statements) ?? 0);

    entries.push({ filePath, lines: linePct, branches: branchPct, functions: funcPct, statements: stmtPct });

  }

  // Only aggregate complete counts. A missing denominator is unknown, not empty.
  const total = data['total'] as Record<string, Metric> | undefined;
  const aggregate = (key: string): number => {
    const supplied = percentage(total?.[key]);
    if (supplied !== undefined) return supplied;
    const metrics = metricsByFile.map(file => file[key]);
    if (metrics.length === 0 || !metrics.every(hasCounts)) return 0;
    return ratio(metrics.reduce((sum, m) => sum + m.covered, 0),
      metrics.reduce((sum, m) => sum + m.total, 0));
  };

  // Sort by lowest line coverage
  entries.sort((a, b) => a.lines - b.lines);

  return {
    found: entries.length > 0,
    source,
    entries,
    summary: {
      totalFiles: entries.length,
      overallLineCoverage: aggregate('lines'),
      overallBranchCoverage: aggregate('branches'),
      overallFunctionCoverage: aggregate('functions'),
      overallStatementCoverage: aggregate('statements'),
    },
  };
}

function parseLcovInfo(raw: string, source: string): CoverageData {
  const entries: CoverageFileEntry[] = [];
  let currentFile = '';
  let linesHit = 0, linesFound = 0;
  let branchesHit = 0, branchesFound = 0;
  let functionsHit = 0, functionsFound = 0;

  let totalLH = 0, totalLF = 0, totalBH = 0, totalBF = 0, totalFH = 0, totalFF = 0;
  const flushRecord = () => {
    if (currentFile) {
      totalLH += linesHit; totalLF += linesFound;
      totalBH += branchesHit; totalBF += branchesFound;
      totalFH += functionsHit; totalFF += functionsFound;
      entries.push({
        filePath: currentFile,
        lines: linesFound > 0 ? (linesHit / linesFound) * 100 : 100,
        branches: branchesFound > 0 ? (branchesHit / branchesFound) * 100 : 100,
        functions: functionsFound > 0 ? (functionsHit / functionsFound) * 100 : 100,
        statements: linesFound > 0 ? (linesHit / linesFound) * 100 : 100,
      });
    }
  };

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('SF:')) {
      flushRecord();
      currentFile = trimmed.slice(3);
      linesHit = 0; linesFound = 0;
      branchesHit = 0; branchesFound = 0;
      functionsHit = 0; functionsFound = 0;
    } else if (trimmed.startsWith('LH:')) {
      linesHit = parseInt(trimmed.slice(3), 10) || 0;
    } else if (trimmed.startsWith('LF:')) {
      linesFound = parseInt(trimmed.slice(3), 10) || 0;
    } else if (trimmed.startsWith('BRH:')) {
      branchesHit = parseInt(trimmed.slice(4), 10) || 0;
    } else if (trimmed.startsWith('BRF:')) {
      branchesFound = parseInt(trimmed.slice(4), 10) || 0;
    } else if (trimmed.startsWith('FNH:')) {
      functionsHit = parseInt(trimmed.slice(4), 10) || 0;
    } else if (trimmed.startsWith('FNF:')) {
      functionsFound = parseInt(trimmed.slice(4), 10) || 0;
    } else if (trimmed === 'end_of_record') {
      flushRecord();
      currentFile = '';
    }
  }
  flushRecord();

  entries.sort((a, b) => a.lines - b.lines);

  return {
    found: entries.length > 0,
    source,
    entries,
    summary: {
      totalFiles: entries.length,
      overallLineCoverage: ratio(totalLH, totalLF),
      overallBranchCoverage: ratio(totalBH, totalBF),
      overallFunctionCoverage: ratio(totalFH, totalFF),
      overallStatementCoverage: ratio(totalLH, totalLF),
    },
  };
}


type Metric = { total?: number; covered?: number; pct?: number | string };
function ratio(covered: number, total: number): number {
  return total > 0 ? covered / total * 100 : 100;
}
function hasCounts(metric?: Metric): metric is Metric & { total: number; covered: number } {
  return typeof metric?.total === 'number' && Number.isFinite(metric.total) && metric.total >= 0
    && typeof metric.covered === 'number' && Number.isFinite(metric.covered)
    && metric.covered >= 0 && metric.covered <= metric.total;
}
function percentage(metric?: Metric): number | undefined {
  if (typeof metric?.pct === 'number' && Number.isFinite(metric.pct)
    && metric.pct >= 0 && metric.pct <= 100) return metric.pct;
  return hasCounts(metric) ? ratio(metric.covered, metric.total) : undefined;
}

/** Istanbul line coverage uses the maximum statement hit count on each start line. */
function parseIstanbulCoverage(data: Record<string, unknown>, source: string): CoverageData {
  const summary: Record<string, unknown> = {};
  for (const [filePath, value] of Object.entries(data)) {
    const cov = value as { s?: Record<string, number>; f?: Record<string, number>; b?: Record<string, number[]>; statementMap?: Record<string, { start: { line: number } }> };
    if (!cov || !cov.s || !cov.f || !cov.b || !cov.statementMap) continue;
    const lines = new Map<number, number>();
    for (const [id, hits] of Object.entries(cov.s)) {
      const line = cov.statementMap[id]?.start?.line;
      if (!Number.isInteger(line) || line! < 1) throw new Error('Invalid Istanbul statement location');
      lines.set(line!, Math.max(lines.get(line!) ?? 0, hits));
    }
    const metric = (hits: number[]) => {
      if (hits.some(n => !Number.isFinite(n) || n < 0)) throw new Error('Invalid Istanbul counter');
      const covered = hits.filter(n => n > 0).length;
      return { total: hits.length, covered, pct: ratio(covered, hits.length) };
    };
    summary[filePath] = { lines: metric([...lines.values()]), statements: metric(Object.values(cov.s)),
      functions: metric(Object.values(cov.f)), branches: metric(Object.values(cov.b).flat()) };
  }
  return parseCoverageSummaryJson(summary, source);
}
