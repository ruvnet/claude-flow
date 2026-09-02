/**
 * V3 Git Commit Hook
 *
 * TypeScript conversion of V2 git-commit-hook.sh.
 * Provides conventional commit formatting, JIRA ticket extraction,
 * co-author addition, and commit message validation.
 *
 * @module v3/shared/hooks/safety/git-commit
 */

import {
  HookEvent,
  HookContext,
  HookResult,
  HookPriority,
} from '../types.js';
import { HookRegistry } from '../registry.js';

/**
 * Git commit hook result
 */
export interface GitCommitResult extends HookResult {
  /** Original commit message */
  originalMessage: string;
  /** Modified commit message */
  modifiedMessage: string;
  /** Detected commit type */
  commitType?: CommitType;
  /** Extracted ticket reference */
  ticketReference?: string;
  /** Whether co-author was added */
  coAuthorAdded: boolean;
  /** Validation issues */
  validationIssues?: CommitValidationIssue[];
  /** Suggestions for improvement */
  suggestions?: string[];
}

/**
 * Commit type definition
 */
export type CommitType =
  | 'feat'
  | 'fix'
  | 'docs'
  | 'style'
  | 'refactor'
  | 'perf'
  | 'test'
  | 'build'
  | 'ci'
  | 'chore'
  | 'revert';

/**
 * Commit validation issue
 */
export interface CommitValidationIssue {
  /** Issue type */
  type: 'format' | 'length' | 'scope' | 'body' | 'breaking';
  /** Issue severity */
  severity: 'info' | 'warning' | 'error';
  /** Issue description */
  description: string;
  /** Suggested fix */
  suggestedFix?: string;
}

/**
 * Conventional commit patterns
 */
interface CommitTypePattern {
  /** Keywords that indicate this commit type */
  keywords: string[];
  /** Commit type */
  type: CommitType;
  /** Description */
  description: string;
}

const COMMIT_TYPE_PATTERNS: CommitTypePattern[] = [
  {
    keywords: ['add', 'implement', 'create', 'introduce', 'new'],
    type: 'feat',
    description: 'A new feature',
  },
  {
    keywords: ['fix', 'resolve', 'repair', 'patch', 'correct', 'bug'],
    type: 'fix',
    description: 'A bug fix',
  },
  {
    keywords: ['doc', 'docs', 'readme', 'comment', 'documentation'],
    type: 'docs',
    description: 'Documentation changes',
  },
  {
    keywords: ['style', 'format', 'lint', 'whitespace', 'prettier'],
    type: 'style',
    description: 'Code style changes',
  },
  {
    keywords: ['refactor', 'restructure', 'reorganize', 'extract', 'simplify'],
    type: 'refactor',
    description: 'Code refactoring',
  },
  {
    keywords: ['perf', 'performance', 'optimize', 'speed', 'faster'],
    type: 'perf',
    description: 'Performance improvements',
  },
  {
    keywords: ['test', 'tests', 'spec', 'coverage', 'unittest'],
    type: 'test',
    description: 'Adding or updating tests',
  },
  {
    keywords: ['build', 'webpack', 'rollup', 'vite', 'esbuild', 'package'],
    type: 'build',
    description: 'Build system changes',
  },
  {
    keywords: ['ci', 'github action', 'workflow', 'pipeline', 'travis', 'jenkins'],
    type: 'ci',
    description: 'CI/CD changes',
  },
  {
    keywords: ['chore', 'update', 'upgrade', 'bump', 'dependency', 'deps'],
    type: 'chore',
    description: 'Maintenance tasks',
  },
  {
    keywords: ['revert', 'rollback', 'undo'],
    type: 'revert',
    description: 'Reverting changes',
  },
];

/**
 * Ticket patterns (JIRA, GitHub, etc.)
 */
const TICKET_PATTERNS: Array<{
  name: string;
  pattern: RegExp;
  format: (match: RegExpExecArray) => string;
}> = [
  {
    name: 'JIRA',
    pattern: /([A-Z]{2,10}-\d+)/,
    format: (match) => match[1],
  },
  {
    name: 'GitHub Issue',
    pattern: /#(\d+)/,
    format: (match) => `#${match[1]}`,
  },
  {
    name: 'Linear',
    pattern: /([A-Z]{2,10}-[A-Z0-9]+)/,
    format: (match) => match[1],
  },
];

/**
 * Co-author configuration
 */
interface CoAuthor {
  name: string;
  email: string;
}

const DEFAULT_CO_AUTHOR: CoAuthor = {
  name: 'Claude Opus 4.5',
  email: 'noreply@anthropic.com',
};

/**
 * Commit message configuration
 */
interface CommitConfig {
  /** Maximum subject line length */
  maxSubjectLength: number;
  /** Maximum body line length */
  maxBodyLength: number;
  /** Require conventional commit format */
  requireConventional: boolean;
  /** Add co-author by default */
  addCoAuthor: boolean;
  /** Co-author to add */
  coAuthor: CoAuthor;
  /** Add Claude Code reference */
  addClaudeReference: boolean;
  /** Allowed scopes */
  allowedScopes?: string[];
}

const DEFAULT_CONFIG: CommitConfig = {
  maxSubjectLength: 72,
  maxBodyLength: 100,
  requireConventional: true,
  addCoAuthor: true,
  coAuthor: DEFAULT_CO_AUTHOR,
  addClaudeReference: true,
};

/**
 * Git Commit Hook Manager
 */
export class GitCommitHook {
  private registry: HookRegistry;
  private config: CommitConfig;

  constructor(registry: HookRegistry, config?: Partial<CommitConfig>) {
    this.registry = registry;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.registerHooks();
  }

  /**
   * Register git commit hooks
   */
  private registerHooks(): void {
    // We use PreCommand hook since there's no specific commit hook event
    // In practice, this would be called when detecting git commit commands
    this.registry.register(
      HookEvent.PreCommand,
      this.handlePreCommit.bind(this),
      HookPriority.Normal,
      { name: 'git-commit:pre-commit' }
    );
  }

  /**
   * Handle pre-commit (when a git commit command is detected)
   */
  async handlePreCommit(context: HookContext): Promise<HookResult> {
    const command = context.command?.command || '';

    // Only process git commit commands
    if (!command.includes('git commit')) {
      return { success: true };
    }

    // Extract message from command if present
    const messageMatch = command.match(/-m\s+["']([^"']+)["']/);
    if (!messageMatch) {
      return { success: true }; // No message to process
    }

    const message = messageMatch[1];
    const branchName = context.metadata?.branchName as string | undefined;

    const result = await this.processCommitMessage(message, branchName);

    // Modify the command with the new message
    if (result.success && result.modifiedMessage !== message) {
      const modifiedCommand = command.replace(
        /-m\s+["'][^"']+["']/,
        `-m "${result.modifiedMessage.replace(/"/g, '\\"')}"`
      );

      return {
        ...result,
        data: {
          command: {
            ...context.command,
            command: modifiedCommand,
          },
        },
      };
    }

    return result;
  }

  /**
   * Process commit message
   */
  async processCommitMessage(
    message: string,
    branchName?: string
  ): Promise<GitCommitResult> {
    const originalMessage = message;
    let modifiedMessage = message;
    const validationIssues: CommitValidationIssue[] = [];
    const suggestions: string[] = [];

    // Parse existing message structure
    const { subject, body, footer } = this.parseMessage(message);

    // Detect commit type
    const commitType = this.detectCommitType(subject);

    // Add commit type prefix if not present and type was detected
    if (commitType && !this.hasConventionalPrefix(subject)) {
      modifiedMessage = `${commitType}: ${this.lowercaseFirstLetter(subject)}`;
      suggestions.push(`Added conventional commit prefix: ${commitType}`);
    } else if (!commitType && this.config.requireConventional && !this.hasConventionalPrefix(subject)) {
      // No type detected but conventional commits are required - suggest adding a prefix
      suggestions.push('Consider adding a conventional commit prefix (feat:, fix:, docs:, etc.)');
    }

    // Validate subject length
    if (subject.length > this.config.maxSubjectLength) {
      validationIssues.push({
        type: 'length',
        severity: 'warning',
        description: `Subject line exceeds ${this.config.maxSubjectLength} characters`,
        suggestedFix: 'Shorten the subject line',
      });
    }

    // Extract ticket reference from branch name
    let ticketReference: string | undefined;
    if (branchName) {
      ticketReference = this.extractTicket(branchName);
      if (ticketReference && !modifiedMessage.includes(ticketReference)) {
        modifiedMessage = this.addTicketReference(modifiedMessage, ticketReference);
        suggestions.push(`Added ticket reference: ${ticketReference}`);
      }
    }

    // Add Claude Code reference and co-author
    let coAuthorAdded = false;
    if (this.config.addClaudeReference || this.config.addCoAuthor) {
      const additions: string[] = [];

      if (this.config.addClaudeReference) {
        additions.push('\n\nGenerated with [Claude Code](https://claude.com/claude-code)');
      }

      if (this.config.addCoAuthor) {
        additions.push(`\n\nCo-Authored-By: ${this.config.coAuthor.name} <${this.config.coAuthor.email}>`);
        coAuthorAdded = true;
      }

      // Only add if not already present
      for (const addition of additions) {
        const searchStr = addition.trim().split('\n')[0];
        if (!modifiedMessage.includes(searchStr)) {
          modifiedMessage += addition;
        }
      }
    }

    // Validate conventional commit format
    if (this.config.requireConventional) {
      const conventionalIssues = this.validateConventional(modifiedMessage);
      validationIssues.push(...conventionalIssues);
    }

    return {
      success: true,
      originalMessage,
      modifiedMessage,
      commitType,
      ticketReference,
      coAuthorAdded,
      validationIssues: validationIssues.length > 0 ? validationIssues : undefined,
      suggestions: suggestions.length > 0 ? suggestions : undefined,
    };
  }

  /**
   * Parse commit message into parts
   */
  private parseMessage(message: string): {
    subject: string;
    body?: string;
    footer?: string;
  } {
    const parts = message.split('\n\n');
    return {
      subject: parts[0] || '',
      body: parts[1],
      footer: parts.slice(2).join('\n\n'),
    };
  }

  /**
   * Detect commit type from message
   */
  private detectCommitType(message: string): CommitType | undefined {
    const lowerMessage = message.toLowerCase();

    // First check if message already has conventional prefix
    const prefixMatch = lowerMessage.match(/^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\(.+\))?:/);
    if (prefixMatch) {
      return prefixMatch[1] as CommitType;
    }

    // Score each commit type based on keyword matches
    // More specific/unique keywords get higher weight
    const scores: Map<CommitType, number> = new Map();

    // High-priority patterns (check these first as they're more specific)
    const priorityPatterns: Array<{ pattern: RegExp; type: CommitType; weight: number }> = [
      // Test patterns - high priority because "add tests" should be 'test' not 'feat'
      { pattern: /\b(test|tests|spec|specs|unittest|unit test|testing)\b/i, type: 'test', weight: 3 },
      // Docs patterns
      { pattern: /\b(doc|docs|documentation|readme|comment|comments)\b/i, type: 'docs', weight: 3 },
      // Revert patterns
      { pattern: /\b(revert|rollback|undo)\b/i, type: 'revert', weight: 3 },
      // Fix patterns (bug-specific)
      { pattern: /\b(fix|bug|bugfix|resolve|patch|hotfix)\b/i, type: 'fix', weight: 2 },
      // CI patterns
      { pattern: /\b(ci|github action|workflow|pipeline|travis|jenkins|circleci)\b/i, type: 'ci', weight: 3 },
      // Build patterns
      { pattern: /\b(build|webpack|rollup|vite|esbuild|bundler|package\.json)\b/i, type: 'build', weight: 2 },
      // Perf patterns
      { pattern: /\b(perf|performance|optimize|speed|faster|slow)\b/i, type: 'perf', weight: 2 },
      // Refactor patterns
      { pattern: /\b(refactor|restructure|reorganize|extract|simplify|clean)\b/i, type: 'refactor', weight: 2 },
      // Style patterns
      { pattern: /\b(style|format|lint|whitespace|prettier|eslint)\b/i, type: 'style', weight: 2 },
      // Chore patterns - specifically for dependencies
      { pattern: /\b(dependency|dependencies|deps|bump|upgrade version)\b/i, type: 'chore', weight: 2 },
      // Generic update is lower priority (could be chore or other)
      { pattern: /\b(update)\b/i, type: 'chore', weight: 1 },
      // Feat patterns (generic add/create/implement)
      { pattern: /\b(add|implement|create|introduce|new feature)\b/i, type: 'feat', weight: 1 },
    ];

    // Calculate scores for each pattern
    for (const { pattern, type, weight } of priorityPatterns) {
      if (pattern.test(lowerMessage)) {
        const currentScore = scores.get(type) || 0;
        scores.set(type, currentScore + weight);
      }
    }

    // Find highest scoring type
    let maxScore = 0;
    let detectedType: CommitType | undefined;

    for (const [type, score] of scores) {
      if (score > maxScore) {
        maxScore = score;
        detectedType = type;
      }
    }

    return detectedType;
  }

  /**
   * Check if message has conventional commit prefix
   */
  private hasConventionalPrefix(message: string): boolean {
    return /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\(.+\))?:/.test(message.toLowerCase());
  }

  /**
   * Lowercase first letter of a string
   */
  private lowercaseFirstLetter(str: string): string {
    // Don't lowercase if it's an acronym or proper noun
    if (/^[A-Z]{2,}/.test(str)) {
      return str;
    }
    return str.charAt(0).toLowerCase() + str.slice(1);
  }

  /**
   * Extract ticket reference from branch name
   */
  private extractTicket(branchName: string): string | undefined {
    for (const { pattern, format } of TICKET_PATTERNS) {
      const match = pattern.exec(branchName);
      if (match) {
        return format(match);
      }
    }
    return undefined;
  }

  /**
   * Add ticket reference to message
   */
  private addTicketReference(message: string, ticket: string): string {
    const parts = message.split('\n\n');
    const subject = parts[0];
    const rest = parts.slice(1).join('\n\n');

    // Add refs line
    if (rest) {
      return `${subject}\n\nRefs: ${ticket}\n\n${rest}`;
    }
    return `${subject}\n\nRefs: ${ticket}`;
  }

  /**
   * Validate conventional commit format
   */
  private validateConventional(message: string): CommitValidationIssue[] {
    const issues: CommitValidationIssue[] = [];
    const lines = message.split('\n');
    const subject = lines[0] || '';

    // Check for conventional prefix
    if (!this.hasConventionalPrefix(subject)) {
      issues.push({
        type: 'format',
        severity: 'warning',
        description: 'Missing conventional commit prefix',
        suggestedFix: 'Add a prefix like feat:, fix:, docs:, etc.',
      });
    }

    // Check subject line starts with lowercase (after prefix)
    const afterPrefix = subject.replace(/^[a-z]+(\(.+\))?: /, '');
    if (afterPrefix && /^[A-Z]/.test(afterPrefix) && !/^[A-Z]{2,}/.test(afterPrefix)) {
      issues.push({
        type: 'format',
        severity: 'info',
        description: 'Subject should start with lowercase (conventional style)',
        suggestedFix: 'Use lowercase for the first word after the prefix',
      });
    }

    // Check for period at end of subject
    if (subject.endsWith('.')) {
      issues.push({
        type: 'format',
        severity: 'info',
        description: 'Subject line should not end with a period',
        suggestedFix: 'Remove the trailing period',
      });
    }

    // Check body line lengths
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.length > this.config.maxBodyLength && !line.startsWith('Co-Authored-By:')) {
        issues.push({
          type: 'body',
          severity: 'info',
          description: `Line ${i + 1} exceeds ${this.config.maxBodyLength} characters`,
          suggestedFix: 'Wrap long lines in the commit body',
        });
        break; // Only report first occurrence
      }
    }

    // Check for breaking change indicator
    if (subject.includes('!:') || message.includes('BREAKING CHANGE:')) {
      issues.push({
        type: 'breaking',
        severity: 'info',
        description: 'Breaking change detected - ensure changelog is updated',
      });
    }

    return issues;
  }

  /**
   * Process commit message manually
   */
  async process(message: string, branchName?: string): Promise<GitCommitResult> {
    return this.processCommitMessage(message, branchName);
  }

  /**
   * Format a commit message with heredoc-style for git
   */
  formatForGit(message: string): string {
    // Escape for heredoc usage
    return `$(cat <<'EOF'
${message}
EOF
)`;
  }

  /**
   * Generate a commit command with formatted message
   */
  generateCommitCommand(message: string): string {
    return `git commit -m "${this.formatForGit(message)}"`;
  }

  /**
   * Get commit type description
   */
  getCommitTypeDescription(type: CommitType): string {
    const pattern = COMMIT_TYPE_PATTERNS.find(p => p.type === type);
    return pattern?.description || 'Unknown commit type';
  }

  /**
   * Get all available commit types
   */
  getAllCommitTypes(): Array<{ type: CommitType; description: string }> {
    return COMMIT_TYPE_PATTERNS.map(p => ({
      type: p.type,
      description: p.description,
    }));
  }

  /**
   * Update configuration
   */
  setConfig(config: Partial<CommitConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): CommitConfig {
    return { ...this.config };
  }
}

/**
 * Create git commit hook
 */
export function createGitCommitHook(
  registry: HookRegistry,
  config?: Partial<CommitConfig>
): GitCommitHook {
  return new GitCommitHook(registry, config);
}
