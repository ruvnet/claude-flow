/**
 * Enhanced Model Router with Agent Booster AST Integration
 *
 * Implements ADR-026: 3-tier intelligent model routing:
 * - Tier 1: Agent Booster (WASM) - <1ms, $0 for simple transforms
 * - Tier 2: Haiku - ~500ms for low complexity
 * - Tier 3: Sonnet/Opus - 2-5s for high complexity
 *
 * @module enhanced-model-router
 */

import { existsSync, readFileSync } from 'fs';
import { extname } from 'path';
import { ClaudeModel, getModelRouter, ModelRouter, ModelRoutingResult } from './model-router.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Code editing intent types that Agent Booster can handle
 */
export type EditIntentType =
  | 'var-to-const'
  | 'add-types'
  | 'add-error-handling'
  | 'async-await'
  | 'add-logging'
  | 'remove-console';

/**
 * Detected edit intent from task analysis
 */
export interface EditIntent {
  type: EditIntentType;
  confidence: number;
  filePath?: string;
  language?: string;
  description: string;
}

/**
 * Enhanced routing result with Agent Booster support
 */
export interface EnhancedRouteResult {
  tier: 1 | 2 | 3;
  handler: 'agent-booster' | 'haiku' | 'sonnet' | 'opus';
  model?: ClaudeModel;
  confidence: number;
  complexity?: number;
  reasoning: string;
  agentBoosterIntent?: EditIntent;
  canSkipLLM?: boolean;
  estimatedLatencyMs: number;
  estimatedCost: number;
}

/**
 * Enhanced model router configuration
 */
export interface EnhancedModelRouterConfig {
  agentBoosterEnabled: boolean;
  agentBoosterConfidenceThreshold: number;
  enabledIntents: EditIntentType[];
  complexityThresholds: {
    haiku: number;
    sonnet: number;
    opus: number;
  };
  preferCost: boolean;
  preferQuality: boolean;
}

// ============================================================================
// Intent Detection Patterns
// ============================================================================

/**
 * Pattern definitions for Agent Booster intent detection
 */
const INTENT_PATTERNS: Record<EditIntentType, {
  patterns: RegExp[];
  weight: number;
  description: string;
}> = {
  'var-to-const': {
    patterns: [
      /convert\s+var\s+to\s+const/i,
      /change\s+var\s+to\s+const/i,
      /change\s+var\s+declarations?\s+to\s+const/i,
      /replace\s+var\s+with\s+const/i,
      /var\s*(?:→|->|to)\s*const/i,
      /use\s+const\s+instead\s+of\s+var/i,
    ],
    weight: 1.0,
    description: 'Convert var declarations to const/let',
  },
  'add-types': {
    patterns: [
      /add\s+type\s+annotations?/i,
      /add\s+typescript\s+types?/i,
      /type\s+this\s+function/i,
      /add\s+types?\s+to/i,
      /annotate\s+with\s+types?/i,
    ],
    weight: 0.9,
    description: 'Add TypeScript type annotations',
  },
  'add-error-handling': {
    patterns: [
      /add\s+error\s+handling/i,
      /wrap\s+in\s+try\s*[/-]?\s*catch/i,
      /add\s+try\s*[/-]?\s*catch/i,
      /handle\s+errors?/i,
      /add\s+exception\s+handling/i,
    ],
    weight: 0.7, // Lower weight - often needs more context
    description: 'Wrap code in try/catch blocks',
  },
  'async-await': {
    patterns: [
      /convert\s+to\s+async\s*[/-]?\s*await/i,
      /convert\s+\w+\s+to\s+async/i,
      /use\s+async\s*[/-]?\s*await/i,
      /change\s+promises?\s+to\s+async/i,
      /refactor\s+to\s+async/i,
      /\.then\s*(?:→|->|to)\s*await/i,
      /callback\s+to\s+async/i,
      /callbacks?\s+to\s+async/i,
    ],
    weight: 0.8,
    description: 'Convert callbacks/promises to async/await',
  },
  'add-logging': {
    patterns: [
      /add\s+logging/i,
      /add\s+console\.log/i,
      /add\s+debug\s+logs?/i,
      /log\s+this\s+function/i,
      /add\s+trace\s+logging/i,
    ],
    weight: 0.85,
    description: 'Add console.log or logging statements',
  },
  'remove-console': {
    patterns: [
      /remove\s+(?:all\s+)?console\.log/i,
      /remove\s+(?:all\s+)?console\s+statements?/i,
      /delete\s+(?:all\s+)?console\s+statements?/i,
      /strip\s+console/i,
      /clean\s+up\s+console/i,
      /clean\s+up\s+debug\s+logs?/i,
      /remove\s+(?:all\s+)?debug\s+logs?/i,
      /delete\s+(?:all\s+)?console\.log/i,
    ],
    weight: 0.95,
    description: 'Remove console.* calls',
  },
};

/**
 * File path extraction patterns
 */
const FILE_PATH_PATTERNS: RegExp[] = [
  /(?:in|from|to|file|path)\s+[`"']?([a-zA-Z0-9_./\\-]+\.[a-zA-Z]+)[`"']?/i,
  /[`"']([a-zA-Z0-9_./\\-]+\.[a-zA-Z]+)[`"']/,
  /(\S+\.[tj]sx?)\b/i,
  /(\S+\.(?:js|ts|jsx|tsx|py|rb|go|rs|java|kt|swift|c|cpp|h))\b/i,
];

/**
 * Language detection by extension
 */
/**
 * High-complexity keywords that indicate Tier 3 (Opus) routing
 * These tasks require deep reasoning and architectural understanding
 */
const TIER3_KEYWORDS: RegExp[] = [
  // Architecture & Design
  /\b(microservices?|architecture|system\s+design|distributed)\b/i,
  /\b(design|architect|plan)\s+(a|an|the|complex)\b/i,
  /\b(design)\s+\w+\s+(schema|system|architecture)\b/i,

  // Security
  /\b(oauth2?|pkce|jwt|rbac|authentication\s+system|security\s+audit)\b/i,
  /\b(refresh\s+token|token\s+rotation|role-based|permission|authorization)\b/i,
  /\b(encryption|cryptograph|certificate|ssl|tls)\b/i,
  /\b(end-to-end\s+encryption|key\s+rotation|secure\s+channel)\b/i,

  // Distributed Systems
  /\b(consensus|distributed|byzantine|raft|paxos)\b/i,
  /\b(replication|sharding|partitioning|eventual\s+consistency)\b/i,
  /\b(load\s+balanc|fault[- ]toleran|high\s+availability)\b/i,
  /\b(message\s+queue|event\s+sourc|cqrs|saga)\b/i,

  // Complex Algorithms
  /\b(algorithm|machine\s+learning|neural|optimization)\b/i,
  /\b(graph\s+algorithm|tree\s+traversal|dynamic\s+programming)\b/i,

  // Database Design
  /\b(schema\s+design|database\s+architect|data\s+model)\b/i,
  /\b(database\s+schema|multi[- ]tenant)\b/i,
  /\b(normalization|denormalization|index\s+strateg)\b/i,

  // Performance Critical
  /\b(performance\s+critical|low\s+latency|high\s+throughput)\b/i,
  /\b(memory\s+optimi|cache\s+strateg|concurrent)\b/i,
];

const LANGUAGE_MAP: Record<string, string> = {
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.py': 'python',
  '.rb': 'ruby',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.kt': 'kotlin',
  '.swift': 'swift',
  '.c': 'c',
  '.cpp': 'cpp',
  '.h': 'c',
};

// ============================================================================
// Enhanced Model Router Implementation
// ============================================================================

/**
 * Enhanced Model Router with Agent Booster AST integration
 *
 * Provides intelligent 3-tier routing:
 * - Tier 1: Agent Booster for simple code transforms (352x faster, $0)
 * - Tier 2: Haiku for low complexity tasks
 * - Tier 3: Sonnet/Opus for complex reasoning tasks
 */
export class EnhancedModelRouter {
  private config: EnhancedModelRouterConfig;
  private tinyDancerRouter: ModelRouter;

  constructor(config?: Partial<EnhancedModelRouterConfig>) {
    this.config = {
      agentBoosterEnabled: true,
      agentBoosterConfidenceThreshold: 0.7,
      enabledIntents: [
        'var-to-const',
        'add-types',
        'add-error-handling',
        'async-await',
        'add-logging',
        'remove-console',
      ],
      complexityThresholds: {
        haiku: 0.3,
        sonnet: 0.6,
        opus: 1.0,
      },
      preferCost: false,
      preferQuality: false,
      ...config,
    };

    this.tinyDancerRouter = getModelRouter();
  }

  /**
   * Detect code editing intent from task description
   */
  detectIntent(task: string): EditIntent | null {
    const taskLower = task.toLowerCase();
    let bestIntent: EditIntent | null = null;
    let bestScore = 0;

    for (const [intentType, config] of Object.entries(INTENT_PATTERNS)) {
      if (!this.config.enabledIntents.includes(intentType as EditIntentType)) {
        continue;
      }

      for (const pattern of config.patterns) {
        if (pattern.test(taskLower)) {
          const score = config.weight;
          if (score > bestScore) {
            bestScore = score;
            bestIntent = {
              type: intentType as EditIntentType,
              confidence: score,
              description: config.description,
            };
          }
        }
      }
    }

    // Extract file path if intent found
    if (bestIntent) {
      const filePath = this.extractFilePath(task);
      if (filePath) {
        bestIntent.filePath = filePath;
        bestIntent.language = this.detectLanguage(filePath);
        // Boost confidence if file exists
        if (existsSync(filePath)) {
          bestIntent.confidence = Math.min(1.0, bestIntent.confidence + 0.1);
        }
      }
    }

    return bestIntent;
  }

  /**
   * Extract file path from task description
   */
  private extractFilePath(task: string): string | null {
    for (const pattern of FILE_PATH_PATTERNS) {
      const match = task.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }
    return null;
  }

  /**
   * Detect language from file extension
   */
  private detectLanguage(filePath: string): string {
    const ext = extname(filePath).toLowerCase();
    return LANGUAGE_MAP[ext] || 'javascript';
  }

  /**
   * Check if task contains Tier 3 (Opus) keywords
   */
  private containsTier3Keywords(task: string): { matches: boolean; count: number } {
    let count = 0;
    for (const pattern of TIER3_KEYWORDS) {
      if (pattern.test(task)) {
        count++;
      }
    }
    return { matches: count > 0, count };
  }

  /**
   * Route a task to the optimal tier and handler
   */
  async route(task: string, context?: { filePath?: string }): Promise<EnhancedRouteResult> {
    // Step 1: Try Agent Booster intent detection
    if (this.config.agentBoosterEnabled) {
      const intent = this.detectIntent(task);

      if (intent && intent.confidence >= this.config.agentBoosterConfidenceThreshold) {
        return {
          tier: 1,
          handler: 'agent-booster',
          confidence: intent.confidence,
          reasoning: `Agent Booster can handle "${intent.type}" with ${(intent.confidence * 100).toFixed(0)}% confidence`,
          agentBoosterIntent: intent,
          canSkipLLM: true,
          estimatedLatencyMs: 1,
          estimatedCost: 0,
        };
      }
    }

    // Step 2: Check for Tier 3 keywords (architecture, security, distributed)
    const tier3Check = this.containsTier3Keywords(task);
    if (tier3Check.matches && tier3Check.count >= 2) {
      // Strong signal for Opus - multiple complex keywords
      return {
        tier: 3,
        handler: 'opus',
        model: 'opus',
        confidence: Math.min(0.95, 0.7 + tier3Check.count * 0.1),
        complexity: 0.8 + tier3Check.count * 0.05,
        reasoning: `High complexity task (${tier3Check.count} architectural keywords) - using opus`,
        canSkipLLM: false,
        estimatedLatencyMs: 5000,
        estimatedCost: 0.015,
      };
    }

    // Step 3: AST complexity analysis (if file path provided)
    let astComplexity: number | undefined;
    const targetFile = context?.filePath || this.extractFilePath(task);

    if (targetFile && existsSync(targetFile)) {
      try {
        astComplexity = await this.analyzeASTComplexity(targetFile);
      } catch {
        // AST analysis not available, continue with text-based routing
      }
    }

    // Step 4: Text-based complexity + tiny-dancer routing
    const tinyDancerResult = await this.tinyDancerRouter.route(task);

    // Step 5: Combine AST complexity with tiny-dancer result
    // Also boost if single tier3 keyword found
    let finalComplexity = astComplexity !== undefined
      ? (astComplexity + tinyDancerResult.complexity) / 2
      : tinyDancerResult.complexity;

    // Boost complexity if tier3 keywords found (even just one)
    if (tier3Check.matches) {
      finalComplexity = Math.min(1.0, finalComplexity + 0.25);
    }

    // Step 6: Determine tier based on complexity
    const { haiku, sonnet } = this.config.complexityThresholds;

    if (finalComplexity < haiku) {
      return {
        tier: 2,
        handler: 'haiku',
        model: 'haiku',
        confidence: tinyDancerResult.confidence,
        complexity: finalComplexity,
        reasoning: `Low complexity (${(finalComplexity * 100).toFixed(0)}%) - using haiku`,
        canSkipLLM: false,
        estimatedLatencyMs: 500,
        estimatedCost: 0.0002,
      };
    }

    if (finalComplexity < sonnet) {
      return {
        tier: 2,
        handler: 'sonnet',
        model: 'sonnet',
        confidence: tinyDancerResult.confidence,
        complexity: finalComplexity,
        reasoning: `Medium complexity (${(finalComplexity * 100).toFixed(0)}%) - using sonnet`,
        canSkipLLM: false,
        estimatedLatencyMs: 2000,
        estimatedCost: 0.003,
      };
    }

    return {
      tier: 3,
      handler: 'opus',
      model: 'opus',
      confidence: tinyDancerResult.confidence,
      complexity: finalComplexity,
      reasoning: `High complexity (${(finalComplexity * 100).toFixed(0)}%) - using opus`,
      canSkipLLM: false,
      estimatedLatencyMs: 5000,
      estimatedCost: 0.015,
    };
  }

  /**
   * Analyze AST complexity of a file
   * Returns normalized complexity score (0-1)
   */
  private async analyzeASTComplexity(filePath: string): Promise<number> {
    try {
      const content = readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');

      // Simple heuristics for complexity
      let complexity = 0;

      // Line count contribution
      complexity += Math.min(0.3, lines.length / 1000);

      // Nesting depth estimation (count indentation)
      const avgIndent = lines
        .filter((l) => l.trim().length > 0)
        .map((l) => l.match(/^(\s*)/)?.[1].length || 0)
        .reduce((sum, indent) => sum + indent, 0) / Math.max(1, lines.length);
      complexity += Math.min(0.2, avgIndent / 20);

      // Control flow complexity (count keywords)
      const controlFlowCount = (content.match(/\b(if|else|for|while|switch|case|try|catch|async|await)\b/g) || []).length;
      complexity += Math.min(0.3, controlFlowCount / 100);

      // Function/class count
      const functionCount = (content.match(/\b(function|class|=>)\b/g) || []).length;
      complexity += Math.min(0.2, functionCount / 50);

      return Math.min(1, complexity);
    } catch {
      return 0.5; // Default to medium complexity on error
    }
  }

  /**
   * Execute task using the appropriate tier
   * Returns the result and routing information
   */
  async execute(
    task: string,
    context?: { filePath?: string; originalCode?: string }
  ): Promise<{
    result: string | { applied: boolean; confidence: number };
    routeResult: EnhancedRouteResult;
  }> {
    const routeResult = await this.route(task, context);

    if (routeResult.tier === 1 && routeResult.agentBoosterIntent) {
      // Try to execute with Agent Booster
      const abResult = await this.tryAgentBooster(routeResult.agentBoosterIntent, context);

      if (abResult.success) {
        return {
          result: { applied: true, confidence: abResult.confidence },
          routeResult,
        };
      }

      // Agent Booster failed, fall back to LLM
      routeResult.tier = 2;
      routeResult.handler = 'sonnet';
      routeResult.model = 'sonnet';
      routeResult.canSkipLLM = false;
      routeResult.reasoning += ' (Agent Booster fallback to LLM)';
    }

    // Return routing result - caller handles LLM invocation
    return { result: routeResult.reasoning, routeResult };
  }

  /**
   * Try to apply edit using Agent Booster
   */
  private async tryAgentBooster(
    intent: EditIntent,
    context?: { filePath?: string; originalCode?: string }
  ): Promise<{ success: boolean; confidence: number; output?: string }> {
    try {
      // Try to import and use agentic-flow's agent-booster
      const { execSync } = await import('child_process');

      const filePath = intent.filePath || context?.filePath;
      if (!filePath || !existsSync(filePath)) {
        return { success: false, confidence: 0 };
      }

      const originalCode = context?.originalCode || readFileSync(filePath, 'utf-8');

      // Build agent-booster command based on intent
      const intentToInstruction: Record<EditIntentType, string> = {
        'var-to-const': 'Convert all var declarations to const',
        'add-types': 'Add TypeScript type annotations',
        'add-error-handling': 'Wrap in try/catch blocks',
        'async-await': 'Convert to async/await',
        'add-logging': 'Add console.log statements',
        'remove-console': 'Remove all console.* statements',
      };

      const instruction = intentToInstruction[intent.type];
      const language = intent.language || 'javascript';

      // Try using npx agent-booster
      const cmd = `npx --yes agent-booster@0.2.2 apply --language ${language}`;

      const result = execSync(cmd, {
        encoding: 'utf-8',
        input: JSON.stringify({
          code: originalCode,
          edit: instruction,
        }),
        maxBuffer: 10 * 1024 * 1024,
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const parsed = JSON.parse(result);

      if (parsed.confidence >= this.config.agentBoosterConfidenceThreshold) {
        return {
          success: true,
          confidence: parsed.confidence,
          output: parsed.output,
        };
      }

      return { success: false, confidence: parsed.confidence || 0 };
    } catch {
      // Agent Booster not available or failed
      return { success: false, confidence: 0 };
    }
  }

  /**
   * Get router statistics
   */
  getStats(): {
    config: EnhancedModelRouterConfig;
    tinyDancerStats: ReturnType<ModelRouter['getStats']>;
  } {
    return {
      config: { ...this.config },
      tinyDancerStats: this.tinyDancerRouter.getStats(),
    };
  }
}

// ============================================================================
// Singleton & Factory Functions
// ============================================================================

let enhancedRouterInstance: EnhancedModelRouter | null = null;

/**
 * Get or create the singleton EnhancedModelRouter instance
 */
export function getEnhancedModelRouter(
  config?: Partial<EnhancedModelRouterConfig>
): EnhancedModelRouter {
  if (!enhancedRouterInstance) {
    enhancedRouterInstance = new EnhancedModelRouter(config);
  }
  return enhancedRouterInstance;
}

/**
 * Reset the singleton instance
 */
export function resetEnhancedModelRouter(): void {
  enhancedRouterInstance = null;
}

/**
 * Create a new EnhancedModelRouter instance (non-singleton)
 */
export function createEnhancedModelRouter(
  config?: Partial<EnhancedModelRouterConfig>
): EnhancedModelRouter {
  return new EnhancedModelRouter(config);
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Quick route function with enhanced routing
 */
export async function enhancedRouteToModel(
  task: string,
  context?: { filePath?: string }
): Promise<EnhancedRouteResult> {
  const router = getEnhancedModelRouter();
  return router.route(task, context);
}

/**
 * Detect if a task can be handled by Agent Booster
 */
export function canUseAgentBooster(task: string): {
  canUse: boolean;
  intent?: EditIntent;
} {
  const router = getEnhancedModelRouter();
  const intent = router.detectIntent(task);

  if (intent && intent.confidence >= 0.7) {
    return { canUse: true, intent };
  }

  return { canUse: false };
}
