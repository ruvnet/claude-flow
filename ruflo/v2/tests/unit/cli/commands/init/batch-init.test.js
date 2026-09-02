// batch-init.test.js - Tests for batch initialization functionality
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { promises as fs } from 'fs';
import {
  batchInitCommand,
  batchInitFromConfig,
  validateBatchOptions,
  PROJECT_TEMPLATES,
  ENVIRONMENT_CONFIGS
} from '../../../../../src/cli/simple-commands/init/batch-init.js';

// Mock dependencies
jest.mock('fs', () => ({
  promises: {
    writeFile: jest.fn(),
    mkdir: jest.fn(),
    readFile: jest.fn(),
  },
}));

jest.mock('process', () => ({
  cwd: jest.fn(() => '/test/workspace'),
  chdir: jest.fn(),
  env: { PWD: '/test/workspace' },
}));

jest.mock('../../../../../src/cli/utils.js', () => ({
  printSuccess: jest.fn(),
  printError: jest.fn(),
  printWarning: jest.fn(),
  printInfo: jest.fn(),
}));

// Mock template functions
jest.mock('../../../../../src/cli/simple-commands/init/templates/claude-md.js', () => ({
  createSparcClaudeMd: jest.fn(() => '# SPARC CLAUDE.md'),
  createFullClaudeMd: jest.fn(() => '# Full CLAUDE.md'),
  createMinimalClaudeMd: jest.fn(() => '# Minimal CLAUDE.md'),
}));

describe('Batch Initialization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fs.writeFile.mockResolvedValue();
    fs.mkdir.mockResolvedValue();
    fs.readFile.mockResolvedValue('{}');

    // Mock process.cwd and chdir
    const mockProcess = require('process');
    mockProcess.cwd.mockReturnValue('/test/workspace');
    mockProcess.chdir.mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('batchInitCommand', () => {
    it('should initialize multiple projects in parallel', async () => {
      const projects = ['project1', 'project2', 'project3'];
      const options = {
        parallel: true,
        maxConcurrency: 2,
        progressTracking: false, // Disable for cleaner testing
        performanceMonitoring: false,
      };

      const results = await batchInitCommand(projects, options);

      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
      expect(results).toHaveLength(3);

      // Verify each project was attempted
      results.forEach((result, index) => {
        expect(result).toHaveProperty('success');
        expect(result).toHaveProperty('projectPath');
        expect(result.projectPath).toContain(projects[index]);
      });
    });

    it('should initialize projects sequentially when parallel is false', async () => {
      const projects = ['seq-project1', 'seq-project2'];
      const options = {
        parallel: false,
        progressTracking: false,
        performanceMonitoring: false,
      };

      const results = await batchInitCommand(projects, options);

      expect(results).toHaveLength(2);
      expect(results.every(r => r.hasOwnProperty('success'))).toBe(true);
    });

    it('should handle multiple environments', async () => {
      const projects = ['multi-env-project'];
      const options = {
        environments: ['dev', 'staging', 'prod'],
        progressTracking: false,
        performanceMonitoring: false,
      };

      const results = await batchInitCommand(projects, options);

      // Should create 3 projects (1 project × 3 environments)
      expect(results).toHaveLength(3);
      expect(results.map(r => r.projectPath)).toEqual([
        expect.stringContaining('multi-env-project-dev'),
        expect.stringContaining('multi-env-project-staging'),
        expect.stringContaining('multi-env-project-prod'),
      ]);
    });

    it('should apply project templates correctly', async () => {
      const projects = ['web-api-project'];
      const options = {
        template: 'web-api',
        progressTracking: false,
        performanceMonitoring: false,
      };

      const results = await batchInitCommand(projects, options);

      expect(results).toHaveLength(1);
      expect(results[0]).toHaveProperty('success');

      // Verify template-specific files were created
      expect(fs.writeFile).toHaveBeenCalledWith(
        'package.json',
        expect.stringContaining('express')
      );
      expect(fs.writeFile).toHaveBeenCalledWith(
        'src/index.js',
        expect.stringContaining('Welcome to web-api-project API')
      );
    });

    it('should handle initialization failures gracefully', async () => {
      // Mock mkdir to fail for specific project
      fs.mkdir.mockImplementation((path) => {
        if (path.includes('failing-project')) {
          return Promise.reject(new Error('Permission denied'));
        }
        return Promise.resolve();
      });

      const projects = ['good-project', 'failing-project'];
      const options = {
        progressTracking: false,
        performanceMonitoring: false,
      };

      const results = await batchInitCommand(projects, options);

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
      expect(results[1].error).toContain('Permission denied');
    });

    it('should respect concurrency limits', async () => {
      const projects = Array.from({ length: 10 }, (_, i) => `project${i}`);
      const maxConcurrency = 3;

      let currentConcurrent = 0;
      let maxObservedConcurrency = 0;

      // Mock mkdir to track concurrency
      fs.mkdir.mockImplementation(async (path) => {
        currentConcurrent++;
        maxObservedConcurrency = Math.max(maxObservedConcurrency, currentConcurrent);

        // Simulate async work
        await new Promise(resolve => setTimeout(resolve, 10));

        currentConcurrent--;
        return Promise.resolve();
      });

      const options = {
        parallel: true,
        maxConcurrency,
        progressTracking: false,
        performanceMonitoring: false,
      };

      await batchInitCommand(projects, options);

      expect(maxObservedConcurrency).toBeLessThanOrEqual(maxConcurrency);
    });

    it('should handle empty project list', async () => {
      const results = await batchInitCommand([], {});
      expect(results).toBeUndefined();
    });

    it('should handle SPARC mode in batch', async () => {
      const projects = ['sparc-project'];
      const options = {
        sparc: true,
        progressTracking: false,
        performanceMonitoring: false,
      };

      const results = await batchInitCommand(projects, options);

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(true);

      // Verify SPARC-specific content was used
      const sparcTemplate = require('../../../../../src/cli/simple-commands/init/templates/claude-md.js');
      expect(sparcTemplate.createSparcClaudeMd).toHaveBeenCalled();
    });
  });

  describe('batchInitFromConfig', () => {
    it('should load configuration from file', async () => {
      const mockConfig = {
        projects: ['config-project1', 'config-project2'],
        baseOptions: {
          template: 'react-app',
          environments: ['dev', 'prod'],
        },
      };

      fs.readFile.mockResolvedValue(JSON.stringify(mockConfig));

      const results = await batchInitFromConfig('test-config.json', {});

      expect(fs.readFile).toHaveBeenCalledWith('test-config.json', 'utf8');
      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
    });

    it('should handle individual project configurations', async () => {
      const mockConfig = {
        projectConfigs: {
          'api-project': {
            template: 'web-api',
            environment: 'dev',
          },
          'frontend-project': {
            template: 'react-app',
            environment: 'prod',
          },
        },
      };

      fs.readFile.mockResolvedValue(JSON.stringify(mockConfig));

      const results = await batchInitFromConfig('projects.json', {});

      expect(results).toHaveLength(2);
      expect(results.every(r => r.hasOwnProperty('success'))).toBe(true);
    });

    it('should handle invalid configuration file', async () => {
      fs.readFile.mockRejectedValue(new Error('File not found'));

      const results = await batchInitFromConfig('missing.json', {});

      expect(results).toBeUndefined();

      const { printError } = require('../../../../../src/cli/utils.js');
      expect(printError).toHaveBeenCalledWith(
        expect.stringContaining('Failed to read batch config file')
      );
    });

    it('should handle malformed JSON', async () => {
      fs.readFile.mockResolvedValue('invalid json {');

      const results = await batchInitFromConfig('bad.json', {});

      expect(results).toBeUndefined();

      const { printError } = require('../../../../../src/cli/utils.js');
      expect(printError).toHaveBeenCalledWith(
        expect.stringContaining('Failed to read batch config file')
      );
    });
  });

  describe('validateBatchOptions', () => {
    it('should validate correct options', () => {
      const validOptions = {
        maxConcurrency: 5,
        template: 'web-api',
        environments: ['dev', 'staging'],
      };

      const errors = validateBatchOptions(validOptions);
      expect(errors).toHaveLength(0);
    });

    it('should reject invalid concurrency values', () => {
      const invalidOptions = {
        maxConcurrency: 0,
      };

      const errors = validateBatchOptions(invalidOptions);
      expect(errors).toContain('maxConcurrency must be between 1 and 20');
    });

    it('should reject invalid templates', () => {
      const invalidOptions = {
        template: 'nonexistent-template',
      };

      const errors = validateBatchOptions(invalidOptions);
      expect(errors).toContain(
        expect.stringContaining('Unknown template: nonexistent-template')
      );
    });

    it('should reject invalid environments', () => {
      const invalidOptions = {
        environments: ['dev', 'invalid-env'],
      };

      const errors = validateBatchOptions(invalidOptions);
      expect(errors).toContain(
        expect.stringContaining('Unknown environment: invalid-env')
      );
    });

    it('should handle multiple validation errors', () => {
      const invalidOptions = {
        maxConcurrency: 25,
        template: 'invalid',
        environments: ['invalid1', 'invalid2'],
      };

      const errors = validateBatchOptions(invalidOptions);
      expect(errors.length).toBeGreaterThan(1);
    });
  });

  describe('Project Templates', () => {
    it('should have all required templates defined', () => {
      expect(PROJECT_TEMPLATES).toHaveProperty('web-api');
      expect(PROJECT_TEMPLATES).toHaveProperty('react-app');
      expect(PROJECT_TEMPLATES).toHaveProperty('microservice');
      expect(PROJECT_TEMPLATES).toHaveProperty('cli-tool');

      // Verify template structure
      Object.values(PROJECT_TEMPLATES).forEach(template => {
        expect(template).toHaveProperty('name');
        expect(template).toHaveProperty('description');
        expect(template).toHaveProperty('extraDirs');
        expect(template).toHaveProperty('extraFiles');
      });
    });

    it('should have valid environment configurations', () => {
      expect(ENVIRONMENT_CONFIGS).toHaveProperty('dev');
      expect(ENVIRONMENT_CONFIGS).toHaveProperty('staging');
      expect(ENVIRONMENT_CONFIGS).toHaveProperty('prod');

      // Verify environment structure
      Object.values(ENVIRONMENT_CONFIGS).forEach(env => {
        expect(env).toHaveProperty('name');
        expect(env).toHaveProperty('features');
        expect(env).toHaveProperty('config');
      });
    });
  });

  describe('Performance and Resource Management', () => {
    it('should handle resource constraints', async () => {
      const projects = Array.from({ length: 5 }, (_, i) => `resource-project${i}`);
      const options = {
        maxConcurrency: 2,
        progressTracking: false,
        performanceMonitoring: false,
      };

      const results = await batchInitCommand(projects, options);

      expect(results).toHaveLength(5);
      expect(results.every(r => r.hasOwnProperty('success'))).toBe(true);
    });

    it('should track progress when enabled', async () => {
      const projects = ['progress-project'];
      const options = {
        progressTracking: true,
        performanceMonitoring: false,
      };

      // Mock console.clear and console.log to prevent output during tests
      const originalConsole = { ...console };
      console.clear = jest.fn();
      console.log = jest.fn();

      const results = await batchInitCommand(projects, options);

      expect(results).toHaveLength(1);

      // Restore console
      Object.assign(console, originalConsole);
    });
  });
});