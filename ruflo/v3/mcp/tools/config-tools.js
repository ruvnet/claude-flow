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
// Default Configuration
// ============================================================================
const DEFAULT_CONFIG = {
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
async function handleLoadConfig(input, context) {
    const path = input.path || './claude-flow.config.json';
    const loadedAt = new Date().toISOString();
    let config = { ...DEFAULT_CONFIG };
    // Try to load from filesystem
    try {
        const fs = await import('fs/promises');
        const fileContent = await fs.readFile(path, 'utf-8');
        const loadedConfig = JSON.parse(fileContent);
        if (input.merge) {
            // Merge with defaults
            config = { ...DEFAULT_CONFIG, ...loadedConfig };
        }
        else {
            config = loadedConfig;
        }
    }
    catch (error) {
        // If file doesn't exist, use defaults
        if (error.code !== 'ENOENT') {
            console.error('Failed to load config:', error);
        }
        // Continue with default config
    }
    const result = {
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
async function handleSaveConfig(input, context) {
    const path = input.path || './claude-flow.config.json';
    const savedAt = new Date().toISOString();
    let backupPath;
    try {
        const fs = await import('fs/promises');
        // Create backup if requested
        if (input.createBackup) {
            try {
                const existingContent = await fs.readFile(path, 'utf-8');
                backupPath = `${path}.backup.${Date.now()}`;
                await fs.writeFile(backupPath, existingContent, 'utf-8');
            }
            catch (error) {
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
                const existingContent = await fs.readFile(path, 'utf-8');
                const existingConfig = JSON.parse(existingContent);
                configToSave = { ...existingConfig, ...input.config };
            }
            catch (error) {
                // If file doesn't exist, just save new config
                if (error.code !== 'ENOENT') {
                    console.error('Failed to load existing config for merge:', error);
                }
            }
        }
        // Save the configuration
        await fs.writeFile(path, JSON.stringify(configToSave, null, 2), 'utf-8');
        return {
            saved: true,
            path,
            scope: input.scope,
            savedAt,
            backupPath,
        };
    }
    catch (error) {
        console.error('Failed to save config:', error);
        throw new Error(`Failed to save configuration: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}
/**
 * Validate configuration
 */
async function handleValidateConfig(input, context) {
    const issues = [];
    // Stub validation logic
    const config = input.config;
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
    let fixedConfig;
    let fixed = false;
    // Attempt to fix issues if requested
    if (input.fixIssues && issues.length > 0) {
        fixedConfig = { ...config };
        issues.forEach(issue => {
            if (issue.severity === 'error') {
                // Apply fixes based on suggestions
                const parts = issue.field.split('.');
                if (parts[0] === 'agents' && parts[1] === 'maxConcurrent') {
                    fixedConfig.agents.maxConcurrent = 15;
                    fixed = true;
                }
                else if (parts[0] === 'swarm' && parts[1] === 'maxAgents') {
                    fixedConfig.swarm.maxAgents = 15;
                    fixed = true;
                }
                else if (parts[0] === 'memory' && parts[1] === 'vectorDimensions') {
                    fixedConfig.memory.vectorDimensions = 1536;
                    fixed = true;
                }
                else if (parts[0] === 'mcp' && parts[1] === 'port') {
                    fixedConfig.mcp.port = 3000;
                    fixed = true;
                }
            }
        });
    }
    const result = {
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
export const loadConfigTool = {
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
export const saveConfigTool = {
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
export const validateConfigTool = {
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
export const configTools = [
    loadConfigTool,
    saveConfigTool,
    validateConfigTool,
];
export default configTools;
//# sourceMappingURL=config-tools.js.map