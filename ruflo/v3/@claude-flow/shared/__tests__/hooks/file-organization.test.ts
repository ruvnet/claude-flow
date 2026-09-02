/**
 * V3 File Organization Hook Tests
 *
 * Tests for file organization enforcement and formatter recommendations.
 *
 * @module v3/shared/hooks/__tests__/file-organization.test
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createHookRegistry,
  createFileOrganizationHook,
  FileOrganizationHook,
  HookRegistry,
} from '../../src/hooks/index.js';

describe('FileOrganizationHook', () => {
  let registry: HookRegistry;
  let fileOrg: FileOrganizationHook;

  beforeEach(() => {
    registry = createHookRegistry();
    fileOrg = createFileOrganizationHook(registry);
  });

  describe('root folder blocking', () => {
    it('should block TypeScript source files in root', async () => {
      const result = await fileOrg.analyze('utils.ts');

      expect(result.blocked).toBe(true);
      expect(result.blockReason).toBeDefined();
      expect(result.suggestedDirectory).toBe('src/');
      expect(result.suggestedPath).toBe('src/utils.ts');
    });

    it('should block JavaScript source files in root', async () => {
      const result = await fileOrg.analyze('index.js');

      expect(result.blocked).toBe(true);
      expect(result.suggestedDirectory).toBe('src/');
    });

    it('should block TypeScript test files in root', async () => {
      const result = await fileOrg.analyze('utils.test.ts');

      expect(result.blocked).toBe(true);
      expect(result.suggestedDirectory).toBe('tests/');
      expect(result.suggestedPath).toBe('tests/utils.test.ts');
    });

    it('should block spec files in root', async () => {
      const result = await fileOrg.analyze('api.spec.ts');

      expect(result.blocked).toBe(true);
      expect(result.suggestedDirectory).toBe('tests/');
    });

    it('should block Python files in root', async () => {
      const result = await fileOrg.analyze('main.py');

      expect(result.blocked).toBe(true);
      expect(result.suggestedDirectory).toBe('src/');
    });

    it('should block Go files in root', async () => {
      const result = await fileOrg.analyze('main.go');

      expect(result.blocked).toBe(true);
      expect(result.suggestedDirectory).toBe('cmd/');
    });

    it('should block shell scripts in root', async () => {
      const result = await fileOrg.analyze('deploy.sh');

      expect(result.blocked).toBe(true);
      expect(result.suggestedDirectory).toBe('scripts/');
    });

    it('should block CSS files in root', async () => {
      const result = await fileOrg.analyze('styles.css');

      expect(result.blocked).toBe(true);
      expect(result.suggestedDirectory).toBe('styles/');
    });
  });

  describe('allowed root files', () => {
    it('should allow JSON config files in root', async () => {
      const result = await fileOrg.analyze('package.json');

      expect(result.blocked).toBe(false);
    });

    it('should allow YAML config files in root', async () => {
      const result = await fileOrg.analyze('config.yaml');

      expect(result.blocked).toBe(false);
    });

    it('should allow Markdown files in root', async () => {
      const result = await fileOrg.analyze('README.md');

      expect(result.blocked).toBe(false);
    });

    it('should allow environment files in root', async () => {
      const result = await fileOrg.analyze('.env');

      expect(result.blocked).toBe(false);
    });

    it('should allow .env.local files in root', async () => {
      const result = await fileOrg.analyze('.env.local');

      expect(result.blocked).toBe(false);
    });
  });

  describe('files in correct directories', () => {
    it('should allow TypeScript files in src/', async () => {
      const result = await fileOrg.analyze('src/utils.ts');

      expect(result.blocked).toBe(false);
      expect(result.issues?.some(i => i.type === 'wrong-directory')).toBeFalsy();
    });

    it('should allow test files in tests/', async () => {
      const result = await fileOrg.analyze('tests/utils.test.ts');

      expect(result.blocked).toBe(false);
    });

    it('should allow test files in __tests__/', async () => {
      const result = await fileOrg.analyze('__tests__/utils.test.ts');

      expect(result.blocked).toBe(false);
    });

    it('should allow scripts in scripts/', async () => {
      const result = await fileOrg.analyze('scripts/deploy.sh');

      expect(result.blocked).toBe(false);
    });

    it('should allow Go files in cmd/', async () => {
      const result = await fileOrg.analyze('cmd/main.go');

      expect(result.blocked).toBe(false);
    });
  });

  describe('files in wrong directories', () => {
    it('should warn about test files in src/', async () => {
      const result = await fileOrg.analyze('src/utils.test.ts');

      expect(result.blocked).toBe(false);
      expect(result.issues?.some(i => i.type === 'wrong-directory')).toBe(true);
      expect(result.warnings?.length).toBeGreaterThan(0);
    });

    it('should warn about source files in tests/', async () => {
      const result = await fileOrg.analyze('tests/utils.ts');

      expect(result.blocked).toBe(false);
      expect(result.issues?.some(i => i.type === 'wrong-directory')).toBe(true);
    });
  });

  describe('formatter recommendations', () => {
    it('should recommend Prettier for TypeScript', async () => {
      const result = await fileOrg.analyze('src/utils.ts');

      expect(result.formatter).toBeDefined();
      expect(result.formatter!.name).toBe('Prettier');
      expect(result.formatter!.command).toBe('prettier --write');
    });

    it('should recommend Black for Python', async () => {
      const result = await fileOrg.analyze('src/main.py');

      expect(result.formatter).toBeDefined();
      expect(result.formatter!.name).toBe('Black');
      expect(result.formatter!.command).toBe('black');
    });

    it('should recommend gofmt for Go', async () => {
      const result = await fileOrg.analyze('cmd/main.go');

      expect(result.formatter).toBeDefined();
      expect(result.formatter!.name).toBe('gofmt');
      expect(result.formatter!.command).toBe('gofmt -w');
    });

    it('should recommend rustfmt for Rust', async () => {
      const result = await fileOrg.analyze('src/main.rs');

      expect(result.formatter).toBeDefined();
      expect(result.formatter!.name).toBe('rustfmt');
    });

    it('should recommend Prettier for CSS', async () => {
      const result = await fileOrg.analyze('styles/app.css');

      expect(result.formatter).toBeDefined();
      expect(result.formatter!.name).toBe('Prettier');
    });

    it('should recommend Prettier for JSON', async () => {
      const result = await fileOrg.analyze('config.json');

      expect(result.formatter).toBeDefined();
      expect(result.formatter!.name).toBe('Prettier');
    });
  });

  describe('linter recommendations', () => {
    it('should recommend ESLint for TypeScript', async () => {
      const result = await fileOrg.analyze('src/utils.ts');

      expect(result.linter).toBeDefined();
      expect(result.linter!.name).toBe('ESLint');
    });

    it('should recommend Pylint for Python', async () => {
      const result = await fileOrg.analyze('src/main.py');

      expect(result.linter).toBeDefined();
      expect(result.linter!.name).toBe('Pylint');
    });

    it('should recommend golangci-lint for Go', async () => {
      const result = await fileOrg.analyze('cmd/main.go');

      expect(result.linter).toBeDefined();
      expect(result.linter!.name).toBe('golangci-lint');
    });

    it('should recommend Clippy for Rust', async () => {
      const result = await fileOrg.analyze('src/main.rs');

      expect(result.linter).toBeDefined();
      expect(result.linter!.name).toBe('Clippy');
    });
  });

  describe('organization issues', () => {
    it('should detect root write issues', async () => {
      const result = await fileOrg.analyze('utils.ts');

      expect(result.issues).toBeDefined();
      expect(result.issues!.some(i => i.type === 'root-write')).toBe(true);
      expect(result.issues![0].severity).toBe('error');
    });

    it('should provide suggested fixes', async () => {
      const result = await fileOrg.analyze('utils.ts');

      expect(result.issues).toBeDefined();
      expect(result.issues![0].suggestedFix).toBeDefined();
    });
  });

  describe('helper methods', () => {
    it('should get suggested directory for file', () => {
      expect(fileOrg.getSuggestedDirectory('app.ts')).toBe('src/');
      expect(fileOrg.getSuggestedDirectory('test.spec.ts')).toBe('tests/');
      expect(fileOrg.getSuggestedDirectory('deploy.sh')).toBe('scripts/');
    });

    it('should check if file would be blocked', () => {
      expect(fileOrg.wouldBlock('utils.ts')).toBe(true);
      expect(fileOrg.wouldBlock('package.json')).toBe(false);
      expect(fileOrg.wouldBlock('src/utils.ts')).toBe(false);
    });

    it('should allow setting project root', () => {
      fileOrg.setProjectRoot('/custom/project');
      // No error should be thrown
    });

    it('should get all formatters', () => {
      const formatters = fileOrg.getAllFormatters();

      expect(formatters['.ts']).toBeDefined();
      expect(formatters['.py']).toBeDefined();
      expect(formatters['.go']).toBeDefined();
    });

    it('should get all linters', () => {
      const linters = fileOrg.getAllLinters();

      expect(linters['.ts']).toBeDefined();
      expect(linters['.py']).toBeDefined();
      expect(linters['.go']).toBeDefined();
    });
  });

  describe('file type detection', () => {
    it('should detect TypeScript source type', async () => {
      const result = await fileOrg.analyze('src/app.ts');

      expect(result.fileType).toBe('TypeScript source');
    });

    it('should detect test file type', async () => {
      const result = await fileOrg.analyze('tests/app.test.ts');

      expect(result.fileType).toBe('test file');
    });

    it('should detect spec file type', async () => {
      const result = await fileOrg.analyze('spec/app.spec.ts');

      expect(result.fileType).toBe('spec file');
    });

    it('should detect shell script type', async () => {
      const result = await fileOrg.analyze('scripts/build.sh');

      expect(result.fileType).toBe('shell script');
    });

    it('should detect SQL file type', async () => {
      const result = await fileOrg.analyze('migrations/001_init.sql');

      expect(result.fileType).toBe('SQL file');
    });

    it('should detect image file type', async () => {
      const result = await fileOrg.analyze('assets/logo.png');

      expect(result.fileType).toBe('image');
    });
  });
});
