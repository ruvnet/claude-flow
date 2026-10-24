/**
 * Security Regression Checker
 *
 * Detects new security vulnerabilities and regressions.
 *
 * @module v3/testing/regression/security-regression
 */

import { readFile, readdir, stat } from 'fs/promises';
import { join, extname } from 'path';

/**
 * Security check definition
 */
export interface SecurityCheck {
  id: string;
  name: string;
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  passed: boolean;
  message: string;
  location?: string;
  line?: number;
}

/**
 * Security vulnerability
 */
export interface SecurityVulnerability {
  id: string;
  type: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  file: string;
  line: number;
  description: string;
  recommendation: string;
  cwe?: string;
}

/**
 * Security report
 */
export interface SecurityReport {
  timestamp: Date;
  duration: number;
  passed: boolean;
  checks: SecurityCheck[];
  vulnerabilities: SecurityVulnerability[];
  newIssues: string[];
  resolvedIssues: string[];
  summary: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
}

/**
 * Security patterns to check
 */
const SECURITY_PATTERNS = [
  {
    id: 'sql-injection',
    name: 'SQL Injection',
    pattern: /\$\{[^}]*\}.*(?:SELECT|INSERT|UPDATE|DELETE|FROM|WHERE)/gi,
    altPattern: /['"`]\s*\+\s*\w+.*(?:SELECT|INSERT|UPDATE|DELETE|FROM|WHERE)/gi,
    severity: 'critical' as const,
    cwe: 'CWE-89',
    description: 'Potential SQL injection vulnerability',
    recommendation: 'Use parameterized queries instead of string concatenation',
  },
  {
    id: 'command-injection',
    name: 'Command Injection',
    pattern: /exec\s*\(\s*['"`].*\$\{|exec\s*\(\s*\w+\s*\+/gi,
    altPattern: /child_process.*exec.*\+|spawn.*shell:\s*true/gi,
    severity: 'critical' as const,
    cwe: 'CWE-78',
    description: 'Potential command injection vulnerability',
    recommendation: 'Avoid shell execution with user input; use parameterized commands',
  },
  {
    id: 'path-traversal',
    name: 'Path Traversal',
    pattern: /\.\.\//g,
    altPattern: /path\.join.*req\.|path\.resolve.*req\./gi,
    severity: 'high' as const,
    cwe: 'CWE-22',
    description: 'Potential path traversal vulnerability',
    recommendation: 'Validate and sanitize file paths; use path.normalize()',
  },
  {
    id: 'weak-random',
    name: 'Weak Random',
    pattern: /Math\.random\(\)/g,
    severity: 'medium' as const,
    cwe: 'CWE-330',
    description: 'Use of weak random number generator',
    recommendation: 'Use crypto.randomBytes() or crypto.randomUUID() for security-sensitive operations',
  },
  {
    id: 'hardcoded-secret',
    name: 'Hardcoded Secret',
    pattern: /(?:password|secret|api_key|apikey|token)\s*[=:]\s*['"][^'"]{8,}/gi,
    severity: 'high' as const,
    cwe: 'CWE-798',
    description: 'Potential hardcoded secret or credential',
    recommendation: 'Use environment variables or secure vault for secrets',
  },
  {
    id: 'cors-wildcard',
    name: 'CORS Wildcard',
    pattern: /origin:\s*['"]?\*/gi,
    altPattern: /Access-Control-Allow-Origin.*\*/gi,
    severity: 'medium' as const,
    cwe: 'CWE-942',
    description: 'Permissive CORS configuration',
    recommendation: 'Specify explicit allowed origins instead of wildcard',
  },
  {
    id: 'eval-usage',
    name: 'Eval Usage',
    pattern: /\beval\s*\(/gi,
    altPattern: /new\s+Function\s*\(/gi,
    severity: 'high' as const,
    cwe: 'CWE-95',
    description: 'Use of eval() or dynamic code execution',
    recommendation: 'Avoid eval(); use safer alternatives like JSON.parse()',
  },
  {
    id: 'unsafe-regex',
    name: 'Unsafe Regex',
    pattern: /new\s+RegExp\s*\(\s*\w+\s*\)/gi,
    severity: 'medium' as const,
    cwe: 'CWE-1333',
    description: 'Potentially unsafe dynamic regex construction',
    recommendation: 'Validate and escape regex input; consider using regex-safe libraries',
  },
  {
    id: 'missing-csrf',
    name: 'Missing CSRF Protection',
    pattern: /router\.(?:post|put|patch|delete)\s*\([^)]*\)/gi,
    severity: 'medium' as const,
    cwe: 'CWE-352',
    description: 'Endpoint may lack CSRF protection',
    recommendation: 'Implement CSRF tokens for state-changing operations',
  },
  {
    id: 'insecure-http',
    name: 'Insecure HTTP',
    pattern: /http:\/\/(?!localhost|127\.0\.0\.1)/gi,
    severity: 'low' as const,
    cwe: 'CWE-319',
    description: 'Use of insecure HTTP protocol',
    recommendation: 'Use HTTPS for all external communications',
  },
];

/**
 * File extensions to scan
 */
const SCANNABLE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

/**
 * Directories to exclude
 */
const EXCLUDED_DIRS = ['node_modules', 'dist', 'build', '.git', 'coverage', '__tests__'];

/**
 * Security Regression Checker
 *
 * Scans codebase for security vulnerabilities.
 */
export class SecurityRegressionChecker {
  private readonly basePath: string;

  constructor(basePath: string = process.cwd()) {
    this.basePath = basePath;
  }

  /**
   * Run full security check
   */
  async check(): Promise<SecurityReport> {
    const startTime = Date.now();
    const vulnerabilities: SecurityVulnerability[] = [];
    const checks: SecurityCheck[] = [];

    // Scan all TypeScript/JavaScript files
    const files = await this.findFiles(join(this.basePath, 'v3'));

    for (const file of files) {
      const fileVulns = await this.scanFile(file);
      vulnerabilities.push(...fileVulns);
    }

    // Create checks from patterns
    for (const pattern of SECURITY_PATTERNS) {
      const patternVulns = vulnerabilities.filter((v) => v.type === pattern.id);
      checks.push({
        id: pattern.id,
        name: pattern.name,
        description: pattern.description,
        severity: pattern.severity,
        passed: patternVulns.length === 0,
        message: patternVulns.length === 0
          ? `No ${pattern.name} vulnerabilities found`
          : `Found ${patternVulns.length} potential ${pattern.name} issues`,
      });
    }

    // Calculate summary
    const summary = {
      critical: vulnerabilities.filter((v) => v.severity === 'critical').length,
      high: vulnerabilities.filter((v) => v.severity === 'high').length,
      medium: vulnerabilities.filter((v) => v.severity === 'medium').length,
      low: vulnerabilities.filter((v) => v.severity === 'low').length,
    };

    const report: SecurityReport = {
      timestamp: new Date(),
      duration: Date.now() - startTime,
      passed: summary.critical === 0 && summary.high === 0,
      checks,
      vulnerabilities,
      newIssues: vulnerabilities.map((v) => `${v.severity.toUpperCase()}: ${v.type} in ${v.file}:${v.line}`),
      resolvedIssues: [],
      summary,
    };

    return report;
  }

  /**
   * Find all scannable files
   */
  private async findFiles(dir: string): Promise<string[]> {
    const files: string[] = [];

    try {
      const entries = await readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(dir, entry.name);

        if (entry.isDirectory()) {
          if (!EXCLUDED_DIRS.includes(entry.name)) {
            const subFiles = await this.findFiles(fullPath);
            files.push(...subFiles);
          }
        } else if (entry.isFile()) {
          if (SCANNABLE_EXTENSIONS.includes(extname(entry.name))) {
            files.push(fullPath);
          }
        }
      }
    } catch {
      // Directory doesn't exist or not accessible
    }

    return files;
  }

  /**
   * Scan a single file for vulnerabilities
   */
  private async scanFile(filePath: string): Promise<SecurityVulnerability[]> {
    const vulnerabilities: SecurityVulnerability[] = [];

    try {
      const content = await readFile(filePath, 'utf-8');
      const lines = content.split('\n');

      for (const pattern of SECURITY_PATTERNS) {
        // Skip weak-random checks in test files
        if (pattern.id === 'weak-random' && filePath.includes('test')) {
          continue;
        }

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;

          // Check main pattern
          if (pattern.pattern.test(line)) {
            // Reset lastIndex for global patterns
            pattern.pattern.lastIndex = 0;

            vulnerabilities.push({
              id: `${pattern.id}-${filePath}-${i + 1}`,
              type: pattern.id,
              severity: pattern.severity,
              file: filePath.replace(this.basePath + '/', ''),
              line: i + 1,
              description: pattern.description,
              recommendation: pattern.recommendation,
              cwe: pattern.cwe,
            });
          }

          // Check alternate pattern if exists
          if (pattern.altPattern && pattern.altPattern.test(line)) {
            pattern.altPattern.lastIndex = 0;

            // Avoid duplicates
            const existingVuln = vulnerabilities.find(
              (v) => v.type === pattern.id && v.line === i + 1 && v.file === filePath.replace(this.basePath + '/', '')
            );

            if (!existingVuln) {
              vulnerabilities.push({
                id: `${pattern.id}-${filePath}-${i + 1}`,
                type: pattern.id,
                severity: pattern.severity,
                file: filePath.replace(this.basePath + '/', ''),
                line: i + 1,
                description: pattern.description,
                recommendation: pattern.recommendation,
                cwe: pattern.cwe,
              });
            }
          }
        }
      }
    } catch {
      // File not readable
    }

    return vulnerabilities;
  }
}
