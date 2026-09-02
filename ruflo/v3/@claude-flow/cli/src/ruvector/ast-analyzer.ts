/**
 * AST Analyzer for Code Analysis
 *
 * Analyzes Abstract Syntax Trees for code understanding
 * and intelligent routing decisions.
 *
 * @module ast-analyzer
 */

export interface ASTAnalyzerConfig {
  maxFileSize: number;
  languages: string[];
  includeComments: boolean;
  extractTypes: boolean;
  maxDepth: number;
}

export interface ASTNode {
  type: string;
  name: string;
  startLine: number;
  endLine: number;
  children: ASTNode[];
  metadata?: Record<string, unknown>;
}

export interface ASTAnalysis {
  filePath: string;
  language: string;
  root: ASTNode;
  functions: ASTNode[];
  classes: ASTNode[];
  imports: string[];
  exports: string[];
  complexity: {
    cyclomatic: number;
    cognitive: number;
    loc: number;
    commentDensity: number;
  };
  timestamp: number;
  durationMs: number;
}

const DEFAULT_CONFIG: ASTAnalyzerConfig = {
  maxFileSize: 1024 * 1024,
  languages: ['typescript', 'javascript', 'python', 'rust', 'go'],
  includeComments: true,
  extractTypes: true,
  maxDepth: 20,
};

const LANGUAGE_PATTERNS: Record<string, RegExp[]> = {
  typescript: [/\.tsx?$/, /^import\s+.*from\s+['"]/, /:\s*(string|number|boolean|void)/],
  javascript: [/\.jsx?$/, /^(const|let|var)\s+\w+\s*=/, /module\.exports/],
  python: [/\.py$/, /^(def|class|import|from)\s+/, /^#!/],
  rust: [/\.rs$/, /^(fn|struct|impl|use)\s+/, /^(pub\s+)?mod\s+/],
  go: [/\.go$/, /^package\s+/, /^func\s+/],
};

export class ASTAnalyzer {
  private config: ASTAnalyzerConfig;
  private ruvectorEngine: unknown = null;
  private useNative = false;
  private analysisCache: Map<string, ASTAnalysis> = new Map();

  constructor(config: Partial<ASTAnalyzerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async initialize(): Promise<void> {
    try {
      // @ruvector/ast is optional - gracefully fallback if not installed
      const ruvector = await import('@ruvector/ast' as string).catch(() => null);
      if (ruvector) {
        this.ruvectorEngine = (ruvector as any).createASTAnalyzer?.(this.config);
        this.useNative = !!this.ruvectorEngine;
      }
    } catch {
      this.useNative = false;
    }
  }

  analyze(code: string, filePath: string = 'unknown'): ASTAnalysis {
    const startTime = performance.now();
    if (code.length > this.config.maxFileSize) {
      throw new Error(`File too large: ${code.length} bytes exceeds ${this.config.maxFileSize}`);
    }
    const cacheKey = this.getCacheKey(code, filePath);
    const cached = this.analysisCache.get(cacheKey);
    if (cached) return cached;
    const language = this.detectLanguage(code, filePath);
    const root = this.parseAST(code, language);
    const functions = this.extractFunctions(root);
    const classes = this.extractClasses(root);
    const imports = this.extractImports(code, language);
    const exports = this.extractExports(code, language);
    const complexity = this.calculateComplexity(code, root);
    const durationMs = performance.now() - startTime;
    const analysis: ASTAnalysis = {
      filePath, language, root, functions, classes, imports, exports,
      complexity, timestamp: Date.now(), durationMs,
    };
    this.analysisCache.set(cacheKey, analysis);
    return analysis;
  }

  getFunctionAtLine(analysis: ASTAnalysis, line: number): ASTNode | null {
    for (const func of analysis.functions) {
      if (line >= func.startLine && line <= func.endLine) return func;
    }
    return null;
  }

  getClassAtLine(analysis: ASTAnalysis, line: number): ASTNode | null {
    for (const cls of analysis.classes) {
      if (line >= cls.startLine && line <= cls.endLine) return cls;
    }
    return null;
  }

  getSymbols(analysis: ASTAnalysis): string[] {
    const symbols: string[] = [];
    for (const func of analysis.functions) symbols.push(func.name);
    for (const cls of analysis.classes) symbols.push(cls.name);
    return symbols;
  }

  getStats(): Record<string, number> {
    return { cacheSize: this.analysisCache.size, useNative: this.useNative ? 1 : 0 };
  }

  clearCache(): void { this.analysisCache.clear(); }

  private getCacheKey(code: string, filePath: string): string {
    let hash = 0;
    const str = filePath + code.substring(0, 1000);
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return `ast_${hash}_${code.length}`;
  }

  private detectLanguage(code: string, filePath: string): string {
    for (const [lang, patterns] of Object.entries(LANGUAGE_PATTERNS)) {
      for (const pattern of patterns) {
        if (pattern.test(filePath) || pattern.test(code)) return lang;
      }
    }
    return 'unknown';
  }

  private parseAST(code: string, language: string): ASTNode {
    const lines = code.split('\n');
    const root: ASTNode = { type: 'program', name: 'root', startLine: 1, endLine: lines.length, children: [] };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;
      const funcMatch = this.matchFunction(line, language);
      if (funcMatch) {
        const funcNode: ASTNode = {
          type: 'function', name: funcMatch.name, startLine: lineNum,
          endLine: lineNum + this.findBlockEnd(lines, i), children: [],
          metadata: { params: funcMatch.params },
        };
        root.children.push(funcNode);
        continue;
      }
      const classMatch = this.matchClass(line, language);
      if (classMatch) {
        const classNode: ASTNode = {
          type: 'class', name: classMatch.name, startLine: lineNum,
          endLine: lineNum + this.findBlockEnd(lines, i), children: [],
          metadata: { extends: classMatch.extends },
        };
        root.children.push(classNode);
      }
    }
    return root;
  }

  private matchFunction(line: string, language: string): { name: string; params: string } | null {
    const patterns: Record<string, RegExp> = {
      typescript: /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/,
      javascript: /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/,
      python: /def\s+(\w+)\s*\(([^)]*)\)/,
      rust: /(?:pub\s+)?(?:async\s+)?fn\s+(\w+)\s*\(([^)]*)\)/,
      go: /func\s+(?:\([^)]*\)\s+)?(\w+)\s*\(([^)]*)\)/,
    };
    const pattern = patterns[language];
    if (!pattern) return null;
    const match = line.match(pattern);
    if (match) return { name: match[1], params: match[2] || '' };
    const arrowMatch = line.match(/(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>/);
    if (arrowMatch) return { name: arrowMatch[1], params: '' };
    const methodMatch = line.match(/^\s*(?:async\s+)?(\w+)\s*\([^)]*\)\s*(?::\s*\w+)?\s*\{/);
    if (methodMatch && methodMatch[1] !== 'if' && methodMatch[1] !== 'while' && methodMatch[1] !== 'for') {
      return { name: methodMatch[1], params: '' };
    }
    return null;
  }

  private matchClass(line: string, language: string): { name: string; extends?: string } | null {
    const patterns: Record<string, RegExp> = {
      typescript: /(?:export\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?/,
      javascript: /(?:export\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?/,
      python: /class\s+(\w+)(?:\((\w+)\))?/,
      rust: /(?:pub\s+)?struct\s+(\w+)/,
      go: /type\s+(\w+)\s+struct/,
    };
    const pattern = patterns[language];
    if (!pattern) return null;
    const match = line.match(pattern);
    if (match) return { name: match[1], extends: match[2] };
    return null;
  }

  private findBlockEnd(lines: string[], startIdx: number): number {
    let depth = 0;
    let inBlock = false;
    for (let i = startIdx; i < lines.length; i++) {
      const line = lines[i];
      const opens = (line.match(/[\{]/g) || []).length;
      const closes = (line.match(/[\}]/g) || []).length;
      if (opens > 0) inBlock = true;
      depth += opens - closes;
      if (inBlock && depth <= 0) return i - startIdx;
    }
    return Math.min(50, lines.length - startIdx);
  }

  private extractFunctions(root: ASTNode): ASTNode[] {
    const functions: ASTNode[] = [];
    const visit = (node: ASTNode) => {
      if (node.type === 'function') functions.push(node);
      for (const child of node.children) visit(child);
    };
    visit(root);
    return functions;
  }

  private extractClasses(root: ASTNode): ASTNode[] {
    const classes: ASTNode[] = [];
    const visit = (node: ASTNode) => {
      if (node.type === 'class') classes.push(node);
      for (const child of node.children) visit(child);
    };
    visit(root);
    return classes;
  }

  private extractImports(code: string, language: string): string[] {
    const imports: string[] = [];
    const lines = code.split('\n');
    const patterns: Record<string, RegExp> = {
      typescript: /import\s+(?:.*\s+from\s+)?['"]([^'"]+)['"]/,
      javascript: /(?:import\s+.*from\s+|require\s*\(\s*)['"]([^'"]+)['"]/,
      python: /(?:from\s+(\S+)\s+import|import\s+(\S+))/,
      rust: /use\s+(\S+)/,
      go: /import\s+(?:\(\s*)?["']([^"']+)["']/,
    };
    const pattern = patterns[language];
    if (!pattern) return imports;
    for (const line of lines) {
      const match = line.match(pattern);
      if (match) imports.push(match[1] || match[2]);
    }
    return imports;
  }

  private extractExports(code: string, language: string): string[] {
    const exports: string[] = [];
    const lines = code.split('\n');
    for (const line of lines) {
      const exportMatch = line.match(/export\s+(?:default\s+)?(?:const|let|var|function|class|interface|type|enum)\s+(\w+)/);
      if (exportMatch) exports.push(exportMatch[1]);
      const namedExportMatch = line.match(/export\s*\{\s*([^}]+)\s*\}/);
      if (namedExportMatch) {
        const names = namedExportMatch[1].split(',').map(n => n.trim().split(/\s+as\s+/)[0]);
        exports.push(...names);
      }
    }
    return exports;
  }

  private calculateComplexity(code: string, root: ASTNode): ASTAnalysis['complexity'] {
    const lines = code.split('\n');
    const nonEmptyLines = lines.filter(l => l.trim().length > 0);
    const commentLines = lines.filter(l => /^\s*(\/\/|\/\*|\*|#)/.test(l));
    const decisionPoints = (code.match(/\b(if|else|for|while|switch|case|catch|&&|\|\||\?)\b/g) || []).length;
    const cyclomatic = decisionPoints + 1;
    let cognitive = 0;
    let nestingLevel = 0;
    for (const line of lines) {
      const opens = (line.match(/[\{]/g) || []).length;
      const closes = (line.match(/[\}]/g) || []).length;
      if (/\b(if|for|while|switch)\b/.test(line)) cognitive += 1 + nestingLevel;
      nestingLevel += opens - closes;
      nestingLevel = Math.max(0, nestingLevel);
    }
    return {
      cyclomatic, cognitive, loc: nonEmptyLines.length,
      commentDensity: lines.length > 0 ? commentLines.length / lines.length : 0,
    };
  }
}

export function createASTAnalyzer(config?: Partial<ASTAnalyzerConfig>): ASTAnalyzer {
  return new ASTAnalyzer(config);
}
