/**
 * Analyze MCP Tools
 * Provides diff analysis and classification via MCP protocol
 */

import type { MCPTool } from './types.js';
import {
  analyzeDiff,
  assessFileRisk,
  assessOverallRisk,
  classifyDiff,
  suggestReviewers,
  getGitDiffNumstat,
  type DiffFile,
  type RiskLevel,
} from '../ruvector/diff-classifier.js';

/**
 * Diff Analysis Tool
 * Analyzes git diffs for change risk assessment and classification
 */
export const analyzeDiffTool: MCPTool = {
  name: 'analyze/diff',
  description: 'Analyze git diff for change risk assessment and classification',
  category: 'analyze',
  tags: ['diff', 'risk', 'classification', 'git'],
  inputSchema: {
    type: 'object',
    properties: {
      ref: {
        type: 'string',
        description: 'Git ref to compare against (e.g., HEAD~1, main..feature, commit hash)',
        default: 'HEAD',
      },
      includeFileRisks: {
        type: 'boolean',
        description: 'Include detailed file-level risk analysis',
        default: false,
      },
      includeReviewers: {
        type: 'boolean',
        description: 'Include recommended reviewers',
        default: true,
      },
      useRuVector: {
        type: 'boolean',
        description: 'Attempt to use ruvector for analysis (graceful fallback if unavailable)',
        default: true,
      },
    },
  },
  handler: async (params: Record<string, unknown>) => {
    const ref = (params.ref as string) || 'HEAD';
    const includeFileRisks = params.includeFileRisks !== false;
    const includeReviewers = params.includeReviewers !== false;
    const useRuVector = params.useRuVector !== false;

    try {
      const result = await analyzeDiff({
        ref,
        useRuVector,
      });

      // Build response
      const response: Record<string, unknown> = {
        ref: result.ref,
        timestamp: result.timestamp,
        files: result.files,
        risk: result.risk,
        classification: result.classification,
        summary: result.summary,
      };

      if (includeFileRisks) {
        response.fileRisks = result.fileRisks;
      }

      if (includeReviewers) {
        response.recommendedReviewers = result.recommendedReviewers;
      }

      return response;
    } catch (error) {
      return {
        error: true,
        message: error instanceof Error ? error.message : String(error),
        ref,
      };
    }
  },
};

/**
 * Diff Risk Assessment Tool
 * Focused risk assessment without full analysis
 */
export const diffRiskTool: MCPTool = {
  name: 'analyze/diff-risk',
  description: 'Quick risk assessment for git diff',
  category: 'analyze',
  tags: ['diff', 'risk', 'git'],
  inputSchema: {
    type: 'object',
    properties: {
      ref: {
        type: 'string',
        description: 'Git ref to compare against',
        default: 'HEAD',
      },
    },
  },
  handler: async (params: Record<string, unknown>) => {
    const ref = (params.ref as string) || 'HEAD';

    try {
      const files = getGitDiffNumstat(ref);
      const fileRisks = files.map(assessFileRisk);
      const risk = assessOverallRisk(files, fileRisks);

      return {
        ref,
        risk,
        summary: `${risk.overall} risk (score: ${risk.score}/100) - ${files.length} files changed`,
      };
    } catch (error) {
      return {
        error: true,
        message: error instanceof Error ? error.message : String(error),
        ref,
      };
    }
  },
};

/**
 * Diff Classification Tool
 * Classify change type without full analysis
 */
export const diffClassifyTool: MCPTool = {
  name: 'analyze/diff-classify',
  description: 'Classify git diff change type',
  category: 'analyze',
  tags: ['diff', 'classification', 'git'],
  inputSchema: {
    type: 'object',
    properties: {
      ref: {
        type: 'string',
        description: 'Git ref to compare against',
        default: 'HEAD',
      },
    },
  },
  handler: async (params: Record<string, unknown>) => {
    const ref = (params.ref as string) || 'HEAD';

    try {
      const files = getGitDiffNumstat(ref);
      const classification = classifyDiff(files);

      return {
        ref,
        classification,
        files: files.length,
      };
    } catch (error) {
      return {
        error: true,
        message: error instanceof Error ? error.message : String(error),
        ref,
      };
    }
  },
};

/**
 * Diff Reviewers Tool
 * Suggest reviewers for changes
 */
export const diffReviewersTool: MCPTool = {
  name: 'analyze/diff-reviewers',
  description: 'Suggest reviewers for git diff changes',
  category: 'analyze',
  tags: ['diff', 'reviewers', 'git'],
  inputSchema: {
    type: 'object',
    properties: {
      ref: {
        type: 'string',
        description: 'Git ref to compare against',
        default: 'HEAD',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of reviewers to suggest',
        default: 5,
      },
    },
  },
  handler: async (params: Record<string, unknown>) => {
    const ref = (params.ref as string) || 'HEAD';
    const limit = (params.limit as number) || 5;

    try {
      const files = getGitDiffNumstat(ref);
      const fileRisks = files.map(assessFileRisk);
      const reviewers = suggestReviewers(files, fileRisks);

      return {
        ref,
        recommendedReviewers: reviewers.slice(0, limit),
        filesAnalyzed: files.length,
      };
    } catch (error) {
      return {
        error: true,
        message: error instanceof Error ? error.message : String(error),
        ref,
      };
    }
  },
};

/**
 * File Risk Tool
 * Assess risk for a specific file path
 */
export const fileRiskTool: MCPTool = {
  name: 'analyze/file-risk',
  description: 'Assess risk for a specific file change',
  category: 'analyze',
  tags: ['file', 'risk'],
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'File path to assess',
      },
      additions: {
        type: 'number',
        description: 'Number of lines added',
        default: 0,
      },
      deletions: {
        type: 'number',
        description: 'Number of lines deleted',
        default: 0,
      },
      status: {
        type: 'string',
        description: 'File status: added, modified, deleted, renamed',
        default: 'modified',
      },
    },
    required: ['path'],
  },
  handler: async (params: Record<string, unknown>) => {
    const file: DiffFile = {
      path: params.path as string,
      status: (params.status as DiffFile['status']) || 'modified',
      additions: (params.additions as number) || 0,
      deletions: (params.deletions as number) || 0,
      hunks: 1,
      binary: false,
    };

    const risk = assessFileRisk(file);

    return {
      file: file.path,
      risk: risk.risk,
      score: risk.score,
      reasons: risk.reasons,
    };
  },
};

/**
 * Diff Stats Tool
 * Get quick diff statistics
 */
export const diffStatsTool: MCPTool = {
  name: 'analyze/diff-stats',
  description: 'Get quick statistics for git diff',
  category: 'analyze',
  tags: ['diff', 'stats', 'git'],
  inputSchema: {
    type: 'object',
    properties: {
      ref: {
        type: 'string',
        description: 'Git ref to compare against',
        default: 'HEAD',
      },
    },
  },
  handler: async (params: Record<string, unknown>) => {
    const ref = (params.ref as string) || 'HEAD';

    try {
      const files = getGitDiffNumstat(ref);

      const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
      const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);
      const addedFiles = files.filter(f => f.status === 'added').length;
      const modifiedFiles = files.filter(f => f.status === 'modified').length;
      const deletedFiles = files.filter(f => f.status === 'deleted').length;
      const renamedFiles = files.filter(f => f.status === 'renamed').length;
      const binaryFiles = files.filter(f => f.binary).length;

      return {
        ref,
        totalFiles: files.length,
        totalAdditions,
        totalDeletions,
        totalChanges: totalAdditions + totalDeletions,
        byStatus: {
          added: addedFiles,
          modified: modifiedFiles,
          deleted: deletedFiles,
          renamed: renamedFiles,
        },
        binaryFiles,
      };
    } catch (error) {
      return {
        error: true,
        message: error instanceof Error ? error.message : String(error),
        ref,
      };
    }
  },
};

// Export all analyze tools
export const analyzeTools: MCPTool[] = [
  analyzeDiffTool,
  diffRiskTool,
  diffClassifyTool,
  diffReviewersTool,
  fileRiskTool,
  diffStatsTool,
];

export default analyzeTools;
