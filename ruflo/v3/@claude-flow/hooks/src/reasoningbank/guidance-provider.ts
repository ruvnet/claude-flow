/**
 * V3 Guidance Provider
 *
 * Generates Claude-visible guidance output from ReasoningBank patterns.
 * Outputs plain text (exit 0) or JSON with additionalContext.
 *
 * @module @claude-flow/hooks/reasoningbank/guidance-provider
 */

import { ReasoningBank, GuidanceResult, RoutingResult } from './index.js';
import type { HookContext, HookEvent, PreEditResult, RouteTaskResult } from '../types.js';

/**
 * Official Claude hook output format
 */
export interface ClaudeHookOutput {
  decision?: 'approve' | 'block' | 'allow' | 'deny';
  reason?: string;
  hookSpecificOutput?: {
    hookEventName: string;
    additionalContext?: string;
    permissionDecision?: 'allow' | 'deny' | 'ask';
    permissionDecisionReason?: string;
    updatedInput?: Record<string, unknown>;
  };
}

/**
 * Security patterns to block
 */
const BLOCKED_PATTERNS = ['.env', '.pem', '.key', 'credentials', 'secret', 'password'];
const WARNED_PATTERNS = ['prod', 'production', 'live', 'deploy'];

/**
 * Dangerous commands to block
 */
const DANGEROUS_COMMANDS = [
  'rm -rf',
  'drop database',
  'truncate',
  'push.*--force|--force.*push',
  'reset --hard',
  'format c:',
];

/**
 * Risky commands to warn about
 */
const RISKY_COMMANDS = ['npm publish', 'git push', 'deploy', 'kubectl apply'];

/**
 * Guidance Provider class
 *
 * Converts ReasoningBank patterns into Claude-visible guidance.
 */
export class GuidanceProvider {
  private reasoningBank: ReasoningBank;

  constructor(reasoningBank?: ReasoningBank) {
    this.reasoningBank = reasoningBank || new ReasoningBank();
  }

  /**
   * Initialize the provider
   */
  async initialize(): Promise<void> {
    await this.reasoningBank.initialize();
  }

  /**
   * Generate session start context
   * Returns plain text that Claude will see
   */
  async generateSessionContext(): Promise<string> {
    const stats = this.reasoningBank.getStats();

    const lines = [
      '## V3 Development Context',
      '',
      '**Architecture**: Domain-Driven Design with 15 @claude-flow modules',
      '**Priority**: Security-first (CVE-1, CVE-2, CVE-3 remediation)',
      '',
      '**Performance Targets**:',
      '- HNSW search: 150x-12,500x faster (<1ms)',
      '- Flash Attention: 2.49x-7.47x speedup',
      '- Memory: 50-75% reduction',
      '',
      '**Active Patterns**:',
      '- Use TDD London School (mock-first)',
      '- Event sourcing for state changes',
      '- agentic-flow@alpha as core foundation',
      '- Bounded contexts with clear interfaces',
      '',
      '**Code Quality Rules**:',
      '- Files under 500 lines',
      '- No hardcoded secrets',
      '- Input validation at boundaries',
      '- Typed interfaces for all public APIs',
      '',
      `**Learned Patterns**: ${stats.shortTermCount + stats.longTermCount} available`,
      `**Avg Search Time**: ${stats.avgSearchTime.toFixed(2)}ms`,
    ];

    return lines.join('\n');
  }

  /**
   * Generate user prompt context
   * Returns plain text guidance based on prompt analysis
   */
  async generatePromptContext(prompt: string): Promise<string> {
    const guidance = await this.reasoningBank.generateGuidance({
      event: 'pre-route' as any,
      timestamp: new Date(),
      routing: { task: prompt },
    });

    const lines: string[] = [];

    // Add domain-specific guidance
    if (guidance.recommendations.length > 0) {
      const domains = this.detectDomains(prompt);
      for (const domain of domains) {
        lines.push(`**${this.capitalize(domain)} Guidance**:`);
        for (const rec of guidance.recommendations.slice(0, 5)) {
          lines.push(`- ${rec}`);
        }
        lines.push('');
      }
    }

    // Add relevant patterns
    if (guidance.patterns.length > 0) {
      lines.push('**Relevant Learned Patterns**:');
      for (const { pattern, similarity } of guidance.patterns.slice(0, 3)) {
        lines.push(`- ${pattern.strategy} (${(similarity * 100).toFixed(0)}% match)`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Generate pre-edit guidance
   * Returns JSON for Claude hook system
   */
  async generatePreEditGuidance(filePath: string): Promise<ClaudeHookOutput> {
    // Security checks - block sensitive files
    for (const pattern of BLOCKED_PATTERNS) {
      if (filePath.toLowerCase().includes(pattern)) {
        return {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: `Security: Cannot edit ${pattern} files directly. Use environment variables instead.`,
          },
        };
      }
    }

    // Warn about production files
    for (const pattern of WARNED_PATTERNS) {
      if (filePath.toLowerCase().includes(pattern)) {
        return {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'ask',
            permissionDecisionReason: `This appears to be a ${pattern} file. Confirm this edit is intentional.`,
          },
        };
      }
    }

    // Generate file-specific guidance from patterns
    const guidance = await this.reasoningBank.generateGuidance({
      event: 'pre-edit' as any,
      timestamp: new Date(),
      file: { path: filePath, operation: 'modify' },
    });

    let contextGuidance = '';

    // File type specific guidance
    if (/test|spec/i.test(filePath)) {
      contextGuidance = 'Testing file: Use TDD London School patterns. Mock dependencies, test behavior not implementation.';
    } else if (/security|auth/i.test(filePath)) {
      contextGuidance = 'Security module: Validate inputs, use parameterized queries, no hardcoded secrets.';
    } else if (/memory|cache/i.test(filePath)) {
      contextGuidance = 'Memory module: Consider HNSW indexing, batch operations, proper cleanup.';
    } else if (/swarm|coordinator/i.test(filePath)) {
      contextGuidance = 'Swarm module: Use event-driven communication, handle failures gracefully.';
    } else if (/\.ts$/.test(filePath)) {
      contextGuidance = 'TypeScript: Use strict types, avoid any, export interfaces for public APIs.';
    }

    // Add pattern-based guidance
    if (guidance.patterns.length > 0) {
      const patternHints = guidance.patterns
        .slice(0, 2)
        .map(p => p.pattern.strategy)
        .join('; ');
      contextGuidance += ` Similar patterns: ${patternHints}`;
    }

    if (contextGuidance) {
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          additionalContext: contextGuidance,
        },
      };
    }

    return { decision: 'allow' };
  }

  /**
   * Generate post-edit feedback
   * Returns JSON with quality feedback
   */
  async generatePostEditFeedback(
    filePath: string,
    fileContent?: string
  ): Promise<ClaudeHookOutput> {
    const issues: string[] = [];

    if (fileContent) {
      // Check for console.log in non-test files
      if (!/test|spec/i.test(filePath) && fileContent.includes('console.log')) {
        issues.push('Remove console.log statements (use proper logging)');
      }

      // Check for TODO/FIXME
      if (/TODO|FIXME|HACK/i.test(fileContent)) {
        issues.push('Address TODO/FIXME comments before committing');
      }

      // Check for any type in TypeScript
      if (/\.ts$/.test(filePath) && /:\s*any\b/.test(fileContent)) {
        issues.push("Replace 'any' types with specific types");
      }

      // Check file size
      const lines = fileContent.split('\n').length;
      if (lines > 500) {
        issues.push(`File exceeds 500 lines (${lines}). Consider splitting.`);
      }

      // Check for hardcoded secrets
      if (/password\s*=\s*['"][^'"]+['"]|api[_-]?key\s*=\s*['"][^'"]+['"]/i.test(fileContent)) {
        issues.push('Possible hardcoded secret detected. Use environment variables.');
      }
    }

    // Store the edit as a pattern
    await this.reasoningBank.storePattern(`Edit: ${filePath}`, 'code', {
      operation: 'modify',
      issues: issues.length,
    });

    if (issues.length > 0) {
      return {
        decision: 'allow',
        reason: `Edit completed. Review suggestions:\n- ${issues.join('\n- ')}`,
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          additionalContext: `Quality check found items to address:\n- ${issues.join('\n- ')}`,
        },
      };
    }

    return { decision: 'allow' };
  }

  /**
   * Generate pre-command guidance
   * Returns JSON with risk assessment
   */
  async generatePreCommandGuidance(command: string): Promise<ClaudeHookOutput> {
    // Block dangerous commands
    for (const pattern of DANGEROUS_COMMANDS) {
      if (new RegExp(pattern, 'i').test(command)) {
        return {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: `Destructive command blocked: ${pattern}. Use safer alternatives.`,
          },
        };
      }
    }

    // Warn about risky commands
    for (const pattern of RISKY_COMMANDS) {
      if (command.toLowerCase().includes(pattern)) {
        return {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'ask',
            permissionDecisionReason: `This command has external effects (${pattern}). Confirm before proceeding.`,
          },
        };
      }
    }

    // Guide test commands
    if (/npm test|vitest|jest|pnpm test/i.test(command)) {
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          additionalContext: 'Running tests. If failures occur, fix them before proceeding.',
        },
      };
    }

    // Guide build commands
    if (/npm run build|tsc|pnpm build/i.test(command)) {
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          additionalContext: 'Building project. Watch for type errors. All must pass before commit.',
        },
      };
    }

    return { decision: 'allow' };
  }

  /**
   * Generate task routing guidance
   * Returns plain text with agent recommendation
   */
  async generateRoutingGuidance(task: string): Promise<string> {
    const routing = await this.reasoningBank.routeTask(task);

    const lines = [
      `**Recommended Agent**: ${routing.agent}`,
      `**Confidence**: ${routing.confidence}%`,
      `**Reasoning**: ${routing.reasoning}`,
      '',
    ];

    if (routing.alternatives.length > 0) {
      lines.push('**Alternatives**:');
      for (const alt of routing.alternatives) {
        lines.push(`- ${alt.agent} (${alt.confidence}%)`);
      }
      lines.push('');
    }

    if (routing.historicalPerformance) {
      lines.push('**Historical Performance**:');
      lines.push(`- Success rate: ${(routing.historicalPerformance.successRate * 100).toFixed(0)}%`);
      lines.push(`- Avg quality: ${(routing.historicalPerformance.avgQuality * 100).toFixed(0)}%`);
      lines.push(`- Similar tasks: ${routing.historicalPerformance.taskCount}`);
    }

    lines.push('');
    lines.push(`Use Task tool with subagent_type="${routing.agent}" for optimal results.`);

    return lines.join('\n');
  }

  /**
   * Generate stop check
   * Returns exit code 2 + stderr if work incomplete
   */
  async generateStopCheck(): Promise<{ shouldStop: boolean; reason?: string }> {
    const stats = this.reasoningBank.getStats();

    // Check if there are uncommitted patterns
    if (stats.shortTermCount > 10) {
      return {
        shouldStop: false,
        reason: `${stats.shortTermCount} patterns not yet consolidated. Run consolidation before stopping.`,
      };
    }

    return { shouldStop: true };
  }

  // ===== Helper Methods =====

  private detectDomains(text: string): string[] {
    const domains: string[] = [];
    const lowerText = text.toLowerCase();

    if (/security|auth|password|token|secret|cve|vuln/i.test(lowerText)) {
      domains.push('security');
    }
    if (/test|spec|mock|coverage|tdd|assert/i.test(lowerText)) {
      domains.push('testing');
    }
    if (/perf|optim|fast|slow|memory|cache|speed/i.test(lowerText)) {
      domains.push('performance');
    }
    if (/architect|design|ddd|domain|refactor|struct/i.test(lowerText)) {
      domains.push('architecture');
    }
    if (/fix|bug|error|issue|broken|fail|debug/i.test(lowerText)) {
      domains.push('debugging');
    }

    return domains;
  }

  private capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
}

// Export singleton
export const guidanceProvider = new GuidanceProvider();
