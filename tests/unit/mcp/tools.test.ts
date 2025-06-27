/// <reference types="jest" />

/**
 * Unit tests for Tool Registry
 */

import { ToolRegistry } from '../../../src/mcp/tools.js';
import { MCPTool } from '../../../src/utils/types.js';
import { Logger } from '../../../src/core/logger.js';

describe('ToolRegistry', () => {
  let registry: ToolRegistry;
  let logger: Logger;

  beforeEach(async () => {
    logger = new Logger();
    await logger.configure({
      level: 'debug',
      format: 'text',
      destination: 'console',
    });

    registry = new ToolRegistry(logger);
  });

  describe('Tool Registration', () => {
    it('should register a valid tool', () => {
      const tool: MCPTool = {
        name: 'test/tool',
        description: 'A test tool',
        inputSchema: {
          type: 'object',
          properties: {
            message: { type: 'string' },
          },
          required: ['message'],
        },
        handler: async (input: any) => {
          return { received: input.message };
        },
      };

      registry.register(tool);
      
      const retrievedTool = registry.getTool('test/tool');
      expect(retrievedTool);
      expect(retrievedTool?.name).toBe( 'test/tool');
      expect(retrievedTool?.description).toBe( 'A test tool');
    });

    it('should prevent duplicate tool registration', () => {
      const tool: MCPTool = {
        name: 'test/duplicate',
        description: 'A test tool',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => ({}),
      };

      registry.register(tool);
      
      try {
        registry.register(tool);
        throw new Error('Should have thrown an error');
      } catch (error) {
        expect((error as Error).message.includes('already registered')).toBe( true);
      }
    });

    it('should validate tool name format', () => {
      const invalidTool: MCPTool = {
        name: 'invalid-name', // Should be namespace/name
        description: 'Invalid tool',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => ({}),
      };

      try {
        registry.register(invalidTool);
        throw new Error('Should have thrown an error');
      } catch (error) {
        expect((error as Error).message.includes('format: namespace/name')).toBe( true);
      }
    });

    it('should validate required tool properties', () => {
      const invalidTools = [
        {
          name: '',
          description: 'Invalid tool',
          inputSchema: { type: 'object', properties: {} },
          handler: async () => ({}),
        },
        {
          name: 'test/tool',
          description: '',
          inputSchema: { type: 'object', properties: {} },
          handler: async () => ({}),
        },
        {
          name: 'test/tool',
          description: 'Invalid tool',
          inputSchema: null,
          handler: async () => ({}),
        },
        {
          name: 'test/tool',
          description: 'Invalid tool',
          inputSchema: { type: 'object', properties: {} },
          handler: null,
        },
      ];

      for (const invalidTool of invalidTools) {
        try {
          registry.register(invalidTool as MCPTool);
          throw new Error('Should have thrown an error');
        } catch (error) {
          expect(error);
        }
      }
    });
  });

  describe('Tool Retrieval', () => {
    beforeEach(() => {
      const tools: MCPTool[] = [
        {
          name: 'test/tool1',
          description: 'First test tool',
          inputSchema: { type: 'object', properties: {} },
          handler: async () => ({ tool: 1 }),
        },
        {
          name: 'test/tool2',
          description: 'Second test tool',
          inputSchema: { type: 'object', properties: {} },
          handler: async () => ({ tool: 2 }),
        },
      ];

      for (const tool of tools) {
        registry.register(tool);
      }
    });

    it('should retrieve a tool by name', () => {
      const tool = registry.getTool('test/tool1');
      expect(tool);
      expect(tool?.name).toBe( 'test/tool1');
      expect(tool?.description).toBe( 'First test tool');
    });

    it('should return undefined for non-existent tool', () => {
      const tool = registry.getTool('test/nonexistent');
      expect(tool).toBe( undefined);
    });

    it('should list all tools', () => {
      const tools = registry.listTools();
      expect(tools);
      expect(tools.length).toBe( 2);
      
      const toolNames = tools.map(t => t.name);
      expect(toolNames.includes('test/tool1')).toBe( true);
      expect(toolNames.includes('test/tool2')).toBe( true);
    });

    it('should get tool count', () => {
      expect(registry.getToolCount()).toBe( 2);
    });
  });

  describe('Tool Execution', () => {
    beforeEach(() => {
      const tools: MCPTool[] = [
        {
          name: 'test/echo',
          description: 'Echo tool',
          inputSchema: {
            type: 'object',
            properties: {
              message: { type: 'string' },
            },
            required: ['message'],
          },
          handler: async (input: any) => {
            return { echo: input.message };
          },
        },
        {
          name: 'test/error',
          description: 'Error tool',
          inputSchema: { type: 'object', properties: {} },
          handler: async () => {
            throw new Error('Test error');
          },
        },
      ];

      for (const tool of tools) {
        registry.register(tool);
      }
    });

    it('should execute a tool successfully', async () => {
      const result = await registry.executeTool('test/echo', { message: 'Hello, World!' });
      expect(result).toEqual({ echo: 'Hello, World!' });
    });

    it('should handle tool execution errors', async () => {
      try {
        await registry.executeTool('test/error', {});
        throw new Error('Should have thrown an error');
      } catch (error) {
        expect((error as Error).message).toBe( 'Test error');
      }
    });

    it('should handle non-existent tool execution', async () => {
      try {
        await registry.executeTool('test/nonexistent', {});
        throw new Error('Should have thrown an error');
      } catch (error) {
        expect((error as Error).message.includes('Tool not found')).toBe( true);
      }
    });

    it('should validate input against schema', async () => {
      try {
        await registry.executeTool('test/echo', {}); // Missing required 'message'
        throw new Error('Should have thrown an error');
      } catch (error) {
        expect((error as Error).message.includes('Missing required property')).toBe( true);
      }
    });

    it('should validate input types', async () => {
      try {
        await registry.executeTool('test/echo', { message: 123 }); // Should be string
        throw new Error('Should have thrown an error');
      } catch (error) {
        expect((error as Error).message.includes('Invalid type')).toBe( true);
      }
    });
  });

  describe('Tool Unregistration', () => {
    beforeEach(() => {
      const tool: MCPTool = {
        name: 'test/removable',
        description: 'Removable tool',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => ({}),
      };

      registry.register(tool);
    });

    it('should unregister a tool', () => {
      expect(registry.getTool('test/removable'));
      
      registry.unregister('test/removable');
      
      expect(registry.getTool('test/removable')).toBe( undefined);
    });

    it('should handle unregistering non-existent tool', () => {
      try {
        registry.unregister('test/nonexistent');
        throw new Error('Should have thrown an error');
      } catch (error) {
        expect((error as Error).message.includes('Tool not found')).toBe( true);
      }
    });
  });

  describe('Input Validation', () => {
    beforeEach(() => {
      const tool: MCPTool = {
        name: 'test/complex',
        description: 'Complex validation tool',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            age: { type: 'number' },
            active: { type: 'boolean' },
            tags: { type: 'array', items: { type: 'string' } },
            metadata: { type: 'object' },
          },
          required: ['name', 'age'],
        },
        handler: async (input: any) => input,
      };

      registry.register(tool);
    });

    it('should validate string types', async () => {
      const result = await registry.executeTool('test/complex', {
        name: 'John',
        age: 30,
      });
      expect(result.name).toBe( 'John');
    });

    it('should validate number types', async () => {
      try {
        await registry.executeTool('test/complex', {
          name: 'John',
          age: 'thirty', // Should be number
        });
        throw new Error('Should have thrown an error');
      } catch (error) {
        expect((error as Error).message.includes('Invalid type')).toBe( true);
      }
    });

    it('should validate boolean types', async () => {
      const result = await registry.executeTool('test/complex', {
        name: 'John',
        age: 30,
        active: true,
      });
      expect(result.active).toBe( true);
    });

    it('should validate array types', async () => {
      const result = await registry.executeTool('test/complex', {
        name: 'John',
        age: 30,
        tags: ['developer', 'typescript'],
      });
      expect(result.tags).toEqual(['developer', 'typescript']);
    });

    it('should validate object types', async () => {
      const result = await registry.executeTool('test/complex', {
        name: 'John',
        age: 30,
        metadata: { department: 'engineering' },
      });
      expect(result.metadata).toEqual({ department: 'engineering' });
    });

    it('should handle null input for non-object schema', async () => {
      const tool: MCPTool = {
        name: 'test/null',
        description: 'Null input tool',
        inputSchema: { type: 'null' },
        handler: async () => ({ received: 'null' }),
      };

      registry.register(tool);

      const result = await registry.executeTool('test/null', null);
      expect(result).toEqual({ received: 'null' });
    });
  });
});
