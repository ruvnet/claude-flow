/**
 * SDK Builder Tests
 */

import { describe, it, expect } from 'vitest';
import {
  PluginBuilder,
  MCPToolBuilder,
  HookBuilder,
  WorkerBuilder,
  createToolPlugin,
  createHooksPlugin,
  createWorkerPlugin,
} from '../src/sdk/index.js';
import { HookEvent, HookPriority } from '../src/types/index.js';

describe('PluginBuilder', () => {
  it('should create a basic plugin', () => {
    const plugin = new PluginBuilder('test-plugin', '1.0.0')
      .withDescription('A test plugin')
      .build();

    expect(plugin.metadata.name).toBe('test-plugin');
    expect(plugin.metadata.version).toBe('1.0.0');
    expect(plugin.metadata.description).toBe('A test plugin');
    expect(plugin.state).toBe('uninitialized');
  });

  it('should add all metadata fields', () => {
    const plugin = new PluginBuilder('full-plugin', '2.0.0')
      .withDescription('Full metadata test')
      .withAuthor('Test Author')
      .withLicense('MIT')
      .withRepository('https://github.com/test/repo')
      .withDependencies(['dep1', 'dep2'])
      .withTags(['test', 'demo'])
      .withMinCoreVersion('3.0.0')
      .build();

    expect(plugin.metadata.author).toBe('Test Author');
    expect(plugin.metadata.license).toBe('MIT');
    expect(plugin.metadata.repository).toBe('https://github.com/test/repo');
    expect(plugin.metadata.dependencies).toEqual(['dep1', 'dep2']);
    expect(plugin.metadata.tags).toEqual(['test', 'demo']);
    expect(plugin.metadata.minCoreVersion).toBe('3.0.0');
  });

  it('should add MCP tools', () => {
    const plugin = new PluginBuilder('tool-plugin', '1.0.0')
      .withMCPTools([
        {
          name: 'test-tool',
          description: 'A test tool',
          inputSchema: { type: 'object', properties: {} },
          handler: async () => ({ content: [{ type: 'text', text: 'done' }] }),
        },
      ])
      .build();

    const tools = plugin.registerMCPTools?.();
    expect(tools).toHaveLength(1);
    expect(tools?.[0].name).toBe('test-tool');
  });

  it('should add hooks', () => {
    const plugin = new PluginBuilder('hook-plugin', '1.0.0')
      .withHooks([
        {
          event: HookEvent.PostTaskComplete,
          handler: async () => ({ success: true }),
          priority: HookPriority.High,
        },
      ])
      .build();

    const hooks = plugin.registerHooks?.();
    expect(hooks).toHaveLength(1);
    expect(hooks?.[0].event).toBe(HookEvent.PostTaskComplete);
  });

  it('should add workers', () => {
    const plugin = new PluginBuilder('worker-plugin', '1.0.0')
      .withWorkers([
        {
          type: 'coder',
          name: 'test-coder',
          capabilities: ['code-generation'],
        },
      ])
      .build();

    const workers = plugin.registerWorkers?.();
    expect(workers).toHaveLength(1);
    expect(workers?.[0].name).toBe('test-coder');
  });

  it('should call lifecycle handlers', async () => {
    let initCalled = false;
    let shutdownCalled = false;

    const plugin = new PluginBuilder('lifecycle-plugin', '1.0.0')
      .onInitialize(async () => {
        initCalled = true;
      })
      .onShutdown(async () => {
        shutdownCalled = true;
      })
      .build();

    // Create minimal context
    const context = {
      config: { enabled: true, priority: 50, settings: {} },
      eventBus: { emit: () => {}, on: () => () => {}, off: () => {}, once: () => () => {} },
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, child: () => ({} as any) },
      services: { get: () => undefined, set: () => {}, has: () => false, delete: () => false },
      coreVersion: '3.0.0',
      dataDir: '/tmp',
    };

    await plugin.initialize(context);
    expect(initCalled).toBe(true);

    await plugin.shutdown();
    expect(shutdownCalled).toBe(true);
  });
});

describe('MCPToolBuilder', () => {
  it('should build a tool with parameters', async () => {
    const tool = new MCPToolBuilder('greet')
      .withDescription('Greet someone')
      .addStringParam('name', 'The name to greet', { required: true })
      .addNumberParam('times', 'How many times to greet', { default: 1, minimum: 1 })
      .addBooleanParam('formal', 'Use formal greeting', { default: false })
      .withHandler(async (input) => ({
        content: [{ type: 'text', text: `Hello, ${input.name}!` }],
      }))
      .build();

    expect(tool.name).toBe('greet');
    expect(tool.description).toBe('Greet someone');
    expect(tool.inputSchema.properties.name).toBeDefined();
    expect(tool.inputSchema.required).toContain('name');

    const result = await tool.handler({ name: 'World' });
    expect(result.content[0].text).toBe('Hello, World!');
  });

  it('should support array parameters', () => {
    const tool = new MCPToolBuilder('process')
      .withDescription('Process items')
      .addArrayParam('items', 'Items to process', { type: 'string' }, { required: true })
      .withHandler(async () => ({ content: [{ type: 'text', text: 'done' }] }))
      .build();

    expect(tool.inputSchema.properties.items.type).toBe('array');
    expect(tool.inputSchema.required).toContain('items');
  });

  it('should support object parameters', () => {
    const tool = new MCPToolBuilder('configure')
      .withDescription('Configure settings')
      .addObjectParam(
        'settings',
        'Configuration settings',
        {
          type: 'object',
          properties: {
            debug: { type: 'boolean' },
            level: { type: 'number' },
          },
        },
        { required: true }
      )
      .withHandler(async () => ({ content: [{ type: 'text', text: 'configured' }] }))
      .build();

    expect(tool.inputSchema.properties.settings).toBeDefined();
  });

  it('should throw without handler', () => {
    expect(() => {
      new MCPToolBuilder('no-handler')
        .withDescription('Missing handler')
        .build();
    }).toThrow('requires a handler');
  });
});

describe('HookBuilder', () => {
  it('should build a hook with conditions', async () => {
    let executed = false;

    const hook = new HookBuilder(HookEvent.PostTaskComplete)
      .withName('conditional-hook')
      .withDescription('Conditional hook test')
      .withPriority(HookPriority.High)
      .when((ctx) => (ctx.data as any)?.shouldRun === true)
      .handle(async () => {
        executed = true;
        return { success: true };
      })
      .build();

    // Should not execute when condition is false
    await hook.handler({
      event: HookEvent.PostTaskComplete,
      data: { shouldRun: false },
      timestamp: new Date(),
    });
    expect(executed).toBe(false);

    // Should execute when condition is true
    await hook.handler({
      event: HookEvent.PostTaskComplete,
      data: { shouldRun: true },
      timestamp: new Date(),
    });
    expect(executed).toBe(true);
  });

  it('should apply transformers', async () => {
    const hook = new HookBuilder(HookEvent.PreTaskExecute)
      .withName('transform-hook')
      .transform((data) => ({ ...(data as object), transformed: true }))
      .handle(async (ctx) => ({
        success: true,
        data: ctx.data,
        modified: true,
      }))
      .build();

    const result = await hook.handler({
      event: HookEvent.PreTaskExecute,
      data: { original: true },
      timestamp: new Date(),
    });

    expect((result.data as any).transformed).toBe(true);
    expect((result.data as any).original).toBe(true);
  });

  it('should support synchronous mode', () => {
    const hook = new HookBuilder(HookEvent.PostCommand)
      .synchronous()
      .handle(() => ({ success: true }))
      .build();

    expect(hook.async).toBe(false);
  });
});

describe('WorkerBuilder', () => {
  it('should build a worker definition', () => {
    const worker = new WorkerBuilder('coder', 'main-coder')
      .withDescription('Primary coder worker')
      .withCapabilities(['code-generation', 'refactoring', 'debugging'])
      .withMaxConcurrentTasks(5)
      .withTimeout(60000)
      .withPriority(75)
      .withMetadata({ language: 'typescript' })
      .build();

    expect(worker.type).toBe('coder');
    expect(worker.name).toBe('main-coder');
    expect(worker.description).toBe('Primary coder worker');
    expect(worker.capabilities).toContain('code-generation');
    expect(worker.maxConcurrentTasks).toBe(5);
    expect(worker.timeout).toBe(60000);
    expect(worker.priority).toBe(75);
    expect(worker.metadata?.language).toBe('typescript');
  });

  it('should support specialization vector', () => {
    const specialization = new Float32Array([0.1, 0.2, 0.3]);

    const worker = new WorkerBuilder('specialized', 'ml-worker')
      .withSpecialization(specialization)
      .withCapabilities(['ml-training'])
      .build();

    expect(worker.specialization).toBe(specialization);
  });
});

describe('Quick Plugin Creators', () => {
  it('should create tool-only plugin', () => {
    const plugin = createToolPlugin('quick-tools', '1.0.0', [
      {
        name: 'quick-tool',
        description: 'Quick tool',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => ({ content: [{ type: 'text', text: '' }] }),
      },
    ]);

    expect(plugin.metadata.name).toBe('quick-tools');
    expect(plugin.registerMCPTools?.()).toHaveLength(1);
  });

  it('should create hooks-only plugin', () => {
    const plugin = createHooksPlugin('quick-hooks', '1.0.0', [
      {
        event: HookEvent.SessionStart,
        handler: async () => ({ success: true }),
      },
    ]);

    expect(plugin.metadata.name).toBe('quick-hooks');
    expect(plugin.registerHooks?.()).toHaveLength(1);
  });

  it('should create worker plugin', () => {
    const plugin = createWorkerPlugin('quick-workers', '1.0.0', [
      {
        type: 'tester',
        name: 'quick-tester',
        capabilities: ['testing'],
      },
    ]);

    expect(plugin.metadata.name).toBe('quick-workers');
    expect(plugin.registerWorkers?.()).toHaveLength(1);
  });
});
