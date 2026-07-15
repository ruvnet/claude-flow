/**
 * PluginPublishScanner — pre-publish static/behavioral scanner (ADR-320 Part A).
 *
 * Implements P1 of ADR-320 (ruvnet/ruflo#2630): the AST-level symbolic rule
 * pass (Stage 1) that runs on every `plugins publish`, before a manifest is
 * accepted into the IPFS registry. Distinct from ADR-145's install-time
 * `PluginIntegrityVerifier`: this scans executable **code**, not description
 * text, and runs once per published version rather than once per install.
 *
 * Threat model
 * ------------
 * Four Grade-A 2026 papers (dream-cycle research, issue #2630) show
 * install-time / description-only scanning leaves code-level attacks
 * undetected:
 *
 *   - SCH (arXiv:2605.14460): 77.67% confidentiality breach, 67.33% RCE
 *     success, 0.00% detection rate against existing scanners. ADR-145
 *     Stage-2 targets this paper's natural-language variant; this scanner
 *     targets the same family at the code level.
 *   - Ecosystem survey (arXiv:2601.10338): 26.1% of 31,132 real skills carry
 *     a vulnerability; executable-script skills are 2.12x more likely to be
 *     vulnerable than manifest-only skills.
 *   - Neuro-symbolic static scanning (arXiv:2603.27204): a combined AST +
 *     symbolic-rule scanner reaches 93% F1 across 150,108 real skills. This
 *     class implements the deterministic (symbolic) half of that pair.
 *
 * Scope (P1)
 * ----------
 * - AST-level symbolic rule pass only (Stage 1): credential extraction,
 *   exfiltration calls, undeclared hook injection, RCE patterns. See
 *   publish-scanner-rules.ts for the rule corpus.
 * - Deterministic and rule-based — no model/LLM call.
 * - Backwards compatible: default mode is warn-only.
 *   `CLAUDE_FLOW_STRICT_PUBLISH=true` makes a high-confidence finding block.
 *
 * Stage 2 (P2)
 * -----------
 * - Dependency-graph traversal / OSV cross-reference now lives in
 *   `./dependency-graph.ts` (`analyzeDependencyGraph`) and populates the
 *   real `dependencyRisk` field below. See that file for the full
 *   traversal/degrade-posture writeup.
 *
 * Non-goals (P1/P2)
 * -----------------
 * - `PluginPermissionManifest` schema + runtime enforcement (Part B, P3/P4).
 * - LLM-based (neural) scoring for the AST pass — deferred per ADR-320
 *   "Deferred" section until the symbolic baseline has a measured FP rate.
 *
 * Reference: ADR-320, ADR-145 (install-layer sibling), arXiv:2605.14460 (SCH),
 * arXiv:2601.10338 (ecosystem survey), arXiv:2603.27204 (neuro-symbolic 93% F1).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as ts from 'typescript';
import { scanSourceForFindings } from './publish-scanner-rules.js';
import { analyzeDependencyGraph } from './dependency-graph.js';
import type { DependencyGraphReport } from './dependency-graph.js';

export type { DependencyFinding, DependencyFindingIssue, DependencyGraphReport } from './dependency-graph.js';

// P5: strict-mode-default flip in v4.0, see ADR-320 §Integration plan

export type ScanFindingCategory =
  | 'credential-extraction'
  | 'exfiltration-call'
  | 'undeclared-hook-injection'
  | 'rce-pattern';

export interface ScanFinding {
  readonly category: ScanFindingCategory;
  readonly file: string;
  /** 0-1. Fixed per-rule weight for the deterministic P1 pass. */
  readonly confidence: number;
}

export type PublishScanVerdict = 'pass' | 'warn' | 'block';

export interface PublishScanResult {
  readonly verdict: PublishScanVerdict;
  readonly findings: ReadonlyArray<ScanFinding>;
  readonly dependencyRisk: DependencyGraphReport;
}

export interface PublishScannerConfig {
  /**
   * Overrides the `CLAUDE_FLOW_STRICT_PUBLISH` env var for tests/callers
   * that want an explicit strictness decision rather than reading the
   * process environment (mirrors ADR-145's `VerifierConfig.strict`).
   */
  readonly strict?: boolean;
  /** Confidence at/above which a finding counts as "high confidence" for the block gate. Default 0.7. */
  readonly highConfidenceThreshold?: number;
}

const SCAN_EXTENSIONS = new Set(['.js', '.ts', '.mjs', '.cjs']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage']);
const DEFAULT_HIGH_CONFIDENCE_THRESHOLD = 0.7;

/**
 * `PluginPublishScanner` — Stage-1 AST symbolic rule pass.
 *
 * Holds only scan configuration; safe to construct per-invocation or share.
 */
export class PluginPublishScanner {
  constructor(private readonly config: PublishScannerConfig = {}) {}

  /**
   * Scan every `.js`/`.ts` file under `pluginDir` (skipping `node_modules`)
   * for the four ADR-320 Part A finding categories.
   */
  async scan(pluginDir: string): Promise<PublishScanResult> {
    const absoluteDir = validatePluginDir(pluginDir);
    const declaredHooks = readDeclaredHooks(absoluteDir);
    const files = listScannableFiles(absoluteDir);

    const findings: ScanFinding[] = [];
    for (const file of files) {
      findings.push(...scanFile(file, absoluteDir, declaredHooks));
    }

    const dependencyRisk: DependencyGraphReport = await analyzeDependencyGraph(absoluteDir);

    return {
      verdict: computeVerdict(findings, this.config),
      findings,
      dependencyRisk,
    };
  }
}

// ─── helpers ────────────────────────────────────────────────────────────

/** Validate `pluginDir` exists and is a directory before any scan work. */
function validatePluginDir(pluginDir: string): string {
  const absolute = path.resolve(pluginDir);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isDirectory()) {
    throw new Error(`PluginPublishScanner: not a directory: ${absolute}`);
  }
  return absolute;
}

/** Reads the plugin's declared hook names from `package.json`'s `claude-flow.hooks` array (same shape as `manager.ts`'s `pkg['claude-flow']` reads). */
function readDeclaredHooks(pluginDir: string): ReadonlySet<string> {
  const pkgPath = path.join(pluginDir, 'package.json');
  if (!fs.existsSync(pkgPath)) return new Set();
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>;
    const meta = pkg['claude-flow'] as { hooks?: unknown } | undefined;
    const hooks = meta?.hooks;
    return new Set(Array.isArray(hooks) ? (hooks as string[]) : []);
  } catch {
    return new Set();
  }
}

function listScannableFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && SCAN_EXTENSIONS.has(path.extname(entry.name))) {
        out.push(full);
      }
    }
  };
  walk(dir);
  return out;
}

function scanFile(absoluteFile: string, pluginDir: string, declaredHooks: ReadonlySet<string>): ScanFinding[] {
  let text: string;
  try {
    text = fs.readFileSync(absoluteFile, 'utf-8');
  } catch {
    return [];
  }
  const scriptKind = absoluteFile.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const sourceFile = ts.createSourceFile(absoluteFile, text, ts.ScriptTarget.Latest, true, scriptKind);
  const relativeFile = path.relative(pluginDir, absoluteFile);
  return scanSourceForFindings(sourceFile, relativeFile, declaredHooks);
}

/**
 * `block` only when strict mode is on AND at least one high-confidence
 * finding exists; `warn` when any finding exists; `pass` otherwise. Default
 * posture is warn-only, matching ADR-145's rollout pattern.
 */
function computeVerdict(findings: ReadonlyArray<ScanFinding>, config: PublishScannerConfig): PublishScanVerdict {
  if (findings.length === 0) return 'pass';

  const strict = config.strict ?? process.env.CLAUDE_FLOW_STRICT_PUBLISH === 'true';
  const threshold = config.highConfidenceThreshold ?? DEFAULT_HIGH_CONFIDENCE_THRESHOLD;
  const hasHighConfidence = findings.some(f => f.confidence >= threshold);

  return strict && hasHighConfidence ? 'block' : 'warn';
}
