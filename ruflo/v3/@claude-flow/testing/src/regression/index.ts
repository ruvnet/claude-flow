/**
 * Regression Testing System
 *
 * Comprehensive regression detection to prevent capability degradation
 * as new features are added. Includes:
 * - Performance baselines
 * - Security vulnerability checks
 * - API contract validation
 * - Integration verification
 *
 * @module v3/testing/regression
 */

export {
  RegressionTestRunner,
  type RegressionConfig,
  type RegressionResult,
  type RegressionReport,
} from './regression-runner.js';

export {
  PerformanceBaseline,
  type BaselineMetric,
  type BaselineComparison,
  type BaselineConfig,
} from './performance-baseline.js';

export {
  SecurityRegressionChecker,
  type SecurityCheck,
  type SecurityVulnerability,
  type SecurityReport,
} from './security-regression.js';

export {
  APIContractValidator,
  type ContractDefinition,
  type ContractValidation,
  type ContractDiff,
} from './api-contract.js';

export {
  IntegrationRegressionSuite,
  type IntegrationTest,
  type IntegrationResult,
} from './integration-regression.js';
