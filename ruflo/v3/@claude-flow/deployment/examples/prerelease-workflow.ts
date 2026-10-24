/**
 * Prerelease Workflow Example
 *
 * Demonstrates publishing alpha/beta/rc versions
 */

import { prepareRelease, publishToNpm } from '@claude-flow/deployment';

async function prereleaseWorkflow() {
  console.log('Prerelease Workflow\n');

  // Alpha release (early development)
  console.log('1. Creating alpha release...');
  const alpha = await prepareRelease({
    bumpType: 'prerelease',
    channel: 'alpha',
    generateChangelog: true,
    createTag: true,
    commit: true
  });

  if (alpha.success) {
    console.log(`   Created: ${alpha.newVersion}`);

    await publishToNpm({
      tag: 'alpha',
      access: 'public'
    });
    console.log('   Published to npm with tag "alpha"\n');
  }

  // Beta release (feature complete, testing)
  console.log('2. Creating beta release...');
  const beta = await prepareRelease({
    bumpType: 'prerelease',
    channel: 'beta',
    generateChangelog: true,
    createTag: true,
    commit: true
  });

  if (beta.success) {
    console.log(`   Created: ${beta.newVersion}`);

    await publishToNpm({
      tag: 'beta',
      access: 'public'
    });
    console.log('   Published to npm with tag "beta"\n');
  }

  // RC release (release candidate)
  console.log('3. Creating release candidate...');
  const rc = await prepareRelease({
    bumpType: 'prerelease',
    channel: 'rc',
    generateChangelog: true,
    createTag: true,
    commit: true
  });

  if (rc.success) {
    console.log(`   Created: ${rc.newVersion}`);

    await publishToNpm({
      tag: 'rc',
      access: 'public'
    });
    console.log('   Published to npm with tag "rc"\n');
  }

  // Final release (stable)
  console.log('4. Creating final release...');
  const final = await prepareRelease({
    bumpType: 'patch',
    generateChangelog: true,
    createTag: true,
    commit: true
  });

  if (final.success) {
    console.log(`   Created: ${final.newVersion}`);

    await publishToNpm({
      tag: 'latest',
      access: 'public'
    });
    console.log('   Published to npm with tag "latest"\n');
  }

  console.log('✅ Prerelease workflow completed!');
}

// Run the workflow
prereleaseWorkflow().catch(error => {
  console.error('Workflow failed:', error);
  process.exit(1);
});
