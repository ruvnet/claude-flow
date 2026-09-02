// validation.test.js - Tests for validation system
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { promises as fs } from 'fs';
import {
  ValidationSystem,
  runFullValidation
} from '../../../../../src/cli/simple-commands/init/validation/index.js';

// Mock dependencies
jest.mock('fs', () => ({
  promises: {
    access: jest.fn(),
    stat: jest.fn(),
    readFile: jest.fn(),
    readdir: jest.fn(),
  },
  constants: {
    F_OK: 0,
    R_OK: 4,
    W_OK: 2,
  },
}));

jest.mock('os', () => ({
  freemem: jest.fn(() => 8 * 1024 * 1024 * 1024), // 8GB
  totalmem: jest.fn(() => 16 * 1024 * 1024 * 1024), // 16GB
  platform: jest.fn(() => 'linux'),
}));

jest.mock('process', () => ({
  getuid: jest.fn(() => 1000),
  getgid: jest.fn(() => 1000),
  cwd: jest.fn(() => '/test/workspace'),
}));

// Mock validation classes
jest.mock('../../../../../src/cli/simple-commands/init/validation/pre-init-validator.js', () => ({
  PreInitValidator: jest.fn().mockImplementation(() => ({
    checkPermissions: jest.fn().mockResolvedValue({
      success: true,
      errors: [],
      message: 'Permissions OK',
    }),
    checkDiskSpace: jest.fn().mockResolvedValue({
      success: true,
      errors: [],
      message: 'Disk space sufficient',
    }),
    checkConflicts: jest.fn().mockResolvedValue({
      success: true,
      errors: [],
      warnings: [],
      message: 'No conflicts found',
    }),
    checkDependencies: jest.fn().mockResolvedValue({
      success: true,
      errors: [],
      message: 'Dependencies OK',
    }),
    checkEnvironment: jest.fn().mockResolvedValue({
      success: true,
      errors: [],
      message: 'Environment OK',
    }),
  })),
}));

jest.mock('../../../../../src/cli/simple-commands/init/validation/post-init-validator.js', () => ({
  PostInitValidator: jest.fn().mockImplementation(() => ({
    checkFileIntegrity: jest.fn().mockResolvedValue({
      success: true,
      errors: [],
      message: 'File integrity OK',
    }),
    checkCompleteness: jest.fn().mockResolvedValue({
      success: true,
      errors: [],
      message: 'Initialization complete',
    }),
    validateStructure: jest.fn().mockResolvedValue({
      success: true,
      errors: [],
      message: 'Structure valid',
    }),
    checkPermissions: jest.fn().mockResolvedValue({
      success: true,
      errors: [],
      message: 'Permissions OK',
    }),
  })),
}));

jest.mock('../../../../../src/cli/simple-commands/init/validation/config-validator.js', () => ({
  ConfigValidator: jest.fn().mockImplementation(() => ({
    validateRoomodes: jest.fn().mockResolvedValue({
      success: true,
      errors: [],
      message: 'Roomodes config valid',
    }),
    validateClaudeMd: jest.fn().mockResolvedValue({
      success: true,
      errors: [],
      message: 'CLAUDE.md valid',
    }),
    validateMemoryConfig: jest.fn().mockResolvedValue({
      success: true,
      errors: [],
      message: 'Memory config valid',
    }),
    validateCoordinationConfig: jest.fn().mockResolvedValue({
      success: true,
      errors: [],
      message: 'Coordination config valid',
    }),
  })),
}));

jest.mock('../../../../../src/cli/simple-commands/init/validation/mode-validator.js', () => ({
  ModeValidator: jest.fn().mockImplementation(() => ({
    testAllModes: jest.fn().mockResolvedValue({
      success: true,
      modes: {
        'sparc-architect': { success: true, message: 'Mode working' },
        'sparc-tdd': { success: true, message: 'Mode working' },
      },
      errors: [],
      warnings: [],
    }),
  })),
}));

jest.mock('../../../../../src/cli/simple-commands/init/validation/health-checker.js', () => ({
  HealthChecker: jest.fn().mockImplementation(() => ({
    checkModeAvailability: jest.fn().mockResolvedValue({
      success: true,
      errors: [],
      message: 'All modes available',
    }),
    checkTemplateIntegrity: jest.fn().mockResolvedValue({
      success: true,
      errors: [],
      message: 'Templates OK',
    }),
    checkConfigConsistency: jest.fn().mockResolvedValue({
      success: true,
      errors: [],
      message: 'Config consistent',
    }),
    checkSystemResources: jest.fn().mockResolvedValue({
      success: true,
      errors: [],
      message: 'Resources OK',
    }),
  })),
}));

describe('ValidationSystem', () => {
  let validationSystem;

  beforeEach(() => {
    jest.clearAllMocks();
    validationSystem = new ValidationSystem('/test/workspace');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Pre-initialization Validation', () => {
    it('should validate pre-init requirements successfully', async () => {
      const result = await validationSystem.validatePreInit();

      expect(result.success).toBe(true);
      expect(result.checks).toHaveProperty('permissions');
      expect(result.checks).toHaveProperty('diskSpace');
      expect(result.checks).toHaveProperty('conflicts');
      expect(result.checks).toHaveProperty('dependencies');
      expect(result.checks).toHaveProperty('environment');
      expect(result.errors).toHaveLength(0);
    });

    it('should handle permission failures', async () => {
      const { PreInitValidator } = require('../../../../../src/cli/simple-commands/init/validation/pre-init-validator.js');
      const mockValidator = new PreInitValidator();
      mockValidator.checkPermissions.mockResolvedValue({
        success: false,
        errors: ['Insufficient permissions'],
      });

      validationSystem.preInitValidator = mockValidator;

      const result = await validationSystem.validatePreInit();

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Insufficient permissions');
    });

    it('should handle disk space issues', async () => {
      const { PreInitValidator } = require('../../../../../src/cli/simple-commands/init/validation/pre-init-validator.js');
      const mockValidator = new PreInitValidator();
      mockValidator.checkDiskSpace.mockResolvedValue({
        success: false,
        errors: ['Insufficient disk space'],
      });

      validationSystem.preInitValidator = mockValidator;

      const result = await validationSystem.validatePreInit();

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Insufficient disk space');
    });

    it('should handle file conflicts with force option', async () => {
      const { PreInitValidator } = require('../../../../../src/cli/simple-commands/init/validation/pre-init-validator.js');
      const mockValidator = new PreInitValidator();
      mockValidator.checkConflicts.mockResolvedValue({
        success: false,
        errors: ['Files already exist'],
        warnings: ['Will overwrite existing files'],
      });

      validationSystem.preInitValidator = mockValidator;

      const result = await validationSystem.validatePreInit({ force: true });

      expect(result.success).toBe(true); // Should succeed with force
      expect(result.warnings).toContain('Will overwrite existing files');
    });

    it('should handle validation exceptions', async () => {
      const { PreInitValidator } = require('../../../../../src/cli/simple-commands/init/validation/pre-init-validator.js');
      const mockValidator = new PreInitValidator();
      mockValidator.checkPermissions.mockRejectedValue(new Error('Validation error'));

      validationSystem.preInitValidator = mockValidator;

      const result = await validationSystem.validatePreInit();

      expect(result.success).toBe(false);
      expect(result.errors).toContain(
        expect.stringContaining('Pre-initialization validation failed')
      );
    });
  });

  describe('Post-initialization Validation', () => {
    it('should validate post-init state successfully', async () => {
      const result = await validationSystem.validatePostInit();

      expect(result.success).toBe(true);
      expect(result.checks).toHaveProperty('fileIntegrity');
      expect(result.checks).toHaveProperty('completeness');
      expect(result.checks).toHaveProperty('structure');
      expect(result.checks).toHaveProperty('permissions');
      expect(result.errors).toHaveLength(0);
    });

    it('should detect file integrity issues', async () => {
      const { PostInitValidator } = require('../../../../../src/cli/simple-commands/init/validation/post-init-validator.js');
      const mockValidator = new PostInitValidator();
      mockValidator.checkFileIntegrity.mockResolvedValue({
        success: false,
        errors: ['Corrupted file detected'],
      });

      validationSystem.postInitValidator = mockValidator;

      const result = await validationSystem.validatePostInit();

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Corrupted file detected');
    });

    it('should detect incomplete initialization', async () => {
      const { PostInitValidator } = require('../../../../../src/cli/simple-commands/init/validation/post-init-validator.js');
      const mockValidator = new PostInitValidator();
      mockValidator.checkCompleteness.mockResolvedValue({
        success: false,
        errors: ['Missing required files'],
      });

      validationSystem.postInitValidator = mockValidator;

      const result = await validationSystem.validatePostInit();

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Missing required files');
    });
  });

  describe('Configuration Validation', () => {
    it('should validate configuration files successfully', async () => {
      const result = await validationSystem.validateConfiguration();

      expect(result.success).toBe(true);
      expect(result.checks).toHaveProperty('roomodes');
      expect(result.checks).toHaveProperty('claudeMd');
      expect(result.checks).toHaveProperty('memory');
      expect(result.checks).toHaveProperty('coordination');
    });

    it('should handle configuration errors as warnings', async () => {
      const { ConfigValidator } = require('../../../../../src/cli/simple-commands/init/validation/config-validator.js');
      const mockValidator = new ConfigValidator();
      mockValidator.validateClaudeMd.mockResolvedValue({
        success: false,
        errors: ['Invalid CLAUDE.md format'],
      });

      validationSystem.configValidator = mockValidator;

      const result = await validationSystem.validateConfiguration();

      expect(result.success).toBe(true); // Config errors are warnings
      expect(result.warnings).toContain('Invalid CLAUDE.md format');
    });
  });

  describe('Mode Functionality Testing', () => {
    it('should test all SPARC modes successfully', async () => {
      const result = await validationSystem.testModeFunctionality();

      expect(result.success).toBe(true);
      expect(result.modes).toHaveProperty('sparc-architect');
      expect(result.modes).toHaveProperty('sparc-tdd');
    });

    it('should handle mode test failures', async () => {
      const { ModeValidator } = require('../../../../../src/cli/simple-commands/init/validation/mode-validator.js');
      const mockValidator = new ModeValidator();
      mockValidator.testAllModes.mockResolvedValue({
        success: false,
        modes: {
          'sparc-architect': { success: false, message: 'Mode failed' },
        },
        errors: ['Mode test failed'],
        warnings: [],
      });

      validationSystem.modeValidator = mockValidator;

      const result = await validationSystem.testModeFunctionality();

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Mode test failed');
    });
  });

  describe('Health Checks', () => {
    it('should run health checks successfully', async () => {
      const result = await validationSystem.runHealthChecks();

      expect(result.success).toBe(true);
      expect(result.health).toHaveProperty('modes');
      expect(result.health).toHaveProperty('templates');
      expect(result.health).toHaveProperty('configuration');
      expect(result.health).toHaveProperty('resources');
    });

    it('should detect health issues', async () => {
      const { HealthChecker } = require('../../../../../src/cli/simple-commands/init/validation/health-checker.js');
      const mockChecker = new HealthChecker();
      mockChecker.checkTemplateIntegrity.mockResolvedValue({
        success: false,
        errors: ['Template corruption detected'],
      });

      validationSystem.healthChecker = mockChecker;

      const result = await validationSystem.runHealthChecks();

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Template corruption detected');
    });
  });

  describe('Report Generation', () => {
    it('should generate comprehensive validation report', () => {
      const mockResults = {
        success: true,
        errors: [],
        warnings: ['Minor warning'],
        preInit: {
          success: true,
          checks: {
            permissions: { success: true, message: 'OK' },
            diskSpace: { success: true, message: 'OK' },
          },
        },
        postInit: {
          success: true,
          checks: {
            fileIntegrity: { success: true, message: 'OK' },
          },
        },
      };

      const report = validationSystem.generateReport(mockResults);

      expect(report).toContain('SPARC Initialization Validation Report');
      expect(report).toContain('PASSED');
      expect(report).toContain('permissions');
      expect(report).toContain('diskSpace');
      expect(report).toContain('fileIntegrity');
      expect(report).toContain('Minor warning');
    });

    it('should generate failure report', () => {
      const mockResults = {
        success: false,
        errors: ['Critical error'],
        warnings: [],
        preInit: {
          success: false,
          checks: {
            permissions: { success: false, message: 'Failed' },
          },
        },
      };

      const report = validationSystem.generateReport(mockResults);

      expect(report).toContain('FAILED');
      expect(report).toContain('Critical error');
      expect(report).toContain('✗ permissions');
    });
  });
});

describe('runFullValidation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should run complete validation suite', async () => {
    const result = await runFullValidation('/test/workspace');

    expect(result.success).toBe(true);
    expect(result).toHaveProperty('preInit');
    expect(result).toHaveProperty('postInit');
    expect(result).toHaveProperty('configuration');
    expect(result).toHaveProperty('modeFunctionality');
    expect(result).toHaveProperty('health');
    expect(result).toHaveProperty('report');
  });

  it('should skip phases based on options', async () => {
    const result = await runFullValidation('/test/workspace', {
      skipPreInit: true,
      skipConfig: true,
      skipModeTest: true,
    });

    expect(result).not.toHaveProperty('preInit');
    expect(result).not.toHaveProperty('configuration');
    expect(result).not.toHaveProperty('modeFunctionality');
    expect(result).toHaveProperty('health'); // Always runs
  });

  it('should stop early on pre-init failure', async () => {
    // Mock pre-init failure
    const { PreInitValidator } = require('../../../../../src/cli/simple-commands/init/validation/pre-init-validator.js');
    const mockValidator = new PreInitValidator();
    mockValidator.checkPermissions.mockResolvedValue({
      success: false,
      errors: ['Critical permission error'],
    });

    const result = await runFullValidation('/test/workspace');

    expect(result.success).toBe(false);
    expect(result).toHaveProperty('preInit');
    expect(result).not.toHaveProperty('postInit'); // Should stop early
  });

  it('should accumulate errors and warnings', async () => {
    // Mock various validation failures
    const { PostInitValidator } = require('../../../../../src/cli/simple-commands/init/validation/post-init-validator.js');
    const mockPostValidator = new PostInitValidator();
    mockPostValidator.checkFileIntegrity.mockResolvedValue({
      success: false,
      errors: ['File error'],
    });

    const { ConfigValidator } = require('../../../../../src/cli/simple-commands/init/validation/config-validator.js');
    const mockConfigValidator = new ConfigValidator();
    mockConfigValidator.validateClaudeMd.mockResolvedValue({
      success: false,
      errors: ['Config warning'],
    });

    const result = await runFullValidation('/test/workspace', { postInit: true });

    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});