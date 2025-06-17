/**
 * Unit tests for Config Manager
 */

import {
  describe,
  it,
  beforeEach,
  afterEach,
  assertEquals,
  assertExists,
  assertThrows,
  assertRejects,
} from '../../test.utils.ts';
import { ConfigManager, loadConfig } from '../../../src/core/config.ts';
import { Config } from '../../../src/utils/types.ts';
import { ConfigError, ValidationError } from '../../../src/utils/errors.ts';
import { createTestFile } from '../../test.utils.ts';
import { cleanupTestEnv, setupTestEnv } from '../../test.config.ts';

describe('ConfigManager', () => {
  let configManager: ConfigManager;
  let originalEnv: Record<string, string>;

  beforeEach(() => {
    setupTestEnv();
    
    // Save original env vars
    originalEnv = {};
    const envKeys = [
      'CLAUDE_FLOW_MAX_AGENTS',
      'CLAUDE_FLOW_TERMINAL_TYPE',
      'CLAUDE_FLOW_MEMORY_BACKEND',
      'CLAUDE_FLOW_MCP_TRANSPORT',
      'CLAUDE_FLOW_MCP_PORT',
      'CLAUDE_FLOW_LOG_LEVEL',
      // Add OPEN_CODEX env vars to track for restoration
      'OPEN_CODEX_MODEL',
      'OPEN_CODEX_BASE_URL',
      'OPEN_CODEX_API_KEY',
      'OPEN_CODEX_PATH',
    ];
    
    envKeys.forEach(key => {
      originalEnv[key] = Deno.env.get(key) || '';
    });
    
    // Reset singleton
    (ConfigManager as any).instance = undefined;
    configManager = ConfigManager.getInstance();
  });

  afterEach(async () => {
    // Restore env vars
    Object.entries(originalEnv).forEach(([key, value]) => {
      if (value) {
        Deno.env.set(key, value);
      } else {
        Deno.env.delete(key);
      }
    });
    
    await cleanupTestEnv();
  });

  describe('singleton', () => {
    it('should be a singleton', () => {
      const instance1 = ConfigManager.getInstance();
      const instance2 = ConfigManager.getInstance();
      assertEquals(instance1, instance2);
    });
  });

  describe('loading configuration', () => {
    it('should load default configuration', async () => {
      const config = await configManager.load();
      
      assertExists(config.orchestrator);
      assertExists(config.terminal);
      assertExists(config.memory);
      assertExists(config.coordination);
      assertExists(config.mcp);
      assertExists(config.logging);
      assertExists(config.openCodex); // Check new section
      
      // Check some defaults
      assertEquals(config.orchestrator.maxConcurrentAgents, 10);
      assertEquals(config.terminal.type, 'auto');
      assertEquals(config.memory.backend, 'hybrid');
      // Check openCodex defaults
      assertEquals(config.openCodex?.model, '');
      assertEquals(config.openCodex?.baseUrl, '');
      assertEquals(config.openCodex?.apiKey, '');
      assertEquals(config.openCodex?.path, 'open-codex');
    });

    it('should load configuration from file', async () => {
      const configData = {
        orchestrator: {
          maxConcurrentAgents: 20,
        },
        logging: {
          level: 'debug' as const,
        },
      };
      
      const configFile = await createTestFile('config.json', JSON.stringify(configData));
      const config = await configManager.load(configFile);
      
      assertEquals(config.orchestrator.maxConcurrentAgents, 20);
      assertEquals(config.logging.level, 'debug');
      // Other values should still be defaults
      assertEquals(config.terminal.type, 'auto');
    });

    it('should handle non-existent config file gracefully', async () => {
      const config = await configManager.load('/non/existent/file.json');
      
      // Should use defaults
      assertEquals(config.orchestrator.maxConcurrentAgents, 10);
    });

    it('should throw on invalid JSON in config file', async () => {
      const configFile = await createTestFile('invalid.json', '{ invalid json }');
      
      await assertRejects(
        () => configManager.load(configFile),
        ConfigError,
        'Invalid JSON in configuration file'
      );
    });

    it('should load configuration from environment variables', async () => {
      Deno.env.set('CLAUDE_FLOW_MAX_AGENTS', '5');
      Deno.env.set('CLAUDE_FLOW_TERMINAL_TYPE', 'vscode');
      Deno.env.set('CLAUDE_FLOW_MEMORY_BACKEND', 'sqlite');
      Deno.env.set('CLAUDE_FLOW_MCP_TRANSPORT', 'http');
      Deno.env.set('CLAUDE_FLOW_MCP_PORT', '9000');
      Deno.env.set('CLAUDE_FLOW_LOG_LEVEL', 'debug');
      // Set OpenCodex env vars
      Deno.env.set('OPEN_CODEX_MODEL', 'test-model-env');
      Deno.env.set('OPEN_CODEX_BASE_URL', 'http://test-url-env.com');
      Deno.env.set('OPEN_CODEX_API_KEY', 'test-key-env');
      Deno.env.set('OPEN_CODEX_PATH', '/test/path/open-codex-env');
      
      const config = await configManager.load();
      
      assertEquals(config.orchestrator.maxConcurrentAgents, 5);
      assertEquals(config.terminal.type, 'vscode');
      assertEquals(config.memory.backend, 'sqlite');
      assertEquals(config.mcp.transport, 'http');
      assertEquals(config.mcp.port, 9000);
      assertEquals(config.logging.level, 'debug');
      // Check OpenCodex values from env
      assertEquals(config.openCodex?.model, 'test-model-env');
      assertEquals(config.openCodex?.baseUrl, 'http://test-url-env.com');
      assertEquals(config.openCodex?.apiKey, 'test-key-env');
      assertEquals(config.openCodex?.path, '/test/path/open-codex-env');

      // Unset OpenCodex env vars for subsequent tests
      Deno.env.delete('OPEN_CODEX_MODEL');
      Deno.env.delete('OPEN_CODEX_BASE_URL');
      Deno.env.delete('OPEN_CODEX_API_KEY');
      Deno.env.delete('OPEN_CODEX_PATH');
    });

    it('should merge file and env configuration with env taking precedence', async () => {
      const configData = {
        orchestrator: {
          maxConcurrentAgents: 20,
        },
        logging: {
          level: 'info' as const,
        },
      };
      
      const configFile = await createTestFile('config.json', JSON.stringify(configData));
      Deno.env.set('CLAUDE_FLOW_MAX_AGENTS', '15');
      
      const config = await configManager.load(configFile);
      
      assertEquals(config.orchestrator.maxConcurrentAgents, 15); // Env wins
      assertEquals(config.logging.level, 'info'); // From file
    });

    it('should ignore invalid env values', async () => {
      Deno.env.set('CLAUDE_FLOW_TERMINAL_TYPE', 'invalid-type');
      
      const config = await configManager.load();
      
      // Should use default
      assertEquals(config.terminal.type, 'auto');
    });
  });

  describe('validation', () => {
    it('should validate orchestrator configuration', async () => {
      const invalidConfig = {
        orchestrator: {
          maxConcurrentAgents: 0, // Invalid
          taskQueueSize: -1, // Invalid
        },
      };
      
      const configFile = await createTestFile('invalid.json', JSON.stringify(invalidConfig));
      
      await assertRejects(
        () => configManager.load(configFile),
        ValidationError,
        'maxConcurrentAgents must be at least 1'
      );
    });

    it('should validate terminal configuration', async () => {
      const invalidConfig = {
        terminal: {
          poolSize: 0, // Invalid
        },
      };
      
      const configFile = await createTestFile('invalid.json', JSON.stringify(invalidConfig));
      
      await assertRejects(
        () => configManager.load(configFile),
        ValidationError,
        'terminal poolSize must be at least 1'
      );
    });

    it('should validate memory configuration', async () => {
      const invalidConfig = {
        memory: {
          cacheSizeMB: -10, // Invalid
        },
      };
      
      const configFile = await createTestFile('invalid.json', JSON.stringify(invalidConfig));
      
      await assertRejects(
        () => configManager.load(configFile),
        ValidationError,
        'memory cacheSizeMB must be at least 1'
      );
    });

    it('should validate coordination configuration', async () => {
      const invalidConfig = {
        coordination: {
          maxRetries: -1, // Invalid
        },
      };
      
      const configFile = await createTestFile('invalid.json', JSON.stringify(invalidConfig));
      
      await assertRejects(
        () => configManager.load(configFile),
        ValidationError,
        'coordination maxRetries cannot be negative'
      );
    });

    it('should validate MCP configuration', async () => {
      const invalidConfig = {
        mcp: {
          transport: 'http' as const,
          port: 70000, // Invalid port
        },
      };
      
      const configFile = await createTestFile('invalid.json', JSON.stringify(invalidConfig));
      
      await assertRejects(
        () => configManager.load(configFile),
        ValidationError,
        'Invalid MCP port number'
      );
    });
  });

  describe('getSchema', () => {
    it('should return schema definition for openCodex', () => {
      const schema = configManager.getSchema();
      assertExists(schema.openCodex);
      assertEquals(schema.openCodex, {
        model: { type: 'string' },
        baseUrl: { type: 'string' },
        apiKey: { type: 'string' },
        path: { type: 'string' },
      });
    });
  });

  describe('get/update operations', () => {
    beforeEach(async () => {
      await configManager.load();
    });

    it('should get current configuration', () => {
      const config = configManager.get();
      
      assertExists(config.orchestrator);
      assertExists(config.terminal);
      // Should be a copy, not the original
      config.orchestrator.maxConcurrentAgents = 999;
      assertEquals(configManager.get().orchestrator.maxConcurrentAgents, 10);
      assertExists(configManager.get().openCodex); // Ensure openCodex is part of the config
    });

    it('should update configuration, including openCodex', () => {
      const updates: Partial<Config> = {
        orchestrator: {
          maxConcurrentAgents: 25,
        },
        openCodex: {
          model: 'updated-model',
          apiKey: 'updated-key',
        }
      };
      
      const updatedConfig = configManager.update(updates);
      
      assertEquals(updatedConfig.orchestrator.maxConcurrentAgents, 25);
      assertExists(updatedConfig.openCodex);
      assertEquals(updatedConfig.openCodex?.model, 'updated-model');
      assertEquals(updatedConfig.openCodex?.apiKey, 'updated-key');
      // Check that unspecified openCodex fields retain defaults
      assertEquals(updatedConfig.openCodex?.baseUrl, ''); // Default
      assertEquals(updatedConfig.openCodex?.path, 'open-codex'); // Default
    });

    it('should allow partial updates to openCodex settings', () => {
      configManager.update({
        openCodex: {
          baseUrl: 'http://specific-url.com',
        }
      });
      const updatedConfig = configManager.get();
      assertEquals(updatedConfig.openCodex?.baseUrl, 'http://specific-url.com');
      assertEquals(updatedConfig.openCodex?.model, ''); // Default
      assertEquals(updatedConfig.openCodex?.apiKey, ''); // Default
      assertEquals(updatedConfig.openCodex?.path, 'open-codex'); // Default
    });

    it('should validate updates', () => {
      const invalidUpdates: Partial<Config> = {
        terminal: {
          poolSize: -5,
          type: 'auto',
          recycleAfter: 10,
          healthCheckInterval: 30000,
          commandTimeout: 120000,
        },
      };
      
      assertThrows(
        () => configManager.update(invalidUpdates),
        ValidationError,
        'terminal poolSize must be at least 1'
      );
    });
  });

  describe('save operations', () => {
    beforeEach(async () => {
      await configManager.load();
    });

    it('should save configuration to file', async () => {
      const savePath = await createTestFile('save-test.json', '');
      
      configManager.update({
        orchestrator: {
          maxConcurrentAgents: 15,
          taskQueueSize: 100,
          healthCheckInterval: 30000,
          shutdownTimeout: 30000,
        },
      });
      
      await configManager.save(savePath);
      
      const savedContent = await Deno.readTextFile(savePath);
      const savedConfig = JSON.parse(savedContent);
      
      assertEquals(savedConfig.orchestrator.maxConcurrentAgents, 15);
    });

    it('should save to original file if no path specified', async () => {
      const configFile = await createTestFile('original.json', JSON.stringify({
        orchestrator: { maxConcurrentAgents: 5 },
      }));
      
      await configManager.load(configFile);
      configManager.update({
        orchestrator: {
          maxConcurrentAgents: 30,
          taskQueueSize: 100,
          healthCheckInterval: 30000,
          shutdownTimeout: 30000,
        },
      });
      
      await configManager.save();
      
      const savedContent = await Deno.readTextFile(configFile);
      const savedConfig = JSON.parse(savedContent);
      
      assertEquals(savedConfig.orchestrator.maxConcurrentAgents, 30);
    });

    it('should throw if no save path available', async () => {
      // Load without file path
      await configManager.load();
      
      await assertRejects(
        () => configManager.save(),
        ConfigError,
        'No configuration file path specified'
      );
    });
  });

  describe('loadConfig helper', () => {
    it('should load config with helper function', async () => {
      const config = await loadConfig();
      
      assertExists(config.orchestrator);
      assertEquals(config.orchestrator.maxConcurrentAgents, 10);
    });

    it('should load config from specified path', async () => {
      const configData = {
        logging: {
          level: 'error' as const,
        },
      };
      
      const configFile = await createTestFile('helper.json', JSON.stringify(configData));
      const config = await loadConfig(configFile);
      
      assertEquals(config.logging.level, 'error');
    });
  });

  describe('edge cases', () => {
    it('should handle deeply nested configuration', async () => {
      const configData = {
        orchestrator: {
          maxConcurrentAgents: 15,
        },
        memory: {
          backend: 'sqlite' as const,
          cacheSizeMB: 50,
        },
        logging: {
          level: 'warn' as const,
          format: 'json' as const,
          destination: 'both' as const,
        },
      };
      
      const configFile = await createTestFile('nested.json', JSON.stringify(configData));
      const config = await configManager.load(configFile);
      
      assertEquals(config.orchestrator.maxConcurrentAgents, 15);
      assertEquals(config.memory.backend, 'sqlite');
      assertEquals(config.memory.cacheSizeMB, 50);
      assertEquals(config.logging.level, 'warn');
      assertEquals(config.logging.format, 'json');
      assertEquals(config.logging.destination, 'both');
    });

    it('should handle partial configuration files', async () => {
      const configData = {
        orchestrator: {
          maxConcurrentAgents: 20,
        },
        // Missing other sections
      };
      
      const configFile = await createTestFile('partial.json', JSON.stringify(configData));
      const config = await configManager.load(configFile);
      
      // Should have updated orchestrator
      assertEquals(config.orchestrator.maxConcurrentAgents, 20);
      
      // Should have defaults for other sections
      assertExists(config.terminal);
      assertExists(config.memory);
      assertExists(config.coordination);
      assertExists(config.mcp);
      assertExists(config.logging);
    });

    it('should handle empty configuration file', async () => {
      const configFile = await createTestFile('empty.json', '{}');
      const config = await configManager.load(configFile);
      
      // Should use all defaults
      assertEquals(config.orchestrator.maxConcurrentAgents, 10);
      assertEquals(config.terminal.type, 'auto');
    });
  });
});