/**
 * Coverage Router for Test Routing
 *
 * Optimizations:
 * - Async file I/O for non-blocking coverage loading
 * - TTL-based caching of coverage data
 * - Singleton router instance
 */

// ============================================================================
// Caching for Performance
// ============================================================================

/**
 * Cache for coverage data (1 minute TTL)
 */
const coverageDataCache = new Map<string, { report: CoverageReport; timestamp: number }>();
const COVERAGE_CACHE_TTL_MS = 60 * 1000; // 1 minute

/**
 * Clear coverage cache
 */
export function clearCoverageCache(): void {
  coverageDataCache.clear();
}

/**
 * Get coverage cache stats
 */
export function getCoverageCacheStats(): { size: number } {
  return { size: coverageDataCache.size };
}

export interface CoverageRouterConfig {
  minCoverage: number;
  targetCoverage: number;
  incremental: boolean;
  coverageTypes: ('line' | 'branch' | 'function' | 'statement')[];
}

export interface FileCoverage {
  path: string;
  lineCoverage: number;
  branchCoverage: number;
  functionCoverage: number;
  statementCoverage: number;
  uncoveredLines: number[];
  totalLines: number;
  coveredLines: number;
}

export interface CoverageReport {
  overall: number;
  byType: { line: number; branch: number; function: number; statement: number };
  byFile: FileCoverage[];
  lowestCoverage: FileCoverage[];
  highestCoverage: FileCoverage[];
  uncoveredCritical: string[];
  timestamp: number;
}

export interface CoverageRouteResult {
  action: 'add-tests' | 'review-coverage' | 'skip' | 'prioritize';
  priority: number;
  targetFiles: string[];
  testTypes: ('unit' | 'integration' | 'e2e')[];
  gaps: Array<{ file: string; currentCoverage: number; targetCoverage: number; gap: number; suggestedTests: string[] }>;
  estimatedEffort: number;
  impactScore: number;
}

const DEFAULT_CONFIG: CoverageRouterConfig = {
  minCoverage: 70,
  targetCoverage: 85,
  incremental: true,
  coverageTypes: ['line', 'branch', 'function', 'statement'],
};

export class CoverageRouter {
  private config: CoverageRouterConfig;
  private ruvectorEngine: unknown = null;
  private useNative = false;
  private coverageHistory: CoverageReport[] = [];

  constructor(config: Partial<CoverageRouterConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async initialize(): Promise<void> {
    try {
      // @ruvector/coverage is optional - gracefully fallback if not installed
      const ruvector = await import('@ruvector/coverage' as string).catch(() => null);
      if (ruvector) {
        this.ruvectorEngine = (ruvector as any).createCoverageRouter?.(this.config);
        this.useNative = !!this.ruvectorEngine;
      }
    } catch { this.useNative = false; }
  }

  parseCoverage(data: unknown, format: 'lcov' | 'istanbul' | 'cobertura' | 'json' = 'json'): CoverageReport {
    switch (format) {
      case 'lcov': return this.parseLcov(data as string);
      case 'istanbul': return this.parseIstanbul(data as Record<string, unknown>);
      case 'cobertura': return this.parseCobertura(data as string);
      default: return this.parseJson(data as Record<string, unknown>);
    }
  }

  route(coverage: CoverageReport, changedFiles?: string[]): CoverageRouteResult {
    const gaps = this.calculateGaps(coverage);
    const targetFiles = this.prioritizeFiles(coverage, changedFiles);
    const action = this.determineAction(coverage, gaps);
    const priority = this.calculatePriority(coverage, changedFiles);
    const testTypes = this.recommendTestTypes(gaps);
    const estimatedEffort = this.estimateEffort(gaps);
    const impactScore = this.calculateImpact(coverage, targetFiles);
    return { action, priority, targetFiles, testTypes, gaps, estimatedEffort, impactScore };
  }

  getTrend(): { direction: 'up' | 'down' | 'stable'; change: number } {
    if (this.coverageHistory.length < 2) return { direction: 'stable', change: 0 };
    const recent = this.coverageHistory[this.coverageHistory.length - 1];
    const previous = this.coverageHistory[this.coverageHistory.length - 2];
    const change = recent.overall - previous.overall;
    return { direction: change > 0.5 ? 'up' : change < -0.5 ? 'down' : 'stable', change };
  }

  addToHistory(report: CoverageReport): void {
    this.coverageHistory.push(report);
    if (this.coverageHistory.length > 10) this.coverageHistory.shift();
  }

  getStats(): Record<string, number | boolean> {
    return { useNative: this.useNative, historySize: this.coverageHistory.length, minCoverage: this.config.minCoverage, targetCoverage: this.config.targetCoverage };
  }

  private parseLcov(data: string): CoverageReport {
    const files: FileCoverage[] = [];
    let currentFile: Partial<FileCoverage> | null = null;
    const lines = data.split('\n');
    for (const line of lines) {
      if (line.startsWith('SF:')) {
        if (currentFile?.path) files.push(this.finalizeFileCoverage(currentFile));
        currentFile = { path: line.substring(3), uncoveredLines: [], totalLines: 0, coveredLines: 0 };
      } else if (line.startsWith('LF:')) { if (currentFile) currentFile.totalLines = parseInt(line.substring(3), 10); }
      else if (line.startsWith('LH:')) { if (currentFile) currentFile.coveredLines = parseInt(line.substring(3), 10); }
      else if (line.startsWith('DA:')) { const [lineNum, hits] = line.substring(3).split(',').map(Number); if (currentFile && hits === 0) currentFile.uncoveredLines?.push(lineNum); }
      else if (line === 'end_of_record') { if (currentFile?.path) files.push(this.finalizeFileCoverage(currentFile)); currentFile = null; }
    }
    return this.buildReport(files);
  }

  private parseIstanbul(data: Record<string, unknown>): CoverageReport {
    const files: FileCoverage[] = [];
    for (const [path, coverage] of Object.entries(data)) {
      const cov = coverage as Record<string, unknown>;
      const statements = cov.s as Record<string, number>;
      const functions = cov.f as Record<string, number>;
      const branches = cov.b as Record<string, number[]>;
      const statementCovered = Object.values(statements).filter(v => v > 0).length;
      const statementTotal = Object.values(statements).length;
      const functionCovered = Object.values(functions).filter(v => v > 0).length;
      const functionTotal = Object.values(functions).length;
      const branchCovered = Object.values(branches).flat().filter(v => v > 0).length;
      const branchTotal = Object.values(branches).flat().length;
      files.push({
        path, lineCoverage: statementTotal > 0 ? (statementCovered / statementTotal) * 100 : 100,
        branchCoverage: branchTotal > 0 ? (branchCovered / branchTotal) * 100 : 100,
        functionCoverage: functionTotal > 0 ? (functionCovered / functionTotal) * 100 : 100,
        statementCoverage: statementTotal > 0 ? (statementCovered / statementTotal) * 100 : 100,
        uncoveredLines: [], totalLines: statementTotal, coveredLines: statementCovered,
      });
    }
    return this.buildReport(files);
  }

  private parseCobertura(data: string): CoverageReport {
    const files: FileCoverage[] = [];
    const classMatches = data.matchAll(/<class[^>]*filename="([^"]+)"[^>]*line-rate="([^"]+)"[^>]*branch-rate="([^"]+)"[^>]*>/g);
    for (const match of classMatches) {
      files.push({
        path: match[1], lineCoverage: parseFloat(match[2]) * 100, branchCoverage: parseFloat(match[3]) * 100,
        functionCoverage: parseFloat(match[2]) * 100, statementCoverage: parseFloat(match[2]) * 100,
        uncoveredLines: [], totalLines: 0, coveredLines: 0,
      });
    }
    return this.buildReport(files);
  }

  private parseJson(data: Record<string, unknown>): CoverageReport {
    if (Array.isArray(data)) return this.buildReport(data as FileCoverage[]);
    const files: FileCoverage[] = [];
    for (const [path, coverage] of Object.entries(data)) {
      const cov = coverage as Partial<FileCoverage>;
      files.push({
        path, lineCoverage: cov.lineCoverage || 0, branchCoverage: cov.branchCoverage || 0,
        functionCoverage: cov.functionCoverage || 0, statementCoverage: cov.statementCoverage || 0,
        uncoveredLines: cov.uncoveredLines || [], totalLines: cov.totalLines || 0, coveredLines: cov.coveredLines || 0,
      });
    }
    return this.buildReport(files);
  }

  private finalizeFileCoverage(partial: Partial<FileCoverage>): FileCoverage {
    const lineCoverage = partial.totalLines && partial.totalLines > 0 ? (partial.coveredLines || 0) / partial.totalLines * 100 : 100;
    return { path: partial.path || 'unknown', lineCoverage, branchCoverage: lineCoverage, functionCoverage: lineCoverage, statementCoverage: lineCoverage, uncoveredLines: partial.uncoveredLines || [], totalLines: partial.totalLines || 0, coveredLines: partial.coveredLines || 0 };
  }

  private buildReport(files: FileCoverage[]): CoverageReport {
    const totalLines = files.reduce((sum, f) => sum + f.totalLines, 0);
    const coveredLines = files.reduce((sum, f) => sum + f.coveredLines, 0);
    const overall = totalLines > 0 ? (coveredLines / totalLines) * 100 : 100;
    const avgLine = files.length > 0 ? files.reduce((sum, f) => sum + f.lineCoverage, 0) / files.length : 100;
    const avgBranch = files.length > 0 ? files.reduce((sum, f) => sum + f.branchCoverage, 0) / files.length : 100;
    const avgFunction = files.length > 0 ? files.reduce((sum, f) => sum + f.functionCoverage, 0) / files.length : 100;
    const avgStatement = files.length > 0 ? files.reduce((sum, f) => sum + f.statementCoverage, 0) / files.length : 100;
    const sortedByLine = [...files].sort((a, b) => a.lineCoverage - b.lineCoverage);
    return { overall, byType: { line: avgLine, branch: avgBranch, function: avgFunction, statement: avgStatement }, byFile: files, lowestCoverage: sortedByLine.slice(0, 5), highestCoverage: sortedByLine.slice(-5).reverse(), uncoveredCritical: this.findCriticalUncovered(files), timestamp: Date.now() };
  }

  private findCriticalUncovered(files: FileCoverage[]): string[] {
    const critical: string[] = [];
    const criticalPatterns = [/auth/, /security/, /payment/, /core/, /main/, /index/];
    for (const file of files) {
      if (file.lineCoverage < this.config.minCoverage) {
        for (const pattern of criticalPatterns) { if (pattern.test(file.path)) { critical.push(file.path); break; } }
      }
    }
    return critical.slice(0, 10);
  }

  private calculateGaps(coverage: CoverageReport): CoverageRouteResult['gaps'] {
    const gaps: CoverageRouteResult['gaps'] = [];
    for (const file of coverage.byFile) {
      if (file.lineCoverage < this.config.targetCoverage) {
        const gap = this.config.targetCoverage - file.lineCoverage;
        gaps.push({ file: file.path, currentCoverage: file.lineCoverage, targetCoverage: this.config.targetCoverage, gap, suggestedTests: this.suggestTests(file) });
      }
    }
    return gaps.sort((a, b) => b.gap - a.gap).slice(0, 10);
  }

  private suggestTests(file: FileCoverage): string[] {
    const suggestions: string[] = [];
    if (file.uncoveredLines.length > 10) suggestions.push('Add unit tests for uncovered code paths');
    if (file.branchCoverage < 50) suggestions.push('Add branch coverage tests (if/else paths)');
    if (file.functionCoverage < 80) suggestions.push('Add tests for untested functions');
    if (/api|endpoint|route|handler/.test(file.path)) suggestions.push('Add integration tests for API endpoints');
    return suggestions.slice(0, 3);
  }

  private prioritizeFiles(coverage: CoverageReport, changedFiles?: string[]): string[] {
    let targetFiles = coverage.lowestCoverage.map(f => f.path);
    if (changedFiles && changedFiles.length > 0) {
      const changedWithLowCoverage = coverage.byFile.filter(f => changedFiles.some(cf => f.path.includes(cf))).filter(f => f.lineCoverage < this.config.targetCoverage).map(f => f.path);
      targetFiles = [...new Set([...changedWithLowCoverage, ...targetFiles])];
    }
    return targetFiles.slice(0, 10);
  }

  private determineAction(coverage: CoverageReport, gaps: CoverageRouteResult['gaps']): CoverageRouteResult['action'] {
    if (coverage.overall < this.config.minCoverage) return 'prioritize';
    if (gaps.length > 5) return 'add-tests';
    if (coverage.overall < this.config.targetCoverage) return 'review-coverage';
    return 'skip';
  }

  private calculatePriority(coverage: CoverageReport, changedFiles?: string[]): number {
    let priority = 5;
    if (coverage.overall < 50) priority += 4; else if (coverage.overall < 70) priority += 2; else if (coverage.overall < 85) priority += 1;
    priority += Math.min(3, coverage.uncoveredCritical.length);
    if (changedFiles && changedFiles.length > 0) {
      const changedLowCoverage = coverage.byFile.filter(f => changedFiles.some(cf => f.path.includes(cf))).filter(f => f.lineCoverage < this.config.minCoverage);
      priority += Math.min(2, changedLowCoverage.length);
    }
    return Math.min(10, priority);
  }

  private recommendTestTypes(gaps: CoverageRouteResult['gaps']): CoverageRouteResult['testTypes'] {
    const types: Set<'unit' | 'integration' | 'e2e'> = new Set(['unit']);
    for (const gap of gaps) {
      if (/api|endpoint|route|handler|service/.test(gap.file)) types.add('integration');
      if (/page|component|view|ui/.test(gap.file)) types.add('e2e');
    }
    return Array.from(types);
  }

  private estimateEffort(gaps: CoverageRouteResult['gaps']): number {
    let effort = 0;
    for (const gap of gaps) effort += (gap.gap / 10) * 0.5;
    return Math.round(effort * 10) / 10;
  }

  private calculateImpact(coverage: CoverageReport, targetFiles: string[]): number {
    const potentialGain = targetFiles.reduce((sum, file) => {
      const fileCov = coverage.byFile.find(f => f.path === file);
      return fileCov ? sum + (this.config.targetCoverage - fileCov.lineCoverage) : sum;
    }, 0);
    return Math.min(100, Math.round(potentialGain / targetFiles.length || 0));
  }
}

export function createCoverageRouter(config?: Partial<CoverageRouterConfig>): CoverageRouter {
  return new CoverageRouter(config);
}

// ============================================================================
// Additional Exports for MCP Tools (coverage-tools.ts)
// ============================================================================

/**
 * Coverage suggestion result
 */
export interface CoverageSuggestResult {
  path: string;
  suggestions: Array<{
    file: string;
    currentCoverage: number;
    targetCoverage: number;
    gap: number;
    priority: number;
    suggestedTests: string[];
  }>;
  totalGap: number;
  estimatedEffort: number;
}

/**
 * Coverage gaps result
 */
export interface CoverageGapsResult {
  totalGaps: number;
  gaps: Array<{
    file: string;
    currentCoverage: number;
    targetCoverage: number;
    gap: number;
    priority: number;
    suggestedAgent: string;
  }>;
  byAgent: Record<string, string[]>;
  summary: string;
}

/**
 * Coverage route options
 */
export interface CoverageRouteOptions {
  projectRoot?: string;
  threshold?: number;
  useRuvector?: boolean;
}

/**
 * Coverage suggest options
 */
export interface CoverageSuggestOptions extends CoverageRouteOptions {
  limit?: number;
}

/**
 * Coverage gaps options
 */
export interface CoverageGapsOptions extends CoverageRouteOptions {
  groupByAgent?: boolean;
}

/**
 * Route a task based on coverage analysis
 */
export async function coverageRoute(
  task: string,
  options: CoverageRouteOptions = {}
): Promise<CoverageRouteResult> {
  const router = new CoverageRouter({
    targetCoverage: options.threshold || 80,
  });

  // Try to load coverage data
  const coverage = await loadProjectCoverage(options.projectRoot);
  if (!coverage) {
    return {
      action: 'skip',
      priority: 1,
      targetFiles: [],
      testTypes: ['unit'],
      gaps: [],
      estimatedEffort: 0,
      impactScore: 0,
    };
  }

  return router.route(coverage);
}

/**
 * Suggest coverage improvements for a path
 */
export async function coverageSuggest(
  path: string,
  options: CoverageSuggestOptions = {}
): Promise<CoverageSuggestResult> {
  const limit = options.limit || 20;
  const threshold = options.threshold || 80;

  const coverage = await loadProjectCoverage(options.projectRoot);
  if (!coverage) {
    return {
      path,
      suggestions: [],
      totalGap: 0,
      estimatedEffort: 0,
    };
  }

  // Filter files matching the path
  const matchingFiles = coverage.byFile.filter(f => f.path.includes(path));
  const belowThreshold = matchingFiles.filter(f => f.lineCoverage < threshold);

  const suggestions = belowThreshold
    .map(f => ({
      file: f.path,
      currentCoverage: f.lineCoverage,
      targetCoverage: threshold,
      gap: threshold - f.lineCoverage,
      priority: calculateFilePriority(f.path, f.lineCoverage, threshold),
      suggestedTests: suggestTestsForFile(f),
    }))
    .sort((a, b) => b.priority - a.priority)
    .slice(0, limit);

  const totalGap = suggestions.reduce((sum, s) => sum + s.gap, 0);
  const estimatedEffort = totalGap * 0.1; // Rough estimate: 0.1 hours per % gap

  return { path, suggestions, totalGap, estimatedEffort };
}

/**
 * List all coverage gaps with agent assignments
 */
export async function coverageGaps(
  options: CoverageGapsOptions = {}
): Promise<CoverageGapsResult> {
  const threshold = options.threshold || 80;
  const groupByAgent = options.groupByAgent !== false;

  const coverage = await loadProjectCoverage(options.projectRoot);
  if (!coverage) {
    return {
      totalGaps: 0,
      gaps: [],
      byAgent: {},
      summary: 'No coverage data found',
    };
  }

  const belowThreshold = coverage.byFile.filter(f => f.lineCoverage < threshold);

  const gaps = belowThreshold.map(f => ({
    file: f.path,
    currentCoverage: f.lineCoverage,
    targetCoverage: threshold,
    gap: threshold - f.lineCoverage,
    priority: calculateFilePriority(f.path, f.lineCoverage, threshold),
    suggestedAgent: suggestAgentForFile(f.path),
  }));

  const byAgent: Record<string, string[]> = {};
  if (groupByAgent) {
    for (const gap of gaps) {
      if (!byAgent[gap.suggestedAgent]) {
        byAgent[gap.suggestedAgent] = [];
      }
      byAgent[gap.suggestedAgent].push(gap.file);
    }
  }

  return {
    totalGaps: gaps.length,
    gaps,
    byAgent,
    summary: `${gaps.length} files below ${threshold}% coverage threshold`,
  };
}

/**
 * Validate and normalize path to prevent directory traversal
 * Returns null if path is invalid or attempts traversal
 */
function validateProjectPath(inputPath: string | undefined): string | null {
  const { resolve, normalize, isAbsolute } = require('path');

  // Default to cwd if not provided
  const basePath = inputPath || process.cwd();

  // Normalize and resolve the path
  const normalizedPath = normalize(basePath);
  const resolvedPath = isAbsolute(normalizedPath) ? normalizedPath : resolve(process.cwd(), normalizedPath);

  // Check for path traversal attempts
  if (normalizedPath.includes('..') && !resolvedPath.startsWith(process.cwd())) {
    // Only allow .. if it resolves within or above cwd
    // For safety, reject any path with .. that goes outside project
    return null;
  }

  // Additional validation: no null bytes or control characters
  if (/[\x00-\x1f]/.test(resolvedPath)) {
    return null;
  }

  // Limit path length to prevent DoS
  if (resolvedPath.length > 4096) {
    return null;
  }

  return resolvedPath;
}

/**
 * Load project coverage data (async with caching)
 */
async function loadProjectCoverage(projectRoot?: string, skipCache?: boolean): Promise<CoverageReport | null> {
  // Validate and normalize the project root path
  const root = validateProjectPath(projectRoot);
  if (!root) {
    // Invalid path detected, return null safely
    return null;
  }

  // Check cache first
  if (!skipCache) {
    const cached = coverageDataCache.get(root);
    if (cached && Date.now() - cached.timestamp < COVERAGE_CACHE_TTL_MS) {
      return cached.report;
    }
  }

  const { existsSync } = require('fs');
  const { readFile } = require('fs/promises');
  const { join, normalize } = require('path');

  // Try common coverage locations (all relative to validated root)
  const coverageLocations = [
    ['coverage', 'coverage-final.json'],
    ['coverage', 'lcov.info'],
    ['.nyc_output', 'coverage.json'],
    ['coverage.json'],
  ];

  for (const pathParts of coverageLocations) {
    // Join and normalize to prevent traversal in coverage paths
    const coveragePath = normalize(join(root, ...pathParts));

    // Ensure the coverage path is still within or under root
    if (!coveragePath.startsWith(root)) {
      continue;
    }

    if (existsSync(coveragePath)) {
      try {
        // Use async file read for non-blocking I/O
        const content = await readFile(coveragePath, 'utf-8');
        const router = new CoverageRouter();
        let report: CoverageReport | null = null;

        if (coveragePath.endsWith('.json')) {
          report = router.parseCoverage(JSON.parse(content), 'istanbul');
        } else if (coveragePath.endsWith('.info')) {
          report = router.parseCoverage(content, 'lcov');
        }

        // Cache the result
        if (report) {
          coverageDataCache.set(root, { report, timestamp: Date.now() });
          return report;
        }
      } catch {
        // Continue to next path
      }
    }
  }

  return null;
}

/**
 * Calculate priority for a file based on path and coverage
 */
function calculateFilePriority(path: string, coverage: number, threshold: number): number {
  let priority = 5;

  // Gap-based priority
  const gap = threshold - coverage;
  if (gap > 50) priority += 3;
  else if (gap > 30) priority += 2;
  else if (gap > 15) priority += 1;

  // Path-based priority
  const lowerPath = path.toLowerCase();
  if (/core|main|index/.test(lowerPath)) priority += 2;
  if (/auth|security|payment/.test(lowerPath)) priority += 3;
  if (/api|service|controller/.test(lowerPath)) priority += 1;
  if (/util|helper/.test(lowerPath)) priority -= 1;
  if (/test|spec|mock/.test(lowerPath)) priority -= 2;

  return Math.max(1, Math.min(10, priority));
}

/**
 * Suggest tests for a file based on its coverage
 */
function suggestTestsForFile(file: FileCoverage): string[] {
  const suggestions: string[] = [];

  if (file.uncoveredLines.length > 10) {
    suggestions.push('Add unit tests for uncovered code paths');
  }
  if (file.branchCoverage < 50) {
    suggestions.push('Add branch coverage tests (if/else paths)');
  }
  if (file.functionCoverage < 80) {
    suggestions.push('Add tests for untested functions');
  }

  const lowerPath = file.path.toLowerCase();
  if (/api|endpoint|route|handler/.test(lowerPath)) {
    suggestions.push('Add integration tests for API endpoints');
  }
  if (/component|view|ui/.test(lowerPath)) {
    suggestions.push('Add component tests with user interactions');
  }

  return suggestions.slice(0, 3);
}

/**
 * Suggest an agent type for a file
 */
function suggestAgentForFile(path: string): string {
  const lowerPath = path.toLowerCase();

  if (/api|endpoint|route|controller/.test(lowerPath)) return 'api-tester';
  if (/component|view|ui|page/.test(lowerPath)) return 'ui-tester';
  if (/service|repository|model/.test(lowerPath)) return 'unit-tester';
  if (/integration|e2e/.test(lowerPath)) return 'e2e-tester';
  if (/util|helper|lib/.test(lowerPath)) return 'unit-tester';

  return 'tester';
}
