/**
 * Plugin Creator Tests
 */

import { describe, it, expect } from 'vitest';
import {
  pluginCreatorPlugin,
  generatePlugin,
  generateToolCode,
  generateHookCode,
  generateWorkerCode,
  generateAgentTypeCode,
  PLUGIN_TEMPLATES,
  type CreatePluginOptions,
} from './index.js';
import { HookEvent } from '../../src/types/index.js';

describe('Plugin Creator Plugin', () => {
  describe('pluginCreatorPlugin', () => {
    it('should have correct metadata', () => {
      expect(pluginCreatorPlugin.metadata.name).toBe('plugin-creator');
      expect(pluginCreatorPlugin.metadata.version).toBe('1.0.0');
      expect(pluginCreatorPlugin.metadata.tags).toContain('meta');
    });

    it('should register MCP tools', () => {
      const tools = pluginCreatorPlugin.registerMCPTools?.() ?? [];
      expect(tools.length).toBeGreaterThan(0);

      const toolNames = tools.map(t => t.name);
      expect(toolNames).toContain('create-plugin');
      expect(toolNames).toContain('list-plugin-templates');
      expect(toolNames).toContain('generate-tool');
      expect(toolNames).toContain('generate-hook');
      expect(toolNames).toContain('generate-worker');
    });

    it('should register hooks', () => {
      const hooks = pluginCreatorPlugin.registerHooks?.() ?? [];
      expect(hooks.length).toBeGreaterThan(0);
      expect(hooks[0].name).toBe('plugin-creator-logger');
    });

    it('should register workers', () => {
      const workers = pluginCreatorPlugin.registerWorkers?.() ?? [];
      expect(workers.length).toBeGreaterThan(0);
      expect(workers[0].name).toBe('plugin-code-generator');
    });
  });

  describe('PLUGIN_TEMPLATES', () => {
    it('should have all expected templates', () => {
      const templateNames = Object.keys(PLUGIN_TEMPLATES);
      expect(templateNames).toContain('minimal');
      expect(templateNames).toContain('tool-plugin');
      expect(templateNames).toContain('hooks-plugin');
      expect(templateNames).toContain('worker-plugin');
      expect(templateNames).toContain('swarm-plugin');
      expect(templateNames).toContain('full-featured');
      expect(templateNames).toContain('security-focused');
    });

    it('should have valid template structures', () => {
      for (const [name, template] of Object.entries(PLUGIN_TEMPLATES)) {
        expect(template.name).toBeDefined();
        expect(template.description).toBeDefined();
        expect(template.category).toMatch(/^(tools|hooks|workers|swarm|full)$/);
        expect(Array.isArray(template.features)).toBe(true);
      }
    });
  });

  describe('generatePlugin', () => {
    it('should generate a minimal plugin', () => {
      const result = generatePlugin({
        name: 'test-plugin',
        version: '1.0.0',
      });

      expect(result.plugin).toBeDefined();
      expect(result.metadata.name).toBe('test-plugin');
      expect(result.metadata.version).toBe('1.0.0');
      expect(result.code).toContain("PluginBuilder('test-plugin'");
    });

    it('should generate a plugin with tools', () => {
      const result = generatePlugin({
        name: 'tools-test',
        features: { tools: true },
        toolNames: ['my-tool', 'another-tool'],
      });

      const tools = result.plugin.registerMCPTools?.() ?? [];
      expect(tools.length).toBe(2);
      expect(tools[0].name).toBe('my-tool');
      expect(tools[1].name).toBe('another-tool');
      expect(result.code).toContain('MCPToolBuilder');
    });

    it('should generate a plugin with hooks', () => {
      const result = generatePlugin({
        name: 'hooks-test',
        features: { hooks: true },
        hookEvents: [HookEvent.SessionStart, HookEvent.PostTaskComplete],
      });

      const hooks = result.plugin.registerHooks?.() ?? [];
      expect(hooks.length).toBe(2);
      expect(result.code).toContain('HookBuilder');
    });

    it('should generate a plugin with workers', () => {
      const result = generatePlugin({
        name: 'workers-test',
        features: { workers: true },
        workerTypes: ['coder', 'reviewer'],
      });

      const workers = result.plugin.registerWorkers?.() ?? [];
      expect(workers.length).toBe(2);
      expect(result.code).toContain('WorkerFactory');
    });

    it('should generate a plugin with swarm capabilities', () => {
      const result = generatePlugin({
        name: 'swarm-test',
        features: { swarm: true },
        agentTypes: ['coordinator', 'worker-agent'],
      });

      const agents = result.plugin.registerAgentTypes?.() ?? [];
      expect(agents.length).toBe(2);
      expect(result.code).toContain('AgentTypeDefinition');
    });

    it('should apply template features', () => {
      const result = generatePlugin({
        name: 'full-test',
        template: 'full-featured',
      });

      const tools = result.plugin.registerMCPTools?.() ?? [];
      const hooks = result.plugin.registerHooks?.() ?? [];
      const workers = result.plugin.registerWorkers?.() ?? [];
      const agents = result.plugin.registerAgentTypes?.() ?? [];

      expect(tools.length).toBeGreaterThan(0);
      expect(hooks.length).toBeGreaterThan(0);
      expect(workers.length).toBeGreaterThan(0);
      expect(agents.length).toBeGreaterThan(0);
    });

    it('should reject invalid plugin names', () => {
      expect(() => generatePlugin({ name: 'Invalid Name' })).toThrow();
      expect(() => generatePlugin({ name: '123-start' })).toThrow();
      expect(() => generatePlugin({ name: 'ab' })).toThrow(); // Too short
    });
  });

  describe('generateToolCode', () => {
    it('should generate valid tool definition', () => {
      const { definition, code } = generateToolCode('my-tool');

      expect(definition.name).toBe('my-tool');
      expect(definition.handler).toBeDefined();
      expect(code).toContain('MCPToolBuilder');
      expect(code).toContain('my-tool');
    });

    it('should sanitize invalid tool names', () => {
      const { definition } = generateToolCode('Invalid Tool Name!');
      expect(definition.name).toBe('custom-tool');
    });

    it('should create working handler', async () => {
      const { definition } = generateToolCode('test-tool');
      const result = await definition.handler({ input: 'test' });

      expect(result.content).toBeDefined();
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toContain('test-tool');
    });
  });

  describe('generateHookCode', () => {
    it('should generate valid hook definition', () => {
      const { definition, code } = generateHookCode(HookEvent.SessionStart);

      expect(definition.event).toBe(HookEvent.SessionStart);
      expect(definition.handler).toBeDefined();
      expect(code).toContain('HookBuilder');
      expect(code).toContain('SessionStart');
    });

    it('should create working handler', async () => {
      const { definition } = generateHookCode(HookEvent.PostTaskComplete);
      const result = await definition.handler({
        event: HookEvent.PostTaskComplete,
        data: { taskId: '123' },
        timestamp: new Date(),
      });

      expect(result.success).toBe(true);
    });
  });

  describe('generateWorkerCode', () => {
    it('should generate valid worker definitions for known types', () => {
      const types = ['coder', 'reviewer', 'tester', 'researcher', 'planner', 'coordinator', 'security', 'performance'];

      for (const type of types) {
        const { definition, code } = generateWorkerCode(type);

        expect(definition.type).toBe(type);
        expect(definition.name).toBe(`${type}-worker`);
        expect(definition.capabilities.length).toBeGreaterThan(0);
        expect(code).toContain('WorkerFactory');
      }
    });

    it('should fallback to specialized for unknown types', () => {
      const { definition, code } = generateWorkerCode('custom-type');

      expect(definition.type).toBe('specialized');
      expect(code).toContain('createSpecialized');
    });
  });

  describe('generateAgentTypeCode', () => {
    it('should generate valid agent type definition', () => {
      const { definition, code } = generateAgentTypeCode('coordinator');

      expect(definition.type).toBe('coordinator');
      expect(definition.name).toBe('coordinator Agent');
      expect(definition.model).toBe('claude-sonnet-4-20250514');
      expect(code).toContain('AgentTypeDefinition');
    });

    it('should sanitize invalid agent type names', () => {
      const { definition } = generateAgentTypeCode('Invalid Agent!');
      expect(definition.type).toBe('custom-agent');
    });
  });
});

describe('MCP Tool Handlers', () => {
  it('create-plugin tool should work', async () => {
    const tools = pluginCreatorPlugin.registerMCPTools?.() ?? [];
    const createTool = tools.find(t => t.name === 'create-plugin');

    expect(createTool).toBeDefined();

    const result = await createTool!.handler({
      name: 'test-created-plugin',
      version: '1.0.0',
      template: 'tool-plugin',
    });

    expect(result.content[0].text).toContain('test-created-plugin');
    expect(result.content[0].text).toContain('created successfully');
  });

  it('list-plugin-templates tool should work', async () => {
    const tools = pluginCreatorPlugin.registerMCPTools?.() ?? [];
    const listTool = tools.find(t => t.name === 'list-plugin-templates');

    expect(listTool).toBeDefined();

    const result = await listTool!.handler({});

    expect(result.content[0].text).toContain('Available Plugin Templates');
    expect(result.content[0].text).toContain('minimal');
    expect(result.content[0].text).toContain('full-featured');
  });

  it('generate-tool tool should work', async () => {
    const tools = pluginCreatorPlugin.registerMCPTools?.() ?? [];
    const genTool = tools.find(t => t.name === 'generate-tool');

    expect(genTool).toBeDefined();

    const result = await genTool!.handler({ name: 'my-custom-tool' });

    expect(result.content[0].text).toContain('Generated Tool');
    expect(result.content[0].text).toContain('my-custom-tool');
    expect(result.content[0].text).toContain('MCPToolBuilder');
  });

  it('generate-hook tool should work', async () => {
    const tools = pluginCreatorPlugin.registerMCPTools?.() ?? [];
    const genHook = tools.find(t => t.name === 'generate-hook');

    expect(genHook).toBeDefined();

    const result = await genHook!.handler({ event: HookEvent.SessionStart });

    expect(result.content[0].text).toContain('Generated Hook');
    expect(result.content[0].text).toContain('HookBuilder');
  });

  it('generate-worker tool should work', async () => {
    const tools = pluginCreatorPlugin.registerMCPTools?.() ?? [];
    const genWorker = tools.find(t => t.name === 'generate-worker');

    expect(genWorker).toBeDefined();

    const result = await genWorker!.handler({ type: 'coder' });

    expect(result.content[0].text).toContain('Generated Worker');
    expect(result.content[0].text).toContain('WorkerFactory');
  });
});
