/**
 * Mock Factory Utilities for Security Module Testing
 *
 * Provides type-safe mock creation utilities for testing security components.
 * Uses vitest's mocking capabilities with full TypeScript support.
 *
 * @module v3/security/__tests__/helpers/create-mock
 */

import { vi, type MockInstance } from 'vitest';

/**
 * Type representing a mocked interface where all methods are vi.fn() mocks
 */
export type MockedInterface<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? MockInstance<(...args: A) => R>
    : T[K];
};

/**
 * Type for a deeply mocked interface (including nested objects)
 */
export type DeepMockedInterface<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? MockInstance<(...args: A) => R>
    : T[K] extends object
    ? DeepMockedInterface<T[K]>
    : T[K];
};

/**
 * Creates a type-safe mock object for an interface.
 * All methods are replaced with vi.fn() mocks.
 *
 * @example
 * ```typescript
 * interface IService {
 *   getData(): Promise<string>;
 *   process(input: number): boolean;
 * }
 *
 * const mock = createMock<IService>();
 * mock.getData.mockResolvedValue('test');
 * mock.process.mockReturnValue(true);
 * ```
 *
 * @returns A proxy-based mock object
 */
export function createMock<T extends object>(): MockedInterface<T> {
  const cache = new Map<string | symbol, MockInstance>();

  return new Proxy({} as MockedInterface<T>, {
    get(target, prop) {
      if (!cache.has(prop)) {
        cache.set(prop, vi.fn());
      }
      return cache.get(prop);
    },
  });
}

/**
 * Creates a partial mock with some real implementations.
 *
 * @param overrides - Partial implementation to use
 * @returns A mock object with the provided overrides
 *
 * @example
 * ```typescript
 * const mock = createPartialMock<IService>({
 *   getData: vi.fn().mockResolvedValue('real'),
 * });
 * ```
 */
export function createPartialMock<T extends object>(
  overrides: Partial<MockedInterface<T>> = {}
): MockedInterface<T> {
  const baseMock = createMock<T>();
  return { ...baseMock, ...overrides };
}

/**
 * Creates a spy on an existing object's methods.
 *
 * @param obj - The object to spy on
 * @param methods - Array of method names to spy on
 * @returns The object with spied methods
 *
 * @example
 * ```typescript
 * const service = new RealService();
 * const spied = createSpy(service, ['getData', 'process']);
 * ```
 */
export function createSpy<T extends object, K extends keyof T>(
  obj: T,
  methods: K[]
): T & { [P in K]: MockInstance } {
  const spiedObj = { ...obj } as T & { [P in K]: MockInstance };

  for (const method of methods) {
    if (typeof obj[method] === 'function') {
      (spiedObj as Record<K, MockInstance>)[method] = vi.fn(
        (obj[method] as Function).bind(obj)
      );
    }
  }

  return spiedObj;
}

/**
 * Mock factory for PasswordHasher
 */
export interface MockPasswordHasher {
  hash: MockInstance<(password: string) => Promise<string>>;
  verify: MockInstance<(password: string, hash: string) => Promise<boolean>>;
  validate: MockInstance<(password: string) => { isValid: boolean; errors: string[] }>;
  needsRehash: MockInstance<(hash: string) => boolean>;
  getConfig: MockInstance<() => Record<string, unknown>>;
}

export function createMockPasswordHasher(
  overrides: Partial<MockPasswordHasher> = {}
): MockPasswordHasher {
  return {
    hash: vi.fn().mockResolvedValue('$2b$12$mockedHashValue'),
    verify: vi.fn().mockResolvedValue(true),
    validate: vi.fn().mockReturnValue({ isValid: true, errors: [] }),
    needsRehash: vi.fn().mockReturnValue(false),
    getConfig: vi.fn().mockReturnValue({ rounds: 12 }),
    ...overrides,
  };
}

/**
 * Mock factory for CredentialGenerator
 */
export interface MockCredentialGenerator {
  generatePassword: MockInstance<(length?: number) => string>;
  generateApiKey: MockInstance<(prefix?: string) => { key: string; prefix: string; keyId: string; createdAt: Date }>;
  generateSecret: MockInstance<(length?: number) => string>;
  generateEncryptionKey: MockInstance<() => string>;
  generateInstallationCredentials: MockInstance<(expirationDays?: number) => {
    adminPassword: string;
    servicePassword: string;
    jwtSecret: string;
    sessionSecret: string;
    encryptionKey: string;
    generatedAt: Date;
    expiresAt?: Date;
  }>;
  generateSessionToken: MockInstance<() => string>;
  generateCsrfToken: MockInstance<() => string>;
  generateNonce: MockInstance<() => string>;
}

export function createMockCredentialGenerator(
  overrides: Partial<MockCredentialGenerator> = {}
): MockCredentialGenerator {
  const now = new Date();
  return {
    generatePassword: vi.fn().mockReturnValue('MockedSecureP@ssword123!'),
    generateApiKey: vi.fn().mockReturnValue({
      key: 'cf_mockedApiKey12345',
      prefix: 'cf_',
      keyId: '550e8400-e29b-41d4-a716-446655440000',
      createdAt: now,
    }),
    generateSecret: vi.fn().mockReturnValue('0'.repeat(64)),
    generateEncryptionKey: vi.fn().mockReturnValue('a'.repeat(64)),
    generateInstallationCredentials: vi.fn().mockReturnValue({
      adminPassword: 'MockedAdminP@ss123!',
      servicePassword: 'MockedServiceP@ss123!',
      jwtSecret: '0'.repeat(64),
      sessionSecret: '1'.repeat(64),
      encryptionKey: 'a'.repeat(64),
      generatedAt: now,
    }),
    generateSessionToken: vi.fn().mockReturnValue('mockedSessionToken'),
    generateCsrfToken: vi.fn().mockReturnValue('mockedCsrfToken'),
    generateNonce: vi.fn().mockReturnValue('0'.repeat(32)),
    ...overrides,
  };
}

/**
 * Mock factory for PathValidator
 */
export interface MockPathValidator {
  validate: MockInstance<(path: string) => Promise<{
    isValid: boolean;
    resolvedPath: string;
    relativePath: string;
    matchedPrefix: string;
    errors: string[];
  }>>;
  validateSync: MockInstance<(path: string) => {
    isValid: boolean;
    resolvedPath: string;
    relativePath: string;
    matchedPrefix: string;
    errors: string[];
  }>;
  validateOrThrow: MockInstance<(path: string) => Promise<string>>;
  securePath: MockInstance<(prefix: string, ...segments: string[]) => Promise<string>>;
  isWithinAllowed: MockInstance<(path: string) => boolean>;
  getAllowedPrefixes: MockInstance<() => readonly string[]>;
}

export function createMockPathValidator(
  overrides: Partial<MockPathValidator> = {}
): MockPathValidator {
  return {
    validate: vi.fn().mockResolvedValue({
      isValid: true,
      resolvedPath: '/workspaces/project/src/file.ts',
      relativePath: 'src/file.ts',
      matchedPrefix: '/workspaces/project',
      errors: [],
    }),
    validateSync: vi.fn().mockReturnValue({
      isValid: true,
      resolvedPath: '/workspaces/project/src/file.ts',
      relativePath: 'src/file.ts',
      matchedPrefix: '/workspaces/project',
      errors: [],
    }),
    validateOrThrow: vi.fn().mockResolvedValue('/workspaces/project/src/file.ts'),
    securePath: vi.fn().mockResolvedValue('/workspaces/project/src/file.ts'),
    isWithinAllowed: vi.fn().mockReturnValue(true),
    getAllowedPrefixes: vi.fn().mockReturnValue(['/workspaces/project']),
    ...overrides,
  };
}

/**
 * Mock factory for SafeExecutor
 */
export interface MockSafeExecutor {
  execute: MockInstance<(command: string, args?: string[]) => Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
    command: string;
    args: string[];
    duration: number;
  }>>;
  executeStreaming: MockInstance<(command: string, args?: string[]) => {
    process: unknown;
    stdout: unknown;
    stderr: unknown;
    promise: Promise<unknown>;
  }>;
  sanitizeArgument: MockInstance<(arg: string) => string>;
  isCommandAllowed: MockInstance<(command: string) => boolean>;
  allowCommand: MockInstance<(command: string) => void>;
  getAllowedCommands: MockInstance<() => readonly string[]>;
}

export function createMockSafeExecutor(
  overrides: Partial<MockSafeExecutor> = {}
): MockSafeExecutor {
  return {
    execute: vi.fn().mockResolvedValue({
      stdout: 'success',
      stderr: '',
      exitCode: 0,
      command: 'echo',
      args: ['hello'],
      duration: 10,
    }),
    executeStreaming: vi.fn().mockReturnValue({
      process: {},
      stdout: null,
      stderr: null,
      promise: Promise.resolve({
        stdout: 'success',
        stderr: '',
        exitCode: 0,
        command: 'echo',
        args: ['hello'],
        duration: 10,
      }),
    }),
    sanitizeArgument: vi.fn().mockImplementation((arg: string) => arg.replace(/[;&|]/g, '')),
    isCommandAllowed: vi.fn().mockReturnValue(true),
    allowCommand: vi.fn(),
    getAllowedCommands: vi.fn().mockReturnValue(['echo', 'git', 'npm', 'node']),
    ...overrides,
  };
}

/**
 * Mock factory for TokenGenerator
 */
export interface MockTokenGenerator {
  generate: MockInstance<(length?: number) => string>;
  generateWithExpiration: MockInstance<(expirationSeconds?: number, metadata?: Record<string, unknown>) => {
    value: string;
    createdAt: Date;
    expiresAt: Date;
    metadata?: Record<string, unknown>;
  }>;
  generateSessionToken: MockInstance<() => { value: string; createdAt: Date; expiresAt: Date }>;
  generateCsrfToken: MockInstance<() => { value: string; createdAt: Date; expiresAt: Date }>;
  generateApiToken: MockInstance<(prefix?: string) => { value: string; createdAt: Date; expiresAt: Date }>;
  generateVerificationCode: MockInstance<(length?: number, expirationMinutes?: number, maxAttempts?: number) => {
    code: string;
    createdAt: Date;
    expiresAt: Date;
    attempts: number;
    maxAttempts: number;
  }>;
  generateSignedToken: MockInstance<(payload: Record<string, unknown>, expirationSeconds?: number) => {
    token: string;
    signature: string;
    combined: string;
    createdAt: Date;
    expiresAt: Date;
  }>;
  verifySignedToken: MockInstance<(combined: string) => Record<string, unknown> | null>;
  generateTokenPair: MockInstance<() => {
    accessToken: { value: string; createdAt: Date; expiresAt: Date };
    refreshToken: { value: string; createdAt: Date; expiresAt: Date };
  }>;
  isExpired: MockInstance<(token: { expiresAt: Date }) => boolean>;
  compare: MockInstance<(a: string, b: string) => boolean>;
}

export function createMockTokenGenerator(
  overrides: Partial<MockTokenGenerator> = {}
): MockTokenGenerator {
  const now = new Date();
  const expires = new Date(now.getTime() + 3600000);

  return {
    generate: vi.fn().mockReturnValue('mockedToken12345'),
    generateWithExpiration: vi.fn().mockReturnValue({
      value: 'mockedTokenWithExpiration',
      createdAt: now,
      expiresAt: expires,
    }),
    generateSessionToken: vi.fn().mockReturnValue({
      value: 'mockedSessionToken',
      createdAt: now,
      expiresAt: expires,
    }),
    generateCsrfToken: vi.fn().mockReturnValue({
      value: 'mockedCsrfToken',
      createdAt: now,
      expiresAt: expires,
    }),
    generateApiToken: vi.fn().mockReturnValue({
      value: 'cf_mockedApiToken',
      createdAt: now,
      expiresAt: expires,
    }),
    generateVerificationCode: vi.fn().mockReturnValue({
      code: '123456',
      createdAt: now,
      expiresAt: expires,
      attempts: 0,
      maxAttempts: 3,
    }),
    generateSignedToken: vi.fn().mockReturnValue({
      token: 'mockedToken',
      signature: 'mockedSignature',
      combined: 'mockedToken.mockedSignature',
      createdAt: now,
      expiresAt: expires,
    }),
    verifySignedToken: vi.fn().mockReturnValue({ userId: '123' }),
    generateTokenPair: vi.fn().mockReturnValue({
      accessToken: { value: 'accessToken', createdAt: now, expiresAt: expires },
      refreshToken: { value: 'refreshToken', createdAt: now, expiresAt: new Date(now.getTime() + 604800000) },
    }),
    isExpired: vi.fn().mockReturnValue(false),
    compare: vi.fn().mockImplementation((a: string, b: string) => a === b),
    ...overrides,
  };
}

/**
 * Mock factory for InputValidator
 */
export interface MockInputValidator {
  validateEmail: MockInstance<(email: string) => string>;
  validatePassword: MockInstance<(password: string) => string>;
  validateIdentifier: MockInstance<(id: string) => string>;
  validatePath: MockInstance<(path: string) => string>;
  validateCommandArg: MockInstance<(arg: string) => string>;
  validateLoginRequest: MockInstance<(data: unknown) => { email: string; password: string; mfaCode?: string }>;
  validateCreateUser: MockInstance<(data: unknown) => { email: string; password: string; role: string }>;
  validateTaskInput: MockInstance<(data: unknown) => { taskId: string; content: string; agentType: string }>;
}

export function createMockInputValidator(
  overrides: Partial<MockInputValidator> = {}
): MockInputValidator {
  return {
    validateEmail: vi.fn().mockImplementation((email: string) => email.toLowerCase()),
    validatePassword: vi.fn().mockImplementation((password: string) => password),
    validateIdentifier: vi.fn().mockImplementation((id: string) => id),
    validatePath: vi.fn().mockImplementation((path: string) => path),
    validateCommandArg: vi.fn().mockImplementation((arg: string) => arg),
    validateLoginRequest: vi.fn().mockImplementation((data: unknown) => data as { email: string; password: string }),
    validateCreateUser: vi.fn().mockImplementation((data: unknown) => data as { email: string; password: string; role: string }),
    validateTaskInput: vi.fn().mockImplementation((data: unknown) => data as { taskId: string; content: string; agentType: string }),
    ...overrides,
  };
}

/**
 * Resets all mocks in a mock object
 */
export function resetMock<T extends object>(mock: MockedInterface<T>): void {
  for (const key of Object.keys(mock)) {
    const value = (mock as Record<string, unknown>)[key];
    if (typeof value === 'function' && 'mockReset' in value) {
      (value as MockInstance).mockReset();
    }
  }
}

/**
 * Clears all mocks in a mock object (keeps implementation)
 */
export function clearMock<T extends object>(mock: MockedInterface<T>): void {
  for (const key of Object.keys(mock)) {
    const value = (mock as Record<string, unknown>)[key];
    if (typeof value === 'function' && 'mockClear' in value) {
      (value as MockInstance).mockClear();
    }
  }
}

/**
 * Restores all mocks in a mock object
 */
export function restoreMock<T extends object>(mock: MockedInterface<T>): void {
  for (const key of Object.keys(mock)) {
    const value = (mock as Record<string, unknown>)[key];
    if (typeof value === 'function' && 'mockRestore' in value) {
      (value as MockInstance).mockRestore();
    }
  }
}

/**
 * Helper to verify mock was called with specific arguments
 */
export function expectCalledWith<T extends MockInstance>(
  mock: T,
  ...args: Parameters<T extends MockInstance<infer F> ? F : never>
): void {
  expect(mock).toHaveBeenCalledWith(...args);
}

/**
 * Helper to verify mock was called exactly N times
 */
export function expectCalledTimes<T extends MockInstance>(
  mock: T,
  times: number
): void {
  expect(mock).toHaveBeenCalledTimes(times);
}
