/**
 * Diff Classifier for Change Analysis
 */

export interface DiffClassifierConfig {
  maxDiffSize: number;
  classifyByImpact: boolean;
  detectRefactoring: boolean;
  minConfidence: number;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  content: string;
  changes: DiffChange[];
}

export interface DiffChange {
  type: 'add' | 'remove' | 'context';
  lineNumber: number;
  content: string;
}

export interface DiffClassification {
  primary: 'feature' | 'bugfix' | 'refactor' | 'docs' | 'test' | 'config' | 'style' | 'unknown';
  secondary: string[];
  confidence: number;
  impactLevel: 'low' | 'medium' | 'high' | 'critical';
  suggestedReviewers: string[];
  testingStrategy: string[];
  riskFactors: string[];
}

export interface FileDiff {
  path: string;
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
  classification: DiffClassification;
}

export interface DiffAnalysis {
  files: FileDiff[];
  overall: DiffClassification;
  stats: {
    totalAdditions: number;
    totalDeletions: number;
    filesChanged: number;
    avgConfidence: number;
  };
  timestamp: number;
}

const DEFAULT_CONFIG: DiffClassifierConfig = {
  maxDiffSize: 10000,
  classifyByImpact: true,
  detectRefactoring: true,
  minConfidence: 0.5,
};

const CLASSIFICATION_PATTERNS: Record<string, RegExp[]> = {
  feature: [/^feat/, /add.*feature/, /implement/, /new.*functionality/i],
  bugfix: [/^fix/, /bug/, /patch/, /resolve.*issue/i, /hotfix/i],
  refactor: [/^refactor/, /restructure/, /reorganize/, /cleanup/i, /rename/i],
  docs: [/^docs?/, /documentation/, /readme/i, /comment/i, /\.md$/i],
  test: [/^test/, /spec/, /\.test\.[jt]sx?$/, /\.spec\.[jt]sx?$/, /__tests__/],
  config: [/^config/, /\.config\./, /package\.json/, /tsconfig/, /\.env/],
  style: [/^style/, /format/, /lint/, /prettier/, /eslint/],
};

const IMPACT_KEYWORDS: Record<string, number> = {
  security: 3, auth: 3, payment: 3, database: 2, api: 2, core: 2,
  util: 1, helper: 1, test: 0, mock: 0, fixture: 0,
};

export class DiffClassifier {
  private config: DiffClassifierConfig;
  private ruvectorEngine: unknown = null;
  private useNative = false;
  private classificationCache: Map<string, DiffClassification> = new Map();

  constructor(config: Partial<DiffClassifierConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async initialize(): Promise<void> {
    try {
      // @ruvector/diff is optional - gracefully fallback if not installed
      const ruvector = await import('@ruvector/diff' as string).catch(() => null);
      if (ruvector) {
        this.ruvectorEngine = (ruvector as any).createDiffClassifier?.(this.config);
        this.useNative = !!this.ruvectorEngine;
      }
    } catch { this.useNative = false; }
  }

  parseDiff(diffContent: string): FileDiff[] {
    const files: FileDiff[] = [];
    const fileBlocks = diffContent.split(/^diff --git/m).filter(Boolean);
    for (const block of fileBlocks) {
      const pathMatch = block.match(/a\/(.+?)\s+b\/(.+)/);
      if (!pathMatch) continue;
      const path = pathMatch[2];
      const hunks = this.parseHunks(block);
      const additions = hunks.reduce((sum, h) => sum + h.changes.filter(c => c.type === 'add').length, 0);
      const deletions = hunks.reduce((sum, h) => sum + h.changes.filter(c => c.type === 'remove').length, 0);
      const classification = this.classifyFile(path, hunks);
      files.push({ path, hunks, additions, deletions, classification });
    }
    return files;
  }

  classify(files: FileDiff[]): DiffAnalysis {
    const overall = this.computeOverallClassification(files);
    const stats = {
      totalAdditions: files.reduce((sum, f) => sum + f.additions, 0),
      totalDeletions: files.reduce((sum, f) => sum + f.deletions, 0),
      filesChanged: files.length,
      avgConfidence: files.length > 0 ? files.reduce((sum, f) => sum + f.classification.confidence, 0) / files.length : 0,
    };
    return { files, overall, stats, timestamp: Date.now() };
  }

  classifyCommitMessage(message: string): DiffClassification['primary'] {
    const lowerMessage = message.toLowerCase();
    for (const [type, patterns] of Object.entries(CLASSIFICATION_PATTERNS)) {
      for (const pattern of patterns) {
        if (pattern.test(lowerMessage)) return type as DiffClassification['primary'];
      }
    }
    return 'unknown';
  }

  getStats(): Record<string, number | boolean> {
    return { useNative: this.useNative, cacheSize: this.classificationCache.size };
  }

  clearCache(): void { this.classificationCache.clear(); }

  private parseHunks(block: string): DiffHunk[] {
    const hunks: DiffHunk[] = [];
    const hunkMatches = block.matchAll(/@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@([^\n]*)\n([\s\S]*?)(?=@@|$)/g);
    for (const match of hunkMatches) {
      const oldStart = parseInt(match[1], 10);
      const oldLines = parseInt(match[2] || '1', 10);
      const newStart = parseInt(match[3], 10);
      const newLines = parseInt(match[4] || '1', 10);
      const content = match[6] || '';
      const changes = this.parseChanges(content, newStart);
      hunks.push({ oldStart, oldLines, newStart, newLines, content, changes });
    }
    return hunks;
  }

  private parseChanges(content: string, startLine: number): DiffChange[] {
    const changes: DiffChange[] = [];
    const lines = content.split('\n');
    let lineNumber = startLine;
    for (const line of lines) {
      if (line.startsWith('+')) { changes.push({ type: 'add', lineNumber, content: line.substring(1) }); lineNumber++; }
      else if (line.startsWith('-')) { changes.push({ type: 'remove', lineNumber: -1, content: line.substring(1) }); }
      else if (line.startsWith(' ') || line === '') { changes.push({ type: 'context', lineNumber, content: line.substring(1) || '' }); lineNumber++; }
    }
    return changes;
  }

  private classifyFile(path: string, hunks: DiffHunk[]): DiffClassification {
    const cacheKey = this.getCacheKey(path, hunks);
    const cached = this.classificationCache.get(cacheKey);
    if (cached) return cached;
    const primary = this.determinePrimaryClassification(path, hunks);
    const secondary = this.determineSecondaryClassifications(path, hunks, primary);
    const confidence = this.calculateConfidence(path, hunks, primary);
    const impactLevel = this.determineImpactLevel(path, hunks);
    const suggestedReviewers = this.suggestReviewers(path, primary, impactLevel);
    const testingStrategy = this.determineTestingStrategy(path, primary, impactLevel);
    const riskFactors = this.identifyRiskFactors(path, hunks, impactLevel);
    const classification: DiffClassification = { primary, secondary, confidence, impactLevel, suggestedReviewers, testingStrategy, riskFactors };
    this.classificationCache.set(cacheKey, classification);
    return classification;
  }

  private getCacheKey(path: string, hunks: DiffHunk[]): string {
    const hunkSummary = hunks.map(h => h.oldStart + ':' + h.newStart).join(',');
    return path + ':' + hunkSummary;
  }

  private determinePrimaryClassification(path: string, hunks: DiffHunk[]): DiffClassification['primary'] {
    for (const [type, patterns] of Object.entries(CLASSIFICATION_PATTERNS)) {
      for (const pattern of patterns) { if (pattern.test(path)) return type as DiffClassification['primary']; }
    }
    const allContent = hunks.flatMap(h => h.changes.map(c => c.content)).join('\n').toLowerCase();
    if (/function|class|interface|type\s+\w+/.test(allContent) && hunks.some(h => h.changes.filter(c => c.type === 'add').length > 10)) return 'feature';
    if (/fix|bug|issue|error|exception/.test(allContent)) return 'bugfix';
    if (this.config.detectRefactoring && this.isRefactoring(hunks)) return 'refactor';
    return 'unknown';
  }

  private isRefactoring(hunks: DiffHunk[]): boolean {
    let totalAdds = 0, totalRemoves = 0;
    for (const hunk of hunks) { for (const change of hunk.changes) { if (change.type === 'add') totalAdds++; else if (change.type === 'remove') totalRemoves++; } }
    const ratio = totalAdds > 0 ? totalRemoves / totalAdds : 0;
    return ratio > 0.7 && ratio < 1.4 && totalAdds > 5;
  }

  private determineSecondaryClassifications(path: string, hunks: DiffHunk[], primary: DiffClassification['primary']): string[] {
    const secondary: string[] = [];
    for (const [type, patterns] of Object.entries(CLASSIFICATION_PATTERNS)) {
      if (type === primary) continue;
      for (const pattern of patterns) { if (pattern.test(path)) { secondary.push(type); break; } }
    }
    return secondary.slice(0, 3);
  }

  private calculateConfidence(path: string, hunks: DiffHunk[], primary: DiffClassification['primary']): number {
    let confidence = 0.5;
    for (const patterns of Object.values(CLASSIFICATION_PATTERNS)) { for (const pattern of patterns) { if (pattern.test(path)) { confidence += 0.2; break; } } }
    const totalChanges = hunks.reduce((sum, h) => sum + h.changes.length, 0);
    if (totalChanges > 10) confidence += 0.1;
    if (totalChanges > 50) confidence += 0.1;
    if (primary !== 'unknown') confidence += 0.1;
    return Math.min(1, confidence);
  }

  private determineImpactLevel(path: string, hunks: DiffHunk[]): DiffClassification['impactLevel'] {
    let score = 0;
    const lowerPath = path.toLowerCase();
    for (const [keyword, weight] of Object.entries(IMPACT_KEYWORDS)) { if (lowerPath.includes(keyword)) score = Math.max(score, weight); }
    const totalChanges = hunks.reduce((sum, h) => sum + h.changes.filter(c => c.type !== 'context').length, 0);
    if (totalChanges > 100) score = Math.max(score, 2);
    if (totalChanges > 300) score = Math.max(score, 3);
    if (score >= 3) return 'critical';
    if (score >= 2) return 'high';
    if (score >= 1) return 'medium';
    return 'low';
  }

  private suggestReviewers(path: string, primary: DiffClassification['primary'], impact: DiffClassification['impactLevel']): string[] {
    const reviewers: string[] = [];
    const typeReviewers: Record<string, string[]> = { feature: ['tech-lead', 'product-owner'], bugfix: ['qa-engineer', 'developer'], refactor: ['senior-developer', 'architect'], docs: ['tech-writer', 'developer'], test: ['qa-engineer', 'developer'], config: ['devops', 'tech-lead'], style: ['developer'], unknown: ['developer'] };
    reviewers.push(...(typeReviewers[primary] || typeReviewers.unknown));
    if (impact === 'critical' || impact === 'high') reviewers.push('security-reviewer');
    if (/security|auth/.test(path)) reviewers.push('security-team');
    if (/database|migration/.test(path)) reviewers.push('dba');
    return [...new Set(reviewers)].slice(0, 4);
  }

  private determineTestingStrategy(path: string, primary: DiffClassification['primary'], impact: DiffClassification['impactLevel']): string[] {
    const strategies: string[] = [];
    if (primary !== 'test') strategies.push('unit-tests');
    if (primary === 'feature') strategies.push('integration-tests');
    if (impact === 'high' || impact === 'critical') { strategies.push('regression-tests'); strategies.push('e2e-tests'); }
    if (/api|endpoint|route|handler/.test(path)) strategies.push('api-contract-tests');
    if (/security|auth|crypto/.test(path)) strategies.push('security-audit');
    return strategies.slice(0, 5);
  }

  private identifyRiskFactors(path: string, hunks: DiffHunk[], impact: DiffClassification['impactLevel']): string[] {
    const risks: string[] = [];
    const totalChanges = hunks.reduce((sum, h) => sum + h.changes.length, 0);
    if (totalChanges > 200) risks.push('Large change set - increased review time needed');
    if (impact === 'critical') risks.push('Critical system component - requires careful review');
    if (impact === 'high') risks.push('High-impact area - monitor after deployment');
    if (/security|auth/.test(path)) risks.push('Security-sensitive code');
    if (/database|migration/.test(path)) risks.push('Database changes - ensure backup strategy');
    if (/config|env/.test(path)) risks.push('Configuration changes - verify all environments');
    const allContent = hunks.flatMap(h => h.changes.map(c => c.content)).join('\n');
    if (/TODO|FIXME|HACK/.test(allContent)) risks.push('Contains TODO/FIXME comments');
    if (/password|secret|key|token/i.test(allContent)) risks.push('Potential secrets in code');
    return risks.slice(0, 5);
  }

  private computeOverallClassification(files: FileDiff[]): DiffClassification {
    if (files.length === 0) return { primary: 'unknown', secondary: [], confidence: 0, impactLevel: 'low', suggestedReviewers: [], testingStrategy: [], riskFactors: [] };
    const primaryCounts: Record<string, number> = {};
    for (const file of files) { const p = file.classification.primary; primaryCounts[p] = (primaryCounts[p] || 0) + 1; }
    let primary: DiffClassification['primary'] = 'unknown';
    let maxCount = 0;
    for (const [type, count] of Object.entries(primaryCounts)) { if (count > maxCount) { maxCount = count; primary = type as DiffClassification['primary']; } }
    const secondaryCounts: Record<string, number> = {};
    for (const file of files) { for (const s of file.classification.secondary) { secondaryCounts[s] = (secondaryCounts[s] || 0) + 1; } }
    const secondary = Object.entries(secondaryCounts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([type]) => type);
    const confidence = files.reduce((sum, f) => sum + f.classification.confidence, 0) / files.length;
    const impactOrder: DiffClassification['impactLevel'][] = ['low', 'medium', 'high', 'critical'];
    let impactLevel: DiffClassification['impactLevel'] = 'low';
    for (const file of files) { if (impactOrder.indexOf(file.classification.impactLevel) > impactOrder.indexOf(impactLevel)) impactLevel = file.classification.impactLevel; }
    const reviewers = [...new Set(files.flatMap(f => f.classification.suggestedReviewers))].slice(0, 5);
    const testingStrategy = [...new Set(files.flatMap(f => f.classification.testingStrategy))].slice(0, 5);
    const riskFactors = [...new Set(files.flatMap(f => f.classification.riskFactors))].slice(0, 5);
    return { primary, secondary, confidence, impactLevel, suggestedReviewers: reviewers, testingStrategy, riskFactors };
  }
}

export function createDiffClassifier(config?: Partial<DiffClassifierConfig>): DiffClassifier {
  return new DiffClassifier(config);
}

// ============================================================================
// Additional Exports for MCP Tools
// ============================================================================

/**
 * Risk level type for file risk assessment
 */
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

/**
 * Diff file interface for analyze tools
 */
export interface DiffFile {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
  hunks: number;
  binary: boolean;
}

/**
 * File risk assessment result
 */
export interface FileRisk {
  file: string;
  risk: RiskLevel;
  score: number;
  reasons: string[];
}

/**
 * Overall risk assessment result
 */
export interface OverallRisk {
  overall: RiskLevel;
  score: number;
  breakdown: { low: number; medium: number; high: number; critical: number };
}

/**
 * Diff analysis result
 */
export interface DiffAnalysisResult {
  ref: string;
  timestamp: number;
  files: DiffFile[];
  risk: OverallRisk;
  classification: DiffClassification;
  summary: string;
  fileRisks?: FileRisk[];
  recommendedReviewers?: string[];
}

// ============================================================================
// Optimized Git Diff Functions
// ============================================================================

// Cache for diff results (TTL-based)
const diffCache = new Map<string, { files: DiffFile[]; timestamp: number }>();
const CACHE_TTL_MS = 5000; // 5 seconds - short TTL since diffs change frequently

/**
 * Validate git ref to prevent command injection
 * Only allows safe characters: alphanumeric, -, _, /, ., ~, ^
 */
function validateGitRef(ref: string): void {
  // Block shell metacharacters and dangerous patterns
  if (!/^[a-zA-Z0-9_\-./~^@]+$/.test(ref)) {
    throw new Error(`Invalid git ref: contains unsafe characters`);
  }
  // Block multiple dots (path traversal)
  if (ref.includes('..') && !ref.match(/^[a-zA-Z0-9_\-]+\.\.\.?[a-zA-Z0-9_\-]+$/)) {
    if (!/^\w+\.\.[.\w]+$/.test(ref)) {
      throw new Error(`Invalid git ref: suspicious pattern`);
    }
  }
  // Max length check
  if (ref.length > 256) {
    throw new Error(`Invalid git ref: too long`);
  }
}

/**
 * Get git diff statistics using SINGLE combined command (optimized)
 * Replaces two separate git commands with one
 */
export function getGitDiffNumstat(ref: string = 'HEAD'): DiffFile[] {
  // SECURITY: Validate git ref to prevent command injection
  validateGitRef(ref);

  // Check cache first
  const cacheKey = `numstat:${ref}`;
  const cached = diffCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.files;
  }

  const { execFileSync } = require('child_process');
  try {
    // SECURITY: Use execFileSync with args array instead of shell string
    // This prevents command injection via the ref parameter
    const numstatOutput = execFileSync('git', [
      'diff', '--numstat', '--diff-filter=ACDMRTUXB', ref
    ], { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });

    const statusOutput = execFileSync('git', [
      'diff', '--name-status', ref
    ], { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });

    const output = numstatOutput + '---STATUS---' + statusOutput;

    const [numstatPart, statusPart] = output.split('---STATUS---');

    // Parse status (usually smaller, parse first)
    const statusMap = new Map<string, string>();
    if (statusPart) {
      for (const line of statusPart.trim().split('\n')) {
        if (!line) continue;
        const [status, ...pathParts] = line.split('\t');
        const path = pathParts[pathParts.length - 1] || pathParts[0];
        if (path) statusMap.set(path, status.charAt(0));
      }
    }

    // Parse numstat
    const files: DiffFile[] = [];
    if (numstatPart) {
      for (const line of numstatPart.trim().split('\n')) {
        if (!line) continue;
        const [addStr, delStr, path] = line.split('\t');
        if (!path) continue;

        const additions = addStr === '-' ? 0 : parseInt(addStr, 10) || 0;
        const deletions = delStr === '-' ? 0 : parseInt(delStr, 10) || 0;
        const binary = addStr === '-' && delStr === '-';

        const statusChar = statusMap.get(path) || 'M';
        let status: DiffFile['status'] = 'modified';
        switch (statusChar) {
          case 'A': status = 'added'; break;
          case 'D': status = 'deleted'; break;
          case 'R': status = 'renamed'; break;
          default: status = 'modified';
        }

        files.push({ path, status, additions, deletions, hunks: 1, binary });
      }
    }

    // Cache the result
    diffCache.set(cacheKey, { files, timestamp: Date.now() });

    return files;
  } catch {
    return [];
  }
}

/**
 * Async version of getGitDiffNumstat for non-blocking operation
 */
export async function getGitDiffNumstatAsync(ref: string = 'HEAD'): Promise<DiffFile[]> {
  // SECURITY: Validate git ref to prevent command injection
  validateGitRef(ref);

  // Check cache first
  const cacheKey = `numstat:${ref}`;
  const cached = diffCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.files;
  }

  const { execFile } = require('child_process');
  const { promisify } = require('util');
  const execFileAsync = promisify(execFile);

  try {
    // SECURITY: Use execFile with args array instead of shell string
    const { stdout: numstatOutput } = await execFileAsync('git', [
      'diff', '--numstat', '--diff-filter=ACDMRTUXB', ref
    ], { maxBuffer: 10 * 1024 * 1024 });

    const { stdout: statusOutput } = await execFileAsync('git', [
      'diff', '--name-status', ref
    ], { maxBuffer: 10 * 1024 * 1024 });

    const stdout = numstatOutput + '---STATUS---' + statusOutput;

    const [numstatPart, statusPart] = stdout.split('---STATUS---');

    const statusMap = new Map<string, string>();
    if (statusPart) {
      for (const line of statusPart.trim().split('\n')) {
        if (!line) continue;
        const [status, ...pathParts] = line.split('\t');
        const path = pathParts[pathParts.length - 1] || pathParts[0];
        if (path) statusMap.set(path, status.charAt(0));
      }
    }

    const files: DiffFile[] = [];
    if (numstatPart) {
      for (const line of numstatPart.trim().split('\n')) {
        if (!line) continue;
        const [addStr, delStr, path] = line.split('\t');
        if (!path) continue;

        const additions = addStr === '-' ? 0 : parseInt(addStr, 10) || 0;
        const deletions = delStr === '-' ? 0 : parseInt(delStr, 10) || 0;
        const binary = addStr === '-' && delStr === '-';

        const statusChar = statusMap.get(path) || 'M';
        let status: DiffFile['status'] = 'modified';
        switch (statusChar) {
          case 'A': status = 'added'; break;
          case 'D': status = 'deleted'; break;
          case 'R': status = 'renamed'; break;
          default: status = 'modified';
        }

        files.push({ path, status, additions, deletions, hunks: 1, binary });
      }
    }

    diffCache.set(cacheKey, { files, timestamp: Date.now() });
    return files;
  } catch {
    return [];
  }
}

/**
 * Clear the diff cache (call when git state changes)
 */
export function clearDiffCache(): void {
  diffCache.clear();
}

/**
 * Assess risk for a single file
 */
export function assessFileRisk(file: DiffFile): FileRisk {
  const reasons: string[] = [];
  let score = 0;

  // Size-based risk
  const totalChanges = file.additions + file.deletions;
  if (totalChanges > 300) {
    score += 30;
    reasons.push('Large change size (>300 lines)');
  } else if (totalChanges > 100) {
    score += 15;
    reasons.push('Medium change size (>100 lines)');
  }

  // Path-based risk
  const lowerPath = file.path.toLowerCase();
  if (/security|auth|crypto|password/.test(lowerPath)) {
    score += 40;
    reasons.push('Security-sensitive file');
  }
  if (/payment|billing|transaction/.test(lowerPath)) {
    score += 35;
    reasons.push('Payment-related file');
  }
  if (/database|migration|schema/.test(lowerPath)) {
    score += 25;
    reasons.push('Database-related file');
  }
  if (/core|main|index/.test(lowerPath)) {
    score += 15;
    reasons.push('Core module');
  }
  if (/config|env|settings/.test(lowerPath)) {
    score += 20;
    reasons.push('Configuration file');
  }

  // Status-based risk
  if (file.status === 'deleted') {
    score += 10;
    reasons.push('File deleted');
  }

  // Binary file risk
  if (file.binary) {
    score += 5;
    reasons.push('Binary file');
  }

  let risk: RiskLevel = 'low';
  if (score >= 60) risk = 'critical';
  else if (score >= 40) risk = 'high';
  else if (score >= 20) risk = 'medium';

  return { file: file.path, risk, score: Math.min(100, score), reasons };
}

/**
 * Assess overall risk from files and file risks
 */
export function assessOverallRisk(files: DiffFile[], fileRisks: FileRisk[]): OverallRisk {
  const breakdown = { low: 0, medium: 0, high: 0, critical: 0 };
  let totalScore = 0;

  for (const fr of fileRisks) {
    breakdown[fr.risk]++;
    totalScore += fr.score;
  }

  const avgScore = fileRisks.length > 0 ? totalScore / fileRisks.length : 0;

  // Weight more heavily towards high/critical files
  const weightedScore = avgScore + (breakdown.critical * 15) + (breakdown.high * 10);

  let overall: RiskLevel = 'low';
  if (weightedScore >= 60 || breakdown.critical > 0) overall = 'critical';
  else if (weightedScore >= 40 || breakdown.high > 1) overall = 'high';
  else if (weightedScore >= 20 || breakdown.medium > 2) overall = 'medium';

  return { overall, score: Math.min(100, Math.round(weightedScore)), breakdown };
}

// Singleton classifier instance for reuse
let classifierInstance: DiffClassifier | null = null;

function getClassifier(): DiffClassifier {
  if (!classifierInstance) {
    classifierInstance = new DiffClassifier();
  }
  return classifierInstance;
}

/**
 * Classify a diff based on files (uses singleton classifier)
 */
export function classifyDiff(files: DiffFile[]): DiffClassification {
  const classifier = getClassifier();
  const fileDiffs: FileDiff[] = files.map(f => ({
    path: f.path,
    hunks: [],
    additions: f.additions,
    deletions: f.deletions,
    classification: classifier['classifyFile'](f.path, []),
  }));

  return classifier['computeOverallClassification'](fileDiffs);
}

/**
 * Suggest reviewers based on files and risks
 */
export function suggestReviewers(files: DiffFile[], fileRisks: FileRisk[]): string[] {
  const reviewers = new Set<string>();

  for (const file of files) {
    const lowerPath = file.path.toLowerCase();

    if (/security|auth|crypto/.test(lowerPath)) reviewers.add('security-team');
    if (/database|migration/.test(lowerPath)) reviewers.add('dba');
    if (/api|endpoint|route/.test(lowerPath)) reviewers.add('api-owner');
    if (/test|spec/.test(lowerPath)) reviewers.add('qa-engineer');
    if (/config|deploy|ci/.test(lowerPath)) reviewers.add('devops');
    if (/ui|component|style/.test(lowerPath)) reviewers.add('frontend-lead');
    if (/model|service|repository/.test(lowerPath)) reviewers.add('backend-lead');
  }

  // Add based on risk
  const hasHighRisk = fileRisks.some(fr => fr.risk === 'high' || fr.risk === 'critical');
  if (hasHighRisk) {
    reviewers.add('tech-lead');
    reviewers.add('senior-developer');
  }

  // Default reviewer
  if (reviewers.size === 0) {
    reviewers.add('developer');
  }

  return Array.from(reviewers).slice(0, 5);
}

// Analysis result cache
const analysisCache = new Map<string, { result: DiffAnalysisResult; timestamp: number }>();
const ANALYSIS_CACHE_TTL_MS = 3000; // 3 seconds

/**
 * Analyze a diff with full analysis (optimized with caching)
 */
export async function analyzeDiff(options: {
  ref?: string;
  useRuVector?: boolean;
  skipCache?: boolean;
}): Promise<DiffAnalysisResult> {
  const ref = options.ref || 'HEAD';

  // Check analysis cache (unless skipCache is true)
  if (!options.skipCache) {
    const cached = analysisCache.get(ref);
    if (cached && Date.now() - cached.timestamp < ANALYSIS_CACHE_TTL_MS) {
      return cached.result;
    }
  }

  // Use async git diff for non-blocking operation
  const files = await getGitDiffNumstatAsync(ref);

  // Parallel file risk assessment for large diffs
  const fileRisks = files.length > 20
    ? await Promise.all(files.map(f => Promise.resolve(assessFileRisk(f))))
    : files.map(assessFileRisk);

  const risk = assessOverallRisk(files, fileRisks);
  const classification = classifyDiff(files);
  const recommendedReviewers = suggestReviewers(files, fileRisks);

  const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
  const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);

  const result: DiffAnalysisResult = {
    ref,
    timestamp: Date.now(),
    files,
    risk,
    classification,
    summary: `${files.length} files changed (+${totalAdditions}/-${totalDeletions}), ${risk.overall} risk`,
    fileRisks,
    recommendedReviewers,
  };

  // Cache the result
  analysisCache.set(ref, { result, timestamp: Date.now() });

  return result;
}

/**
 * Synchronous version of analyzeDiff for backward compatibility
 */
export function analyzeDiffSync(options: {
  ref?: string;
  useRuVector?: boolean;
}): DiffAnalysisResult {
  const ref = options.ref || 'HEAD';

  // Check analysis cache
  const cached = analysisCache.get(ref);
  if (cached && Date.now() - cached.timestamp < ANALYSIS_CACHE_TTL_MS) {
    return cached.result;
  }

  const files = getGitDiffNumstat(ref);
  const fileRisks = files.map(assessFileRisk);
  const risk = assessOverallRisk(files, fileRisks);
  const classification = classifyDiff(files);
  const recommendedReviewers = suggestReviewers(files, fileRisks);

  const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
  const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);

  const result: DiffAnalysisResult = {
    ref,
    timestamp: Date.now(),
    files,
    risk,
    classification,
    summary: `${files.length} files changed (+${totalAdditions}/-${totalDeletions}), ${risk.overall} risk`,
    fileRisks,
    recommendedReviewers,
  };

  analysisCache.set(ref, { result, timestamp: Date.now() });
  return result;
}

/**
 * Clear all diff-related caches
 */
export function clearAllDiffCaches(): void {
  diffCache.clear();
  analysisCache.clear();
  classifierInstance?.clearCache();
}
