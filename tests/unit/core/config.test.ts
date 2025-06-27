/// <reference types="jest" />

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
} from '../../test.utils.js';
import { ConfigManager, loadConfig } from '../../../src/core/config.js';
import { Config } from '../../../src/utils/types.js';
import { ConfigError, ValidationError } from '../../../src/utils/errors.js';
import { createTestFile } from '../../test.utils.js';
import { cleanupTestEnv, setupTestEnv } from '../../test.config.js';

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
    ];
    
    envKeys.forEach(key => {
      originalEnv[key] = process.env[key] || '';
    });
    
    // Reset singleton
    (ConfigManager as any).instance = undefined;
    configManager = ConfigManager.getInstance();
  });

  afterEach(async () => {
    // Restore env vars
    Object.entries(originalEnv).forEach(([key, value]) => {
      if (value) {
        process.env[key] =  value;
      } else {
        delete process.env[key];
      }
    });
    
    await cleanupTestEnv();
  });

  describe('singleton', () => {
    it('should be a singleton', () => {
      const instance1 = ConfigManager.getInstance();
      const instance2 = ConfigManager.getInstance();
      expect(instance1).toBe( instance2);
    });
  });

  describe('loading configuration', () => {
    it('should load default configuration', async () => {
      const config = await configManager.load();
      
      expect(config.orchestrator);
      expect(config.terminal);
      expect(config.memory);
      expect(config.coordination);
      expect(config.mcp);
      expect(config.logging);
      
      // Check some defaults
      expect(config.orchestrator.maxConcurrentAgents).toBe( 10);
      expect(config.terminal.type).toBe( 'auto');
      expect(config.memory.backend).toBe( 'hybrid');
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
      
      expect(config.orchestrator.maxConcurrentAgents).toBe( 20);
      expect(config.logging.level).toBe( 'debug');
      // Other values should still be defaults
      expect(config.terminal.type).toBe( 'auto');
    });

    it('should handle non-existent config file gracefully', async () => {
      const config = await configManager.load('/non/existent/file.json');
      
      // Should use defaults
      expect(config.orchestrator.maxConcurrentAgents).toBe( 10);
    });

    it('should throw on invalid JSON in config file', async () => {
      const configFile = await createTestFile('invalid.json', '{ invalid json }');
      
      await expect(
        () => configManager.load(configFile),
        ConfigError,
        'Invalid JSON in configuration file'
      );
    });

    it('should load configuration from environment variables', async () => {
      process.env['CLAUDE_FLOW_MAX_AGENTS'] =  '5';
      process.env['CLAUDE_FLOW_TERMINAL_TYPE'] =  'vscode';
      process.env['CLAUDE_FLOW_MEMORY_BACKEND'] =  'sqlite';
      process.env['CLAUDE_FLOW_MCP_TRANSPORT'] =  'http';
      process.env['CLAUDE_FLOW_MCP_PORT'] =  '9000';
      process.env['CLAUDE_FLOW_LOG_LEVEL'] =  'debug';
      
      const config = await configManager.load();
      
      expect(config.orchestrator.maxConcurrentAgents).toBe( 5);
      expect(config.terminal.type).toBe( 'vscode');
      expect(config.memory.backend).toBe( 'sqlite');
      expect(config.mcp.transport).toBe( 'http');
      expect(config.mcp.port).toBe( 9000);
      expect(config.logging.level).toBe( 'debug');
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
      process.env['CLAUDE_FLOW_MAX_AGENTS'] =  '15';
      
      const config = await configManager.load(configFile);
      
      expect(config.orchestrator.maxConcurrentAgents).toBe( 15); // Env wins
      expect(config.logging.level).toBe( 'info'); // From file
    });

    it('should ignore invalid env values', async () => {
      process.env['CLAUDE_FLOW_TERMINAL_TYPE'] =  'invalid-type';
      
      const config = await configManager.load();
      
      // Should use default
      expect(config.terminal.type).toBe( 'auto');
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
      
      await expect(
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
      
      await expect(
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
      
      await expect(
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
      
      await expect(
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
      
      await expect(
        () => configManager.load(configFile),
        ValidationError,
        'Invalid MCP port number'
      );
    });
  });

  describe('get/update operations', () => {
    beforeEach(async () => {
      await configManager.load();
    });

    it('should get current configuration', () => {
      const config = configManager.get();
      
      expect(config.orchestrator);
      expect(config.terminal);
      // Should be a copy, not the original
      config.orchestrator.maxConcurrentAgents = 999;
      expect(configManager.get().orchestrator.maxConcurrentAgents).toBe( 10);
    });

    it('should update configuration', () => {
      const updates: Partial<Config> = {
        orchestrator: {
          maxConcurrentAgents: 25,
          taskQueueSize: 200,
          healthCheckInterval: 60000,
          shutdownTimeout: 60000,
        },
      };
      
      const updatedConfig = configManager.update(updates);
      
      expect(updatedConfig.orchestrator.maxConcurrentAgents).toBe( 25);
      expect(updatedConfig.orchestrator.taskQueueSize).toBe( 200);
      // Other orchestrator values should remain
      expect(updatedConfig.orchestrator.healthCheckInterval);
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
      
      expect(
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
      
      const savedContent = fs.readFileSync(savePath, "utf8");
      const savedConfig = JSON.parse(savedContent);
      
      expect(savedConfig.orchestrator.maxConcurrentAgents).toBe( 15);
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
      
      const savedContent = fs.readFileSync(configFile, "utf8");
      const savedConfig = JSON.parse(savedContent);
      
      expect(savedConfig.orchestrator.maxConcurrentAgents).toBe( 30);
    });

    it('should throw if no save path available', async () => {
      // Load without file path
      await configManager.load();
      
      await expect(
        () => configManager.save(),
        ConfigError,
        'No configuration file path specified'
      );
    });
  });

  describe('loadConfig helper', () => {
    it('should load config with helper function', async () => {
      const config = await loadConfig();
      
      expect(config.orchestrator);
      expect(config.orchestrator.maxConcurrentAgents).toBe( 10);
    });

    it('should load config from specified path', async () => {
      const configData = {
        logging: {
          level: 'error' as const,
        },
      };
      
      const configFile = await createTestFile('helper.json', JSON.stringify(configData));
      const config = await loadConfig(configFile);
      
      expect(config.logging.level).toBe( 'error');
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
      
      expect(config.orchestrator.maxConcurrentAgents).toBe( 15);
      expect(config.memory.backend).toBe( 'sqlite');
      expect(config.memory.cacheSizeMB).toBe( 50);
      expect(config.logging.level).toBe( 'warn');
      expect(config.logging.format).toBe( 'json');
      expect(config.logging.destination).toBe( 'both');
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
      expect(config.orchestrator.maxConcurrentAgents).toBe( 20);
      
      // Should have defaults for other sections
      expect(config.terminal);
      expect(config.memory);
      expect(config.coordination);
      expect(config.mcp);
      expect(config.logging);
    });

    it('should handle empty configuration file', async () => {
      const configFile = await createTestFile('empty.json', '{}');
      const config = await configManager.load(configFile);
      
      // Should use all defaults
      expect(config.orchestrator.maxConcurrentAgents).toBe( 10);
      expect(config.terminal.type).toBe( 'auto');
    });
  });
});
