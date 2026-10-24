# Quick Start Guide

## Installation

```bash
npm install @claude-flow/deployment
```

## Common Commands

### 1. Patch Release (1.0.0 → 1.0.1)

```typescript
import { prepareRelease, publishToNpm } from '@claude-flow/deployment';

await prepareRelease({ bumpType: 'patch' });
await publishToNpm({ tag: 'latest' });
```

### 2. Minor Release (1.0.0 → 1.1.0)

```typescript
await prepareRelease({ bumpType: 'minor' });
await publishToNpm({ tag: 'latest' });
```

### 3. Major Release (1.0.0 → 2.0.0)

```typescript
await prepareRelease({ bumpType: 'major' });
await publishToNpm({ tag: 'latest' });
```

### 4. Alpha Release (1.0.0 → 1.0.0-alpha.1)

```typescript
await prepareRelease({ bumpType: 'prerelease', channel: 'alpha' });
await publishToNpm({ tag: 'alpha' });
```

### 5. Dry Run (Test without changes)

```typescript
await prepareRelease({ bumpType: 'minor', dryRun: true });
await publishToNpm({ tag: 'latest', dryRun: true });
```

### 6. Validate Package

```typescript
import { validate } from '@claude-flow/deployment';

const result = await validate();
if (!result.valid) {
  console.error(result.errors);
}
```

## Complete Workflow

```typescript
import { validate, prepareRelease, publishToNpm } from '@claude-flow/deployment';

// 1. Validate
const validation = await validate();
if (!validation.valid) process.exit(1);

// 2. Prepare release
const release = await prepareRelease({
  bumpType: 'minor',
  generateChangelog: true,
  createTag: true,
  commit: true
});

// 3. Publish
const publish = await publishToNpm({
  tag: 'latest',
  access: 'public'
});

console.log(`Released ${publish.packageName}@${publish.version}`);
```

## Class-Based API

```typescript
import { Validator, ReleaseManager, Publisher } from '@claude-flow/deployment';

const validator = new Validator();
const manager = new ReleaseManager();
const publisher = new Publisher();

await validator.validate();
await manager.prepareRelease({ bumpType: 'patch' });
await publisher.publishToNpm({ tag: 'latest' });
```

## Options Reference

### ReleaseOptions

```typescript
{
  bumpType?: 'major' | 'minor' | 'patch' | 'prerelease',
  version?: string,              // Override version
  channel?: 'alpha' | 'beta' | 'rc' | 'latest',
  generateChangelog?: boolean,   // Default: true
  createTag?: boolean,           // Default: true
  commit?: boolean,              // Default: true
  dryRun?: boolean,              // Default: false
  skipValidation?: boolean,      // Default: false
  tagPrefix?: string,            // Default: 'v'
  changelogPath?: string         // Default: 'CHANGELOG.md'
}
```

### PublishOptions

```typescript
{
  tag?: string,                  // Default: 'latest'
  access?: 'public' | 'restricted',
  dryRun?: boolean,              // Default: false
  registry?: string,             // Custom registry URL
  otp?: string,                  // 2FA code
  skipBuild?: boolean,           // Default: false
  buildCommand?: string          // Default: 'npm run build'
}
```

### ValidationOptions

```typescript
{
  lint?: boolean,                // Default: true
  test?: boolean,                // Default: true
  build?: boolean,               // Default: true
  checkDependencies?: boolean,   // Default: true
  checkGitStatus?: boolean,      // Default: true
  lintCommand?: string,          // Default: 'npm run lint'
  testCommand?: string,          // Default: 'npm test'
  buildCommand?: string          // Default: 'npm run build'
}
```

## Conventional Commits

Use conventional commit format for automatic changelog generation:

```bash
git commit -m "feat(api): add new endpoint"
git commit -m "fix(auth): resolve login issue"
git commit -m "docs(readme): update examples"
git commit -m "chore(deps): update dependencies"
```

Breaking changes:
```bash
git commit -m "feat(ui): redesign layout

BREAKING CHANGE: new layout requires migration"
```

## Common Patterns

### Prerelease to Release

```typescript
// 1. Alpha releases
await prepareRelease({ bumpType: 'prerelease', channel: 'alpha' });
await publishToNpm({ tag: 'alpha' });

// 2. Beta releases
await prepareRelease({ bumpType: 'prerelease', channel: 'beta' });
await publishToNpm({ tag: 'beta' });

// 3. Release candidate
await prepareRelease({ bumpType: 'prerelease', channel: 'rc' });
await publishToNpm({ tag: 'rc' });

// 4. Final release
await prepareRelease({ bumpType: 'patch' });
await publishToNpm({ tag: 'latest' });
```

### Check Before Release

```typescript
import { Publisher } from '@claude-flow/deployment';

const publisher = new Publisher();

// Check authentication
const authenticated = await publisher.verifyAuth();
if (!authenticated) {
  console.error('Not logged in to npm');
  process.exit(1);
}

// Check if version exists
const exists = await publisher.checkVersionExists('my-package', '1.0.0');
if (exists) {
  console.error('Version already published');
  process.exit(1);
}

// Get latest version
const latest = await publisher.getLatestVersion('my-package');
console.log('Latest version:', latest);
```

## Error Handling

```typescript
const result = await prepareRelease({ bumpType: 'minor' });

if (result.success) {
  console.log('Success!', result.newVersion);
} else {
  console.error('Failed:', result.error);
  if (result.warnings) {
    console.warn('Warnings:', result.warnings);
  }
}
```

## Examples

See the `/examples` directory for complete working examples:

- `basic-release.ts` - Complete release workflow
- `prerelease-workflow.ts` - Alpha/Beta/RC workflow
- `dry-run.ts` - Test releases safely

Run examples:
```bash
npx tsx examples/basic-release.ts
npx tsx examples/prerelease-workflow.ts
npx tsx examples/dry-run.ts
```

## Tips

1. Always test with `dryRun: true` first
2. Use conventional commits for better changelogs
3. Run validation before releasing
4. Keep your git repo clean (no uncommitted changes)
5. Use prerelease tags for beta testing
6. Verify npm authentication before publishing

## Troubleshooting

**Problem**: "Not authenticated with npm"
```bash
npm login
```

**Problem**: "Uncommitted changes detected"
```bash
git status
git commit -am "your message"
```

**Problem**: "Package is private"
```json
// Remove from package.json
"private": true
```

**Problem**: "Version already exists"
```typescript
// Bump version first
await prepareRelease({ bumpType: 'patch' });
```

## Support

- [Full Documentation](./README.md)
- [Implementation Details](./IMPLEMENTATION.md)
- [Examples](./examples/)
