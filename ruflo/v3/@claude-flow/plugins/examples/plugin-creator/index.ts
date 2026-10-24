/**
 * Plugin Creator Plugin
 *
 * A meta-plugin that creates new plugins with various configurations.
 * Demonstrates all plugin SDK capabilities including tools, hooks, workers,
 * swarm integration, and security features.
 *
 * @example
 * ```typescript
 * import { pluginCreatorPlugin } from '@claude-flow/plugins/examples/plugin-creator';
 * import { getDefaultRegistry } from '@claude-flow/plugins';
 *
 * await getDefaultRegistry().register(pluginCreatorPlugin);
 * ```
 */

import {
  PluginBuilder,
  MCPToolBuilder,
  HookBuilder,
  WorkerBuilder,
  HookEvent,
  HookPriority,
  WorkerFactory,
  Security,
  type PluginMetadata,
  type MCPToolDefinition,
  type HookDefinition,
  type WorkerDefinition,
  type AgentTypeDefinition,
  type IPlugin,
} from '../../src/index.js';

// ============================================================================
// Plugin Creator Types
// ============================================================================

export interface PluginTemplate {
  readonly name: string;
  readonly description: string;
  readonly category: 'tools' | 'hooks' | 'workers' | 'swarm' | 'full';
  readonly features: string[];
}

export interface CreatePluginOptions {
  readonly name: string;
  readonly version?: string;
  readonly description?: string;
  readonly author?: string;
  readonly template?: string;
  readonly features?: {
    tools?: boolean;
    hooks?: boolean;
    workers?: boolean;
    swarm?: boolean;
    security?: boolean;
    providers?: boolean;
  };
  readonly toolNames?: string[];
  readonly hookEvents?: HookEvent[];
  readonly workerTypes?: string[];
  readonly agentTypes?: string[];
}

export interface GeneratedPlugin {
  readonly plugin: IPlugin;
  readonly code: string;
  readonly metadata: PluginMetadata;
}

// ============================================================================
// Plugin Templates
// ============================================================================

export const PLUGIN_TEMPLATES: Record<string, PluginTemplate> = {
  'minimal': {
    name: 'Minimal Plugin',
    description: 'A bare-bones plugin with just metadata',
    category: 'tools',
    features: [],
  },
  'tool-plugin': {
    name: 'Tool Plugin',
    description: 'Plugin focused on MCP tools',
    category: 'tools',
    features: ['tools'],
  },
  'hooks-plugin': {
    name: 'Hooks Plugin',
    description: 'Plugin focused on lifecycle hooks',
    category: 'hooks',
    features: ['hooks'],
  },
  'worker-plugin': {
    name: 'Worker Plugin',
    description: 'Plugin with worker pool integration',
    category: 'workers',
    features: ['workers'],
  },
  'swarm-plugin': {
    name: 'Swarm Plugin',
    description: 'Plugin with swarm coordination capabilities',
    category: 'swarm',
    features: ['swarm', 'workers', 'hooks'],
  },
  'full-featured': {
    name: 'Full Featured Plugin',
    description: 'Complete plugin with all capabilities',
    category: 'full',
    features: ['tools', 'hooks', 'workers', 'swarm', 'security', 'providers'],
  },
  'security-focused': {
    name: 'Security Focused Plugin',
    description: 'Plugin with security features and validation',
    category: 'tools',
    features: ['tools', 'hooks', 'security'],
  },
};

// ============================================================================
// Code Generators
// ============================================================================

function generateToolCode(toolName: string): { definition: MCPToolDefinition; code: string } {
  const sanitizedName = Security.validateString(toolName, {
    pattern: /^[a-z][a-z0-9-]*$/,
    maxLength: 50,
  }) ?? 'custom-tool';

  const definition: MCPToolDefinition = {
    name: sanitizedName,
    description: `Generated tool: ${sanitizedName}`,
    inputSchema: {
      type: 'object',
      properties: {
        input: {
          type: 'string',
          description: 'Input for the tool',
        },
      },
      required: ['input'],
    },
    handler: async (params) => ({
      content: [{
        type: 'text',
        text: `Tool ${sanitizedName} executed with: ${JSON.stringify(params)}`,
      }],
    }),
  };

  const code = `
const ${camelCase(sanitizedName)}Tool = new MCPToolBuilder('${sanitizedName}')
  .withDescription('Generated tool: ${sanitizedName}')
  .addStringParam('input', 'Input for the tool', { required: true })
  .withHandler(async (params) => ({
    content: [{ type: 'text', text: \`Tool ${sanitizedName} executed with: \${JSON.stringify(params)}\` }]
  }))
  .build();
`;

  return { definition, code };
}

function generateHookCode(event: HookEvent): { definition: HookDefinition; code: string } {
  const definition: HookDefinition = {
    event,
    priority: HookPriority.Normal,
    name: `${event}-handler`,
    description: `Handler for ${event} event`,
    handler: async (ctx) => {
      console.log(`Hook triggered: ${event}`, ctx.data);
      return { success: true };
    },
  };

  const code = `
const ${camelCase(event)}Hook = new HookBuilder(HookEvent.${getEventEnumName(event)})
  .withName('${event}-handler')
  .withDescription('Handler for ${event} event')
  .withPriority(HookPriority.Normal)
  .withHandler(async (ctx) => {
    console.log('Hook triggered: ${event}', ctx.data);
    return { success: true };
  })
  .build();
`;

  return { definition, code };
}

function generateWorkerCode(workerType: string): { definition: WorkerDefinition; code: string } {
  const validTypes = ['coder', 'reviewer', 'tester', 'researcher', 'planner', 'coordinator', 'security', 'performance'];
  const type = validTypes.includes(workerType) ? workerType : 'specialized';

  let definition: WorkerDefinition;
  let factoryMethod: string;

  switch (type) {
    case 'coder':
      definition = WorkerFactory.createCoder(`${workerType}-worker`);
      factoryMethod = 'createCoder';
      break;
    case 'reviewer':
      definition = WorkerFactory.createReviewer(`${workerType}-worker`);
      factoryMethod = 'createReviewer';
      break;
    case 'tester':
      definition = WorkerFactory.createTester(`${workerType}-worker`);
      factoryMethod = 'createTester';
      break;
    case 'researcher':
      definition = WorkerFactory.createResearcher(`${workerType}-worker`);
      factoryMethod = 'createResearcher';
      break;
    case 'planner':
      definition = WorkerFactory.createPlanner(`${workerType}-worker`);
      factoryMethod = 'createPlanner';
      break;
    case 'coordinator':
      definition = WorkerFactory.createCoordinator(`${workerType}-worker`);
      factoryMethod = 'createCoordinator';
      break;
    case 'security':
      definition = WorkerFactory.createSecurity(`${workerType}-worker`);
      factoryMethod = 'createSecurity';
      break;
    case 'performance':
      definition = WorkerFactory.createPerformance(`${workerType}-worker`);
      factoryMethod = 'createPerformance';
      break;
    default:
      definition = WorkerFactory.createSpecialized(`${workerType}-worker`, ['custom']);
      factoryMethod = 'createSpecialized';
  }

  const code = factoryMethod === 'createSpecialized'
    ? `const ${camelCase(workerType)}Worker = WorkerFactory.${factoryMethod}('${workerType}-worker', ['custom']);`
    : `const ${camelCase(workerType)}Worker = WorkerFactory.${factoryMethod}('${workerType}-worker');`;

  return { definition, code };
}

function generateAgentTypeCode(agentType: string): { definition: AgentTypeDefinition; code: string } {
  const sanitizedType = Security.validateString(agentType, {
    pattern: /^[a-z][a-z0-9-]*$/,
    maxLength: 50,
  }) ?? 'custom-agent';

  const definition: AgentTypeDefinition = {
    type: sanitizedType,
    name: `${sanitizedType} Agent`,
    description: `Generated agent type: ${sanitizedType}`,
    capabilities: ['general'],
    model: 'claude-sonnet-4-20250514',
    systemPrompt: `You are a ${sanitizedType} agent.`,
  };

  const code = `
const ${camelCase(sanitizedType)}Agent: AgentTypeDefinition = {
  type: '${sanitizedType}',
  name: '${sanitizedType} Agent',
  description: 'Generated agent type: ${sanitizedType}',
  capabilities: ['general'],
  model: 'claude-sonnet-4-20250514',
  systemPrompt: 'You are a ${sanitizedType} agent.',
};
`;

  return { definition, code };
}

// ============================================================================
// Plugin Generator
// ============================================================================

export function generatePlugin(options: CreatePluginOptions): GeneratedPlugin {
  const {
    name,
    version = '1.0.0',
    description = `Generated plugin: ${name}`,
    author = 'Plugin Creator',
    template = 'minimal',
    features = {},
    toolNames = [],
    hookEvents = [],
    workerTypes = [],
    agentTypes = [],
  } = options;

  // Validate plugin name
  const validName = Security.validateString(name, {
    pattern: /^[a-z][a-z0-9-]*$/,
    minLength: 3,
    maxLength: 50,
  });

  if (!validName) {
    throw new Error('Invalid plugin name. Use lowercase letters, numbers, and hyphens.');
  }

  // Get template features
  const templateConfig = PLUGIN_TEMPLATES[template] ?? PLUGIN_TEMPLATES['minimal'];
  const enabledFeatures = {
    tools: features.tools ?? templateConfig.features.includes('tools'),
    hooks: features.hooks ?? templateConfig.features.includes('hooks'),
    workers: features.workers ?? templateConfig.features.includes('workers'),
    swarm: features.swarm ?? templateConfig.features.includes('swarm'),
    security: features.security ?? templateConfig.features.includes('security'),
    providers: features.providers ?? templateConfig.features.includes('providers'),
  };

  // Generate components
  const tools: MCPToolDefinition[] = [];
  const hooks: HookDefinition[] = [];
  const workers: WorkerDefinition[] = [];
  const agents: AgentTypeDefinition[] = [];
  const codeBlocks: string[] = [];

  // Import statements
  codeBlocks.push(`import {
  PluginBuilder,${enabledFeatures.tools ? '\n  MCPToolBuilder,' : ''}${enabledFeatures.hooks ? '\n  HookBuilder,\n  HookEvent,\n  HookPriority,' : ''}${enabledFeatures.workers ? '\n  WorkerFactory,' : ''}${enabledFeatures.security ? '\n  Security,' : ''}
  type IPlugin,${enabledFeatures.workers ? '\n  type WorkerDefinition,' : ''}${agents.length > 0 ? '\n  type AgentTypeDefinition,' : ''}
} from '@claude-flow/plugins';
`);

  // Generate tools
  if (enabledFeatures.tools) {
    const defaultTools = toolNames.length > 0 ? toolNames : ['default-tool'];
    for (const toolName of defaultTools) {
      const { definition, code } = generateToolCode(toolName);
      tools.push(definition);
      codeBlocks.push(code);
    }
  }

  // Generate hooks
  if (enabledFeatures.hooks) {
    const defaultEvents = hookEvents.length > 0 ? hookEvents : [HookEvent.SessionStart, HookEvent.PostTaskComplete];
    for (const event of defaultEvents) {
      const { definition, code } = generateHookCode(event);
      hooks.push(definition);
      codeBlocks.push(code);
    }
  }

  // Generate workers
  if (enabledFeatures.workers) {
    const defaultWorkers = workerTypes.length > 0 ? workerTypes : ['coder', 'tester'];
    for (const workerType of defaultWorkers) {
      const { definition, code } = generateWorkerCode(workerType);
      workers.push(definition);
      codeBlocks.push(code);
    }
  }

  // Generate agents (for swarm plugins)
  if (enabledFeatures.swarm) {
    const defaultAgents = agentTypes.length > 0 ? agentTypes : ['coordinator', 'worker'];
    for (const agentType of defaultAgents) {
      const { definition, code } = generateAgentTypeCode(agentType);
      agents.push(definition);
      codeBlocks.push(code);
    }
  }

  // Build the plugin
  const builder = new PluginBuilder(validName, version)
    .withDescription(description)
    .withAuthor(author);

  if (tools.length > 0) builder.withMCPTools(tools);
  if (hooks.length > 0) builder.withHooks(hooks);
  if (workers.length > 0) builder.withWorkers(workers);
  if (agents.length > 0) builder.withAgentTypes(agents);

  const plugin = builder.build();

  // Generate plugin builder code
  codeBlocks.push(`
// Create the plugin
const ${camelCase(validName)}Plugin = new PluginBuilder('${validName}', '${version}')
  .withDescription('${description}')
  .withAuthor('${author}')${tools.length > 0 ? `
  .withMCPTools([${tools.map(t => camelCase(t.name) + 'Tool').join(', ')}])` : ''}${hooks.length > 0 ? `
  .withHooks([${hooks.map(h => camelCase(h.event) + 'Hook').join(', ')}])` : ''}${workers.length > 0 ? `
  .withWorkers([${workers.map(w => camelCase(w.name.replace('-worker', '')) + 'Worker').join(', ')}])` : ''}${agents.length > 0 ? `
  .withAgentTypes([${agents.map(a => camelCase(a.type) + 'Agent').join(', ')}])` : ''}
  .build();

export default ${camelCase(validName)}Plugin;
`);

  return {
    plugin,
    code: codeBlocks.join('\n'),
    metadata: plugin.metadata,
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

function camelCase(str: string): string {
  return str
    .replace(/[^a-zA-Z0-9]+(.)/g, (_, chr) => chr.toUpperCase())
    .replace(/^./, (chr) => chr.toLowerCase());
}

function getEventEnumName(event: HookEvent): string {
  // Mapping from HookEvent enum values to their TypeScript enum names
  const mapping: Record<string, string> = {
    // Tool lifecycle (from types/index.ts HookEvent enum)
    'hook:pre-tool-use': 'PreToolUse',
    'hook:post-tool-use': 'PostToolUse',
    // Session lifecycle
    'hook:session-start': 'SessionStart',
    'hook:session-end': 'SessionEnd',
    'hook:session-restore': 'SessionRestore',
    // Task execution
    'hook:pre-task-execute': 'PreTaskExecute',
    'hook:post-task-complete': 'PostTaskComplete',
    'hook:task-failed': 'TaskFailed',
    // File operations
    'hook:pre-file-write': 'PreFileWrite',
    'hook:post-file-write': 'PostFileWrite',
    'hook:pre-file-delete': 'PreFileDelete',
    // Command execution
    'hook:pre-command': 'PreCommand',
    'hook:post-command': 'PostCommand',
    // Agent operations
    'hook:agent-spawned': 'AgentSpawned',
    'hook:agent-terminated': 'AgentTerminated',
    // Memory operations
    'hook:pre-memory-store': 'PreMemoryStore',
    'hook:post-memory-store': 'PostMemoryStore',
    // Learning
    'hook:pattern-detected': 'PatternDetected',
    'hook:strategy-updated': 'StrategyUpdated',
    // Plugin lifecycle
    'hook:plugin-loaded': 'PluginLoaded',
    'hook:plugin-unloaded': 'PluginUnloaded',
  };
  return mapping[event] ?? event;
}

// ============================================================================
// Plugin Creator Plugin
// ============================================================================

/**
 * The Plugin Creator Plugin itself - demonstrates all capabilities.
 */
export const pluginCreatorPlugin = new PluginBuilder('plugin-creator', '1.0.0')
  .withDescription('A meta-plugin that creates new plugins with various configurations')
  .withAuthor('Claude Flow Team')
  .withTags(['meta', 'generator', 'developer-tools'])
  .withMCPTools([
    // Tool: Create Plugin
    new MCPToolBuilder('create-plugin')
      .withDescription('Create a new plugin with specified options')
      .addStringParam('name', 'Plugin name (lowercase, hyphens allowed)', { required: true })
      .addStringParam('version', 'Plugin version', { default: '1.0.0' })
      .addStringParam('description', 'Plugin description')
      .addStringParam('template', 'Template to use', {
        enum: Object.keys(PLUGIN_TEMPLATES),
        default: 'minimal',
      })
      .addBooleanParam('includeTools', 'Include MCP tools', { default: false })
      .addBooleanParam('includeHooks', 'Include lifecycle hooks', { default: false })
      .addBooleanParam('includeWorkers', 'Include workers', { default: false })
      .addBooleanParam('includeSwarm', 'Include swarm capabilities', { default: false })
      .withHandler(async (params) => {
        try {
          const result = generatePlugin({
            name: params.name as string,
            version: params.version as string,
            description: params.description as string,
            template: params.template as string,
            features: {
              tools: params.includeTools as boolean,
              hooks: params.includeHooks as boolean,
              workers: params.includeWorkers as boolean,
              swarm: params.includeSwarm as boolean,
            },
          });

          return {
            content: [{
              type: 'text',
              text: `✅ Plugin "${result.metadata.name}" created successfully!\n\n` +
                `**Metadata:**\n` +
                `- Name: ${result.metadata.name}\n` +
                `- Version: ${result.metadata.version}\n` +
                `- Description: ${result.metadata.description}\n\n` +
                `**Generated Code:**\n\`\`\`typescript\n${result.code}\n\`\`\``,
            }],
          };
        } catch (error) {
          return {
            content: [{
              type: 'text',
              text: `❌ Error creating plugin: ${error instanceof Error ? error.message : String(error)}`,
            }],
            isError: true,
          };
        }
      })
      .build(),

    // Tool: List Templates
    new MCPToolBuilder('list-plugin-templates')
      .withDescription('List available plugin templates')
      .withHandler(async () => {
        const templateList = Object.entries(PLUGIN_TEMPLATES)
          .map(([key, tmpl]) =>
            `- **${key}**: ${tmpl.name}\n  ${tmpl.description}\n  Features: ${tmpl.features.join(', ') || 'none'}`
          )
          .join('\n\n');

        return {
          content: [{
            type: 'text',
            text: `📦 **Available Plugin Templates:**\n\n${templateList}`,
          }],
        };
      })
      .build(),

    // Tool: Generate Tool
    new MCPToolBuilder('generate-tool')
      .withDescription('Generate a single MCP tool definition')
      .addStringParam('name', 'Tool name', { required: true })
      .addStringParam('description', 'Tool description')
      .addStringParam('params', 'Comma-separated parameter names')
      .withHandler(async (params) => {
        const { definition, code } = generateToolCode(params.name as string);

        return {
          content: [{
            type: 'text',
            text: `🔧 **Generated Tool: ${definition.name}**\n\n` +
              `**Code:**\n\`\`\`typescript\n${code}\n\`\`\``,
          }],
        };
      })
      .build(),

    // Tool: Generate Hook
    new MCPToolBuilder('generate-hook')
      .withDescription('Generate a lifecycle hook definition')
      .addStringParam('event', 'Hook event type', {
        required: true,
        enum: Object.values(HookEvent),
      })
      .addStringParam('priority', 'Hook priority', {
        enum: ['Critical', 'High', 'Normal', 'Low', 'Deferred'],
        default: 'Normal',
      })
      .withHandler(async (params) => {
        const { definition, code } = generateHookCode(params.event as HookEvent);

        return {
          content: [{
            type: 'text',
            text: `🎣 **Generated Hook: ${definition.name}**\n\n` +
              `Event: ${definition.event}\n` +
              `Priority: ${definition.priority}\n\n` +
              `**Code:**\n\`\`\`typescript\n${code}\n\`\`\``,
          }],
        };
      })
      .build(),

    // Tool: Generate Worker
    new MCPToolBuilder('generate-worker')
      .withDescription('Generate a worker definition')
      .addStringParam('type', 'Worker type', {
        required: true,
        enum: ['coder', 'reviewer', 'tester', 'researcher', 'planner', 'coordinator', 'security', 'performance', 'specialized'],
      })
      .addStringParam('capabilities', 'Comma-separated capabilities')
      .withHandler(async (params) => {
        const { definition, code } = generateWorkerCode(params.type as string);

        return {
          content: [{
            type: 'text',
            text: `👷 **Generated Worker: ${definition.name}**\n\n` +
              `Type: ${definition.type}\n` +
              `Capabilities: ${definition.capabilities.join(', ')}\n` +
              `Max Concurrent Tasks: ${definition.maxConcurrentTasks}\n` +
              `Timeout: ${definition.timeout}ms\n\n` +
              `**Code:**\n\`\`\`typescript\n${code}\n\`\`\``,
          }],
        };
      })
      .build(),
  ])
  .withHooks([
    // Hook: Log plugin creation
    new HookBuilder(HookEvent.PostToolUse)
      .withName('plugin-creator-logger')
      .withDescription('Log plugin creation events')
      .withPriority(HookPriority.Low)
      .withHandler(async (ctx) => {
        const data = ctx.data as { toolName?: string } | undefined;
        // Only log if this is from the create-plugin tool
        if (data?.toolName === 'create-plugin') {
          console.log('[Plugin Creator] Plugin created:', ctx.data);
        }
        return { success: true };
      })
      .build(),
  ])
  .withWorkers([
    WorkerFactory.createCoder('plugin-code-generator', ['code-generation', 'typescript']),
  ])
  .onInitialize(async (ctx) => {
    ctx.logger.info('Plugin Creator initialized');
    ctx.logger.info(`Available templates: ${Object.keys(PLUGIN_TEMPLATES).join(', ')}`);
  })
  .build();

// ============================================================================
// Exports
// ============================================================================

export default pluginCreatorPlugin;

export {
  generateToolCode,
  generateHookCode,
  generateWorkerCode,
  generateAgentTypeCode,
};
