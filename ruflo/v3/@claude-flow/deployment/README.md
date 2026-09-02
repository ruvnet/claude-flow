# @claude-flow/deployment

[![npm version](https://img.shields.io/npm/v/@claude-flow/deployment.svg)](https://www.npmjs.com/package/@claude-flow/deployment)
[![npm downloads](https://img.shields.io/npm/dm/@claude-flow/deployment.svg)](https://www.npmjs.com/package/@claude-flow/deployment)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![CI/CD](https://img.shields.io/badge/CI%2FCD-Automated-green.svg)](https://github.com/ruvnet/claude-flow)
[![Semantic Release](https://img.shields.io/badge/Semantic-Release-brightgreen.svg)](https://semantic-release.gitbook.io/)

> Release management, CI/CD, and versioning module for Claude Flow v3.

## Features

- **Version Bumping**: Automatic version management (major, minor, patch, prerelease)
- **Changelog Generation**: Generate changelogs from conventional commits
- **Git Integration**: Automatic tagging and committing
- **NPM Publishing**: Publish packages with tag support (alpha, beta, latest)
- **Pre-Release Validation**: Lint, test, build, and dependency checks
- **Dry Run Mode**: Test releases without making changes

## Installation

```bash
npm install @claude-flow/deployment
```

## Quick Start

### Prepare a Release

```typescript
import { prepareRelease } from '@claude-flow/deployment';

// Bump patch version and generate changelog
const result = await prepareRelease({
  bumpType: 'patch',
  generateChangelog: true,
  createTag: true,
  commit: true
});

console.log(`Released ${result.newVersion}`);
```

### Publish to NPM

```typescript
import { publishToNpm } from '@claude-flow/deployment';

// Publish with 'latest' tag
const result = await publishToNpm({
  tag: 'latest',
  access: 'public'
});

console.log(`Published ${result.packageName}@${result.version}`);
```

### Validate Package

```typescript
import { validate } from '@claude-flow/deployment';

// Run all validation checks
const result = await validate({
  lint: true,
  test: true,
  build: true,
  checkDependencies: true
});

if (!result.valid) {
  console.error('Validation failed:', result.errors);
}
```

## API Reference

### ReleaseManager

```typescript
import { ReleaseManager } from '@claude-flow/deployment';

const manager = new ReleaseManager();

// Prepare release with options
const result = await manager.prepareRelease({
  bumpType: 'minor',           // major | minor | patch | prerelease
  version: '2.0.0',            // Override version
  channel: 'beta',             // alpha | beta | rc | latest
  generateChangelog: true,     // Generate CHANGELOG.md
  createTag: true,             // Create git tag
  commit: true,                // Commit changes
  dryRun: false,               // Test without changes
  skipValidation: false,       // Skip validation checks
  tagPrefix: 'v',              // Tag prefix (v2.0.0)
  changelogPath: 'CHANGELOG.md' // Changelog file path
});
```

#### Version Bumping

```typescript
// Bump patch: 1.0.0 -> 1.0.1
await manager.prepareRelease({ bumpType: 'patch' });

// Bump minor: 1.0.0 -> 1.1.0
await manager.prepareRelease({ bumpType: 'minor' });

// Bump major: 1.0.0 -> 2.0.0
await manager.prepareRelease({ bumpType: 'major' });

// Bump prerelease: 1.0.0 -> 1.0.0-alpha.1
await manager.prepareRelease({ bumpType: 'prerelease', channel: 'alpha' });

// Increment prerelease: 1.0.0-alpha.1 -> 1.0.0-alpha.2
await manager.prepareRelease({ bumpType: 'prerelease', channel: 'alpha' });
```

#### Changelog Generation

Generates changelog from conventional commits:

```bash
# Commit format: type(scope): message
git commit -m "feat(api): add new endpoint"
git commit -m "fix(auth): resolve login issue"
git commit -m "feat(ui): update design BREAKING CHANGE: new layout"
```

Generated changelog:
```markdown
## [2.0.0] - 2026-01-04

### BREAKING CHANGES

- **ui**: update design BREAKING CHANGE: new layout

### Features

- **api**: add new endpoint
- **ui**: update design

### Bug Fixes

- **auth**: resolve login issue
```

### Publisher

```typescript
import { Publisher } from '@claude-flow/deployment';

const publisher = new Publisher();

// Publish to npm
const result = await publisher.publishToNpm({
  tag: 'latest',              // npm tag (alpha, beta, latest)
  access: 'public',           // public | restricted
  dryRun: false,              // Test publish without actual publish
  registry: 'https://registry.npmjs.org/',
  otp: '123456',              // 2FA OTP code
  skipBuild: false,           // Skip build step
  buildCommand: 'npm run build' // Custom build command
});

// Check if version exists
const exists = await publisher.checkVersionExists('my-package', '1.0.0');

// Get latest version
const latest = await publisher.getLatestVersion('my-package', 'latest');

// Verify npm authentication
const authenticated = await publisher.verifyAuth();

// Pack to tarball
const tarball = await publisher.pack('./dist');
```

### Validator

```typescript
import { Validator } from '@claude-flow/deployment';

const validator = new Validator();

// Validate package
const result = await validator.validate({
  lint: true,                 // Run linter
  test: true,                 // Run tests
  build: true,                // Run build
  checkDependencies: true,    // Check dependencies
  checkGitStatus: true,       // Check uncommitted changes
  lintCommand: 'npm run lint',
  testCommand: 'npm test',
  buildCommand: 'npm run build'
});

console.log('Valid:', result.valid);
console.log('Errors:', result.errors);
console.log('Warnings:', result.warnings);
console.log('Checks:', result.checks);
```

## Complete Release Workflow

```typescript
import { Validator, ReleaseManager, Publisher } from '@claude-flow/deployment';

async function release(version: string, tag: string) {
  // 1. Validate package
  console.log('Validating package...');
  const validator = new Validator();
  const validation = await validator.validate();

  if (!validation.valid) {
    console.error('Validation failed:', validation.errors);
    process.exit(1);
  }

  // 2. Prepare release
  console.log('Preparing release...');
  const manager = new ReleaseManager();
  const release = await manager.prepareRelease({
    version,
    generateChangelog: true,
    createTag: true,
    commit: true
  });

  if (!release.success) {
    console.error('Release preparation failed:', release.error);
    process.exit(1);
  }

  // 3. Publish to npm
  console.log('Publishing to npm...');
  const publisher = new Publisher();
  const publish = await publisher.publishToNpm({
    tag,
    access: 'public'
  });

  if (!publish.success) {
    console.error('Publish failed:', publish.error);
    process.exit(1);
  }

  console.log(`Successfully released ${publish.packageName}@${publish.version}`);
}

// Run release
release('2.0.0', 'latest');
```

## CLI Usage

```bash
# Prepare release
npx @claude-flow/deployment release --version 2.0.0 --changelog --tag

# Publish to npm
npx @claude-flow/deployment publish --tag latest --access public

# Validate package
npx @claude-flow/deployment validate
```

## Dry Run Mode

Test releases without making changes:

```typescript
// Test release preparation
await prepareRelease({
  bumpType: 'minor',
  dryRun: true
});

// Test npm publish
await publishToNpm({
  tag: 'beta',
  dryRun: true
});
```

## Channel/Tag Strategy

- **`alpha`**: Early development versions (1.0.0-alpha.1)
- **`beta`**: Feature complete, testing (1.0.0-beta.1)
- **`rc`**: Release candidate (1.0.0-rc.1)
- **`latest`**: Stable production release (1.0.0)

```typescript
// Prerelease workflow
await prepareRelease({ bumpType: 'prerelease', channel: 'alpha' }); // 1.0.0-alpha.1
await publishToNpm({ tag: 'alpha' });

await prepareRelease({ bumpType: 'prerelease', channel: 'beta' });  // 1.0.0-beta.1
await publishToNpm({ tag: 'beta' });

await prepareRelease({ bumpType: 'patch' });  // 1.0.0
await publishToNpm({ tag: 'latest' });
```

## Environment Variables

```bash
# NPM authentication
export NPM_TOKEN="your-token"

# Custom registry
export NPM_CONFIG_REGISTRY="https://registry.npmjs.org/"
```

## Error Handling

```typescript
try {
  const result = await prepareRelease({ bumpType: 'minor' });

  if (!result.success) {
    console.error('Release failed:', result.error);
    console.warn('Warnings:', result.warnings);
  }
} catch (error) {
  console.error('Unexpected error:', error);
}
```

## License

MIT
