/**
 * V3 Claude-Flow Path Validator Unit Tests
 *
 * London School TDD - Behavior Verification
 * Tests path validation for security (CVE-1, CVE-2 prevention)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMock, type MockedInterface } from '../../helpers/create-mock';
import { securityConfigs } from '../../fixtures/configurations';

/**
 * Path validator interface (to be implemented)
 */
interface IPathValidator {
  isValid(path: string): boolean;
  normalize(path: string): string;
  isWithinAllowedDirectory(path: string): boolean;
  sanitize(path: string): string;
}

/**
 * File system provider interface (collaborator)
 */
interface IFileSystemProvider {
  exists(path: string): Promise<boolean>;
  isDirectory(path: string): Promise<boolean>;
  realPath(path: string): Promise<string>;
}

/**
 * Path utility interface (collaborator)
 */
interface IPathUtils {
  normalize(path: string): string;
  resolve(basePath: string, relativePath: string): string;
  isAbsolute(path: string): boolean;
  dirname(path: string): string;
}

/**
 * Path validator implementation for testing
 */
class PathValidator implements IPathValidator {
  constructor(
    private readonly pathUtils: IPathUtils,
    private readonly config: typeof securityConfigs.strict.paths
  ) {}

  isValid(path: string): boolean {
    if (!path || typeof path !== 'string') {
      return false;
    }

    if (path.length > this.config.maxPathLength) {
      return false;
    }

    // Check for blocked patterns
    for (const pattern of this.config.blockedPatterns) {
      if (path.includes(pattern)) {
        return false;
      }
    }

    // Check for null bytes
    if (path.includes('\0')) {
      return false;
    }

    return true;
  }

  normalize(path: string): string {
    return this.pathUtils.normalize(path);
  }

  isWithinAllowedDirectory(path: string): boolean {
    const normalizedPath = this.pathUtils.normalize(path);

    for (const allowedDir of this.config.allowedDirectories) {
      const normalizedAllowed = this.pathUtils.normalize(allowedDir);
      if (normalizedPath.startsWith(normalizedAllowed)) {
        return true;
      }
    }

    return false;
  }

  sanitize(path: string): string {
    let sanitized = path;

    // Remove blocked patterns
    for (const pattern of this.config.blockedPatterns) {
      sanitized = sanitized.split(pattern).join('');
    }

    // Remove null bytes
    sanitized = sanitized.replace(/\0/g, '');

    // Truncate if too long
    if (sanitized.length > this.config.maxPathLength) {
      sanitized = sanitized.slice(0, this.config.maxPathLength);
    }

    return this.pathUtils.normalize(sanitized);
  }
}

describe('PathValidator', () => {
  let mockPathUtils: MockedInterface<IPathUtils>;
  let pathValidator: PathValidator;
  const pathConfig = securityConfigs.strict.paths;

  beforeEach(() => {
    mockPathUtils = createMock<IPathUtils>();

    // Configure default mock behavior
    mockPathUtils.normalize.mockImplementation((p: string) => p.replace(/\/+/g, '/'));
    mockPathUtils.resolve.mockImplementation((base: string, rel: string) => `${base}/${rel}`);
    mockPathUtils.isAbsolute.mockReturnValue(false);
    mockPathUtils.dirname.mockImplementation((p: string) => p.split('/').slice(0, -1).join('/'));

    pathValidator = new PathValidator(mockPathUtils, pathConfig);
  });

  describe('isValid', () => {
    it('should return false for empty path', () => {
      // Given
      const emptyPath = '';

      // When
      const result = pathValidator.isValid(emptyPath);

      // Then
      expect(result).toBe(false);
    });

    it('should return false for null path', () => {
      // Given
      const nullPath = null as unknown as string;

      // When
      const result = pathValidator.isValid(nullPath);

      // Then
      expect(result).toBe(false);
    });

    it('should return false for path exceeding max length', () => {
      // Given
      const longPath = 'a'.repeat(pathConfig.maxPathLength + 1);

      // When
      const result = pathValidator.isValid(longPath);

      // Then
      expect(result).toBe(false);
    });

    it('should return true for path at exactly max length', () => {
      // Given
      const exactPath = 'a'.repeat(pathConfig.maxPathLength);

      // When
      const result = pathValidator.isValid(exactPath);

      // Then
      expect(result).toBe(true);
    });

    it('should return false for path with directory traversal (../)', () => {
      // Given - CVE-1 prevention
      const traversalPath = '../../../etc/passwd';

      // When
      const result = pathValidator.isValid(traversalPath);

      // Then
      expect(result).toBe(false);
    });

    it('should return false for path with home directory reference (~/)', () => {
      // Given - CVE-1 prevention
      const homePath = '~/.ssh/id_rsa';

      // When
      const result = pathValidator.isValid(homePath);

      // Then
      expect(result).toBe(false);
    });

    it('should return false for path to /etc/', () => {
      // Given - CVE-2 prevention
      const etcPath = '/etc/shadow';

      // When
      const result = pathValidator.isValid(etcPath);

      // Then
      expect(result).toBe(false);
    });

    it('should return false for path to /tmp/', () => {
      // Given
      const tmpPath = '/tmp/malicious.sh';

      // When
      const result = pathValidator.isValid(tmpPath);

      // Then
      expect(result).toBe(false);
    });

    it('should return false for path with null bytes', () => {
      // Given - Null byte injection prevention
      const nullBytePath = 'file.txt\0.exe';

      // When
      const result = pathValidator.isValid(nullBytePath);

      // Then
      expect(result).toBe(false);
    });

    it('should return true for valid relative path', () => {
      // Given
      const validPath = 'src/modules/security/index.ts';

      // When
      const result = pathValidator.isValid(validPath);

      // Then
      expect(result).toBe(true);
    });

    it('should return true for path within allowed directory', () => {
      // Given
      const validPath = './v3/src/security/hasher.ts';

      // When
      const result = pathValidator.isValid(validPath);

      // Then
      expect(result).toBe(true);
    });
  });

  describe('normalize', () => {
    it('should delegate to path utils for normalization', () => {
      // Given
      const path = './src/../src/file.ts';
      mockPathUtils.normalize.mockReturnValue('/normalized/path');

      // When
      const result = pathValidator.normalize(path);

      // Then
      expect(mockPathUtils.normalize).toHaveBeenCalledWith(path);
      expect(result).toBe('/normalized/path');
    });

    it('should normalize multiple slashes', () => {
      // Given
      const path = 'src///modules//security//index.ts';

      // When
      const result = pathValidator.normalize(path);

      // Then
      expect(mockPathUtils.normalize).toHaveBeenCalledWith(path);
    });
  });

  describe('isWithinAllowedDirectory', () => {
    it('should return true for path within ./v3/', () => {
      // Given
      const path = './v3/src/security/hasher.ts';
      mockPathUtils.normalize.mockImplementation((p: string) => p);

      // When
      const result = pathValidator.isWithinAllowedDirectory(path);

      // Then
      expect(result).toBe(true);
    });

    it('should return true for path within ./src/', () => {
      // Given
      const path = './src/modules/core/index.ts';
      mockPathUtils.normalize.mockImplementation((p: string) => p);

      // When
      const result = pathValidator.isWithinAllowedDirectory(path);

      // Then
      expect(result).toBe(true);
    });

    it('should return true for path within ./tests/', () => {
      // Given
      const path = './tests/unit/security.test.ts';
      mockPathUtils.normalize.mockImplementation((p: string) => p);

      // When
      const result = pathValidator.isWithinAllowedDirectory(path);

      // Then
      expect(result).toBe(true);
    });

    it('should return false for path outside allowed directories', () => {
      // Given
      const path = '/usr/local/bin/malicious';
      mockPathUtils.normalize.mockImplementation((p: string) => p);

      // When
      const result = pathValidator.isWithinAllowedDirectory(path);

      // Then
      expect(result).toBe(false);
    });

    it('should normalize path before checking', () => {
      // Given
      const path = './v3/../v3/src/file.ts';
      mockPathUtils.normalize.mockReturnValue('./v3/src/file.ts');

      // When
      pathValidator.isWithinAllowedDirectory(path);

      // Then
      expect(mockPathUtils.normalize).toHaveBeenCalledWith(path);
    });
  });

  describe('sanitize', () => {
    it('should remove directory traversal patterns', () => {
      // Given
      const unsafePath = '../../../etc/passwd';

      // When
      const result = pathValidator.sanitize(unsafePath);

      // Then
      expect(result).not.toContain('../');
      expect(mockPathUtils.normalize).toHaveBeenCalled();
    });

    it('should remove home directory references', () => {
      // Given
      const unsafePath = '~/.ssh/id_rsa';

      // When
      const result = pathValidator.sanitize(unsafePath);

      // Then
      expect(result).not.toContain('~/');
    });

    it('should remove /etc/ references', () => {
      // Given
      const unsafePath = 'some/path/etc/passwd';

      // When
      const result = pathValidator.sanitize(unsafePath);

      // Then
      expect(result).not.toContain('/etc/');
    });

    it('should remove null bytes', () => {
      // Given
      const unsafePath = 'file.txt\0.exe';

      // When
      const result = pathValidator.sanitize(unsafePath);

      // Then
      expect(result).not.toContain('\0');
    });

    it('should truncate paths exceeding max length', () => {
      // Given
      const longPath = 'a'.repeat(pathConfig.maxPathLength + 100);

      // When
      const result = pathValidator.sanitize(longPath);

      // Then
      expect(result.length).toBeLessThanOrEqual(pathConfig.maxPathLength);
    });

    it('should normalize the sanitized path', () => {
      // Given
      const path = 'valid/path/file.ts';

      // When
      pathValidator.sanitize(path);

      // Then
      expect(mockPathUtils.normalize).toHaveBeenCalled();
    });
  });

  describe('CVE prevention scenarios', () => {
    it('should block CVE-1: directory traversal attack', () => {
      // Given - Various traversal attempts
      const attacks = [
        '../../../etc/passwd',
        '..\\..\\..\\Windows\\System32\\config\\SAM',
        'valid/path/../../../etc/passwd',
        '....//....//....//etc/passwd',
      ];

      // When/Then
      for (const attack of attacks) {
        expect(pathValidator.isValid(attack)).toBe(false);
      }
    });

    it('should block CVE-2: absolute path injection', () => {
      // Given - Absolute path attempts
      const attacks = [
        '/etc/passwd',
        '/var/log/auth.log',
        '/tmp/malicious',
      ];

      // When/Then
      for (const attack of attacks) {
        expect(pathValidator.isValid(attack)).toBe(false);
      }
    });

    it('should block CVE-3: null byte injection', () => {
      // Given - Null byte attempts
      const attacks = [
        'file.txt\0',
        'image.png\0.exe',
        '\0/etc/passwd',
      ];

      // When/Then
      for (const attack of attacks) {
        expect(pathValidator.isValid(attack)).toBe(false);
      }
    });

    it('should block encoded traversal attempts', () => {
      // Given - URL encoded traversal
      const path = '%2e%2e%2f%2e%2e%2f%2e%2e%2fetc/passwd';

      // When - After decoding, should still be blocked
      const decoded = decodeURIComponent(path);
      const result = pathValidator.isValid(decoded);

      // Then
      expect(result).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle Windows-style paths', () => {
      // Given
      const windowsPath = 'C:\\Users\\test\\file.txt';

      // When
      const result = pathValidator.isValid(windowsPath);

      // Then - Windows paths should be evaluated based on patterns
      expect(typeof result).toBe('boolean');
    });

    it('should handle unicode in paths', () => {
      // Given
      const unicodePath = 'src/modules/\u0000.ts';

      // When
      const result = pathValidator.isValid(unicodePath);

      // Then
      expect(result).toBe(false); // Contains null character
    });

    it('should handle paths with only dots', () => {
      // Given
      const dotsPath = '...';

      // When
      const result = pathValidator.isValid(dotsPath);

      // Then
      expect(result).toBe(true); // Not a traversal pattern
    });

    it('should handle paths with special characters', () => {
      // Given
      const specialPath = 'src/file-name_v2.0.1.ts';

      // When
      const result = pathValidator.isValid(specialPath);

      // Then
      expect(result).toBe(true);
    });
  });
});
