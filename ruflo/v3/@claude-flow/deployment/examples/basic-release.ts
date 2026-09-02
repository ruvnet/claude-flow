/**
 * Basic Release Workflow Example
 *
 * This example demonstrates a complete release workflow:
 * 1. Validate package
 * 2. Prepare release (bump version, generate changelog, create tag)
 * 3. Publish to npm
 */

import { Validator, ReleaseManager, Publisher } from '@claude-flow/deployment';

async function basicRelease() {
  console.log('Starting release workflow...\n');

  // Step 1: Validate package
  console.log('1. Validating package...');
  const validator = new Validator();
  const validation = await validator.validate({
    lint: true,
    test: true,
    build: true,
    checkDependencies: true,
    checkGitStatus: true
  });

  console.log(`   Valid: ${validation.valid}`);
  if (validation.errors.length > 0) {
    console.log(`   Errors: ${validation.errors.join(', ')}`);
  }
  if (validation.warnings.length > 0) {
    console.log(`   Warnings: ${validation.warnings.join(', ')}`);
  }

  if (!validation.valid) {
    console.error('\n❌ Validation failed. Fix errors before releasing.');
    process.exit(1);
  }

  // Step 2: Prepare release
  console.log('\n2. Preparing release...');
  const manager = new ReleaseManager();
  const release = await manager.prepareRelease({
    bumpType: 'patch',        // or 'minor', 'major', 'prerelease'
    generateChangelog: true,
    createTag: true,
    commit: true,
    dryRun: false             // Set to true for testing
  });

  if (!release.success) {
    console.error(`\n❌ Release preparation failed: ${release.error}`);
    process.exit(1);
  }

  console.log(`   Version: ${release.oldVersion} → ${release.newVersion}`);
  console.log(`   Tag: ${release.tag}`);
  console.log(`   Commit: ${release.commitHash?.substring(0, 7)}`);

  // Step 3: Publish to npm
  console.log('\n3. Publishing to npm...');
  const publisher = new Publisher();

  // Verify authentication
  const authenticated = await publisher.verifyAuth();
  if (!authenticated) {
    console.error('\n❌ Not authenticated with npm. Run: npm login');
    process.exit(1);
  }

  const publish = await publisher.publishToNpm({
    tag: 'latest',
    access: 'public',
    dryRun: false             // Set to true for testing
  });

  if (!publish.success) {
    console.error(`\n❌ Publish failed: ${publish.error}`);
    process.exit(1);
  }

  console.log(`   Package: ${publish.packageName}@${publish.version}`);
  console.log(`   Tag: ${publish.tag}`);
  console.log(`   Tarball: ${publish.tarball}`);

  console.log('\n✅ Release completed successfully!');
}

// Run the release
basicRelease().catch(error => {
  console.error('Release failed:', error);
  process.exit(1);
});
