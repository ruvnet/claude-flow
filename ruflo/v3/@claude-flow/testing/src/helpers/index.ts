/**
 * V3 Claude-Flow Test Helpers Index
 *
 * Central export for all test helpers
 */

// Mock factory utilities
export {
  createMock,
  createDeepMock,
  createSpyMock,
  createMockWithBehavior,
  createRetryMock,
  createSequenceMock,
  InteractionRecorder,
  type MockedInterface,
} from './create-mock.js';

// Test application builder
export {
  createTestApplication,
  type TestApplication,
  type IEventBus,
  type ITaskManager,
  type IAgentLifecycle,
  type IMemoryService,
  type ISecurityService,
  type ISwarmCoordinator,
} from './test-application.js';

// Swarm test instance
export {
  createSwarmTestInstance,
  SwarmTestInstance,
  type V3AgentType,
  type SwarmTopology,
  type SwarmAgent,
  type SwarmMessage,
  type SwarmTask,
  type SwarmTaskResult,
} from './swarm-instance.js';

// Custom assertions (legacy)
export {
  assertCallSequence,
  assertNotCalledWith,
  assertInteractionCount,
  assertAllCalled,
  assertNoneCalled,
  assertContractCompliance,
  assertTimingWithin,
  assertTimingRange,
  assertThrowsWithMessage,
  assertEventPublished,
  assertMockSequence,
  assertNoSensitiveDataLogged,
  assertPerformanceTarget,
  type ContractDefinition,
} from './assertions.js';

// Test utilities (waitFor, retry, timeout, etc.)
export {
  waitFor,
  waitUntilChanged,
  retry,
  withTimeout,
  sleep,
  createDeferred,
  parallelLimit,
  measureTime,
  createMockClock,
  createTestEmitter,
  createCallSpy,
  createMockStream,
  collectStream,
  generateTestId,
  createTestContext,
  expectToReject,
  createTrackedMock,
  TimeoutError,
  type WaitForOptions,
  type WaitUntilChangedOptions,
  type RetryOptions,
  type Deferred,
  type MockClock,
  type TestEmitter,
  type CallSpy,
  type MockStreamOptions,
  type TestContext,
  type TrackedMock,
} from './test-utils.js';

// Mock factory (comprehensive service mocks)
export {
  createMockEventBus,
  createMockTaskManager,
  createMockAgentLifecycle,
  createMockMemoryService,
  createMockSecurityService,
  createMockSwarmCoordinator,
  createMockMCPClient,
  createMockLogger,
  createMockApplication,
  resetMockApplication,
  type MockApplication,
  type ILogger,
  type IMCPClient,
  type DomainEvent,
  type EventHandler,
  type Task,
  type TaskDefinition,
  type TaskResult,
  type TaskStatus,
  type TaskFilters,
  type AgentConfig,
  type AgentSpawnResult,
  type TerminateOptions,
  type AgentFilters,
  type AgentHealthCheck,
  type MemoryStats,
  type IndexConfig,
  type InputValidationOptions,
  type ExecuteOptions,
  type ExecuteResult,
} from './mock-factory.js';

// Assertion helpers (enhanced)
export {
  assertCalledWithPattern,
  assertEventOrder,
  assertEventNotPublished,
  assertMocksCalledInOrder,
  assertCalledNTimesWith,
  assertCompletesWithin,
  assertThrowsError,
  assertNoSensitiveData,
  assertMatchesSnapshot,
  assertV3PerformanceTargets,
  assertValidDomainObject,
  assertOnlyCalledWithAllowed,
  assertPartialOrder,
  assertAllPass,
  assertNonePass,
  assertSameElements,
  assertMockReturnsSequence,
  assertValidStateTransition,
  assertRetryPattern,
  assertDependencyInjected,
  registerCustomMatchers,
  type SnapshotOptions,
  type V3PerformanceMetrics,
  type RetryPatternOptions,
} from './assertion-helpers.js';

// Setup and teardown helpers
export {
  createSetupContext,
  getGlobalContext,
  resetGlobalContext,
  configureTestEnvironment,
  createTestSuite,
  createTestScope,
  createInMemoryDatabaseHelper,
  createNetworkTestHelper,
  createInMemoryFileSystemHelper,
  createPerformanceTestHelper,
  setupV3Tests,
  flushPromises,
  withTestTimeout,
  type SetupContext,
  type CleanupFunction,
  type Disposable,
  type TestEnvironmentConfig,
  type TestSuiteHelpers,
  type TestScope,
  type DatabaseTestHelper,
  type NetworkTestHelper,
  type MockFetchResponse,
  type FileSystemTestHelper,
  type PerformanceTestHelper,
  type V3TestConfig,
} from './setup-teardown.js';
