/**
 * V3 File Organization Hook
 *
 * TypeScript conversion of V2 file-hook.sh.
 * Enforces file organization, blocks writes to root folder,
 * suggests proper directories, and recommends formatters.
 *
 * @module v3/shared/hooks/safety/file-organization
 */

import * as path from 'path';
import {
  HookEvent,
  HookContext,
  HookResult,
  HookPriority,
  FileOperationInfo,
} from '../types.js';
import { HookRegistry } from '../registry.js';

/**
 * File organization hook result
 */
export interface FileOrganizationResult extends HookResult {
  /** Whether the file operation should be blocked */
  blocked: boolean;
  /** Reason for blocking */
  blockReason?: string;
  /** Suggested new path */
  suggestedPath?: string;
  /** Suggested directory */
  suggestedDirectory?: string;
  /** Formatter recommendation */
  formatter?: FormatterRecommendation;
  /** Linter recommendation */
  linter?: LinterRecommendation;
  /** File type detected */
  fileType?: string;
  /** Warnings */
  warnings?: string[];
  /** Organization issues detected */
  issues?: OrganizationIssue[];
}

/**
 * Formatter recommendation
 */
export interface FormatterRecommendation {
  /** Formatter name */
  name: string;
  /** Command to run */
  command: string;
  /** Config file to check for */
  configFile?: string;
  /** Whether config exists */
  configExists?: boolean;
}

/**
 * Linter recommendation
 */
export interface LinterRecommendation {
  /** Linter name */
  name: string;
  /** Command to run */
  command: string;
  /** Config file to check for */
  configFile?: string;
}

/**
 * Organization issue
 */
export interface OrganizationIssue {
  /** Issue type */
  type: 'wrong-directory' | 'naming-convention' | 'missing-config' | 'root-write';
  /** Issue severity */
  severity: 'info' | 'warning' | 'error';
  /** Issue description */
  description: string;
  /** Suggested fix */
  suggestedFix?: string;
}

/**
 * File type mapping to directories
 */
const FILE_TYPE_DIRECTORIES: Array<{
  /** File extension or pattern */
  pattern: RegExp;
  /** Suggested directories */
  directories: string[];
  /** File type name */
  type: string;
  /** Whether to block root writes */
  blockRoot: boolean;
}> = [
  // Test files (MUST come before source files - more specific patterns first)
  { pattern: /\.test\.(ts|tsx|js|jsx)$/, directories: ['tests/', '__tests__/', 'test/'], type: 'test file', blockRoot: true },
  { pattern: /\.spec\.(ts|tsx|js|jsx)$/, directories: ['tests/', '__tests__/', 'test/', 'spec/'], type: 'spec file', blockRoot: true },
  { pattern: /_test\.go$/, directories: ['tests/', 'test/'], type: 'Go test file', blockRoot: true },
  { pattern: /test_.*\.py$/, directories: ['tests/', 'test/'], type: 'Python test file', blockRoot: true },
  { pattern: /.*_test\.py$/, directories: ['tests/', 'test/'], type: 'Python test file', blockRoot: true },

  // Source files
  { pattern: /\.(ts|tsx)$/, directories: ['src/', 'lib/'], type: 'TypeScript source', blockRoot: true },
  { pattern: /\.(js|jsx|mjs|cjs)$/, directories: ['src/', 'lib/', 'dist/'], type: 'JavaScript source', blockRoot: true },
  { pattern: /\.py$/, directories: ['src/', 'lib/', 'app/'], type: 'Python source', blockRoot: true },
  { pattern: /\.go$/, directories: ['cmd/', 'pkg/', 'internal/'], type: 'Go source', blockRoot: true },
  { pattern: /\.rs$/, directories: ['src/'], type: 'Rust source', blockRoot: true },
  { pattern: /\.java$/, directories: ['src/main/java/', 'src/'], type: 'Java source', blockRoot: true },
  { pattern: /\.rb$/, directories: ['lib/', 'app/'], type: 'Ruby source', blockRoot: true },
  { pattern: /\.php$/, directories: ['src/', 'app/'], type: 'PHP source', blockRoot: true },
  { pattern: /\.cs$/, directories: ['src/'], type: 'C# source', blockRoot: true },
  { pattern: /\.cpp?$/, directories: ['src/'], type: 'C/C++ source', blockRoot: true },
  { pattern: /\.swift$/, directories: ['Sources/'], type: 'Swift source', blockRoot: true },
  { pattern: /\.kt$/, directories: ['src/main/kotlin/', 'src/'], type: 'Kotlin source', blockRoot: true },

  // Config files (usually allowed at root)
  { pattern: /\.(json|yaml|yml|toml)$/, directories: ['config/', './', 'configs/'], type: 'config file', blockRoot: false },
  { pattern: /\.(env|env\.[a-z]+)$/, directories: ['./'], type: 'environment file', blockRoot: false },

  // Documentation
  { pattern: /\.md$/, directories: ['docs/', './'], type: 'Markdown documentation', blockRoot: false },
  { pattern: /\.rst$/, directories: ['docs/'], type: 'reStructuredText documentation', blockRoot: true },
  { pattern: /\.adoc$/, directories: ['docs/'], type: 'AsciiDoc documentation', blockRoot: true },

  // Assets
  { pattern: /\.(css|scss|sass|less)$/, directories: ['styles/', 'src/styles/', 'assets/css/'], type: 'stylesheet', blockRoot: true },
  { pattern: /\.(png|jpg|jpeg|gif|svg|ico)$/, directories: ['assets/', 'public/', 'images/', 'static/'], type: 'image', blockRoot: true },
  { pattern: /\.(woff2?|ttf|otf|eot)$/, directories: ['assets/fonts/', 'fonts/', 'public/fonts/'], type: 'font', blockRoot: true },

  // Scripts
  { pattern: /\.sh$/, directories: ['scripts/', 'bin/'], type: 'shell script', blockRoot: true },
  { pattern: /\.ps1$/, directories: ['scripts/', 'bin/'], type: 'PowerShell script', blockRoot: true },

  // Data
  { pattern: /\.sql$/, directories: ['migrations/', 'db/', 'database/'], type: 'SQL file', blockRoot: true },
  { pattern: /\.csv$/, directories: ['data/', 'fixtures/', 'test/fixtures/'], type: 'CSV data', blockRoot: true },
];

/**
 * Formatter recommendations by file extension
 */
const FORMATTERS: Record<string, FormatterRecommendation> = {
  '.ts': { name: 'Prettier', command: 'prettier --write', configFile: '.prettierrc' },
  '.tsx': { name: 'Prettier', command: 'prettier --write', configFile: '.prettierrc' },
  '.js': { name: 'Prettier', command: 'prettier --write', configFile: '.prettierrc' },
  '.jsx': { name: 'Prettier', command: 'prettier --write', configFile: '.prettierrc' },
  '.json': { name: 'Prettier', command: 'prettier --write', configFile: '.prettierrc' },
  '.md': { name: 'Prettier', command: 'prettier --write', configFile: '.prettierrc' },
  '.yaml': { name: 'Prettier', command: 'prettier --write', configFile: '.prettierrc' },
  '.yml': { name: 'Prettier', command: 'prettier --write', configFile: '.prettierrc' },
  '.py': { name: 'Black', command: 'black', configFile: 'pyproject.toml' },
  '.go': { name: 'gofmt', command: 'gofmt -w', configFile: undefined },
  '.rs': { name: 'rustfmt', command: 'rustfmt', configFile: 'rustfmt.toml' },
  '.java': { name: 'google-java-format', command: 'google-java-format -i', configFile: undefined },
  '.rb': { name: 'RuboCop', command: 'rubocop -a', configFile: '.rubocop.yml' },
  '.php': { name: 'PHP-CS-Fixer', command: 'php-cs-fixer fix', configFile: '.php-cs-fixer.php' },
  '.cs': { name: 'dotnet-format', command: 'dotnet format', configFile: '.editorconfig' },
  '.swift': { name: 'swift-format', command: 'swift-format -i', configFile: '.swift-format' },
  '.kt': { name: 'ktlint', command: 'ktlint -F', configFile: '.editorconfig' },
  '.css': { name: 'Prettier', command: 'prettier --write', configFile: '.prettierrc' },
  '.scss': { name: 'Prettier', command: 'prettier --write', configFile: '.prettierrc' },
  '.html': { name: 'Prettier', command: 'prettier --write', configFile: '.prettierrc' },
};

/**
 * Linter recommendations by file extension
 */
const LINTERS: Record<string, LinterRecommendation> = {
  '.ts': { name: 'ESLint', command: 'eslint --fix', configFile: '.eslintrc' },
  '.tsx': { name: 'ESLint', command: 'eslint --fix', configFile: '.eslintrc' },
  '.js': { name: 'ESLint', command: 'eslint --fix', configFile: '.eslintrc' },
  '.jsx': { name: 'ESLint', command: 'eslint --fix', configFile: '.eslintrc' },
  '.py': { name: 'Pylint', command: 'pylint', configFile: 'pylintrc' },
  '.go': { name: 'golangci-lint', command: 'golangci-lint run', configFile: '.golangci.yml' },
  '.rs': { name: 'Clippy', command: 'cargo clippy', configFile: 'Cargo.toml' },
  '.rb': { name: 'RuboCop', command: 'rubocop', configFile: '.rubocop.yml' },
  '.php': { name: 'PHPStan', command: 'phpstan analyse', configFile: 'phpstan.neon' },
};

/**
 * Naming convention checks
 */
const NAMING_CONVENTIONS: Array<{
  /** Pattern to match file names */
  pattern: RegExp;
  /** Expected naming convention */
  convention: 'kebab-case' | 'camelCase' | 'PascalCase' | 'snake_case';
  /** File types this applies to */
  fileTypes: RegExp;
}> = [
  { pattern: /^[a-z][a-z0-9-]*\.[a-z]+$/, convention: 'kebab-case', fileTypes: /\.(tsx?|jsx?|css|scss)$/ },
  { pattern: /^[a-z][a-z0-9_]*\.[a-z]+$/, convention: 'snake_case', fileTypes: /\.py$/ },
  { pattern: /^[a-z][a-z0-9_]*\.[a-z]+$/, convention: 'snake_case', fileTypes: /\.go$/ },
  { pattern: /^[A-Z][a-zA-Z0-9]*\.[a-z]+$/, convention: 'PascalCase', fileTypes: /\.(java|kt|cs)$/ },
];

/**
 * File Organization Hook Manager
 */
export class FileOrganizationHook {
  private registry: HookRegistry;
  private projectRoot: string = process.cwd();

  constructor(registry: HookRegistry) {
    this.registry = registry;
    this.registerHooks();
  }

  /**
   * Register file organization hooks
   */
  private registerHooks(): void {
    // Pre-edit hook
    this.registry.register(
      HookEvent.PreEdit,
      this.analyzeFileOperation.bind(this),
      HookPriority.High,
      { name: 'file-organization:pre-edit' }
    );

    // Pre-write hook
    this.registry.register(
      HookEvent.PreWrite,
      this.analyzeFileOperation.bind(this),
      HookPriority.High,
      { name: 'file-organization:pre-write' }
    );
  }

  /**
   * Analyze file operation for organization issues
   */
  async analyzeFileOperation(context: HookContext): Promise<FileOrganizationResult> {
    const fileInfo = context.file;
    if (!fileInfo) {
      return this.createResult(false, []);
    }

    const filePath = fileInfo.path;
    const fileName = path.basename(filePath);
    const dirName = path.dirname(filePath);
    const ext = path.extname(filePath);

    const issues: OrganizationIssue[] = [];
    const warnings: string[] = [];
    let blocked = false;
    let blockReason: string | undefined;
    let suggestedPath: string | undefined;
    let suggestedDirectory: string | undefined;

    // Check if writing to root folder
    const isRootWrite = this.isRootDirectory(dirName);
    const fileTypeInfo = this.getFileTypeInfo(fileName);

    if (isRootWrite && fileTypeInfo?.blockRoot) {
      blocked = true;
      blockReason = `Source files should not be written to root folder. Suggested: ${fileTypeInfo.directories[0]}`;
      suggestedDirectory = fileTypeInfo.directories[0];
      suggestedPath = path.join(suggestedDirectory, fileName);

      issues.push({
        type: 'root-write',
        severity: 'error',
        description: `${fileTypeInfo.type} files should not be in the root directory`,
        suggestedFix: `Move to ${suggestedDirectory}`,
      });
    }

    // Check if file is in wrong directory
    if (!isRootWrite && fileTypeInfo) {
      const isInCorrectDir = fileTypeInfo.directories.some(dir =>
        this.normalizePath(dirName).includes(this.normalizePath(dir))
      );

      if (!isInCorrectDir) {
        issues.push({
          type: 'wrong-directory',
          severity: 'warning',
          description: `${fileTypeInfo.type} typically goes in: ${fileTypeInfo.directories.join(' or ')}`,
          suggestedFix: `Consider moving to ${fileTypeInfo.directories[0]}`,
        });
        warnings.push(`File may be in wrong directory. Expected: ${fileTypeInfo.directories.join(' or ')}`);
      }
    }

    // Check naming convention
    const namingIssue = this.checkNamingConvention(fileName, ext);
    if (namingIssue) {
      issues.push(namingIssue);
      warnings.push(namingIssue.description);
    }

    // Get formatter recommendation
    const formatter = this.getFormatterRecommendation(ext);

    // Get linter recommendation
    const linter = this.getLinterRecommendation(ext);

    return {
      success: true,
      blocked,
      blockReason,
      suggestedPath,
      suggestedDirectory,
      formatter,
      linter,
      fileType: fileTypeInfo?.type,
      warnings: warnings.length > 0 ? warnings : undefined,
      issues: issues.length > 0 ? issues : undefined,
      abort: blocked,
      data: blocked ? undefined : {
        file: {
          ...fileInfo,
          path: suggestedPath || filePath,
        },
        metadata: {
          formatter: formatter?.command,
          linter: linter?.command,
        },
      },
    };
  }

  /**
   * Check if directory is root
   */
  private isRootDirectory(dirName: string): boolean {
    const normalized = this.normalizePath(dirName);
    return normalized === '.' ||
           normalized === './' ||
           normalized === '' ||
           normalized === this.normalizePath(this.projectRoot);
  }

  /**
   * Normalize path for comparison
   */
  private normalizePath(p: string): string {
    return p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
  }

  /**
   * Get file type information
   */
  private getFileTypeInfo(fileName: string): {
    directories: string[];
    type: string;
    blockRoot: boolean;
  } | null {
    for (const info of FILE_TYPE_DIRECTORIES) {
      if (info.pattern.test(fileName)) {
        return {
          directories: info.directories,
          type: info.type,
          blockRoot: info.blockRoot,
        };
      }
    }
    return null;
  }

  /**
   * Check naming convention
   */
  private checkNamingConvention(fileName: string, ext: string): OrganizationIssue | null {
    for (const rule of NAMING_CONVENTIONS) {
      if (rule.fileTypes.test(ext)) {
        const baseName = fileName.replace(ext, '');
        if (!rule.pattern.test(fileName)) {
          return {
            type: 'naming-convention',
            severity: 'info',
            description: `File name may not follow ${rule.convention} convention`,
            suggestedFix: `Consider renaming to follow ${rule.convention}`,
          };
        }
      }
    }
    return null;
  }

  /**
   * Get formatter recommendation
   */
  private getFormatterRecommendation(ext: string): FormatterRecommendation | undefined {
    return FORMATTERS[ext];
  }

  /**
   * Get linter recommendation
   */
  private getLinterRecommendation(ext: string): LinterRecommendation | undefined {
    return LINTERS[ext];
  }

  /**
   * Create result object
   */
  private createResult(blocked: boolean, issues: OrganizationIssue[]): FileOrganizationResult {
    return {
      success: true,
      blocked,
      issues: issues.length > 0 ? issues : undefined,
    };
  }

  /**
   * Manually analyze a file path
   */
  async analyze(filePath: string): Promise<FileOrganizationResult> {
    const context: HookContext = {
      event: HookEvent.PreEdit,
      timestamp: new Date(),
      file: {
        path: filePath,
        operation: 'write',
      },
    };

    return this.analyzeFileOperation(context);
  }

  /**
   * Get suggested directory for a file
   */
  getSuggestedDirectory(fileName: string): string | null {
    const info = this.getFileTypeInfo(fileName);
    return info?.directories[0] || null;
  }

  /**
   * Check if a file path would be blocked
   */
  wouldBlock(filePath: string): boolean {
    const fileName = path.basename(filePath);
    const dirName = path.dirname(filePath);
    const isRoot = this.isRootDirectory(dirName);
    const info = this.getFileTypeInfo(fileName);

    return isRoot && (info?.blockRoot ?? false);
  }

  /**
   * Set project root directory
   */
  setProjectRoot(root: string): void {
    this.projectRoot = root;
  }

  /**
   * Get all formatter recommendations
   */
  getAllFormatters(): Record<string, FormatterRecommendation> {
    return { ...FORMATTERS };
  }

  /**
   * Get all linter recommendations
   */
  getAllLinters(): Record<string, LinterRecommendation> {
    return { ...LINTERS };
  }
}

/**
 * Create file organization hook
 */
export function createFileOrganizationHook(registry: HookRegistry): FileOrganizationHook {
  return new FileOrganizationHook(registry);
}
