/**
 * Test Helpers Index
 *
 * Re-exports all testing utilities for the security module.
 *
 * @module v3/security/__tests__/helpers
 */

export {
  createMock,
  createPartialMock,
  createSpy,
  createMockPasswordHasher,
  createMockCredentialGenerator,
  createMockPathValidator,
  createMockSafeExecutor,
  createMockTokenGenerator,
  createMockInputValidator,
  resetMock,
  clearMock,
  restoreMock,
  expectCalledWith,
  expectCalledTimes,
  type MockedInterface,
  type DeepMockedInterface,
  type MockPasswordHasher,
  type MockCredentialGenerator,
  type MockPathValidator,
  type MockSafeExecutor,
  type MockTokenGenerator,
  type MockInputValidator,
} from './create-mock.js';
