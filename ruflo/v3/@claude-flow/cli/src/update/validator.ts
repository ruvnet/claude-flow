/**
 * Package validator for update compatibility
 * Ensures updates don't break the ecosystem
 */

import * as semver from 'semver';

export interface ValidationResult {
  valid: boolean;
  incompatibilities: string[];
  warnings: string[];
  requiredPeerUpdates: string[];
}

interface PackageCompatibility {
  minVersion: string;
  maxVersion?: string;
  peerDependencies?: Record<string, string>;
}

// Known compatibility matrix between @claude-flow packages
const COMPATIBILITY_MATRIX: Record<string, Record<string, PackageCompatibility>> = {
  '@claude-flow/cli': {
    '@claude-flow/embeddings': { minVersion: '3.0.0-alpha.1' },
    '@claude-flow/security': { minVersion: '3.0.0-alpha.1' },
    '@claude-flow/integration': { minVersion: '3.0.0-alpha.1' },
  },
  '@claude-flow/embeddings': {
    '@claude-flow/cli': { minVersion: '3.0.0-alpha.50' },
  },
  '@claude-flow/integration': {
    '@claude-flow/cli': { minVersion: '3.0.0-alpha.70' },
    'agentic-flow': { minVersion: '0.1.0' },
  },
};

// Known breaking changes by version
const BREAKING_CHANGES: Record<string, Record<string, string[]>> = {
  '@claude-flow/cli': {
    '3.0.0': [
      'Memory API changed from key-value to vector-based',
      'Hooks system completely redesigned',
      'Agent spawning now requires type parameter',
    ],
  },
  '@claude-flow/embeddings': {
    '3.0.0': [
      'Switched from better-sqlite3 to sql.js',
      'New initialization required with initEmbeddings()',
    ],
  },
};

export function validateUpdate(
  packageName: string,
  fromVersion: string,
  toVersion: string,
  installedPackages: Record<string, string>
): ValidationResult {
  const result: ValidationResult = {
    valid: true,
    incompatibilities: [],
    warnings: [],
    requiredPeerUpdates: [],
  };

  // Check if this is a major version bump
  if (semver.valid(fromVersion) && semver.valid(toVersion)) {
    const fromMajor = semver.major(fromVersion);
    const toMajor = semver.major(toVersion);

    if (toMajor > fromMajor) {
      result.warnings.push(
        `Major version update (${fromMajor} → ${toMajor}) may contain breaking changes`
      );

      // Check for known breaking changes
      const changes = BREAKING_CHANGES[packageName]?.[`${toMajor}.0.0`];
      if (changes) {
        result.warnings.push(`Known breaking changes in v${toMajor}:`);
        changes.forEach((change) => result.warnings.push(`  - ${change}`));
      }
    }
  }

  // Check compatibility with installed packages
  const compatibility = COMPATIBILITY_MATRIX[packageName];
  if (compatibility) {
    for (const [depName, depReq] of Object.entries(compatibility)) {
      const installedVersion = installedPackages[depName];

      if (installedVersion) {
        // Check minimum version
        if (
          semver.valid(installedVersion) &&
          semver.lt(installedVersion, depReq.minVersion)
        ) {
          result.incompatibilities.push(
            `${packageName}@${toVersion} requires ${depName} >= ${depReq.minVersion} (installed: ${installedVersion})`
          );
          result.requiredPeerUpdates.push(`${depName}@>=${depReq.minVersion}`);
          result.valid = false;
        }

        // Check maximum version
        if (
          depReq.maxVersion &&
          semver.valid(installedVersion) &&
          semver.gt(installedVersion, depReq.maxVersion)
        ) {
          result.warnings.push(
            `${packageName}@${toVersion} may not be compatible with ${depName}@${installedVersion} (max: ${depReq.maxVersion})`
          );
        }
      }
    }
  }

  // Check reverse compatibility - other packages that depend on this one
  for (const [pkgName, deps] of Object.entries(COMPATIBILITY_MATRIX)) {
    if (pkgName === packageName) continue;

    const depInfo = deps[packageName];
    if (depInfo && installedPackages[pkgName]) {
      // If the target version is below what the installed package needs
      if (semver.valid(toVersion) && semver.lt(toVersion, depInfo.minVersion)) {
        result.incompatibilities.push(
          `${pkgName}@${installedPackages[pkgName]} requires ${packageName} >= ${depInfo.minVersion}`
        );
        result.valid = false;
      }
    }
  }

  return result;
}

export function validateBulkUpdate(
  updates: Array<{ package: string; from: string; to: string }>,
  currentPackages: Record<string, string>
): ValidationResult {
  const combinedResult: ValidationResult = {
    valid: true,
    incompatibilities: [],
    warnings: [],
    requiredPeerUpdates: [],
  };

  // Create a simulated state after all updates
  const simulatedPackages = { ...currentPackages };
  for (const update of updates) {
    simulatedPackages[update.package] = update.to;
  }

  // Validate each update against the final state
  for (const update of updates) {
    const result = validateUpdate(
      update.package,
      update.from,
      update.to,
      simulatedPackages
    );

    if (!result.valid) {
      combinedResult.valid = false;
    }

    combinedResult.incompatibilities.push(...result.incompatibilities);
    combinedResult.warnings.push(...result.warnings);
    combinedResult.requiredPeerUpdates.push(...result.requiredPeerUpdates);
  }

  // Deduplicate
  combinedResult.incompatibilities = [...new Set(combinedResult.incompatibilities)];
  combinedResult.warnings = [...new Set(combinedResult.warnings)];
  combinedResult.requiredPeerUpdates = [...new Set(combinedResult.requiredPeerUpdates)];

  return combinedResult;
}
