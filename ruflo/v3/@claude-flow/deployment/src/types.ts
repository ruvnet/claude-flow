/**
 * Type definitions for deployment module
 */

export type VersionBumpType = 'major' | 'minor' | 'patch' | 'prerelease';
export type ReleaseChannel = 'alpha' | 'beta' | 'rc' | 'latest';

export interface ReleaseOptions {
  /** Type of version bump */
  bumpType?: VersionBumpType;
  /** Specific version to set (overrides bumpType) */
  version?: string;
  /** Release channel/tag */
  channel?: ReleaseChannel;
  /** Generate changelog from git commits */
  generateChangelog?: boolean;
  /** Create git tag */
  createTag?: boolean;
  /** Commit changes */
  commit?: boolean;
  /** Dry run mode */
  dryRun?: boolean;
  /** Skip validation checks */
  skipValidation?: boolean;
  /** Custom git tag prefix */
  tagPrefix?: string;
  /** Custom changelog file path */
  changelogPath?: string;
}

export interface ReleaseResult {
  /** Previous version */
  oldVersion: string;
  /** New version */
  newVersion: string;
  /** Git tag name */
  tag?: string;
  /** Changelog content */
  changelog?: string;
  /** Commit hash */
  commitHash?: string;
  /** Success status */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Validation warnings */
  warnings?: string[];
}

export interface PublishOptions {
  /** npm tag (alpha, beta, latest) */
  tag?: string;
  /** Access level (public, restricted) */
  access?: 'public' | 'restricted';
  /** Dry run mode */
  dryRun?: boolean;
  /** Custom registry URL */
  registry?: string;
  /** OTP for 2FA */
  otp?: string;
  /** Skip build step */
  skipBuild?: boolean;
  /** Custom build command */
  buildCommand?: string;
}

export interface PublishResult {
  /** Package name */
  packageName: string;
  /** Published version */
  version: string;
  /** npm tag */
  tag: string;
  /** Package tarball URL */
  tarball?: string;
  /** Success status */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Publish timestamp */
  publishedAt?: Date;
}

export interface ValidationOptions {
  /** Run linter */
  lint?: boolean;
  /** Run tests */
  test?: boolean;
  /** Run build */
  build?: boolean;
  /** Check dependencies */
  checkDependencies?: boolean;
  /** Check uncommitted changes */
  checkGitStatus?: boolean;
  /** Custom lint command */
  lintCommand?: string;
  /** Custom test command */
  testCommand?: string;
  /** Custom build command */
  buildCommand?: string;
}

export interface ValidationResult {
  /** Overall validation success */
  valid: boolean;
  /** Individual check results */
  checks: {
    lint?: { passed: boolean; errors?: string[] };
    test?: { passed: boolean; errors?: string[] };
    build?: { passed: boolean; errors?: string[] };
    dependencies?: { passed: boolean; errors?: string[] };
    gitStatus?: { passed: boolean; errors?: string[] };
    packageJson?: { passed: boolean; errors?: string[] };
  };
  /** Overall errors */
  errors: string[];
  /** Warnings */
  warnings: string[];
}

export interface PackageInfo {
  name: string;
  version: string;
  description?: string;
  private?: boolean;
  repository?: {
    type: string;
    url: string;
  };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  publishConfig?: {
    access?: string;
    registry?: string;
  };
}

export interface GitCommit {
  hash: string;
  message: string;
  author: string;
  date: string;
  type?: string;
  scope?: string;
  breaking?: boolean;
}

export interface ChangelogEntry {
  version: string;
  date: string;
  changes: {
    breaking?: string[];
    features?: string[];
    fixes?: string[];
    chore?: string[];
    docs?: string[];
    other?: string[];
  };
}
