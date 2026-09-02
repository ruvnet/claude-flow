/**
 * V3 CLI Analyze Command
 * Code analysis, diff classification, AST analysis, and change risk assessment
 *
 * Features:
 * - AST analysis using ruvector (tree-sitter) with graceful fallback
 * - Symbol extraction (functions, classes, variables, types)
 * - Cyclomatic complexity scoring
 * - Diff classification and risk assessment
 * - Graph boundaries using MinCut algorithm
 * - Module communities using Louvain algorithm
 * - Circular dependency detection
 *
 * Created with ruv.io
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { callMCPTool, MCPClientError } from '../mcp-client.js';
import * as path from 'path';
import * as fs from 'fs/promises';
import { writeFile } from 'fs/promises';
import { resolve } from 'path';

// Dynamic import for AST analyzer
async function getASTAnalyzer() {
  try {
    return await import('../ruvector/ast-analyzer.js');
  } catch {
    return null;
  }
}

// Dynamic import for graph analyzer
async function getGraphAnalyzer() {
  try {
    return await import('../ruvector/graph-analyzer.js');
  } catch {
    return null;
  }
}

// Diff subcommand
const diffCommand: Command = {
  name: 'diff',
  description: 'Analyze git diff for change risk assessment and classification',
  options: [
    {
      name: 'risk',
      short: 'r',
      description: 'Show risk assessment',
      type: 'boolean',
      default: false,
    },
    {
      name: 'classify',
      short: 'c',
      description: 'Classify change type',
      type: 'boolean',
      default: false,
    },
    {
      name: 'reviewers',
      description: 'Show recommended reviewers',
      type: 'boolean',
      default: false,
    },
    {
      name: 'format',
      short: 'f',
      description: 'Output format: text, json, table',
      type: 'string',
      default: 'text',
      choices: ['text', 'json', 'table'],
    },
    {
      name: 'verbose',
      short: 'v',
      description: 'Show detailed file-level analysis',
      type: 'boolean',
      default: false,
    },
  ],
  examples: [
    { command: 'claude-flow analyze diff --risk', description: 'Analyze current diff with risk assessment' },
    { command: 'claude-flow analyze diff HEAD~1 --classify', description: 'Classify changes from last commit' },
    { command: 'claude-flow analyze diff main..feature --format json', description: 'Compare branches with JSON output' },
    { command: 'claude-flow analyze diff --reviewers', description: 'Get recommended reviewers for changes' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const ref = ctx.args[0] || 'HEAD';
    const showRisk = ctx.flags.risk as boolean;
    const showClassify = ctx.flags.classify as boolean;
    const showReviewers = ctx.flags.reviewers as boolean;
    const formatType = ctx.flags.format as string || 'text';
    const verbose = ctx.flags.verbose as boolean;

    // If no specific flag, show all
    const showAll = !showRisk && !showClassify && !showReviewers;

    output.printInfo(`Analyzing diff: ${output.highlight(ref)}`);

    try {
      // Call MCP tool for diff analysis
      const result = await callMCPTool<{
        ref: string;
        timestamp: string;
        files: Array<{
          path: string;
          status: string;
          additions: number;
          deletions: number;
          binary: boolean;
        }>;
        risk: {
          overall: string;
          score: number;
          breakdown: {
            fileCount: number;
            totalChanges: number;
            highRiskFiles: string[];
            securityConcerns: string[];
            breakingChanges: string[];
            testCoverage: string;
          };
        };
        classification: {
          category: string;
          subcategory?: string;
          confidence: number;
          reasoning: string;
        };
        fileRisks: Array<{
          path: string;
          risk: string;
          score: number;
          reasons: string[];
        }>;
        recommendedReviewers: string[];
        summary: string;
      }>('analyze/diff', {
        ref,
        includeFileRisks: verbose,
        includeReviewers: showReviewers || showAll,
      });

      // JSON output
      if (formatType === 'json') {
        output.printJson(result);
        return { success: true, data: result };
      }

      output.writeln();

      // Summary box
      const files = result.files || [];
      const risk = result.risk || { overall: 'unknown', score: 0, breakdown: { fileCount: 0, totalChanges: 0, highRiskFiles: [], securityConcerns: [], breakingChanges: [], testCoverage: 'unknown' } };
      const classification = result.classification || { category: 'unknown', confidence: 0, reasoning: '' };

      output.printBox(
        [
          `Ref: ${result.ref || 'HEAD'}`,
          `Files: ${files.length}`,
          `Risk: ${getRiskDisplay(risk.overall)} (${risk.score}/100)`,
          `Type: ${classification.category}${classification.subcategory ? ` (${classification.subcategory})` : ''}`,
          ``,
          result.summary || 'No summary available',
        ].join('\n'),
        'Diff Analysis'
      );

      // Risk assessment
      if (showRisk || showAll) {
        output.writeln();
        output.writeln(output.bold('Risk Assessment'));
        output.writeln(output.dim('-'.repeat(50)));

        output.printTable({
          columns: [
            { key: 'metric', header: 'Metric', width: 25 },
            { key: 'value', header: 'Value', width: 30 },
          ],
          data: [
            { metric: 'Overall Risk', value: getRiskDisplay(risk.overall) },
            { metric: 'Risk Score', value: `${risk.score}/100` },
            { metric: 'Files Changed', value: risk.breakdown.fileCount },
            { metric: 'Total Lines Changed', value: risk.breakdown.totalChanges },
            { metric: 'Test Coverage', value: risk.breakdown.testCoverage },
          ],
        });

        // Security concerns
        if (risk.breakdown.securityConcerns.length > 0) {
          output.writeln();
          output.writeln(output.bold(output.warning('Security Concerns')));
          output.printList(risk.breakdown.securityConcerns.map(c => output.warning(c)));
        }

        // Breaking changes
        if (risk.breakdown.breakingChanges.length > 0) {
          output.writeln();
          output.writeln(output.bold(output.error('Potential Breaking Changes')));
          output.printList(risk.breakdown.breakingChanges.map(c => output.error(c)));
        }

        // High risk files
        if (risk.breakdown.highRiskFiles.length > 0) {
          output.writeln();
          output.writeln(output.bold('High Risk Files'));
          output.printList(risk.breakdown.highRiskFiles.map(f => output.warning(f)));
        }
      }

      // Classification
      if (showClassify || showAll) {
        output.writeln();
        output.writeln(output.bold('Classification'));
        output.writeln(output.dim('-'.repeat(50)));

        output.printTable({
          columns: [
            { key: 'field', header: 'Field', width: 15 },
            { key: 'value', header: 'Value', width: 40 },
          ],
          data: [
            { field: 'Category', value: classification.category },
            { field: 'Subcategory', value: classification.subcategory || '-' },
            { field: 'Confidence', value: `${(classification.confidence * 100).toFixed(0)}%` },
          ],
        });

        output.writeln();
        output.writeln(output.dim(`Reasoning: ${classification.reasoning}`));
      }

      // Reviewers
      if (showReviewers || showAll) {
        output.writeln();
        output.writeln(output.bold('Recommended Reviewers'));
        output.writeln(output.dim('-'.repeat(50)));

        const reviewers = result.recommendedReviewers || [];
        if (reviewers.length > 0) {
          output.printNumberedList(reviewers.map(r => output.highlight(r)));
        } else {
          output.writeln(output.dim('No specific reviewers recommended'));
        }
      }

      // Verbose file-level details
      if (verbose && result.fileRisks) {
        output.writeln();
        output.writeln(output.bold('File-Level Analysis'));
        output.writeln(output.dim('-'.repeat(50)));

        output.printTable({
          columns: [
            { key: 'path', header: 'File', width: 40 },
            { key: 'risk', header: 'Risk', width: 12, format: (v) => getRiskDisplay(String(v)) },
            { key: 'score', header: 'Score', width: 8, align: 'right' },
            { key: 'reasons', header: 'Reasons', width: 30, format: (v) => {
              const reasons = v as string[];
              return reasons.slice(0, 2).join('; ');
            }},
          ],
          data: result.fileRisks,
        });
      }

      // Files changed table
      if (formatType === 'table' || showAll) {
        output.writeln();
        output.writeln(output.bold('Files Changed'));
        output.writeln(output.dim('-'.repeat(50)));

        output.printTable({
          columns: [
            { key: 'status', header: 'Status', width: 10, format: (v) => getStatusDisplay(String(v)) },
            { key: 'path', header: 'File', width: 45 },
            { key: 'additions', header: '+', width: 8, align: 'right', format: (v) => output.success(`+${v}`) },
            { key: 'deletions', header: '-', width: 8, align: 'right', format: (v) => output.error(`-${v}`) },
          ],
          data: files.slice(0, 20),
        });

        if (files.length > 20) {
          output.writeln(output.dim(`  ... and ${files.length - 20} more files`));
        }
      }

      return { success: true, data: result };
    } catch (error) {
      if (error instanceof MCPClientError) {
        output.printError(`Diff analysis failed: ${error.message}`);
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  },
};

// Code subcommand (placeholder for future code analysis)
const codeCommand: Command = {
  name: 'code',
  description: 'Static code analysis and quality assessment',
  options: [
    { name: 'path', short: 'p', type: 'string', description: 'Path to analyze', default: '.' },
    { name: 'type', short: 't', type: 'string', description: 'Analysis type: quality, complexity, security', default: 'quality' },
    { name: 'format', short: 'f', type: 'string', description: 'Output format: text, json', default: 'text' },
  ],
  examples: [
    { command: 'claude-flow analyze code -p ./src', description: 'Analyze source directory' },
    { command: 'claude-flow analyze code --type complexity', description: 'Run complexity analysis' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const path = ctx.flags.path as string || '.';
    const analysisType = ctx.flags.type as string || 'quality';

    output.writeln();
    output.writeln(output.bold('Code Analysis'));
    output.writeln(output.dim('-'.repeat(50)));

    output.printInfo(`Analyzing ${path} for ${analysisType}...`);
    output.writeln();

    // Placeholder - would integrate with actual code analysis tools
    output.printBox(
      [
        `Path: ${path}`,
        `Type: ${analysisType}`,
        `Status: Feature in development`,
        ``,
        `Code analysis capabilities coming soon.`,
        `Use 'analyze diff' for change analysis.`,
      ].join('\n'),
      'Code Analysis'
    );

    return { success: true };
  },
};

// ============================================================================
// AST Analysis Subcommands (using ruvector tree-sitter with fallback)
// ============================================================================

/**
 * Helper: Truncate file path for display
 */
function truncatePathAst(filePath: string, maxLen: number = 45): string {
  if (filePath.length <= maxLen) return filePath;
  return '...' + filePath.slice(-(maxLen - 3));
}

/**
 * Helper: Format complexity value with color coding
 */
function formatComplexityValueAst(value: number): string {
  if (value <= 5) return output.success(String(value));
  if (value <= 10) return output.warning(String(value));
  return output.error(String(value));
}

/**
 * Helper: Get type marker for symbols
 */
function getTypeMarkerAst(type: string): string {
  switch (type) {
    case 'function': return output.success('fn');
    case 'class': return output.info('class');
    case 'variable': return output.dim('var');
    case 'type': return output.highlight('type');
    case 'interface': return output.highlight('iface');
    default: return output.dim(type.slice(0, 5));
  }
}

/**
 * Helper: Get complexity rating text
 */
function getComplexityRatingAst(value: number): string {
  if (value <= 5) return output.success('Simple');
  if (value <= 10) return output.warning('Moderate');
  if (value <= 20) return output.error('Complex');
  return output.error(output.bold('Very Complex'));
}

/**
 * AST analysis subcommand
 */
const astCommand: Command = {
  name: 'ast',
  description: 'Analyze code using AST parsing (tree-sitter via ruvector)',
  options: [
    {
      name: 'complexity',
      short: 'c',
      description: 'Include complexity metrics',
      type: 'boolean',
      default: false,
    },
    {
      name: 'symbols',
      short: 's',
      description: 'Include symbol extraction',
      type: 'boolean',
      default: false,
    },
    {
      name: 'format',
      short: 'f',
      description: 'Output format (text, json, table)',
      type: 'string',
      default: 'text',
      choices: ['text', 'json', 'table'],
    },
    {
      name: 'output',
      short: 'o',
      description: 'Output file path',
      type: 'string',
    },
    {
      name: 'verbose',
      short: 'v',
      description: 'Show detailed analysis',
      type: 'boolean',
      default: false,
    },
  ],
  examples: [
    { command: 'claude-flow analyze ast src/', description: 'Analyze all files in src/' },
    { command: 'claude-flow analyze ast src/index.ts --complexity', description: 'Analyze with complexity' },
    { command: 'claude-flow analyze ast . --format json', description: 'JSON output' },
    { command: 'claude-flow analyze ast src/ --symbols', description: 'Extract symbols' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const targetPath = ctx.args[0] || ctx.cwd;
    const showComplexity = ctx.flags.complexity as boolean;
    const showSymbols = ctx.flags.symbols as boolean;
    const formatType = (ctx.flags.format as string) || 'text';
    const outputFile = ctx.flags.output as string | undefined;
    const verbose = ctx.flags.verbose as boolean;

    // If no specific flags, show summary
    const showAll = !showComplexity && !showSymbols;

    output.printInfo(`Analyzing: ${output.highlight(targetPath)}`);
    output.writeln();

    const spinner = output.createSpinner({ text: 'Parsing AST...', spinner: 'dots' });
    spinner.start();

    try {
      const astModule = await getASTAnalyzer();
      if (!astModule) {
        spinner.stop();
        output.printWarning('AST analyzer not available, using regex fallback');
      }

      // Resolve path and check if file or directory
      const resolvedPath = resolve(targetPath);
      const stat = await fs.stat(resolvedPath);
      const isDirectory = stat.isDirectory();

      let results: Array<{
        filePath: string;
        language: string;
        functions: Array<{ name: string; startLine: number; endLine: number }>;
        classes: Array<{ name: string; startLine: number; endLine: number }>;
        imports: string[];
        exports: string[];
        complexity: { cyclomatic: number; cognitive: number; loc: number; commentDensity: number };
      }> = [];

      if (isDirectory) {
        // Scan directory for source files
        const files = await scanSourceFiles(resolvedPath);
        spinner.stop();
        output.printInfo(`Found ${files.length} source files`);
        spinner.start();

        for (const file of files.slice(0, 100)) {
          try {
            const content = await fs.readFile(file, 'utf-8');
            if (astModule) {
              const analyzer = astModule.createASTAnalyzer();
              const analysis = analyzer.analyze(content, file);
              results.push(analysis);
            } else {
              // Fallback analysis
              results.push(fallbackAnalyze(content, file));
            }
          } catch {
            // Skip files that can't be analyzed
          }
        }
      } else {
        // Single file
        const content = await fs.readFile(resolvedPath, 'utf-8');
        if (astModule) {
          const analyzer = astModule.createASTAnalyzer();
          const analysis = analyzer.analyze(content, resolvedPath);
          results.push(analysis);
        } else {
          results.push(fallbackAnalyze(content, resolvedPath));
        }
      }

      spinner.stop();

      if (results.length === 0) {
        output.printWarning('No files analyzed');
        return { success: true };
      }

      // Calculate totals
      const totals = {
        files: results.length,
        functions: results.reduce((sum, r) => sum + r.functions.length, 0),
        classes: results.reduce((sum, r) => sum + r.classes.length, 0),
        imports: results.reduce((sum, r) => sum + r.imports.length, 0),
        avgComplexity: results.reduce((sum, r) => sum + r.complexity.cyclomatic, 0) / results.length,
        totalLoc: results.reduce((sum, r) => sum + r.complexity.loc, 0),
      };

      // JSON output
      if (formatType === 'json') {
        const jsonOutput = { files: results, totals };
        if (outputFile) {
          await writeFile(outputFile, JSON.stringify(jsonOutput, null, 2));
          output.printSuccess(`Results written to ${outputFile}`);
        } else {
          output.printJson(jsonOutput);
        }
        return { success: true, data: jsonOutput };
      }

      // Summary box
      output.printBox(
        [
          `Files analyzed: ${totals.files}`,
          `Functions: ${totals.functions}`,
          `Classes: ${totals.classes}`,
          `Total LOC: ${totals.totalLoc}`,
          `Avg Complexity: ${formatComplexityValueAst(Math.round(totals.avgComplexity))}`,
        ].join('\n'),
        'AST Analysis Summary'
      );

      // Complexity view
      if (showComplexity || showAll) {
        output.writeln();
        output.writeln(output.bold('Complexity by File'));
        output.writeln(output.dim('-'.repeat(60)));

        const complexityData = results
          .map(r => ({
            file: truncatePathAst(r.filePath),
            cyclomatic: r.complexity.cyclomatic,
            cognitive: r.complexity.cognitive,
            loc: r.complexity.loc,
            rating: getComplexityRatingAst(r.complexity.cyclomatic),
          }))
          .sort((a, b) => b.cyclomatic - a.cyclomatic)
          .slice(0, 15);

        output.printTable({
          columns: [
            { key: 'file', header: 'File', width: 40 },
            { key: 'cyclomatic', header: 'Cyclo', width: 8, align: 'right', format: (v) => formatComplexityValueAst(v as number) },
            { key: 'cognitive', header: 'Cogni', width: 8, align: 'right' },
            { key: 'loc', header: 'LOC', width: 8, align: 'right' },
            { key: 'rating', header: 'Rating', width: 15 },
          ],
          data: complexityData,
        });

        if (results.length > 15) {
          output.writeln(output.dim(`  ... and ${results.length - 15} more files`));
        }
      }

      // Symbols view
      if (showSymbols || showAll) {
        output.writeln();
        output.writeln(output.bold('Extracted Symbols'));
        output.writeln(output.dim('-'.repeat(60)));

        const allSymbols: Array<{ name: string; type: string; file: string; line: number }> = [];

        for (const r of results) {
          for (const fn of r.functions) {
            allSymbols.push({ name: fn.name, type: 'function', file: truncatePathAst(r.filePath, 30), line: fn.startLine });
          }
          for (const cls of r.classes) {
            allSymbols.push({ name: cls.name, type: 'class', file: truncatePathAst(r.filePath, 30), line: cls.startLine });
          }
        }

        const displaySymbols = allSymbols.slice(0, 20);

        output.printTable({
          columns: [
            { key: 'type', header: 'Type', width: 8, format: (v) => getTypeMarkerAst(v as string) },
            { key: 'name', header: 'Symbol', width: 30 },
            { key: 'file', header: 'File', width: 35 },
            { key: 'line', header: 'Line', width: 8, align: 'right' },
          ],
          data: displaySymbols,
        });

        if (allSymbols.length > 20) {
          output.writeln(output.dim(`  ... and ${allSymbols.length - 20} more symbols`));
        }
      }

      // Verbose output
      if (verbose) {
        output.writeln();
        output.writeln(output.bold('Import Analysis'));
        output.writeln(output.dim('-'.repeat(60)));

        const importCounts: Map<string, number> = new Map();
        for (const r of results) {
          for (const imp of r.imports) {
            importCounts.set(imp, (importCounts.get(imp) || 0) + 1);
          }
        }

        const topImports = Array.from(importCounts.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10);

        for (const [imp, count] of topImports) {
          output.writeln(`  ${output.highlight(count.toString().padStart(3))} ${imp}`);
        }
      }

      if (outputFile) {
        await writeFile(outputFile, JSON.stringify({ files: results, totals }, null, 2));
        output.printSuccess(`Results written to ${outputFile}`);
      }

      return { success: true, data: { files: results, totals } };
    } catch (error) {
      spinner.stop();
      const message = error instanceof Error ? error.message : String(error);
      output.printError(`AST analysis failed: ${message}`);
      return { success: false, exitCode: 1 };
    }
  },
};

/**
 * Complexity analysis subcommand
 */
const complexityAstCommand: Command = {
  name: 'complexity',
  aliases: ['cx'],
  description: 'Analyze code complexity metrics',
  options: [
    {
      name: 'threshold',
      short: 't',
      description: 'Complexity threshold to flag (default: 10)',
      type: 'number',
      default: 10,
    },
    {
      name: 'format',
      short: 'f',
      description: 'Output format (text, json)',
      type: 'string',
      default: 'text',
      choices: ['text', 'json'],
    },
    {
      name: 'output',
      short: 'o',
      description: 'Output file path',
      type: 'string',
    },
  ],
  examples: [
    { command: 'claude-flow analyze complexity src/', description: 'Analyze complexity' },
    { command: 'claude-flow analyze complexity src/ --threshold 15', description: 'Flag high complexity' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const targetPath = ctx.args[0] || ctx.cwd;
    const threshold = (ctx.flags.threshold as number) || 10;
    const formatType = (ctx.flags.format as string) || 'text';
    const outputFile = ctx.flags.output as string | undefined;

    output.printInfo(`Analyzing complexity: ${output.highlight(targetPath)}`);
    output.writeln();

    const spinner = output.createSpinner({ text: 'Calculating complexity...', spinner: 'dots' });
    spinner.start();

    try {
      const astModule = await getASTAnalyzer();
      const resolvedPath = resolve(targetPath);
      const stat = await fs.stat(resolvedPath);
      const files = stat.isDirectory() ? await scanSourceFiles(resolvedPath) : [resolvedPath];

      const results: Array<{
        file: string;
        cyclomatic: number;
        cognitive: number;
        loc: number;
        commentDensity: number;
        rating: string;
        flagged: boolean;
      }> = [];

      for (const file of files.slice(0, 100)) {
        try {
          const content = await fs.readFile(file, 'utf-8');
          let analysis;

          if (astModule) {
            const analyzer = astModule.createASTAnalyzer();
            analysis = analyzer.analyze(content, file);
          } else {
            analysis = fallbackAnalyze(content, file);
          }

          const flagged = analysis.complexity.cyclomatic > threshold;
          const rating = analysis.complexity.cyclomatic <= 5 ? 'Simple' :
            analysis.complexity.cyclomatic <= 10 ? 'Moderate' :
            analysis.complexity.cyclomatic <= 20 ? 'Complex' : 'Very Complex';

          results.push({
            file: file,
            cyclomatic: analysis.complexity.cyclomatic,
            cognitive: analysis.complexity.cognitive,
            loc: analysis.complexity.loc,
            commentDensity: analysis.complexity.commentDensity,
            rating,
            flagged,
          });
        } catch {
          // Skip files that can't be analyzed
        }
      }

      spinner.stop();

      // Sort by complexity descending
      results.sort((a, b) => b.cyclomatic - a.cyclomatic);

      const flaggedCount = results.filter(r => r.flagged).length;
      const avgComplexity = results.length > 0
        ? results.reduce((sum, r) => sum + r.cyclomatic, 0) / results.length
        : 0;

      if (formatType === 'json') {
        const jsonOutput = { files: results, summary: { total: results.length, flagged: flaggedCount, avgComplexity, threshold } };
        if (outputFile) {
          await writeFile(outputFile, JSON.stringify(jsonOutput, null, 2));
          output.printSuccess(`Results written to ${outputFile}`);
        } else {
          output.printJson(jsonOutput);
        }
        return { success: true, data: jsonOutput };
      }

      // Summary
      output.printBox(
        [
          `Files analyzed: ${results.length}`,
          `Threshold: ${threshold}`,
          `Flagged files: ${flaggedCount > 0 ? output.error(String(flaggedCount)) : output.success('0')}`,
          `Average complexity: ${formatComplexityValueAst(Math.round(avgComplexity))}`,
        ].join('\n'),
        'Complexity Analysis'
      );

      // Show flagged files first
      if (flaggedCount > 0) {
        output.writeln();
        output.writeln(output.bold(output.warning(`High Complexity Files (>${threshold})`)));
        output.writeln(output.dim('-'.repeat(60)));

        const flaggedFiles = results.filter(r => r.flagged).slice(0, 10);
        output.printTable({
          columns: [
            { key: 'file', header: 'File', width: 40, format: (v) => truncatePathAst(v as string) },
            { key: 'cyclomatic', header: 'Cyclo', width: 8, align: 'right', format: (v) => output.error(String(v)) },
            { key: 'cognitive', header: 'Cogni', width: 8, align: 'right' },
            { key: 'loc', header: 'LOC', width: 8, align: 'right' },
            { key: 'rating', header: 'Rating', width: 15 },
          ],
          data: flaggedFiles,
        });
      }

      // Show all files in table format
      output.writeln();
      output.writeln(output.bold('All Files'));
      output.writeln(output.dim('-'.repeat(60)));

      const displayFiles = results.slice(0, 15);
      output.printTable({
        columns: [
          { key: 'file', header: 'File', width: 40, format: (v) => truncatePathAst(v as string) },
          { key: 'cyclomatic', header: 'Cyclo', width: 8, align: 'right', format: (v) => formatComplexityValueAst(v as number) },
          { key: 'cognitive', header: 'Cogni', width: 8, align: 'right' },
          { key: 'loc', header: 'LOC', width: 8, align: 'right' },
        ],
        data: displayFiles,
      });

      if (results.length > 15) {
        output.writeln(output.dim(`  ... and ${results.length - 15} more files`));
      }

      if (outputFile) {
        await writeFile(outputFile, JSON.stringify({ files: results, summary: { total: results.length, flagged: flaggedCount, avgComplexity, threshold } }, null, 2));
        output.printSuccess(`Results written to ${outputFile}`);
      }

      return { success: true, data: { files: results, flaggedCount } };
    } catch (error) {
      spinner.stop();
      const message = error instanceof Error ? error.message : String(error);
      output.printError(`Complexity analysis failed: ${message}`);
      return { success: false, exitCode: 1 };
    }
  },
};

/**
 * Symbol extraction subcommand
 */
const symbolsCommand: Command = {
  name: 'symbols',
  aliases: ['sym'],
  description: 'Extract and list code symbols (functions, classes, types)',
  options: [
    {
      name: 'type',
      short: 't',
      description: 'Filter by symbol type (function, class, all)',
      type: 'string',
      default: 'all',
      choices: ['function', 'class', 'all'],
    },
    {
      name: 'format',
      short: 'f',
      description: 'Output format (text, json)',
      type: 'string',
      default: 'text',
      choices: ['text', 'json'],
    },
    {
      name: 'output',
      short: 'o',
      description: 'Output file path',
      type: 'string',
    },
  ],
  examples: [
    { command: 'claude-flow analyze symbols src/', description: 'Extract all symbols' },
    { command: 'claude-flow analyze symbols src/ --type function', description: 'Only functions' },
    { command: 'claude-flow analyze symbols src/ --format json', description: 'JSON output' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const targetPath = ctx.args[0] || ctx.cwd;
    const symbolType = (ctx.flags.type as string) || 'all';
    const formatType = (ctx.flags.format as string) || 'text';
    const outputFile = ctx.flags.output as string | undefined;

    output.printInfo(`Extracting symbols: ${output.highlight(targetPath)}`);
    output.writeln();

    const spinner = output.createSpinner({ text: 'Parsing code...', spinner: 'dots' });
    spinner.start();

    try {
      const astModule = await getASTAnalyzer();
      const resolvedPath = resolve(targetPath);
      const stat = await fs.stat(resolvedPath);
      const files = stat.isDirectory() ? await scanSourceFiles(resolvedPath) : [resolvedPath];

      const symbols: Array<{
        name: string;
        type: string;
        file: string;
        startLine: number;
        endLine: number;
      }> = [];

      for (const file of files.slice(0, 100)) {
        try {
          const content = await fs.readFile(file, 'utf-8');
          let analysis;

          if (astModule) {
            const analyzer = astModule.createASTAnalyzer();
            analysis = analyzer.analyze(content, file);
          } else {
            analysis = fallbackAnalyze(content, file);
          }

          if (symbolType === 'all' || symbolType === 'function') {
            for (const fn of analysis.functions) {
              symbols.push({
                name: fn.name,
                type: 'function',
                file,
                startLine: fn.startLine,
                endLine: fn.endLine,
              });
            }
          }

          if (symbolType === 'all' || symbolType === 'class') {
            for (const cls of analysis.classes) {
              symbols.push({
                name: cls.name,
                type: 'class',
                file,
                startLine: cls.startLine,
                endLine: cls.endLine,
              });
            }
          }
        } catch {
          // Skip files that can't be parsed
        }
      }

      spinner.stop();

      // Sort by file then name
      symbols.sort((a, b) => a.file.localeCompare(b.file) || a.name.localeCompare(b.name));

      if (formatType === 'json') {
        if (outputFile) {
          await writeFile(outputFile, JSON.stringify(symbols, null, 2));
          output.printSuccess(`Results written to ${outputFile}`);
        } else {
          output.printJson(symbols);
        }
        return { success: true, data: symbols };
      }

      // Summary
      const functionCount = symbols.filter(s => s.type === 'function').length;
      const classCount = symbols.filter(s => s.type === 'class').length;

      output.printBox(
        [
          `Total symbols: ${symbols.length}`,
          `Functions: ${functionCount}`,
          `Classes: ${classCount}`,
          `Files: ${files.length}`,
        ].join('\n'),
        'Symbol Extraction'
      );

      output.writeln();
      output.writeln(output.bold('Symbols'));
      output.writeln(output.dim('-'.repeat(60)));

      const displaySymbols = symbols.slice(0, 30);
      output.printTable({
        columns: [
          { key: 'type', header: 'Type', width: 10, format: (v) => getTypeMarkerAst(v as string) },
          { key: 'name', header: 'Name', width: 30 },
          { key: 'file', header: 'File', width: 35, format: (v) => truncatePathAst(v as string, 33) },
          { key: 'startLine', header: 'Line', width: 8, align: 'right' },
        ],
        data: displaySymbols,
      });

      if (symbols.length > 30) {
        output.writeln(output.dim(`  ... and ${symbols.length - 30} more symbols`));
      }

      if (outputFile) {
        await writeFile(outputFile, JSON.stringify(symbols, null, 2));
        output.printSuccess(`Results written to ${outputFile}`);
      }

      return { success: true, data: symbols };
    } catch (error) {
      spinner.stop();
      const message = error instanceof Error ? error.message : String(error);
      output.printError(`Symbol extraction failed: ${message}`);
      return { success: false, exitCode: 1 };
    }
  },
};

/**
 * Imports analysis subcommand
 */
const importsCommand: Command = {
  name: 'imports',
  aliases: ['imp'],
  description: 'Analyze import dependencies across files',
  options: [
    {
      name: 'format',
      short: 'f',
      description: 'Output format (text, json)',
      type: 'string',
      default: 'text',
      choices: ['text', 'json'],
    },
    {
      name: 'output',
      short: 'o',
      description: 'Output file path',
      type: 'string',
    },
    {
      name: 'external',
      short: 'e',
      description: 'Show only external (npm) imports',
      type: 'boolean',
      default: false,
    },
  ],
  examples: [
    { command: 'claude-flow analyze imports src/', description: 'Analyze all imports' },
    { command: 'claude-flow analyze imports src/ --external', description: 'Only npm packages' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const targetPath = ctx.args[0] || ctx.cwd;
    const formatType = (ctx.flags.format as string) || 'text';
    const outputFile = ctx.flags.output as string | undefined;
    const externalOnly = ctx.flags.external as boolean;

    output.printInfo(`Analyzing imports: ${output.highlight(targetPath)}`);
    output.writeln();

    const spinner = output.createSpinner({ text: 'Scanning imports...', spinner: 'dots' });
    spinner.start();

    try {
      const astModule = await getASTAnalyzer();
      const resolvedPath = resolve(targetPath);
      const stat = await fs.stat(resolvedPath);
      const files = stat.isDirectory() ? await scanSourceFiles(resolvedPath) : [resolvedPath];

      const importCounts: Map<string, { count: number; files: string[] }> = new Map();
      const fileImports: Map<string, string[]> = new Map();

      for (const file of files.slice(0, 100)) {
        try {
          const content = await fs.readFile(file, 'utf-8');
          let analysis;

          if (astModule) {
            const analyzer = astModule.createASTAnalyzer();
            analysis = analyzer.analyze(content, file);
          } else {
            analysis = fallbackAnalyze(content, file);
          }

          const imports = analysis.imports.filter(imp => {
            if (externalOnly) {
              return !imp.startsWith('.') && !imp.startsWith('/');
            }
            return true;
          });

          fileImports.set(file, imports);

          for (const imp of imports) {
            const existing = importCounts.get(imp) || { count: 0, files: [] };
            existing.count++;
            existing.files.push(file);
            importCounts.set(imp, existing);
          }
        } catch {
          // Skip files that can't be parsed
        }
      }

      spinner.stop();

      // Sort by count
      const sortedImports = Array.from(importCounts.entries())
        .sort((a, b) => b[1].count - a[1].count);

      if (formatType === 'json') {
        const jsonOutput = {
          imports: Object.fromEntries(sortedImports),
          fileImports: Object.fromEntries(fileImports),
        };
        if (outputFile) {
          await writeFile(outputFile, JSON.stringify(jsonOutput, null, 2));
          output.printSuccess(`Results written to ${outputFile}`);
        } else {
          output.printJson(jsonOutput);
        }
        return { success: true, data: jsonOutput };
      }

      // Summary
      const externalImports = sortedImports.filter(([imp]) => !imp.startsWith('.') && !imp.startsWith('/'));
      const localImports = sortedImports.filter(([imp]) => imp.startsWith('.') || imp.startsWith('/'));

      output.printBox(
        [
          `Total unique imports: ${sortedImports.length}`,
          `External (npm): ${externalImports.length}`,
          `Local (relative): ${localImports.length}`,
          `Files scanned: ${files.length}`,
        ].join('\n'),
        'Import Analysis'
      );

      // Most used imports
      output.writeln();
      output.writeln(output.bold('Most Used Imports'));
      output.writeln(output.dim('-'.repeat(60)));

      const topImports = sortedImports.slice(0, 20);
      output.printTable({
        columns: [
          { key: 'count', header: 'Uses', width: 8, align: 'right' },
          { key: 'import', header: 'Import', width: 50 },
          { key: 'type', header: 'Type', width: 10 },
        ],
        data: topImports.map(([imp, data]) => ({
          count: data.count,
          import: imp,
          type: imp.startsWith('.') || imp.startsWith('/') ? output.dim('local') : output.highlight('npm'),
        })),
      });

      if (sortedImports.length > 20) {
        output.writeln(output.dim(`  ... and ${sortedImports.length - 20} more imports`));
      }

      if (outputFile) {
        await writeFile(outputFile, JSON.stringify({
          imports: Object.fromEntries(sortedImports),
          fileImports: Object.fromEntries(fileImports),
        }, null, 2));
        output.printSuccess(`Results written to ${outputFile}`);
      }

      return { success: true, data: { imports: sortedImports } };
    } catch (error) {
      spinner.stop();
      const message = error instanceof Error ? error.message : String(error);
      output.printError(`Import analysis failed: ${message}`);
      return { success: false, exitCode: 1 };
    }
  },
};

/**
 * Helper: Scan directory for source files
 */
async function scanSourceFiles(dir: string, maxDepth: number = 10): Promise<string[]> {
  const files: string[] = [];
  const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
  const excludeDirs = ['node_modules', 'dist', 'build', '.git', 'coverage', '__pycache__'];

  async function scan(currentDir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;

    try {
      const entries = await fs.readdir(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);

        if (entry.isDirectory()) {
          if (!excludeDirs.includes(entry.name)) {
            await scan(fullPath, depth + 1);
          }
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name);
          if (extensions.includes(ext)) {
            files.push(fullPath);
          }
        }
      }
    } catch {
      // Skip directories we can't read
    }
  }

  await scan(dir, 0);
  return files;
}

/**
 * Fallback analysis when ruvector is not available
 */
function fallbackAnalyze(code: string, filePath: string) {
  const lines = code.split('\n');
  const functions: Array<{ name: string; startLine: number; endLine: number }> = [];
  const classes: Array<{ name: string; startLine: number; endLine: number }> = [];
  const imports: string[] = [];
  const exports: string[] = [];

  // Extract functions
  const funcPattern = /(?:export\s+)?(?:async\s+)?function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>|^\s*(?:async\s+)?(\w+)\s*\([^)]*\)\s*(?::\s*\w+)?\s*\{/gm;
  let match;
  while ((match = funcPattern.exec(code)) !== null) {
    const name = match[1] || match[2] || match[3];
    if (name && !['if', 'while', 'for', 'switch'].includes(name)) {
      const lineNum = code.substring(0, match.index).split('\n').length;
      functions.push({ name, startLine: lineNum, endLine: lineNum + 10 });
    }
  }

  // Extract classes
  const classPattern = /(?:export\s+)?class\s+(\w+)/gm;
  while ((match = classPattern.exec(code)) !== null) {
    const lineNum = code.substring(0, match.index).split('\n').length;
    classes.push({ name: match[1], startLine: lineNum, endLine: lineNum + 20 });
  }

  // Extract imports
  const importPattern = /import\s+(?:.*\s+from\s+)?['"]([^'"]+)['"]/gm;
  while ((match = importPattern.exec(code)) !== null) {
    imports.push(match[1]);
  }
  const requirePattern = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/gm;
  while ((match = requirePattern.exec(code)) !== null) {
    imports.push(match[1]);
  }

  // Extract exports
  const exportPattern = /export\s+(?:default\s+)?(?:const|let|var|function|class|interface|type|enum)\s+(\w+)/gm;
  while ((match = exportPattern.exec(code)) !== null) {
    exports.push(match[1]);
  }

  // Calculate complexity
  const nonEmptyLines = lines.filter(l => l.trim().length > 0).length;
  const commentLines = lines.filter(l => /^\s*(\/\/|\/\*|\*|#)/.test(l)).length;
  const decisionPoints = (code.match(/\b(if|else|for|while|switch|case|catch|&&|\|\||\?)\b/g) || []).length;

  let cognitive = 0;
  let nestingLevel = 0;
  for (const line of lines) {
    const opens = (line.match(/\{/g) || []).length;
    const closes = (line.match(/\}/g) || []).length;
    if (/\b(if|for|while|switch)\b/.test(line)) {
      cognitive += 1 + nestingLevel;
    }
    nestingLevel = Math.max(0, nestingLevel + opens - closes);
  }

  // Detect language
  const ext = path.extname(filePath).toLowerCase();
  const language = ext === '.ts' || ext === '.tsx' ? 'typescript' :
    ext === '.js' || ext === '.jsx' || ext === '.mjs' || ext === '.cjs' ? 'javascript' :
    ext === '.py' ? 'python' : 'unknown';

  return {
    filePath,
    language,
    functions,
    classes,
    imports,
    exports,
    complexity: {
      cyclomatic: decisionPoints + 1,
      cognitive,
      loc: nonEmptyLines,
      commentDensity: lines.length > 0 ? commentLines / lines.length : 0,
    },
  };
}

// Dependencies subcommand
const depsCommand: Command = {
  name: 'deps',
  description: 'Analyze project dependencies',
  options: [
    { name: 'outdated', short: 'o', type: 'boolean', description: 'Show only outdated dependencies' },
    { name: 'security', short: 's', type: 'boolean', description: 'Check for security vulnerabilities' },
    { name: 'format', short: 'f', type: 'string', description: 'Output format: text, json', default: 'text' },
  ],
  examples: [
    { command: 'claude-flow analyze deps --outdated', description: 'Show outdated dependencies' },
    { command: 'claude-flow analyze deps --security', description: 'Check for vulnerabilities' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const showOutdated = ctx.flags.outdated as boolean;
    const checkSecurity = ctx.flags.security as boolean;

    output.writeln();
    output.writeln(output.bold('Dependency Analysis'));
    output.writeln(output.dim('-'.repeat(50)));

    output.printInfo('Analyzing dependencies...');
    output.writeln();

    // Placeholder - would integrate with npm/yarn audit
    output.printBox(
      [
        `Outdated Check: ${showOutdated ? 'Enabled' : 'Disabled'}`,
        `Security Check: ${checkSecurity ? 'Enabled' : 'Disabled'}`,
        `Status: Feature in development`,
        ``,
        `Dependency analysis capabilities coming soon.`,
        `Use 'security scan --type deps' for security scanning.`,
      ].join('\n'),
      'Dependency Analysis'
    );

    return { success: true };
  },
};

// ============================================================================
// Graph Analysis Subcommands (MinCut, Louvain, Circular Dependencies)
// ============================================================================

/**
 * Analyze code boundaries using MinCut algorithm
 */
const boundariesCommand: Command = {
  name: 'boundaries',
  aliases: ['boundary', 'mincut'],
  description: 'Find natural code boundaries using MinCut algorithm',
  options: [
    {
      name: 'partitions',
      short: 'p',
      description: 'Number of partitions to find',
      type: 'number',
      default: 2,
    },
    {
      name: 'output',
      short: 'o',
      description: 'Output file path',
      type: 'string',
    },
    {
      name: 'format',
      short: 'f',
      description: 'Output format (text, json, dot)',
      type: 'string',
      default: 'text',
      choices: ['text', 'json', 'dot'],
    },
  ],
  examples: [
    { command: 'claude-flow analyze boundaries src/', description: 'Find code boundaries in src/' },
    { command: 'claude-flow analyze boundaries -p 3 src/', description: 'Find 3 partitions' },
    { command: 'claude-flow analyze boundaries -f dot -o graph.dot src/', description: 'Export to DOT format' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const targetDir = ctx.args[0] || ctx.cwd;
    const numPartitions = (ctx.flags.partitions as number) || 2;
    const outputFile = ctx.flags.output as string | undefined;
    const format = (ctx.flags.format as string) || 'text';

    output.printInfo(`Analyzing code boundaries in: ${output.highlight(targetDir)}`);
    output.writeln();

    const spinner = output.createSpinner({ text: 'Building dependency graph...', spinner: 'dots' });
    spinner.start();

    try {
      const analyzer = await getGraphAnalyzer();
      if (!analyzer) {
        spinner.stop();
        output.printError('Graph analyzer module not available');
        return { success: false, exitCode: 1 };
      }

      const result = await analyzer.analyzeGraph(resolve(targetDir), {
        includeBoundaries: true,
        includeModules: false,
        numPartitions,
      });

      spinner.stop();

      // Handle different output formats
      if (format === 'json') {
        const jsonOutput = {
          boundaries: result.boundaries,
          statistics: result.statistics,
          circularDependencies: result.circularDependencies,
        };

        if (outputFile) {
          await writeFile(outputFile, JSON.stringify(jsonOutput, null, 2));
          output.printSuccess(`Results written to ${outputFile}`);
        } else {
          output.printJson(jsonOutput);
        }

        return { success: true, data: jsonOutput };
      }

      if (format === 'dot') {
        const dotOutput = analyzer.exportToDot(result, {
          includeLabels: true,
          highlightCycles: true,
        });

        if (outputFile) {
          await writeFile(outputFile, dotOutput);
          output.printSuccess(`DOT graph written to ${outputFile}`);
          output.writeln(output.dim('Visualize with: dot -Tpng -o graph.png ' + outputFile));
        } else {
          output.writeln(dotOutput);
        }

        return { success: true };
      }

      // Text format (default)
      output.printBox(
        [
          `Files analyzed: ${result.statistics.nodeCount}`,
          `Dependencies: ${result.statistics.edgeCount}`,
          `Avg degree: ${result.statistics.avgDegree.toFixed(2)}`,
          `Density: ${(result.statistics.density * 100).toFixed(2)}%`,
          `Components: ${result.statistics.componentCount}`,
        ].join('\n'),
        'Graph Statistics'
      );

      if (result.boundaries && result.boundaries.length > 0) {
        output.writeln();
        output.writeln(output.bold('MinCut Boundaries'));
        output.writeln();

        for (let i = 0; i < result.boundaries.length; i++) {
          const boundary = result.boundaries[i];
          output.writeln(output.bold(`Boundary ${i + 1} (cut value: ${boundary.cutValue})`));
          output.writeln();

          output.writeln(output.dim('Partition 1:'));
          const p1Display = boundary.partition1.slice(0, 10);
          output.printList(p1Display);
          if (boundary.partition1.length > 10) {
            output.writeln(output.dim(`  ... and ${boundary.partition1.length - 10} more files`));
          }

          output.writeln();
          output.writeln(output.dim('Partition 2:'));
          const p2Display = boundary.partition2.slice(0, 10);
          output.printList(p2Display);
          if (boundary.partition2.length > 10) {
            output.writeln(output.dim(`  ... and ${boundary.partition2.length - 10} more files`));
          }

          output.writeln();
          output.writeln(output.success('Suggestion:'));
          output.writeln(`  ${boundary.suggestion}`);
          output.writeln();
        }
      }

      // Show circular dependencies
      if (result.circularDependencies.length > 0) {
        output.writeln();
        output.writeln(output.bold(output.warning('Circular Dependencies Detected')));
        output.writeln();

        for (const cycle of result.circularDependencies.slice(0, 5)) {
          const severityColor = cycle.severity === 'high' ? output.error : cycle.severity === 'medium' ? output.warning : output.dim;
          output.writeln(`${severityColor(`[${cycle.severity.toUpperCase()}]`)} ${cycle.cycle.join(' -> ')}`);
          output.writeln(output.dim(`  ${cycle.suggestion}`));
          output.writeln();
        }

        if (result.circularDependencies.length > 5) {
          output.writeln(output.dim(`... and ${result.circularDependencies.length - 5} more cycles`));
        }
      }

      if (outputFile) {
        await writeFile(outputFile, JSON.stringify(result, null, 2));
        output.printSuccess(`Full results written to ${outputFile}`);
      }

      return { success: true, data: result };
    } catch (error) {
      spinner.stop();
      const message = error instanceof Error ? error.message : String(error);
      output.printError(`Analysis failed: ${message}`);
      return { success: false, exitCode: 1 };
    }
  },
};

/**
 * Analyze modules/communities using Louvain algorithm
 */
const modulesCommand: Command = {
  name: 'modules',
  aliases: ['communities', 'louvain'],
  description: 'Detect module communities using Louvain algorithm',
  options: [
    {
      name: 'output',
      short: 'o',
      description: 'Output file path',
      type: 'string',
    },
    {
      name: 'format',
      short: 'f',
      description: 'Output format (text, json, dot)',
      type: 'string',
      default: 'text',
      choices: ['text', 'json', 'dot'],
    },
    {
      name: 'min-size',
      short: 'm',
      description: 'Minimum community size to display',
      type: 'number',
      default: 2,
    },
  ],
  examples: [
    { command: 'claude-flow analyze modules src/', description: 'Detect module communities' },
    { command: 'claude-flow analyze modules -f dot -o modules.dot src/', description: 'Export colored DOT graph' },
    { command: 'claude-flow analyze modules -m 3 src/', description: 'Only show communities with 3+ files' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const targetDir = ctx.args[0] || ctx.cwd;
    const outputFile = ctx.flags.output as string | undefined;
    const format = (ctx.flags.format as string) || 'text';
    const minSize = (ctx.flags['min-size'] as number) || 2;

    output.printInfo(`Detecting module communities in: ${output.highlight(targetDir)}`);
    output.writeln();

    const spinner = output.createSpinner({ text: 'Building dependency graph...', spinner: 'dots' });
    spinner.start();

    try {
      const analyzer = await getGraphAnalyzer();
      if (!analyzer) {
        spinner.stop();
        output.printError('Graph analyzer module not available');
        return { success: false, exitCode: 1 };
      }

      const result = await analyzer.analyzeGraph(resolve(targetDir), {
        includeBoundaries: false,
        includeModules: true,
      });

      spinner.stop();

      // Filter communities by size
      const communities = result.communities?.filter(c => c.members.length >= minSize) || [];

      // Handle different output formats
      if (format === 'json') {
        const jsonOutput = {
          communities,
          statistics: result.statistics,
        };

        if (outputFile) {
          await writeFile(outputFile, JSON.stringify(jsonOutput, null, 2));
          output.printSuccess(`Results written to ${outputFile}`);
        } else {
          output.printJson(jsonOutput);
        }

        return { success: true, data: jsonOutput };
      }

      if (format === 'dot') {
        const dotOutput = analyzer.exportToDot(result, {
          includeLabels: true,
          colorByCommunity: true,
          highlightCycles: true,
        });

        if (outputFile) {
          await writeFile(outputFile, dotOutput);
          output.printSuccess(`DOT graph written to ${outputFile}`);
          output.writeln(output.dim('Visualize with: dot -Tpng -o modules.png ' + outputFile));
        } else {
          output.writeln(dotOutput);
        }

        return { success: true };
      }

      // Text format (default)
      output.printBox(
        [
          `Files analyzed: ${result.statistics.nodeCount}`,
          `Dependencies: ${result.statistics.edgeCount}`,
          `Communities found: ${result.communities?.length || 0}`,
          `Showing: ${communities.length} (min size: ${minSize})`,
        ].join('\n'),
        'Module Detection Results'
      );

      if (communities.length > 0) {
        output.writeln();
        output.writeln(output.bold('Detected Communities'));
        output.writeln();

        for (const community of communities.slice(0, 10)) {
          const cohesionIndicator = community.cohesion > 0.5 ? output.success('High') :
            community.cohesion > 0.2 ? output.warning('Medium') : output.dim('Low');

          output.writeln(output.bold(`Community ${community.id}: ${community.suggestedName || 'unnamed'}`));
          output.writeln(`  ${output.dim('Cohesion:')} ${cohesionIndicator} (${(community.cohesion * 100).toFixed(1)}%)`);
          output.writeln(`  ${output.dim('Central node:')} ${community.centralNode || 'none'}`);
          output.writeln(`  ${output.dim('Members:')} ${community.members.length} files`);

          const displayMembers = community.members.slice(0, 5);
          for (const member of displayMembers) {
            output.writeln(`    - ${member}`);
          }
          if (community.members.length > 5) {
            output.writeln(output.dim(`    ... and ${community.members.length - 5} more`));
          }
          output.writeln();
        }

        if (communities.length > 10) {
          output.writeln(output.dim(`... and ${communities.length - 10} more communities`));
        }
      }

      if (outputFile) {
        await writeFile(outputFile, JSON.stringify(result, null, 2));
        output.printSuccess(`Full results written to ${outputFile}`);
      }

      return { success: true, data: result };
    } catch (error) {
      spinner.stop();
      const message = error instanceof Error ? error.message : String(error);
      output.printError(`Analysis failed: ${message}`);
      return { success: false, exitCode: 1 };
    }
  },
};

/**
 * Build and export dependency graph
 */
const dependenciesCommand: Command = {
  name: 'dependencies',
  aliases: ['graph'],
  description: 'Build and export full dependency graph',
  options: [
    {
      name: 'output',
      short: 'o',
      description: 'Output file path',
      type: 'string',
    },
    {
      name: 'format',
      short: 'f',
      description: 'Output format (text, json, dot)',
      type: 'string',
      default: 'text',
      choices: ['text', 'json', 'dot'],
    },
    {
      name: 'include',
      short: 'i',
      description: 'File extensions to include (comma-separated)',
      type: 'string',
      default: '.ts,.tsx,.js,.jsx,.mjs,.cjs',
    },
    {
      name: 'exclude',
      short: 'e',
      description: 'Patterns to exclude (comma-separated)',
      type: 'string',
      default: 'node_modules,dist,build,.git',
    },
    {
      name: 'depth',
      short: 'd',
      description: 'Maximum directory depth',
      type: 'number',
      default: 10,
    },
  ],
  examples: [
    { command: 'claude-flow analyze dependencies src/', description: 'Build dependency graph' },
    { command: 'claude-flow analyze dependencies -f dot -o deps.dot src/', description: 'Export to DOT' },
    { command: 'claude-flow analyze dependencies -i .ts,.tsx src/', description: 'Only TypeScript files' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const targetDir = ctx.args[0] || ctx.cwd;
    const outputFile = ctx.flags.output as string | undefined;
    const format = (ctx.flags.format as string) || 'text';
    const include = ((ctx.flags.include as string) || '.ts,.tsx,.js,.jsx,.mjs,.cjs').split(',');
    const exclude = ((ctx.flags.exclude as string) || 'node_modules,dist,build,.git').split(',');
    const maxDepth = (ctx.flags.depth as number) || 10;

    output.printInfo(`Building dependency graph for: ${output.highlight(targetDir)}`);
    output.writeln();

    const spinner = output.createSpinner({ text: 'Scanning files...', spinner: 'dots' });
    spinner.start();

    try {
      const analyzer = await getGraphAnalyzer();
      if (!analyzer) {
        spinner.stop();
        output.printError('Graph analyzer module not available');
        return { success: false, exitCode: 1 };
      }

      const graph = await analyzer.buildDependencyGraph(resolve(targetDir), {
        include,
        exclude,
        maxDepth,
      });

      spinner.stop();

      // Detect circular dependencies
      const circularDeps = analyzer.detectCircularDependencies(graph);

      // Handle different output formats
      if (format === 'json') {
        const jsonOutput = {
          nodes: Array.from(graph.nodes.values()),
          edges: graph.edges,
          metadata: graph.metadata,
          circularDependencies: circularDeps,
        };

        if (outputFile) {
          await writeFile(outputFile, JSON.stringify(jsonOutput, null, 2));
          output.printSuccess(`Graph written to ${outputFile}`);
        } else {
          output.printJson(jsonOutput);
        }

        return { success: true, data: jsonOutput };
      }

      if (format === 'dot') {
        const result = { graph, circularDependencies: circularDeps, statistics: {
          nodeCount: graph.nodes.size,
          edgeCount: graph.edges.length,
          avgDegree: 0,
          maxDegree: 0,
          density: 0,
          componentCount: 0,
        }};

        const dotOutput = analyzer.exportToDot(result, {
          includeLabels: true,
          highlightCycles: true,
        });

        if (outputFile) {
          await writeFile(outputFile, dotOutput);
          output.printSuccess(`DOT graph written to ${outputFile}`);
          output.writeln(output.dim('Visualize with: dot -Tpng -o deps.png ' + outputFile));
        } else {
          output.writeln(dotOutput);
        }

        return { success: true };
      }

      // Text format (default)
      output.printBox(
        [
          `Files: ${graph.metadata.totalFiles}`,
          `Dependencies: ${graph.metadata.totalEdges}`,
          `Build time: ${graph.metadata.buildTime}ms`,
          `Root: ${graph.metadata.rootDir}`,
        ].join('\n'),
        'Dependency Graph'
      );

      // Show top files by imports
      output.writeln();
      output.writeln(output.bold('Most Connected Files'));
      output.writeln();

      const nodesByDegree = Array.from(graph.nodes.values())
        .map(n => ({
          ...n,
          degree: graph.edges.filter(e => e.source === n.id || e.target === n.id).length,
        }))
        .sort((a, b) => b.degree - a.degree)
        .slice(0, 10);

      output.printTable({
        columns: [
          { key: 'path', header: 'File', width: 50 },
          { key: 'degree', header: 'Connections', width: 12, align: 'right' },
          { key: 'complexity', header: 'Complexity', width: 12, align: 'right' },
        ],
        data: nodesByDegree.map(n => ({
          path: n.path.length > 48 ? '...' + n.path.slice(-45) : n.path,
          degree: n.degree,
          complexity: n.complexity || 0,
        })),
      });

      // Show circular dependencies
      if (circularDeps.length > 0) {
        output.writeln();
        output.writeln(output.bold(output.warning(`Circular Dependencies: ${circularDeps.length}`)));
        output.writeln();

        for (const cycle of circularDeps.slice(0, 3)) {
          output.writeln(`  ${cycle.cycle.join(' -> ')}`);
        }
        if (circularDeps.length > 3) {
          output.writeln(output.dim(`  ... and ${circularDeps.length - 3} more`));
        }
      }

      if (outputFile) {
        const fullOutput = {
          nodes: Array.from(graph.nodes.values()),
          edges: graph.edges,
          metadata: graph.metadata,
          circularDependencies: circularDeps,
        };
        await writeFile(outputFile, JSON.stringify(fullOutput, null, 2));
        output.printSuccess(`Full results written to ${outputFile}`);
      }

      return { success: true };
    } catch (error) {
      spinner.stop();
      const message = error instanceof Error ? error.message : String(error);
      output.printError(`Analysis failed: ${message}`);
      return { success: false, exitCode: 1 };
    }
  },
};

/**
 * Detect circular dependencies
 */
const circularCommand: Command = {
  name: 'circular',
  aliases: ['cycles'],
  description: 'Detect circular dependencies in codebase',
  options: [
    {
      name: 'output',
      short: 'o',
      description: 'Output file path',
      type: 'string',
    },
    {
      name: 'format',
      short: 'f',
      description: 'Output format (text, json)',
      type: 'string',
      default: 'text',
      choices: ['text', 'json'],
    },
    {
      name: 'severity',
      short: 's',
      description: 'Minimum severity to show (low, medium, high)',
      type: 'string',
      default: 'low',
      choices: ['low', 'medium', 'high'],
    },
  ],
  examples: [
    { command: 'claude-flow analyze circular src/', description: 'Find circular dependencies' },
    { command: 'claude-flow analyze circular -s high src/', description: 'Only high severity cycles' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const targetDir = ctx.args[0] || ctx.cwd;
    const outputFile = ctx.flags.output as string | undefined;
    const format = (ctx.flags.format as string) || 'text';
    const minSeverity = (ctx.flags.severity as string) || 'low';

    output.printInfo(`Detecting circular dependencies in: ${output.highlight(targetDir)}`);
    output.writeln();

    const spinner = output.createSpinner({ text: 'Analyzing dependencies...', spinner: 'dots' });
    spinner.start();

    try {
      const analyzer = await getGraphAnalyzer();
      if (!analyzer) {
        spinner.stop();
        output.printError('Graph analyzer module not available');
        return { success: false, exitCode: 1 };
      }

      const graph = await analyzer.buildDependencyGraph(resolve(targetDir));
      const cycles = analyzer.detectCircularDependencies(graph);

      spinner.stop();

      // Filter by severity
      const severityOrder = { low: 0, medium: 1, high: 2 };
      const minLevel = severityOrder[minSeverity as keyof typeof severityOrder] || 0;
      const filtered = cycles.filter(c => severityOrder[c.severity] >= minLevel);

      if (format === 'json') {
        const jsonOutput = { cycles: filtered, total: cycles.length, filtered: filtered.length };

        if (outputFile) {
          await writeFile(outputFile, JSON.stringify(jsonOutput, null, 2));
          output.printSuccess(`Results written to ${outputFile}`);
        } else {
          output.printJson(jsonOutput);
        }

        return { success: true, data: jsonOutput };
      }

      // Text format
      if (filtered.length === 0) {
        output.printSuccess('No circular dependencies found!');
        return { success: true };
      }

      output.printBox(
        [
          `Total cycles: ${cycles.length}`,
          `Shown (${minSeverity}+): ${filtered.length}`,
          `High severity: ${cycles.filter(c => c.severity === 'high').length}`,
          `Medium severity: ${cycles.filter(c => c.severity === 'medium').length}`,
          `Low severity: ${cycles.filter(c => c.severity === 'low').length}`,
        ].join('\n'),
        'Circular Dependencies'
      );

      output.writeln();

      // Group by severity
      const grouped = {
        high: filtered.filter(c => c.severity === 'high'),
        medium: filtered.filter(c => c.severity === 'medium'),
        low: filtered.filter(c => c.severity === 'low'),
      };

      for (const [severity, items] of Object.entries(grouped)) {
        if (items.length === 0) continue;

        const color = severity === 'high' ? output.error : severity === 'medium' ? output.warning : output.dim;
        output.writeln(color(output.bold(`${severity.toUpperCase()} SEVERITY (${items.length})`)));
        output.writeln();

        for (const cycle of items.slice(0, 5)) {
          output.writeln(`  ${cycle.cycle.join(' -> ')}`);
          output.writeln(output.dim(`  Fix: ${cycle.suggestion}`));
          output.writeln();
        }

        if (items.length > 5) {
          output.writeln(output.dim(`  ... and ${items.length - 5} more ${severity} cycles`));
          output.writeln();
        }
      }

      if (outputFile) {
        await writeFile(outputFile, JSON.stringify({ cycles: filtered }, null, 2));
        output.printSuccess(`Results written to ${outputFile}`);
      }

      return { success: true, data: { cycles: filtered } };
    } catch (error) {
      spinner.stop();
      const message = error instanceof Error ? error.message : String(error);
      output.printError(`Analysis failed: ${message}`);
      return { success: false, exitCode: 1 };
    }
  },
};

// Helper functions
function getRiskDisplay(risk: string): string {
  switch (risk) {
    case 'critical':
      return output.color(output.bold('CRITICAL'), 'bgRed' as never, 'white' as never);
    case 'high-risk':
      return output.error('HIGH');
    case 'medium-risk':
      return output.warning('MEDIUM');
    case 'low-risk':
      return output.success('LOW');
    default:
      return risk;
  }
}

function getStatusDisplay(status: string): string {
  switch (status) {
    case 'added':
      return output.success('A');
    case 'modified':
      return output.warning('M');
    case 'deleted':
      return output.error('D');
    case 'renamed':
      return output.info('R');
    default:
      return status;
  }
}

// Main analyze command
export const analyzeCommand: Command = {
  name: 'analyze',
  description: 'Code analysis, diff classification, graph boundaries, and change risk assessment',
  aliases: ['an'],
  subcommands: [
    diffCommand,
    codeCommand,
    depsCommand,
    astCommand,
    complexityAstCommand,
    symbolsCommand,
    importsCommand,
    boundariesCommand,
    modulesCommand,
    dependenciesCommand,
    circularCommand,
  ],
  options: [
    {
      name: 'format',
      short: 'f',
      description: 'Output format: text, json, table',
      type: 'string',
      default: 'text',
    },
  ],
  examples: [
    { command: 'claude-flow analyze ast src/', description: 'Analyze code with AST parsing' },
    { command: 'claude-flow analyze complexity src/ --threshold 15', description: 'Find high-complexity files' },
    { command: 'claude-flow analyze symbols src/ --type function', description: 'Extract all functions' },
    { command: 'claude-flow analyze imports src/ --external', description: 'List npm dependencies' },
    { command: 'claude-flow analyze diff --risk', description: 'Analyze diff with risk assessment' },
    { command: 'claude-flow analyze boundaries src/', description: 'Find code boundaries using MinCut' },
    { command: 'claude-flow analyze modules src/', description: 'Detect module communities with Louvain' },
    { command: 'claude-flow analyze dependencies src/ --format dot', description: 'Export dependency graph as DOT' },
    { command: 'claude-flow analyze circular src/', description: 'Find circular dependencies' },
    { command: 'claude-flow analyze deps --security', description: 'Check dependency vulnerabilities' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    // If no subcommand, show help
    output.writeln();
    output.writeln(output.bold('Analyze Commands'));
    output.writeln(output.dim('-'.repeat(50)));
    output.writeln();

    output.writeln(output.bold('Available subcommands:'));
    output.writeln();
    output.writeln(`  ${output.highlight('diff')}         Analyze git diff for change risk and classification`);
    output.writeln(`  ${output.highlight('code')}         Static code analysis and quality assessment`);
    output.writeln(`  ${output.highlight('deps')}         Analyze project dependencies`);
    output.writeln(`  ${output.highlight('ast')}          AST analysis with symbol extraction and complexity`);
    output.writeln(`  ${output.highlight('complexity')}   Analyze cyclomatic and cognitive complexity`);
    output.writeln(`  ${output.highlight('symbols')}      Extract functions, classes, and types`);
    output.writeln(`  ${output.highlight('imports')}      Analyze import dependencies`);
    output.writeln(`  ${output.highlight('boundaries')}   Find code boundaries using MinCut algorithm`);
    output.writeln(`  ${output.highlight('modules')}      Detect module communities using Louvain algorithm`);
    output.writeln(`  ${output.highlight('dependencies')} Build and export full dependency graph`);
    output.writeln(`  ${output.highlight('circular')}     Detect circular dependencies in codebase`);
    output.writeln();

    output.writeln(output.bold('AST Analysis Examples:'));
    output.writeln();
    output.writeln(`  ${output.dim('claude-flow analyze ast src/')}                  # Full AST analysis`);
    output.writeln(`  ${output.dim('claude-flow analyze ast src/index.ts -c')}       # Include complexity`);
    output.writeln(`  ${output.dim('claude-flow analyze complexity src/ -t 15')}     # Flag high complexity`);
    output.writeln(`  ${output.dim('claude-flow analyze symbols src/ --type fn')}    # Extract functions`);
    output.writeln(`  ${output.dim('claude-flow analyze imports src/ --external')}   # Only npm imports`);
    output.writeln();

    output.writeln(output.bold('Graph Analysis Examples:'));
    output.writeln();
    output.writeln(`  ${output.dim('claude-flow analyze boundaries src/')}            # Find natural code boundaries`);
    output.writeln(`  ${output.dim('claude-flow analyze modules src/')}               # Detect module communities`);
    output.writeln(`  ${output.dim('claude-flow analyze dependencies -f dot src/')}   # Export to DOT format`);
    output.writeln(`  ${output.dim('claude-flow analyze circular src/')}              # Find circular deps`);
    output.writeln();

    output.writeln(output.bold('Diff Analysis Examples:'));
    output.writeln();
    output.writeln(`  ${output.dim('claude-flow analyze diff --risk')}              # Risk assessment`);
    output.writeln(`  ${output.dim('claude-flow analyze diff HEAD~1 --classify')}   # Classify changes`);
    output.writeln(`  ${output.dim('claude-flow analyze diff main..feature')}       # Compare branches`);
    output.writeln();

    return { success: true };
  },
};

export default analyzeCommand;
