/**
 * Update checker for @claude-flow packages
 * Queries npm registry and compares versions
 */

import * as semver from 'semver';
import { shouldCheckForUpdates, recordCheck, getCachedVersions } from './rate-limiter.js';

export interface UpdateCheckResult {
  package: string;
  currentVersion: string;
  latestVersion: string;
  updateType: 'major' | 'minor' | 'patch' | 'none';
  shouldAutoUpdate: boolean;
  priority: 'critical' | 'high' | 'normal' | 'low';
  changelog?: string;
}

export interface UpdateConfig {
  enabled: boolean;
  checkIntervalHours: number;
  autoUpdate: {
    patch: boolean;
    minor: boolean;
    major: boolean;
  };
  priority: Record<string, 'critical' | 'high' | 'normal' | 'low'>;
  exclude: string[];
}

const DEFAULT_CONFIG: UpdateConfig = {
  enabled: true,
  checkIntervalHours: 24,
  autoUpdate: {
    patch: true,
    minor: false,
    major: false,
  },
  priority: {
    '@claude-flow/security': 'critical',
    '@claude-flow/cli': 'high',
    '@claude-flow/embeddings': 'normal',
    '@claude-flow/integration': 'normal',
    '@claude-flow/testing': 'low',
  },
  exclude: [],
};

// Packages to check for updates
const CLAUDE_FLOW_PACKAGES = [
  '@claude-flow/cli',
  '@claude-flow/embeddings',
  '@claude-flow/security',
  '@claude-flow/integration',
  '@claude-flow/testing',
];

interface NpmPackageInfo {
  'dist-tags': { latest: string };
  versions: Record<string, unknown>;
}

async function fetchPackageInfo(packageName: string): Promise<NpmPackageInfo | null> {
  try {
    const response = await fetch(
      `https://registry.npmjs.org/${encodeURIComponent(packageName)}`,
      {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
      }
    );

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as NpmPackageInfo;
  } catch {
    return null;
  }
}

function getUpdateType(
  current: string,
  latest: string
): 'major' | 'minor' | 'patch' | 'none' {
  if (!semver.valid(current) || !semver.valid(latest)) {
    return 'none';
  }

  if (semver.eq(current, latest)) {
    return 'none';
  }

  if (semver.major(latest) > semver.major(current)) {
    return 'major';
  }

  if (semver.minor(latest) > semver.minor(current)) {
    return 'minor';
  }

  if (semver.patch(latest) > semver.patch(current)) {
    return 'patch';
  }

  return 'none';
}

function shouldAutoUpdate(
  updateType: 'major' | 'minor' | 'patch' | 'none',
  priority: 'critical' | 'high' | 'normal' | 'low',
  config: UpdateConfig
): boolean {
  if (updateType === 'none') return false;

  // Critical security packages always auto-update patches
  if (priority === 'critical' && updateType === 'patch') {
    return true;
  }

  // Check config
  if (updateType === 'major') return config.autoUpdate.major;
  if (updateType === 'minor') return config.autoUpdate.minor;
  if (updateType === 'patch') return config.autoUpdate.patch;

  return false;
}

export function getInstalledVersion(packageName: string): string | null {
  try {
    // Try to find the package in node_modules
    const possiblePaths = [
      `${packageName}/package.json`,
      `../../node_modules/${packageName}/package.json`,
      `../../../node_modules/${packageName}/package.json`,
    ];

    for (const modulePath of possiblePaths) {
      try {
        // Use dynamic import with require for package.json
        const resolved = require.resolve(modulePath, { paths: [process.cwd()] });
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const pkg = require(resolved);
        return pkg.version;
      } catch {
        continue;
      }
    }

    return null;
  } catch {
    return null;
  }
}

export async function checkForUpdates(
  config: UpdateConfig = DEFAULT_CONFIG
): Promise<{ results: UpdateCheckResult[]; skipped: boolean; reason?: string }> {
  // Check rate limit
  const rateCheck = shouldCheckForUpdates(config.checkIntervalHours);
  if (!rateCheck.allowed) {
    // Return cached results if available
    const cached = getCachedVersions();
    if (Object.keys(cached).length > 0) {
      return {
        results: [],
        skipped: true,
        reason: rateCheck.reason,
      };
    }
    return { results: [], skipped: true, reason: rateCheck.reason };
  }

  const results: UpdateCheckResult[] = [];
  const versionCache: Record<string, string> = {};

  // Check each package
  const packagesToCheck = CLAUDE_FLOW_PACKAGES.filter(
    (pkg) => !config.exclude.includes(pkg)
  );

  // Sort by priority (critical first)
  const priorityOrder = { critical: 0, high: 1, normal: 2, low: 3 };
  packagesToCheck.sort((a, b) => {
    const pa = config.priority[a] || 'normal';
    const pb = config.priority[b] || 'normal';
    return priorityOrder[pa] - priorityOrder[pb];
  });

  await Promise.all(
    packagesToCheck.map(async (packageName) => {
      const currentVersion = getInstalledVersion(packageName);
      if (!currentVersion) {
        // Package not installed, skip
        return;
      }

      const info = await fetchPackageInfo(packageName);
      if (!info) {
        return;
      }

      const latestVersion = info['dist-tags']?.latest;
      if (!latestVersion) {
        return;
      }

      versionCache[packageName] = latestVersion;

      const updateType = getUpdateType(currentVersion, latestVersion);
      const priority = config.priority[packageName] || 'normal';

      results.push({
        package: packageName,
        currentVersion,
        latestVersion,
        updateType,
        priority,
        shouldAutoUpdate: shouldAutoUpdate(updateType, priority, config),
      });
    })
  );

  // Record this check
  recordCheck(versionCache);

  // Filter to only updates available
  const updates = results.filter((r) => r.updateType !== 'none');

  return { results: updates, skipped: false };
}

export async function checkSinglePackage(
  packageName: string,
  config: UpdateConfig = DEFAULT_CONFIG
): Promise<UpdateCheckResult | null> {
  const currentVersion = getInstalledVersion(packageName);
  if (!currentVersion) {
    return null;
  }

  const info = await fetchPackageInfo(packageName);
  if (!info) {
    return null;
  }

  const latestVersion = info['dist-tags']?.latest;
  if (!latestVersion) {
    return null;
  }

  const updateType = getUpdateType(currentVersion, latestVersion);
  const priority = config.priority[packageName] || 'normal';

  return {
    package: packageName,
    currentVersion,
    latestVersion,
    updateType,
    priority,
    shouldAutoUpdate: shouldAutoUpdate(updateType, priority, config),
  };
}

export { DEFAULT_CONFIG };
