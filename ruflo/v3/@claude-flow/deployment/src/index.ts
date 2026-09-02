/**
 * @claude-flow/deployment
 * Release management, CI/CD, and versioning module
 */

// Export types
export type {
  VersionBumpType,
  ReleaseChannel,
  ReleaseOptions,
  ReleaseResult,
  PublishOptions,
  PublishResult,
  ValidationOptions,
  ValidationResult,
  PackageInfo,
  GitCommit,
  ChangelogEntry
} from './types.js';

// Export classes
export { ReleaseManager } from './release-manager.js';
export { Publisher } from './publisher.js';
export { Validator } from './validator.js';

// Export convenience functions
export {
  prepareRelease
} from './release-manager.js';

export {
  publishToNpm,
  checkVersionExists,
  getLatestVersion
} from './publisher.js';

export {
  validate
} from './validator.js';

// Legacy exports for backward compatibility
export interface ReleaseConfig {
  version: string;
  channel: 'alpha' | 'beta' | 'stable';
  changelog: boolean;
  dryRun: boolean;
}

export interface DeploymentTarget {
  name: string;
  type: 'npm' | 'docker' | 'github-release';
  config: Record<string, unknown>;
}

/**
 * Legacy prepare release function
 * @deprecated Use prepareRelease from release-manager instead
 */
export async function prepare(config: ReleaseConfig): Promise<void> {
  const { ReleaseManager } = await import('./release-manager.js');
  const manager = new ReleaseManager();

  await manager.prepareRelease({
    version: config.version,
    channel: config.channel as any,
    generateChangelog: config.changelog,
    dryRun: config.dryRun
  });
}

/**
 * Legacy deploy function
 * @deprecated Use publishToNpm from publisher instead
 */
export async function deploy(target: DeploymentTarget): Promise<void> {
  if (target.type === 'npm') {
    const { Publisher } = await import('./publisher.js');
    const publisher = new Publisher();

    await publisher.publishToNpm({
      tag: (target.config.tag as string) || 'latest',
      dryRun: (target.config.dryRun as boolean) || false
    });
  } else {
    console.log(`Deploying to ${target.name} (${target.type})`);
    throw new Error(`Deployment type ${target.type} not yet implemented`);
  }
}
