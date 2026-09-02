/**
 * V3 Bash Safety Hook
 *
 * TypeScript conversion of V2 bash-hook.sh.
 * Provides command safety analysis, dangerous command detection,
 * secret detection, and safe alternatives.
 *
 * @module v3/shared/hooks/safety/bash-safety
 */

import {
  HookEvent,
  HookContext,
  HookResult,
  HookPriority,
  CommandInfo,
} from '../types.js';
import { HookRegistry } from '../registry.js';

/**
 * Bash safety hook result
 */
export interface BashSafetyResult extends HookResult {
  /** Risk level assessment */
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  /** Whether the command should be blocked */
  blocked: boolean;
  /** Reason for blocking (if blocked) */
  blockReason?: string;
  /** Modified command (if applicable) */
  modifiedCommand?: string;
  /** Detected risks */
  risks: CommandRisk[];
  /** Safe alternatives */
  safeAlternatives?: string[];
  /** Warnings (non-blocking) */
  warnings?: string[];
  /** Missing dependencies detected */
  missingDependencies?: string[];
  /** Redacted command (secrets removed) */
  redactedCommand?: string;
}

/**
 * Command risk definition
 */
export interface CommandRisk {
  /** Risk type */
  type: 'dangerous' | 'destructive' | 'secret' | 'privilege' | 'network' | 'resource';
  /** Risk severity */
  severity: 'low' | 'medium' | 'high' | 'critical';
  /** Risk description */
  description: string;
  /** Pattern that matched */
  pattern?: string;
}

/**
 * Dangerous command patterns
 */
const DANGEROUS_PATTERNS: Array<{
  pattern: RegExp;
  type: CommandRisk['type'];
  severity: CommandRisk['severity'];
  description: string;
  block: boolean;
}> = [
  // Critical - Always block
  {
    pattern: /rm\s+(-[rRf]+\s+)*\//,
    type: 'destructive',
    severity: 'critical',
    description: 'Recursive deletion from root directory',
    block: true,
  },
  {
    pattern: /rm\s+-rf\s+\/\*/,
    type: 'destructive',
    severity: 'critical',
    description: 'Recursive deletion of all root files',
    block: true,
  },
  {
    pattern: /dd\s+if=.*of=\/dev\/(sd|hd|nvme)/,
    type: 'destructive',
    severity: 'critical',
    description: 'Direct disk write that can destroy data',
    block: true,
  },
  {
    pattern: /mkfs\./,
    type: 'destructive',
    severity: 'critical',
    description: 'Filesystem formatting command',
    block: true,
  },
  {
    pattern: />\s*\/dev\/sd[a-z]/,
    type: 'destructive',
    severity: 'critical',
    description: 'Direct write to disk device',
    block: true,
  },
  {
    // Fork bomb patterns - various formats (with flexible spacing)
    pattern: /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:|bomb\s*\(\)|while\s+true.*fork/,
    type: 'resource',
    severity: 'critical',
    description: 'Fork bomb detected',
    block: true,
  },
  {
    pattern: /chmod\s+(-R\s+)?777\s+\//,
    type: 'privilege',
    severity: 'critical',
    description: 'Setting dangerous permissions on root',
    block: true,
  },

  // High - Block but offer alternatives
  {
    pattern: /rm\s+-rf\s+\*/,
    type: 'destructive',
    severity: 'high',
    description: 'Recursive deletion of all files in directory',
    block: true,
  },
  {
    pattern: /rm\s+-rf\s+\.\//,
    type: 'destructive',
    severity: 'high',
    description: 'Recursive deletion of current directory',
    block: true,
  },
  {
    pattern: /rm\s+-rf\s+~/,
    type: 'destructive',
    severity: 'high',
    description: 'Recursive deletion of home directory',
    block: true,
  },
  {
    pattern: /curl.*\|\s*(bash|sh|zsh)/,
    type: 'dangerous',
    severity: 'high',
    description: 'Piping remote content directly to shell',
    block: true,
  },
  {
    pattern: /wget.*-O-\s*\|\s*(bash|sh|zsh)/,
    type: 'dangerous',
    severity: 'high',
    description: 'Piping remote content directly to shell',
    block: true,
  },
  {
    pattern: /eval\s+.*\$\(/,
    type: 'dangerous',
    severity: 'high',
    description: 'Dynamic code execution with command substitution',
    block: true,
  },

  // Medium - Warn
  {
    pattern: /rm\s+(?!.*-i)/,
    type: 'destructive',
    severity: 'medium',
    description: 'Remove command without interactive flag',
    block: false,
  },
  {
    pattern: /sudo\s+rm/,
    type: 'privilege',
    severity: 'medium',
    description: 'Privileged file deletion',
    block: false,
  },
  {
    pattern: /sudo\s+chmod/,
    type: 'privilege',
    severity: 'medium',
    description: 'Privileged permission change',
    block: false,
  },
  {
    pattern: /git\s+push\s+.*--force/,
    type: 'destructive',
    severity: 'medium',
    description: 'Force push can overwrite remote history',
    block: false,
  },
  {
    pattern: /git\s+reset\s+--hard/,
    type: 'destructive',
    severity: 'medium',
    description: 'Hard reset discards uncommitted changes',
    block: false,
  },
  {
    pattern: /DROP\s+(DATABASE|TABLE)/i,
    type: 'destructive',
    severity: 'high',
    description: 'Database/table deletion command',
    block: false,
  },
  {
    pattern: /TRUNCATE\s+TABLE/i,
    type: 'destructive',
    severity: 'medium',
    description: 'Table truncation command',
    block: false,
  },

  // Low - Informational
  {
    pattern: /kill\s+-9/,
    type: 'dangerous',
    severity: 'low',
    description: 'Force kill signal prevents graceful shutdown',
    block: false,
  },
  {
    pattern: /killall/,
    type: 'dangerous',
    severity: 'low',
    description: 'Kills all processes by name',
    block: false,
  },
];

/**
 * Secret patterns to detect and redact
 */
const SECRET_PATTERNS: Array<{
  pattern: RegExp;
  name: string;
  redactGroup?: number;
}> = [
  { pattern: /(password|passwd|pwd)\s*[=:]\s*['"]?([^\s'"]+)/i, name: 'password', redactGroup: 2 },
  { pattern: /(api[_-]?key)\s*[=:]\s*['"]?([^\s'"]+)/i, name: 'API key', redactGroup: 2 },
  { pattern: /(secret[_-]?key)\s*[=:]\s*['"]?([^\s'"]+)/i, name: 'secret key', redactGroup: 2 },
  { pattern: /(access[_-]?token)\s*[=:]\s*['"]?([^\s'"]+)/i, name: 'access token', redactGroup: 2 },
  { pattern: /(auth[_-]?token)\s*[=:]\s*['"]?([^\s'"]+)/i, name: 'auth token', redactGroup: 2 },
  { pattern: /(bearer)\s+([a-zA-Z0-9._-]+)/i, name: 'bearer token', redactGroup: 2 },
  { pattern: /(private[_-]?key)\s*[=:]\s*['"]?([^\s'"]+)/i, name: 'private key', redactGroup: 2 },
  { pattern: /(\bsk-[a-zA-Z0-9]{20,})/i, name: 'OpenAI API key' },
  { pattern: /(\bghp_[a-zA-Z0-9]{36,})/i, name: 'GitHub token' },
  { pattern: /(\bnpm_[a-zA-Z0-9]{36,})/i, name: 'npm token' },
  { pattern: /(AKIA[0-9A-Z]{16})/i, name: 'AWS access key' },
];

/**
 * Common dependencies to check
 */
const DEPENDENCY_CHECKS: Array<{
  command: RegExp;
  dependency: string;
}> = [
  { command: /\bjq\b/, dependency: 'jq' },
  { command: /\byq\b/, dependency: 'yq' },
  { command: /\bawk\b/, dependency: 'awk' },
  { command: /\bsed\b/, dependency: 'sed' },
  { command: /\bcurl\b/, dependency: 'curl' },
  { command: /\bwget\b/, dependency: 'wget' },
  { command: /\bgit\b/, dependency: 'git' },
  { command: /\bdocker\b/, dependency: 'docker' },
  { command: /\bkubectl\b/, dependency: 'kubectl' },
  { command: /\bpython3?\b/, dependency: 'python' },
  { command: /\bnode\b/, dependency: 'node' },
  { command: /\bnpm\b/, dependency: 'npm' },
  { command: /\byarn\b/, dependency: 'yarn' },
  { command: /\bpnpm\b/, dependency: 'pnpm' },
];

/**
 * Safe alternatives for dangerous commands (with patterns for matching)
 */
const SAFE_ALTERNATIVES: Array<{
  pattern: RegExp;
  alternatives: string[];
}> = [
  {
    pattern: /rm\s+-rf\s+\*/,
    alternatives: [
      'rm -ri * (interactive mode)',
      'find . -maxdepth 1 -type f -delete (only files)',
      'git clean -fd (for git repositories)',
    ],
  },
  {
    pattern: /rm\s+-rf/,
    alternatives: [
      'rm -ri (interactive mode)',
      'trash-cli (move to trash instead)',
      'mv to backup directory first',
    ],
  },
  {
    pattern: /kill\s+-9/,
    alternatives: [
      'kill (graceful termination first)',
      'kill -15 (SIGTERM)',
      'systemctl stop (for services)',
    ],
  },
  {
    pattern: /curl.*\|\s*(bash|sh|zsh)/,
    alternatives: [
      'Download script first, review, then execute',
      'Use package managers when available',
      'Verify script hash before execution',
    ],
  },
  {
    pattern: /wget.*\|\s*(bash|sh|zsh)/,
    alternatives: [
      'Download script first, review, then execute',
      'Use package managers when available',
      'Verify script hash before execution',
    ],
  },
  {
    pattern: /git\s+push.*--force/,
    alternatives: [
      'git push --force-with-lease (safer)',
      'Create backup branch first',
      'git push --force-if-includes',
    ],
  },
  {
    pattern: /git\s+reset\s+--hard/,
    alternatives: [
      'git stash (save changes first)',
      'git reset --soft (keep changes staged)',
      'Create backup branch first',
    ],
  },
];

/**
 * Bash Safety Hook Manager
 */
export class BashSafetyHook {
  private registry: HookRegistry;
  private blockedCommands: Set<string> = new Set();
  private availableDependencies: Set<string> = new Set();

  constructor(registry: HookRegistry) {
    this.registry = registry;
    this.registerHooks();
    this.detectAvailableDependencies();
  }

  /**
   * Register bash safety hooks
   */
  private registerHooks(): void {
    this.registry.register(
      HookEvent.PreCommand,
      this.analyzeCommand.bind(this),
      HookPriority.Critical,
      { name: 'bash-safety:pre-command' }
    );
  }

  /**
   * Detect available dependencies
   */
  private async detectAvailableDependencies(): Promise<void> {
    // In a real implementation, this would check which commands are available
    // For now, assume common ones are available
    const commonDeps = ['git', 'node', 'npm', 'curl', 'sed', 'awk'];
    commonDeps.forEach(dep => this.availableDependencies.add(dep));
  }

  /**
   * Analyze a command for safety
   */
  async analyzeCommand(context: HookContext): Promise<BashSafetyResult> {
    const commandInfo = context.command;
    if (!commandInfo) {
      return this.createResult('low', false, []);
    }

    const command = commandInfo.command;
    const risks: CommandRisk[] = [];
    const warnings: string[] = [];
    let blocked = false;
    let blockReason: string | undefined;
    let modifiedCommand: string | undefined;
    let safeAlternatives: string[] | undefined;

    // Check for dangerous patterns
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.pattern.test(command)) {
        risks.push({
          type: pattern.type,
          severity: pattern.severity,
          description: pattern.description,
          pattern: pattern.pattern.toString(),
        });

        if (pattern.block) {
          blocked = true;
          blockReason = pattern.description;
        }

        // Find safe alternatives using pattern matching
        for (const { pattern: altPattern, alternatives } of SAFE_ALTERNATIVES) {
          if (altPattern.test(command)) {
            safeAlternatives = alternatives;
            break;
          }
        }
      }
    }

    // Check for secrets
    const { secrets, redactedCommand } = this.detectSecrets(command);
    for (const secret of secrets) {
      risks.push({
        type: 'secret',
        severity: 'high',
        description: `Potential ${secret.name} detected in command`,
      });
      warnings.push(`Detected potential secret: ${secret.name}`);
    }

    // Check for missing dependencies
    const missingDependencies = this.checkDependencies(command);

    // Add -i flag to rm commands if not present
    if (/\brm\s+/.test(command) && !/-i\b/.test(command) && !blocked) {
      modifiedCommand = command.replace(/\brm\s+/, 'rm -i ');
      warnings.push('Added -i flag for interactive confirmation');
    }

    // Calculate overall risk level
    const riskLevel = this.calculateRiskLevel(risks);

    // Determine if we should proceed
    const shouldProceed = !blocked;

    return {
      success: true,
      riskLevel,
      blocked,
      blockReason,
      modifiedCommand,
      risks,
      safeAlternatives,
      warnings: warnings.length > 0 ? warnings : undefined,
      missingDependencies: missingDependencies.length > 0 ? missingDependencies : undefined,
      redactedCommand: secrets.length > 0 ? redactedCommand : undefined,
      abort: blocked,
      data: blocked ? undefined : {
        command: {
          ...commandInfo,
          command: modifiedCommand || command,
          isDestructive: risks.some(r => r.type === 'destructive'),
        },
      },
    };
  }

  /**
   * Detect secrets in command
   */
  private detectSecrets(command: string): {
    secrets: Array<{ name: string; position: number }>;
    redactedCommand: string;
  } {
    const secrets: Array<{ name: string; position: number }> = [];
    let redactedCommand = command;

    for (const { pattern, name, redactGroup } of SECRET_PATTERNS) {
      const match = pattern.exec(command);
      if (match) {
        secrets.push({ name, position: match.index });

        // Redact the secret value
        if (redactGroup && match[redactGroup]) {
          redactedCommand = redactedCommand.replace(
            match[redactGroup],
            '[REDACTED]'
          );
        } else {
          redactedCommand = redactedCommand.replace(
            match[0],
            `[REDACTED_${name.toUpperCase().replace(/\s/g, '_')}]`
          );
        }
      }
    }

    return { secrets, redactedCommand };
  }

  /**
   * Check for missing dependencies
   */
  private checkDependencies(command: string): string[] {
    const missing: string[] = [];

    for (const { command: pattern, dependency } of DEPENDENCY_CHECKS) {
      if (pattern.test(command) && !this.availableDependencies.has(dependency)) {
        missing.push(dependency);
      }
    }

    return missing;
  }

  /**
   * Calculate overall risk level
   */
  private calculateRiskLevel(risks: CommandRisk[]): BashSafetyResult['riskLevel'] {
    if (risks.length === 0) {
      return 'low';
    }

    const severities = risks.map(r => r.severity);

    if (severities.includes('critical')) {
      return 'critical';
    }
    if (severities.includes('high')) {
      return 'high';
    }
    if (severities.includes('medium')) {
      return 'medium';
    }
    return 'low';
  }

  /**
   * Create a result object
   */
  private createResult(
    riskLevel: BashSafetyResult['riskLevel'],
    blocked: boolean,
    risks: CommandRisk[]
  ): BashSafetyResult {
    return {
      success: true,
      riskLevel,
      blocked,
      risks,
    };
  }

  /**
   * Manually analyze a command
   */
  async analyze(command: string): Promise<BashSafetyResult> {
    const context: HookContext = {
      event: HookEvent.PreCommand,
      timestamp: new Date(),
      command: { command },
    };

    return this.analyzeCommand(context);
  }

  /**
   * Add a custom dangerous pattern
   */
  addDangerousPattern(
    pattern: RegExp,
    type: CommandRisk['type'],
    severity: CommandRisk['severity'],
    description: string,
    block = true
  ): void {
    DANGEROUS_PATTERNS.push({ pattern, type, severity, description, block });
  }

  /**
   * Mark a dependency as available
   */
  markDependencyAvailable(dependency: string): void {
    this.availableDependencies.add(dependency);
  }

  /**
   * Check if a command would be blocked
   */
  wouldBlock(command: string): boolean {
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.block && pattern.pattern.test(command)) {
        return true;
      }
    }
    return false;
  }
}

/**
 * Create bash safety hook
 */
export function createBashSafetyHook(registry: HookRegistry): BashSafetyHook {
  return new BashSafetyHook(registry);
}
