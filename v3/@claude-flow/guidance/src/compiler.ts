/**
 * Guidance Compiler
 *
 * Parses root CLAUDE.md and optional CLAUDE.local.md into a compiled policy bundle:
 * 1. A small always-loaded constitution (first 30-60 lines of invariants)
 * 2. A set of task-scoped rule shards tagged by intent, risk, domain, repo path, tool class
 * 3. A machine-readable manifest with rule IDs, triggers, and verifiers
 *
 * @module @claude-flow/guidance/compiler
 */

import { createHash } from 'node:crypto';
import type {
  GuidanceRule,
  RuleShard,
  Constitution,
  RuleManifest,
  PolicyBundle,
  RiskClass,
  ToolClass,
  TaskIntent,
} from './types.js';

// ============================================================================
// Parser Patterns
// ============================================================================

/** Matches a rule declaration: "R001:" or "RULE-001:" or "[R001]" or "- [R001]" */
const RULE_ID_PATTERN = /^(?:#{1,4}\s+)?(?:[-*]\s+)?\[?([A-Z]+-?\d{3,4})\]?[:\s]/;

/** Matches risk class annotations: "(critical)", "[high-risk]", etc. */
const RISK_PATTERN = /\(?(critical|high|medium|low|info)(?:-risk)?\)?/i;

/** Matches domain tags: @security, @testing, etc. */
const DOMAIN_TAG_PATTERN = /@(security|testing|performance|architecture|debugging|deployment|general)/gi;

/** Matches tool class tags: [edit], [bash], etc. */
const TOOL_TAG_PATTERN = /\[(edit|bash|read|write|mcp|task|all)\]/gi;

/** Matches intent tags: #bug-fix, #feature, etc. */
const INTENT_TAG_PATTERN = /#(bug-fix|feature|refactor|security|performance|testing|docs|deployment|architecture|debug|general)/gi;

/** Matches repo scope: scope:src/**, scope:tests/**, etc. */
const SCOPE_PATTERN = /scope:([\w\/\*\.\-]+)/gi;

/** Matches verifier annotations: verify:tests-pass, verify:lint-clean */
const VERIFIER_PATTERN = /verify:([\w\-]+)/i;

/** Matches priority override: priority:N */
const PRIORITY_PATTERN = /priority:(\d+)/i;

/** Section markers for constitution identification */
const CONSTITUTION_MARKERS = [
  /^#+\s*(safety|security|invariant|constitution|critical|non[- ]?negotiable|always)/i,
  /^#+\s*(must|never|always|required|mandatory)/i,
];

/** Section markers for shard boundaries */
const SHARD_MARKERS = [
  /^#+\s/,         // Any heading
  /^---+\s*$/,     // Horizontal rule
  /^\*\*\*+\s*$/,  // Bold horizontal rule
];

// ============================================================================
// Compiler Configuration
// ============================================================================

export interface CompilerConfig {
  /** Maximum lines for constitution */
  maxConstitutionLines: number;
  /** Default risk class */
  defaultRiskClass: RiskClass;
  /** Default priority */
  defaultPriority: number;
  /** Auto-generate rule IDs for untagged rules */
  autoGenerateIds: boolean;
}

const DEFAULT_CONFIG: CompilerConfig = {
  maxConstitutionLines: 60,
  defaultRiskClass: 'medium',
  defaultPriority: 50,
  autoGenerateIds: true,
};

// ============================================================================
// Guidance Compiler
// ============================================================================

export class GuidanceCompiler {
  private config: CompilerConfig;
  private nextAutoId = 1;

  constructor(config: Partial<CompilerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Compile guidance files into a policy bundle
   */
  compile(rootContent: string, localContent?: string): PolicyBundle {
    // Parse both files into raw rules
    const rootRules = this.parseGuidanceFile(rootContent, 'root');
    const localRules = localContent
      ? this.parseGuidanceFile(localContent, 'local')
      : [];

    // Merge rules (local overrides root for same ID)
    const allRules = this.mergeRules(rootRules, localRules);

    // Split into constitution and shards
    const constitutionRules = allRules.filter(r => r.isConstitution);
    const shardRules = allRules.filter(r => !r.isConstitution);

    // Build constitution
    const constitution = this.buildConstitution(constitutionRules);

    // Build shards
    const shards = this.buildShards(shardRules);

    // Build manifest
    const manifest = this.buildManifest(allRules, rootContent, localContent);

    return { constitution, shards, manifest };
  }

  /**
   * Parse a guidance markdown file into rules
   */
  parseGuidanceFile(content: string, source: 'root' | 'local'): GuidanceRule[] {
    const rules: GuidanceRule[] = [];
    const lines = content.split('\n');

    let currentSection = '';
    let currentBlock: string[] = [];
    let inConstitutionSection = false;
    let blockStartLine = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Detect section boundaries
      if (SHARD_MARKERS.some(m => m.test(line))) {
        // Flush current block
        if (currentBlock.length > 0) {
          const blockRules = this.extractRulesFromBlock(
            currentBlock.join('\n'),
            source,
            inConstitutionSection,
            currentSection
          );
          rules.push(...blockRules);
          currentBlock = [];
        }

        // Check if this is a constitution section
        inConstitutionSection = CONSTITUTION_MARKERS.some(m => m.test(line));
        currentSection = line.replace(/^#+\s*/, '').trim();
        blockStartLine = i;
      }

      currentBlock.push(line);
    }

    // Flush last block
    if (currentBlock.length > 0) {
      const blockRules = this.extractRulesFromBlock(
        currentBlock.join('\n'),
        source,
        inConstitutionSection,
        currentSection
      );
      rules.push(...blockRules);
    }

    return rules;
  }

  /**
   * Extract rules from a content block
   */
  private extractRulesFromBlock(
    block: string,
    source: 'root' | 'local',
    isConstitution: boolean,
    section: string
  ): GuidanceRule[] {
    const rules: GuidanceRule[] = [];
    const lines = block.split('\n');

    // Try to extract explicit rules (with IDs)
    let ruleBuffer: string[] = [];
    let currentRuleId: string | null = null;

    for (const line of lines) {
      const idMatch = line.match(RULE_ID_PATTERN);

      if (idMatch) {
        // Flush previous rule
        if (currentRuleId && ruleBuffer.length > 0) {
          rules.push(this.parseRule(currentRuleId, ruleBuffer.join('\n'), source, isConstitution));
          ruleBuffer = [];
        }
        currentRuleId = idMatch[1];
        ruleBuffer.push(line.replace(RULE_ID_PATTERN, '').trim());
      } else if (currentRuleId) {
        ruleBuffer.push(line);
      }
    }

    // Flush last rule
    if (currentRuleId && ruleBuffer.length > 0) {
      rules.push(this.parseRule(currentRuleId, ruleBuffer.join('\n'), source, isConstitution));
    }

    // If no explicit rules found, try to extract implicit rules from bullet points
    if (rules.length === 0) {
      const implicitRules = this.extractImplicitRules(block, source, isConstitution, section);
      rules.push(...implicitRules);
    }

    return rules;
  }

  /**
   * Extract implicit rules from bullet points and paragraphs
   */
  private extractImplicitRules(
    block: string,
    source: 'root' | 'local',
    isConstitution: boolean,
    section: string
  ): GuidanceRule[] {
    const rules: GuidanceRule[] = [];
    const lines = block.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip empty lines, headings, and non-actionable content
      if (!trimmed || /^#+\s/.test(trimmed) || /^---/.test(trimmed)) continue;

      // Match actionable bullet points
      const bulletMatch = trimmed.match(/^[-*]\s+(.+)/);
      if (!bulletMatch) continue;

      const text = bulletMatch[1].trim();

      // Only create rules for actionable statements
      if (!this.isActionableRule(text)) continue;

      // Auto-generate ID if enabled
      if (this.config.autoGenerateIds) {
        const id = `AUTO-${String(this.nextAutoId++).padStart(3, '0')}`;
        rules.push(this.parseRule(id, text, source, isConstitution));
      }
    }

    return rules;
  }

  /**
   * Check if text represents an actionable rule
   */
  private isActionableRule(text: string): boolean {
    const actionPatterns = [
      /\b(must|never|always|should|require|forbid|ensure|validate|check|verify)\b/i,
      /\b(do not|don't|cannot|can't|avoid|prevent|block|deny|reject)\b/i,
      /\b(use|prefer|apply|follow|implement|enforce|maintain|keep|run|include|write|mock|respect)\b/i,
    ];

    return actionPatterns.some(p => p.test(text));
  }

  /**
   * Parse a single rule from its text content
   */
  private parseRule(
    id: string,
    text: string,
    source: 'root' | 'local',
    isConstitution: boolean
  ): GuidanceRule {
    const now = Date.now();

    // Extract risk class
    const riskMatch = text.match(RISK_PATTERN);
    const riskClass = (riskMatch?.[1]?.toLowerCase() as RiskClass) ?? this.config.defaultRiskClass;

    // Phase 1 perf — replace 4 `new RegExp(PATTERN.source, 'gi')` calls per
    // parseRule with `text.matchAll(PATTERN)` against the existing
    // module-level global regex. On a 500-rule file that previously meant
    // 2,000 RegExp constructions per compile; matchAll is allocation-free
    // per call and the module-level pattern is constructed exactly once.
    const toolClasses: ToolClass[] = [];
    for (const m of text.matchAll(TOOL_TAG_PATTERN)) {
      toolClasses.push(m[1].toLowerCase() as ToolClass);
    }
    if (toolClasses.length === 0) toolClasses.push('all');

    const intents: TaskIntent[] = [];
    for (const m of text.matchAll(INTENT_TAG_PATTERN)) {
      intents.push(m[1].toLowerCase() as TaskIntent);
    }
    if (intents.length === 0) intents.push(...this.inferIntents(text));

    const domains: string[] = [];
    for (const m of text.matchAll(DOMAIN_TAG_PATTERN)) {
      domains.push(m[1].toLowerCase());
    }
    if (domains.length === 0) domains.push(...this.inferDomains(text));

    const repoScopes: string[] = [];
    for (const m of text.matchAll(SCOPE_PATTERN)) {
      repoScopes.push(m[1]);
    }
    if (repoScopes.length === 0) repoScopes.push('**/*');

    // Extract verifier
    const verifierMatch = text.match(VERIFIER_PATTERN);
    const verifier = verifierMatch?.[1];

    // Extract priority
    const priorityMatch = text.match(PRIORITY_PATTERN);
    const priority = priorityMatch ? parseInt(priorityMatch[1], 10) : this.config.defaultPriority;

    // Clean rule text (remove annotations)
    const cleanText = text
      .replace(RISK_PATTERN, '')
      .replace(TOOL_TAG_PATTERN, '')
      .replace(INTENT_TAG_PATTERN, '')
      .replace(DOMAIN_TAG_PATTERN, '')
      .replace(SCOPE_PATTERN, '')
      .replace(VERIFIER_PATTERN, '')
      .replace(PRIORITY_PATTERN, '')
      .replace(/\s+/g, ' ')
      .trim();

    return {
      id,
      text: cleanText,
      riskClass,
      toolClasses,
      intents,
      repoScopes,
      domains,
      priority: isConstitution ? priority + 100 : priority,
      source,
      isConstitution,
      verifier,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Infer intents from rule text
   */
  private inferIntents(text: string): TaskIntent[] {
    const intents: TaskIntent[] = [];
    const lower = text.toLowerCase();

    if (/secur|auth|secret|password|token|cve|vuln|encrypt/i.test(lower)) intents.push('security');
    if (/test|spec|mock|coverage|assert|tdd/i.test(lower)) intents.push('testing');
    if (/perf|optim|fast|slow|cache|memory|speed/i.test(lower)) intents.push('performance');
    if (/refactor|clean|restructur|simplif/i.test(lower)) intents.push('refactor');
    if (/bug|fix|error|broken|fail|debug/i.test(lower)) intents.push('bug-fix');
    if (/architect|design|pattern|structure|boundary/i.test(lower)) intents.push('architecture');
    if (/deploy|release|publish|ci|cd/i.test(lower)) intents.push('deployment');
    if (/doc|readme|comment|jsdoc/i.test(lower)) intents.push('docs');

    return intents.length > 0 ? intents : ['general'];
  }

  /**
   * Infer domains from rule text
   */
  private inferDomains(text: string): string[] {
    const domains: string[] = [];
    const lower = text.toLowerCase();

    if (/secur|auth|secret|password|token|cve|vuln/i.test(lower)) domains.push('security');
    if (/test|spec|mock|coverage|assert/i.test(lower)) domains.push('testing');
    if (/perf|optim|fast|slow|cache|speed/i.test(lower)) domains.push('performance');
    if (/architect|design|ddd|domain|boundary/i.test(lower)) domains.push('architecture');
    if (/bug|fix|error|debug/i.test(lower)) domains.push('debugging');

    return domains.length > 0 ? domains : ['general'];
  }

  /**
   * Merge root and local rules, local overrides root for same ID
   */
  private mergeRules(rootRules: GuidanceRule[], localRules: GuidanceRule[]): GuidanceRule[] {
    const ruleMap = new Map<string, GuidanceRule>();

    for (const rule of rootRules) {
      ruleMap.set(rule.id, rule);
    }

    for (const rule of localRules) {
      if (ruleMap.has(rule.id)) {
        // Local overrides root, but mark as updated
        const existing = ruleMap.get(rule.id)!;
        ruleMap.set(rule.id, {
          ...rule,
          priority: Math.max(rule.priority, existing.priority),
          updatedAt: Date.now(),
        });
      } else {
        ruleMap.set(rule.id, rule);
      }
    }

    return Array.from(ruleMap.values()).sort((a, b) => b.priority - a.priority);
  }

  /**
   * Build the constitution from constitution-class rules
   */
  private buildConstitution(rules: GuidanceRule[]): Constitution {
    // Sort by priority descending
    const sorted = [...rules].sort((a, b) => b.priority - a.priority);

    // Build compact text
    const lines: string[] = [
      '# Constitution - Always Active Rules',
      '',
    ];

    let currentDomain = '';
    for (const rule of sorted) {
      const domain = rule.domains[0] || 'general';
      if (domain !== currentDomain) {
        currentDomain = domain;
        lines.push(`## ${domain.charAt(0).toUpperCase() + domain.slice(1)}`);
      }
      lines.push(`- [${rule.id}] ${rule.text}`);
    }

    // Trim to max lines
    const text = lines.slice(0, this.config.maxConstitutionLines).join('\n');

    return {
      rules: sorted,
      text,
      hash: this.hashContent(text),
    };
  }

  /**
   * Build shards from non-constitution rules
   */
  private buildShards(rules: GuidanceRule[]): RuleShard[] {
    return rules.map(rule => ({
      rule,
      compactText: this.buildCompactShardText(rule),
    }));
  }

  /**
   * Build compact text for a shard
   */
  private buildCompactShardText(rule: GuidanceRule): string {
    const tags = [
      rule.riskClass,
      ...rule.domains,
      ...rule.intents,
      ...rule.toolClasses.filter(t => t !== 'all'),
    ].map(t => `@${t}`).join(' ');

    return `[${rule.id}] ${rule.text} ${tags}`.trim();
  }

  /**
   * Build the manifest
   */
  private buildManifest(
    allRules: GuidanceRule[],
    rootContent: string,
    localContent?: string
  ): RuleManifest {
    const sourceHashes: Record<string, string> = {
      root: this.hashContent(rootContent),
    };
    if (localContent) {
      sourceHashes.local = this.hashContent(localContent);
    }

    return {
      rules: allRules.map(r => ({
        id: r.id,
        triggers: [...r.intents, ...r.domains, ...r.toolClasses],
        verifier: r.verifier ?? null,
        riskClass: r.riskClass,
        priority: r.priority,
        source: r.source,
      })),
      compiledAt: Date.now(),
      sourceHashes,
      totalRules: allRules.length,
      constitutionRules: allRules.filter(r => r.isConstitution).length,
      shardRules: allRules.filter(r => !r.isConstitution).length,
    };
  }

  /**
   * Hash content for change detection
   */
  private hashContent(content: string): string {
    return createHash('sha256').update(content).digest('hex').slice(0, 16);
  }
}

/**
 * Create a compiler instance
 */
export function createCompiler(config?: Partial<CompilerConfig>): GuidanceCompiler {
  return new GuidanceCompiler(config);
}
