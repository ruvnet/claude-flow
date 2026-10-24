/**
 * Security MCP Tools - AIDefence Integration
 *
 * Provides MCP tools for AI manipulation defense:
 * - aidefence_scan: Scan input for threats
 * - aidefence_analyze: Deep analysis of threats
 * - aidefence_stats: Get detection statistics
 * - aidefence_learn: Learn from detection feedback
 *
 * Created with ❤️ by ruv.io
 */

import type { MCPTool, MCPToolResult } from './types.js';
import { autoInstallPackage } from './auto-install.js';
import { createRequire } from 'module';

// Create require for resolving module paths
const require = createRequire(import.meta.url);

// AIDefence instance type
type AIDefenceInstance = ReturnType<typeof import('@claude-flow/aidefence').createAIDefence>;

// Lazy-loaded AIDefence instance
let aidefenceInstance: AIDefenceInstance | null = null;

// Track if we've attempted install this session
let installAttempted = false;

/**
 * Get or create AIDefence instance (throws if unavailable)
 */
async function getAIDefence(): Promise<AIDefenceInstance> {
  if (aidefenceInstance) {
    return aidefenceInstance;
  }

  const packageName = '@claude-flow/aidefence';

  // First attempt - try to load via dynamic import (ESM)
  try {
    const aidefence = await import(packageName);
    const instance = aidefence.createAIDefence({ enableLearning: true });
    if (!instance) {
      throw new Error('createAIDefence returned null');
    }
    aidefenceInstance = instance;
    return instance;
  } catch (e) {
    // Package not found or failed to load
    const error = e as Error;
    if (!error.message?.includes('Cannot find package') && !error.message?.includes('ERR_MODULE_NOT_FOUND')) {
      // Different error - might be a real issue
      throw new Error(`AIDefence failed to load: ${error.message}`);
    }
  }

  // Don't attempt install more than once per session
  if (installAttempted) {
    throw new Error('AIDefence package not available. Install with: npm install @claude-flow/aidefence');
  }
  installAttempted = true;

  // Second attempt - auto-install and retry
  console.error(`[claude-flow] ${packageName} not found, attempting auto-install...`);
  const installed = await autoInstallPackage(packageName);

  if (!installed) {
    throw new Error('AIDefence package not available. Install with: npm install @claude-flow/aidefence');
  }

  // Retry with ESM cache busting via file:// URL + timestamp
  try {
    const modulePath = require.resolve(packageName);
    const cacheBust = `?t=${Date.now()}`;
    const aidefence = await import(`file://${modulePath}${cacheBust}`);
    const instance = aidefence.createAIDefence({ enableLearning: true });
    if (!instance) {
      throw new Error('createAIDefence returned null after install');
    }
    aidefenceInstance = instance;
    console.error(`[claude-flow] ${packageName} loaded successfully after install`);
    return instance;
  } catch (retryError) {
    throw new Error(`AIDefence installed but failed to load: ${retryError}. Try restarting the MCP server.`);
  }
}

/**
 * Scan input for AI manipulation threats
 */
const aidefenceScanTool: MCPTool = {
  name: 'aidefence_scan',
  description: 'Scan input text for AI manipulation threats (prompt injection, jailbreaks, PII). Returns threat assessment with <10ms latency.',
  inputSchema: {
    type: 'object',
    properties: {
      input: {
        type: 'string',
        description: 'Text to scan for threats',
      },
      quick: {
        type: 'boolean',
        description: 'Quick scan mode (faster, less detailed)',
        default: false,
      },
    },
    required: ['input'],
  },
  handler: async (args: Record<string, unknown>): Promise<MCPToolResult> => {
    const input = args.input as string;
    const quick = args.quick as boolean;

    try {
      const defender = await getAIDefence();

      if (quick) {
        const result = defender.quickScan(input);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              safe: !result.threat,
              threatDetected: result.threat,
              confidence: result.confidence,
              mode: 'quick',
            }, null, 2),
          }],
        };
      }

      const result = await defender.detect(input);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            safe: result.safe,
            threats: result.threats.map(t => ({
              type: t.type,
              severity: t.severity,
              confidence: t.confidence,
              description: t.description,
            })),
            piiFound: result.piiFound,
            detectionTimeMs: result.detectionTimeMs,
          }, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ error: String(error) }),
        }],
        isError: true,
      };
    }
  },
};

/**
 * Deep analysis of specific threat
 */
const aidefenceAnalyzeTool: MCPTool = {
  name: 'aidefence_analyze',
  description: 'Deep analysis of input for specific threat types with similar pattern search and mitigation recommendations.',
  inputSchema: {
    type: 'object',
    properties: {
      input: {
        type: 'string',
        description: 'Text to analyze',
      },
      searchSimilar: {
        type: 'boolean',
        description: 'Search for similar known threats',
        default: true,
      },
      k: {
        type: 'number',
        description: 'Number of similar patterns to retrieve',
        default: 5,
      },
    },
    required: ['input'],
  },
  handler: async (args: Record<string, unknown>): Promise<MCPToolResult> => {
    const input = args.input as string;
    const searchSimilar = args.searchSimilar !== false;
    const k = (args.k as number) || 5;

    try {
      const defender = await getAIDefence();
      const result = await defender.detect(input);

      const analysis: Record<string, unknown> = {
        detection: {
          safe: result.safe,
          threats: result.threats,
          piiFound: result.piiFound,
        },
        mitigations: [] as Array<{ threatType: string; strategy: string; effectiveness: number }>,
        similarPatterns: [] as Array<unknown>,
      };

      // Get mitigations for detected threats
      for (const threat of result.threats) {
        const mitigation = await defender.getBestMitigation(threat.type as Parameters<typeof defender.getBestMitigation>[0]);
        if (mitigation) {
          (analysis.mitigations as Array<unknown>).push({
            threatType: threat.type,
            strategy: mitigation.strategy,
            effectiveness: mitigation.effectiveness,
          });
        }
      }

      // Search similar patterns
      if (searchSimilar) {
        const similar = await defender.searchSimilarThreats(input, { k });
        analysis.similarPatterns = similar.map(p => ({
          pattern: p.pattern,
          type: p.type,
          effectiveness: p.effectiveness,
        }));
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(analysis, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ error: String(error) }),
        }],
        isError: true,
      };
    }
  },
};

/**
 * Get detection statistics
 */
const aidefenceStatsTool: MCPTool = {
  name: 'aidefence_stats',
  description: 'Get AIDefence detection and learning statistics.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  handler: async (): Promise<MCPToolResult> => {
    try {
      const defender = await getAIDefence();
      const stats = await defender.getStats();

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            detectionCount: stats.detectionCount,
            avgDetectionTimeMs: stats.avgDetectionTimeMs,
            learnedPatterns: stats.learnedPatterns,
            mitigationStrategies: stats.mitigationStrategies,
            avgMitigationEffectiveness: stats.avgMitigationEffectiveness,
          }, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ error: String(error) }),
        }],
        isError: true,
      };
    }
  },
};

/**
 * Record detection feedback for learning
 */
const aidefenceLearnTool: MCPTool = {
  name: 'aidefence_learn',
  description: 'Record detection feedback for pattern learning. Improves future detection accuracy.',
  inputSchema: {
    type: 'object',
    properties: {
      input: {
        type: 'string',
        description: 'Original input that was scanned',
      },
      wasAccurate: {
        type: 'boolean',
        description: 'Whether the detection was accurate',
      },
      verdict: {
        type: 'string',
        description: 'User verdict or correction',
      },
      threatType: {
        type: 'string',
        description: 'Threat type for mitigation recording',
      },
      mitigationStrategy: {
        type: 'string',
        description: 'Mitigation strategy used',
        enum: ['block', 'sanitize', 'warn', 'log', 'escalate', 'transform', 'redirect'],
      },
      mitigationSuccess: {
        type: 'boolean',
        description: 'Whether the mitigation was successful',
      },
    },
    required: ['input', 'wasAccurate'],
  },
  handler: async (args: Record<string, unknown>): Promise<MCPToolResult> => {
    const input = args.input as string;
    const wasAccurate = args.wasAccurate as boolean;
    const verdict = args.verdict as string | undefined;
    const threatType = args.threatType as string | undefined;
    const mitigationStrategy = args.mitigationStrategy as string | undefined;
    const mitigationSuccess = args.mitigationSuccess as boolean | undefined;

    try {
      const defender = await getAIDefence();

      // Re-detect to get result for learning
      const result = await defender.detect(input);

      // Learn from detection
      await defender.learnFromDetection(input, result, {
        wasAccurate,
        userVerdict: verdict,
      });

      // Record mitigation if provided
      if (threatType && mitigationStrategy && mitigationSuccess !== undefined) {
        await defender.recordMitigation(
          threatType as Parameters<typeof defender.recordMitigation>[0],
          mitigationStrategy as Parameters<typeof defender.recordMitigation>[1],
          mitigationSuccess
        );
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: 'Feedback recorded for pattern learning',
            learnedFrom: {
              input: input.slice(0, 50) + (input.length > 50 ? '...' : ''),
              wasAccurate,
              threatCount: result.threats.length,
            },
          }, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ error: String(error) }),
        }],
        isError: true,
      };
    }
  },
};

/**
 * Check if input is safe (simple boolean check)
 */
const aidefenceIsSafeTool: MCPTool = {
  name: 'aidefence_is_safe',
  description: 'Quick boolean check if input is safe. Fastest option for simple validation.',
  inputSchema: {
    type: 'object',
    properties: {
      input: {
        type: 'string',
        description: 'Text to check',
      },
    },
    required: ['input'],
  },
  handler: async (args: Record<string, unknown>): Promise<MCPToolResult> => {
    const input = args.input as string;

    try {
      const { isSafe } = await import('@claude-flow/aidefence');
      const safe = isSafe(input);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ safe }, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ error: String(error) }),
        }],
        isError: true,
      };
    }
  },
};

/**
 * Check for PII in input
 */
const aidefenceHasPIITool: MCPTool = {
  name: 'aidefence_has_pii',
  description: 'Check if input contains PII (emails, SSNs, API keys, passwords, etc.).',
  inputSchema: {
    type: 'object',
    properties: {
      input: {
        type: 'string',
        description: 'Text to check for PII',
      },
    },
    required: ['input'],
  },
  handler: async (args: Record<string, unknown>): Promise<MCPToolResult> => {
    const input = args.input as string;

    try {
      const defender = await getAIDefence();
      const hasPII = defender.hasPII(input);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ hasPII }, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ error: String(error) }),
        }],
        isError: true,
      };
    }
  },
};

/**
 * Export all security tools
 */
export const securityTools: MCPTool[] = [
  aidefenceScanTool,
  aidefenceAnalyzeTool,
  aidefenceStatsTool,
  aidefenceLearnTool,
  aidefenceIsSafeTool,
  aidefenceHasPIITool,
];

export default securityTools;
