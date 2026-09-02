/**
 * V3 MCP Configuration Tools
 *
 * MCP tools for configuration management:
 * - config/load - Load configuration
 * - config/save - Save configuration
 * - config/validate - Validate configuration
 *
 * Implements ADR-005: MCP-First API Design
 */

import { z } from 'zod';
import { MCPTool, ToolContext } from '../types.js';
import { resolve, normalize } from 'path';

/**
 * Validate and sanitize config file path to prevent path traversal
 */
function validateConfigPath(inputPath: string, cwd: string = process.cwd()): string {
  // Normalize the path to resolve .. and .
  const normalizedPath = normalize(inputPath);

  // Block absolute paths and paths with traversal
  if (normalizedPath.startsWith('/') || normalizedPath.startsWith('\\')) {
    throw new Error('Absolute paths are not allowed for config files');
  }
  if (normalizedPath.includes('..')) {
    throw new Error('Path traversal (..) is not allowed');
  }

  // Only allow .json and .config.* files
  const allowedExtensions = ['.json', '.config.json', '.config.js', '.config.ts'];
  const hasAllowedExt = allowedExtensions.some(ext => normalizedPath.endsWith(ext));
  if (!hasAllowedExt) {
    throw new Error('Only .json and .config.* file extensions are allowed');
  }

  // Resolve to absolute path within cwd
  const resolvedPath = resolve(cwd, normalizedPath);

  // Ensure the resolved path is within cwd
  if (!resolvedPath.startsWith(cwd)) {
    throw new Error('Config path must be within current working directory');
  }

  return resolvedPath;
}

// ============================================================================
// Input Schemas
// ============================================================================

const loadConfigSchema = z.object({
  path: z.string().optional()
    .describe('Configuration file path (defaults to ./claude-flow.config.json)'),
  scope: z.enum(['global', 'project', 'user']).default('project')
    .describe('Configuration scope'),
  merge: z.boolean().default(true)
    .describe('Merge with default configuration'),
  includeDefaults: z.boolean().default(false)
    .describe('Include default values in response'),
});

const saveConfigSchema = z.object({
  config: z.record(z.unknown())
    .describe('Configuration object to save'),
  path: z.string().optional()
    .describe('Configuration file path (defaults to ./claude-flow.config.json)'),
  scope: z.enum(['global', 'project', 'user']).default('project')
    .describe('Configuration scope'),
  merge: z.boolean().default(true)
    .describe('Merge with existing configuration'),
  createBackup: z.boolean().default(true)
    .describe('Create backup of existing configuration'),
});

const validateConfigSchema = z.object({
  config: z.record(z.unknown())
    .describe('Configuration object to validate'),
  strict: z.boolean().default(true)
    .describe('Enable strict validation (fail on unknown fields)'),
  fixIssues: z.boolean().default(false)
    .describe('Attempt to automatically fix validation issues'),
});

// ============================================================================
// Type Definitions
// ============================================================================

interface ConfigurationSection {
  [key: string]: unknown;
}

interface Configuration {
  // Agent configuration
  agents?: {
    maxConcurrent?: number;
    defaultPriority?: 'low' | 'normal' | 'high' | 'critical';
    timeout?: number;
    retryAttempts?: number;
  };

  // Swarm configuration
  swarm?: {
    topology?: 'hierarchical' | 'mesh' | 'adaptive' | 'collective' | 'hierarchical-mesh';
    maxAgents?: number;
    communicationProtocol?: 'direct' | 'message-bus' | 'pubsub';
    consensusMechanism?: 'majority' | 'unanimous' | 'weighted' | 'none';
  };

  // Memory configuration
  memory?: {
    backend?: 'agentdb' | 'sqlite' | 'hybrid';
    maxSize?: number;
    cacheEnabled?: boolean;
    cacheTTL?: number;
    vectorDimensions?: number;
  };

  // MCP configuration
  mcp?: {
    transport?: 'stdio' | 'http' | 'websocket' | 'in-process';
    host?: string;
    port?: number;
    enableMetrics?: boolean;
    enableCaching?: boolean;
  };

  // Performance configuration
  performance?: {
    flashAttention?: boolean;
    gnnEnhanced?: boolean;
    quantization?: boolean;
    optimization?: 'speed' | 'memory' | 'balanced';
  };

  // Security configuration
  security?: {
    enableAuth?: boolean;
    strictMode?: boolean;
    validateInputs?: boolean;
    rateLimiting?: boolean;
  };

  // Logging configuration
  logging?: {
    level?: 'debug' | 'info' | 'warn' | 'error';
    format?: 'json' | 'text';
    destination?: 'console' | 'file' | 'both';
  };

  // Custom fields
  [key: string]: unknown;
}

interface LoadConfigResult {
  config: Configuration;
  source: string;
  scope: string;
  loadedAt: string;
  defaults?: Configuration;
}

interface SaveConfigResult {
  saved: boolean;
  path: string;
  scope: string;
  savedAt: string;
  backupPath?: string;
}

interface ValidationIssue {
  field: string;
  issue: string;
  severity: 'error' | 'warning' | 'info';
  suggestion?: string;
}

interface ValidateConfigResult {
  valid: boolean;
  issues: ValidationIssue[];
  fixed?: boolean;
  fixedConfig?: Configuration;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: Configuration = {
  agents: {
    maxConcurrent: 15,
    defaultPriority: 'normal',
    timeout: 300000,
    retryAttempts: 3,
  },
  swarm: {
    topology: 'hierarchical-mesh',
    maxAgents: 15,
    communicationProtocol: 'message-bus',
    consensusMechanism: 'majority',
  },
  memory: {
    backend: 'hybrid',
    maxSize: 1000000,
    cacheEnabled: true,
    cacheTTL: 300000,
    vectorDimensions: 1536,
  },
  mcp: {
    transport: 'stdio',
    host: 'localhost',
    port: 3000,
    enableMetrics: true,
    enableCaching: true,
  },
  performance: {
    flashAttention: true,
    gnnEnhanced: true,
    quantization: false,
    optimization: 'balanced',
  },
  security: {
    enableAuth: false,
    strictMode: true,
    validateInputs: true,
    rateLimiting: true,
  },
  logging: {
    level: 'info',
    format: 'json',
    destination: 'console',
  },
};

// ============================================================================
// Tool Handlers
// ============================================================================

/**
 * Load configuration
 */
async function handleLoadConfig(
  input: z.infer<typeof loadConfigSchema>,
  context?: ToolContext
): Promise<LoadConfigResult> {
  const inputPath = input.path || './claude-flow.config.json';
  // Validate path to prevent traversal attacks
  const safePath = validateConfigPath(inputPath);
  const loadedAt = new Date().toISOString();

  let config: Configuration = { ...DEFAULT_CONFIG };

  // Try to load from filesystem
  try {
    const fs = await import('fs/promises');
    const fileContent = await fs.readFile(safePath, 'utf-8');
    const loadedConfig = JSON.parse(fileContent) as Configuration;

    if (input.merge) {
      // Merge with defaults
      config = { ...DEFAULT_CONFIG, ...loadedConfig };
    } else {
      config = loadedConfig;
    }
  } catch (error: any) {
    // If file doesn't exist, use defaults
    if (error.code !== 'ENOENT') {
      console.error('Failed to load config:', error);
    }
    // Continue with default config
  }

  const result: LoadConfigResult = {
    config,
    source: path,
    scope: input.scope,
    loadedAt,
  };

  if (input.includeDefaults) {
    result.defaults = DEFAULT_CONFIG;
  }

  return result;
}

/**
 * Save configuration
 */
async function handleSaveConfig(
  input: z.infer<typeof saveConfigSchema>,
  context?: ToolContext
): Promise<SaveConfigResult> {
  const inputPath = input.path || './claude-flow.config.json';
  // Validate path to prevent traversal attacks
  const safePath = validateConfigPath(inputPath);
  const savedAt = new Date().toISOString();
  let backupPath: string | undefined;

  try {
    const fs = await import('fs/promises');

    // Create backup if requested
    if (input.createBackup) {
      try {
        const existingContent = await fs.readFile(safePath, 'utf-8');
        backupPath = `${safePath}.backup.${Date.now()}`;
        await fs.writeFile(backupPath, existingContent, 'utf-8');
      } catch (error: any) {
        // Ignore if file doesn't exist
        if (error.code !== 'ENOENT') {
          console.error('Failed to create backup:', error);
        }
      }
    }

    // Merge with existing if requested
    let configToSave = input.config;
    if (input.merge) {
      try {
        const existingContent = await fs.readFile(safePath, 'utf-8');
        const existingConfig = JSON.parse(existingContent);
        configToSave = { ...existingConfig, ...input.config };
      } catch (error: any) {
        // If file doesn't exist, just save new config
        if (error.code !== 'ENOENT') {
          console.error('Failed to load existing config for merge:', error);
        }
      }
    }

    // Save the configuration
    await fs.writeFile(safePath, JSON.stringify(configToSave, null, 2), 'utf-8');

    return {
      saved: true,
      path: safePath,
      scope: input.scope,
      savedAt,
      backupPath,
    };
  } catch (error) {
    console.error('Failed to save config:', error);
    throw new Error(`Failed to save configuration: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Validate configuration
 */
async function handleValidateConfig(
  input: z.infer<typeof validateConfigSchema>,
  context?: ToolContext
): Promise<ValidateConfigResult> {
  const issues: ValidationIssue[] = [];

  // Stub validation logic
  const config = input.config as Configuration;

  // Validate agent configuration
  if (config.agents) {
    if (config.agents.maxConcurrent && (config.agents.maxConcurrent < 1 || config.agents.maxConcurrent > 1000)) {
      issues.push({
        field: 'agents.maxConcurrent',
        issue: 'Must be between 1 and 1000',
        severity: 'error',
        suggestion: 'Set to 15 (default)',
      });
    }
    if (config.agents.timeout && config.agents.timeout < 1000) {
      issues.push({
        field: 'agents.timeout',
        issue: 'Timeout should be at least 1000ms',
        severity: 'warning',
        suggestion: 'Increase to at least 1000ms',
      });
    }
  }

  // Validate swarm configuration
  if (config.swarm) {
    if (config.swarm.maxAgents && (config.swarm.maxAgents < 1 || config.swarm.maxAgents > 1000)) {
      issues.push({
        field: 'swarm.maxAgents',
        issue: 'Must be between 1 and 1000',
        severity: 'error',
        suggestion: 'Set to 15 (default)',
      });
    }
  }

  // Validate memory configuration
  if (config.memory) {
    if (config.memory.vectorDimensions && (config.memory.vectorDimensions < 1 || config.memory.vectorDimensions > 4096)) {
      issues.push({
        field: 'memory.vectorDimensions',
        issue: 'Must be between 1 and 4096',
        severity: 'error',
        suggestion: 'Set to 1536 (OpenAI standard)',
      });
    }
  }

  // Validate MCP configuration
  if (config.mcp) {
    if (config.mcp.port && (config.mcp.port < 1 || config.mcp.port > 65535)) {
      issues.push({
        field: 'mcp.port',
        issue: 'Port must be between 1 and 65535',
        severity: 'error',
        suggestion: 'Set to 3000 (default)',
      });
    }
  }

  // Check for unknown fields in strict mode
  if (input.strict) {
    const knownSections = ['agents', 'swarm', 'memory', 'mcp', 'performance', 'security', 'logging'];
    const unknownSections = Object.keys(config).filter(k => !knownSections.includes(k));

    unknownSections.forEach(section => {
      issues.push({
        field: section,
        issue: 'Unknown configuration section',
        severity: 'warning',
        suggestion: 'Remove this section or add to custom fields',
      });
    });
  }

  let fixedConfig: Configuration | undefined;
  let fixed = false;

  // Attempt to fix issues if requested
  if (input.fixIssues && issues.length > 0) {
    fixedConfig = { ...config };

    issues.forEach(issue => {
      if (issue.severity === 'error') {
        // Apply fixes based on suggestions
        const parts = issue.field.split('.');
        if (parts[0] === 'agents' && parts[1] === 'maxConcurrent') {
          fixedConfig!.agents!.maxConcurrent = 15;
          fixed = true;
        } else if (parts[0] === 'swarm' && parts[1] === 'maxAgents') {
          fixedConfig!.swarm!.maxAgents = 15;
          fixed = true;
        } else if (parts[0] === 'memory' && parts[1] === 'vectorDimensions') {
          fixedConfig!.memory!.vectorDimensions = 1536;
          fixed = true;
        } else if (parts[0] === 'mcp' && parts[1] === 'port') {
          fixedConfig!.mcp!.port = 3000;
          fixed = true;
        }
      }
    });
  }

  const result: ValidateConfigResult = {
    valid: issues.filter(i => i.severity === 'error').length === 0,
    issues,
  };

  if (fixed) {
    result.fixed = true;
    result.fixedConfig = fixedConfig;
  }

  return result;
}

// ============================================================================
// Tool Definitions
// ============================================================================

/**
 * config/load tool
 */
export const loadConfigTool: MCPTool = {
  name: 'config/load',
  description: 'Load configuration from file with optional merging and defaults',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Configuration file path',
      },
      scope: {
        type: 'string',
        enum: ['global', 'project', 'user'],
        description: 'Configuration scope',
        default: 'project',
      },
      merge: {
        type: 'boolean',
        description: 'Merge with default configuration',
        default: true,
      },
      includeDefaults: {
        type: 'boolean',
        description: 'Include default values in response',
        default: false,
      },
    },
  },
  handler: async (input, context) => {
    const validated = loadConfigSchema.parse(input);
    return handleLoadConfig(validated, context);
  },
  category: 'config',
  tags: ['config', 'load', 'settings'],
  version: '1.0.0',
  cacheable: true,
  cacheTTL: 10000,
};

/**
 * config/save tool
 */
export const saveConfigTool: MCPTool = {
  name: 'config/save',
  description: 'Save configuration to file with optional backup and merging',
  inputSchema: {
    type: 'object',
    properties: {
      config: {
        type: 'object',
        description: 'Configuration object to save',
        additionalProperties: true,
      },
      path: {
        type: 'string',
        description: 'Configuration file path',
      },
      scope: {
        type: 'string',
        enum: ['global', 'project', 'user'],
        description: 'Configuration scope',
        default: 'project',
      },
      merge: {
        type: 'boolean',
        description: 'Merge with existing configuration',
        default: true,
      },
      createBackup: {
        type: 'boolean',
        description: 'Create backup of existing configuration',
        default: true,
      },
    },
    required: ['config'],
  },
  handler: async (input, context) => {
    const validated = saveConfigSchema.parse(input);
    return handleSaveConfig(validated, context);
  },
  category: 'config',
  tags: ['config', 'save', 'settings'],
  version: '1.0.0',
};

/**
 * config/validate tool
 */
export const validateConfigTool: MCPTool = {
  name: 'config/validate',
  description: 'Validate configuration with optional auto-fix',
  inputSchema: {
    type: 'object',
    properties: {
      config: {
        type: 'object',
        description: 'Configuration object to validate',
        additionalProperties: true,
      },
      strict: {
        type: 'boolean',
        description: 'Enable strict validation',
        default: true,
      },
      fixIssues: {
        type: 'boolean',
        description: 'Attempt to automatically fix validation issues',
        default: false,
      },
    },
    required: ['config'],
  },
  handler: async (input, context) => {
    const validated = validateConfigSchema.parse(input);
    return handleValidateConfig(validated, context);
  },
  category: 'config',
  tags: ['config', 'validate', 'settings'],
  version: '1.0.0',
};

// ============================================================================
// Exports
// ============================================================================

export const configTools: MCPTool[] = [
  loadConfigTool,
  saveConfigTool,
  validateConfigTool,
];

export default configTools;
