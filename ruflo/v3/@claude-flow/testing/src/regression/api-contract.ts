/**
 * API Contract Validator
 *
 * Validates MCP tool interfaces to detect breaking changes.
 *
 * @module v3/testing/regression/api-contract
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';

/**
 * Contract definition for a tool or endpoint
 */
export interface ContractDefinition {
  name: string;
  version: string;
  description: string;
  input: ParameterSchema;
  output: ParameterSchema;
  required: string[];
  optional: string[];
  errors: ErrorDefinition[];
}

/**
 * Parameter schema definition
 */
interface ParameterSchema {
  type: string;
  properties?: Record<string, PropertyDefinition>;
  items?: PropertyDefinition;
  required?: string[];
}

/**
 * Property definition
 */
interface PropertyDefinition {
  type: string;
  description?: string;
  enum?: string[];
  default?: unknown;
  properties?: Record<string, PropertyDefinition>;
  items?: PropertyDefinition;
}

/**
 * Error definition
 */
interface ErrorDefinition {
  code: number;
  message: string;
  description: string;
}

/**
 * Contract validation result
 */
export interface ContractValidation {
  endpoint: string;
  valid: boolean;
  breaking: boolean;
  message: string;
  diffs: ContractDiff[];
}

/**
 * Contract difference
 */
export interface ContractDiff {
  type: 'added' | 'removed' | 'changed' | 'deprecated';
  path: string;
  description: string;
  breaking: boolean;
  oldValue?: unknown;
  newValue?: unknown;
}

/**
 * Stored contracts
 */
interface StoredContracts {
  version: string;
  capturedAt: number;
  contracts: ContractDefinition[];
}

/**
 * MCP tool definitions to validate
 */
const MCP_TOOLS: ContractDefinition[] = [
  {
    name: 'agent/spawn',
    version: '1.0.0',
    description: 'Spawn a new agent',
    input: {
      type: 'object',
      properties: {
        agentType: { type: 'string', description: 'Type of agent to spawn' },
        id: { type: 'string', description: 'Optional agent ID' },
        config: { type: 'object', description: 'Agent configuration' },
        priority: { type: 'string', enum: ['low', 'normal', 'high', 'critical'] },
        metadata: { type: 'object', description: 'Additional metadata' },
      },
      required: ['agentType'],
    },
    output: {
      type: 'object',
      properties: {
        agentId: { type: 'string' },
        status: { type: 'string' },
        createdAt: { type: 'string' },
      },
    },
    required: ['agentType'],
    optional: ['id', 'config', 'priority', 'metadata'],
    errors: [
      { code: -32602, message: 'Invalid agent type', description: 'The specified agent type is not valid' },
      { code: -32000, message: 'Agent spawn failed', description: 'Failed to spawn agent' },
    ],
  },
  {
    name: 'agent/list',
    version: '1.0.0',
    description: 'List all agents',
    input: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['active', 'idle', 'terminated', 'all'] },
        agentType: { type: 'string' },
      },
    },
    output: {
      type: 'object',
      properties: {
        agents: { type: 'array', items: { type: 'object' } },
        totalCount: { type: 'number' },
      },
    },
    required: [],
    optional: ['status', 'agentType'],
    errors: [],
  },
  {
    name: 'memory/store',
    version: '1.0.0',
    description: 'Store a memory entry',
    input: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'Memory content' },
        category: { type: 'string', description: 'Memory category' },
        metadata: { type: 'object', description: 'Additional metadata' },
        tags: { type: 'array', items: { type: 'string' } },
        ttl: { type: 'number', description: 'Time-to-live in seconds' },
      },
      required: ['content'],
    },
    output: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        storedAt: { type: 'string' },
        expiresAt: { type: 'string' },
      },
    },
    required: ['content'],
    optional: ['category', 'metadata', 'tags', 'ttl'],
    errors: [
      { code: -32000, message: 'Storage failed', description: 'Failed to store memory' },
    ],
  },
  {
    name: 'memory/search',
    version: '1.0.0',
    description: 'Search memory entries',
    input: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        category: { type: 'string' },
        limit: { type: 'number', default: 10 },
        threshold: { type: 'number', default: 0.7 },
        semantic: { type: 'boolean', default: true },
      },
      required: ['query'],
    },
    output: {
      type: 'object',
      properties: {
        results: { type: 'array', items: { type: 'object' } },
        totalMatches: { type: 'number' },
        searchTime: { type: 'number' },
      },
    },
    required: ['query'],
    optional: ['category', 'limit', 'threshold', 'semantic'],
    errors: [],
  },
  {
    name: 'swarm/init',
    version: '1.0.0',
    description: 'Initialize a swarm',
    input: {
      type: 'object',
      properties: {
        topology: { type: 'string', enum: ['hierarchical', 'mesh', 'star', 'ring', 'adaptive'] },
        maxAgents: { type: 'number' },
        config: { type: 'object' },
      },
      required: ['topology'],
    },
    output: {
      type: 'object',
      properties: {
        swarmId: { type: 'string' },
        status: { type: 'string' },
        topology: { type: 'string' },
      },
    },
    required: ['topology'],
    optional: ['maxAgents', 'config'],
    errors: [
      { code: -32602, message: 'Invalid topology', description: 'The specified topology is not valid' },
    ],
  },
  {
    name: 'task/orchestrate',
    version: '1.0.0',
    description: 'Orchestrate a complex task',
    input: {
      type: 'object',
      properties: {
        description: { type: 'string' },
        strategy: { type: 'string', enum: ['sequential', 'parallel', 'adaptive'] },
        maxAgents: { type: 'number' },
        timeout: { type: 'number' },
      },
      required: ['description'],
    },
    output: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        phases: { type: 'array' },
        estimatedDuration: { type: 'number' },
      },
    },
    required: ['description'],
    optional: ['strategy', 'maxAgents', 'timeout'],
    errors: [],
  },
];

/**
 * API Contract Validator
 *
 * Validates MCP tool contracts for breaking changes.
 */
export class APIContractValidator {
  private readonly contractPath: string;
  private cachedContracts: StoredContracts | null = null;

  constructor(basePath: string = '.regression-baselines') {
    this.contractPath = join(basePath, 'contracts.json');
  }

  /**
   * Capture current contracts as baseline
   */
  async captureContracts(): Promise<StoredContracts> {
    const contracts: StoredContracts = {
      version: '1.0.0',
      capturedAt: Date.now(),
      contracts: MCP_TOOLS,
    };

    await this.saveContracts(contracts);
    this.cachedContracts = contracts;

    return contracts;
  }

  /**
   * Validate all contracts against baseline
   */
  async validateAll(): Promise<ContractValidation[]> {
    const baseline = await this.loadContracts();
    if (!baseline) {
      console.warn('No contract baseline found. Capturing initial contracts...');
      await this.captureContracts();
      return [];
    }

    const validations: ContractValidation[] = [];

    for (const current of MCP_TOOLS) {
      const baselineContract = baseline.contracts.find((c) => c.name === current.name);

      if (!baselineContract) {
        // New endpoint added
        validations.push({
          endpoint: current.name,
          valid: true,
          breaking: false,
          message: 'New endpoint added',
          diffs: [{
            type: 'added',
            path: current.name,
            description: `New endpoint: ${current.description}`,
            breaking: false,
          }],
        });
        continue;
      }

      const diffs = this.compareContracts(baselineContract, current);
      const hasBreakingChanges = diffs.some((d) => d.breaking);

      validations.push({
        endpoint: current.name,
        valid: !hasBreakingChanges,
        breaking: hasBreakingChanges,
        message: hasBreakingChanges
          ? `Breaking changes detected: ${diffs.filter((d) => d.breaking).map((d) => d.description).join(', ')}`
          : diffs.length > 0
            ? `Non-breaking changes: ${diffs.map((d) => d.description).join(', ')}`
            : 'No changes',
        diffs,
      });
    }

    // Check for removed endpoints
    for (const baselineContract of baseline.contracts) {
      const stillExists = MCP_TOOLS.find((c) => c.name === baselineContract.name);
      if (!stillExists) {
        validations.push({
          endpoint: baselineContract.name,
          valid: false,
          breaking: true,
          message: 'Endpoint removed',
          diffs: [{
            type: 'removed',
            path: baselineContract.name,
            description: `Endpoint removed: ${baselineContract.name}`,
            breaking: true,
          }],
        });
      }
    }

    return validations;
  }

  /**
   * Compare two contracts for differences
   */
  private compareContracts(baseline: ContractDefinition, current: ContractDefinition): ContractDiff[] {
    const diffs: ContractDiff[] = [];

    // Check required parameters
    for (const param of baseline.required) {
      if (!current.required.includes(param)) {
        if (current.optional.includes(param)) {
          // Parameter became optional - not breaking
          diffs.push({
            type: 'changed',
            path: `${baseline.name}.input.${param}`,
            description: `Parameter '${param}' changed from required to optional`,
            breaking: false,
            oldValue: 'required',
            newValue: 'optional',
          });
        } else {
          // Parameter removed - breaking
          diffs.push({
            type: 'removed',
            path: `${baseline.name}.input.${param}`,
            description: `Required parameter '${param}' removed`,
            breaking: true,
          });
        }
      }
    }

    // Check for new required parameters (breaking)
    for (const param of current.required) {
      if (!baseline.required.includes(param) && !baseline.optional.includes(param)) {
        diffs.push({
          type: 'added',
          path: `${baseline.name}.input.${param}`,
          description: `New required parameter '${param}' added`,
          breaking: true,
        });
      }
    }

    // Check for new optional parameters (not breaking)
    for (const param of current.optional) {
      if (!baseline.required.includes(param) && !baseline.optional.includes(param)) {
        diffs.push({
          type: 'added',
          path: `${baseline.name}.input.${param}`,
          description: `New optional parameter '${param}' added`,
          breaking: false,
        });
      }
    }

    // Check input schema changes
    if (baseline.input.properties && current.input.properties) {
      for (const [name, prop] of Object.entries(baseline.input.properties)) {
        const currentProp = current.input.properties[name];
        if (currentProp) {
          // Check type changes
          if (prop.type !== currentProp.type) {
            diffs.push({
              type: 'changed',
              path: `${baseline.name}.input.${name}.type`,
              description: `Type of '${name}' changed from '${prop.type}' to '${currentProp.type}'`,
              breaking: true,
              oldValue: prop.type,
              newValue: currentProp.type,
            });
          }

          // Check enum changes
          if (prop.enum && currentProp.enum) {
            const removedValues = prop.enum.filter((v) => !currentProp.enum!.includes(v));
            if (removedValues.length > 0) {
              diffs.push({
                type: 'changed',
                path: `${baseline.name}.input.${name}.enum`,
                description: `Enum values removed from '${name}': ${removedValues.join(', ')}`,
                breaking: true,
                oldValue: prop.enum,
                newValue: currentProp.enum,
              });
            }
          }
        }
      }
    }

    return diffs;
  }

  /**
   * Load contracts from file
   */
  private async loadContracts(): Promise<StoredContracts | null> {
    if (this.cachedContracts) {
      return this.cachedContracts;
    }

    try {
      const content = await readFile(this.contractPath, 'utf-8');
      this.cachedContracts = JSON.parse(content);
      return this.cachedContracts;
    } catch {
      return null;
    }
  }

  /**
   * Save contracts to file
   */
  private async saveContracts(contracts: StoredContracts): Promise<void> {
    await mkdir(dirname(this.contractPath), { recursive: true });
    await writeFile(this.contractPath, JSON.stringify(contracts, null, 2));
  }
}
