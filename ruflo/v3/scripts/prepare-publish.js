#!/usr/bin/env node
/**
 * Prepare V3 packages for npm publishing
 * - Updates workspace:* to actual version numbers
 * - Adds publishConfig
 * - Updates exports to point to dist
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const v3Root = path.join(__dirname, '..');

const VERSION = '3.0.0-alpha.1';
const TAG = 'v3alpha';

// All @claude-flow packages
const packages = [
  'shared',
  'security',
  'memory',
  'embeddings',
  'neural',
  'providers',
  'swarm',
  'hooks',
  'plugins',
  'mcp',
  'integration',
  'cli',
  'deployment',
  'performance',
  'testing',
  'claims',
];

// Dependency order (packages that others depend on first)
const publishOrder = [
  'shared',      // No deps
  'security',    // Depends on shared
  'memory',      // Depends on shared
  'embeddings',  // Depends on shared
  'neural',      // Depends on shared, memory
  'providers',   // Depends on shared
  'swarm',       // Depends on shared, memory
  'hooks',       // Depends on shared, memory, neural
  'plugins',     // Depends on shared, hooks
  'mcp',         // Depends on shared, swarm, memory
  'integration', // Depends on multiple
  'cli',         // Depends on most
  'deployment',  // Depends on cli, shared
  'performance', // Depends on shared
  'testing',     // Depends on shared
  'claims',      // Depends on shared
];

function updatePackageJson(pkgName) {
  const pkgPath = path.join(v3Root, '@claude-flow', pkgName, 'package.json');

  if (!fs.existsSync(pkgPath)) {
    console.log(`⚠️  ${pkgName}: package.json not found`);
    return;
  }

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

  // Ensure version
  pkg.version = VERSION;

  // Add publishConfig
  pkg.publishConfig = {
    access: 'public',
    tag: TAG,
  };

  // Update main/types to point to dist
  if (pkg.main?.startsWith('src/')) {
    pkg.main = pkg.main.replace('src/', 'dist/').replace('.ts', '.js');
  }
  if (pkg.types?.startsWith('src/')) {
    pkg.types = pkg.types.replace('src/', 'dist/').replace('.ts', '.d.ts');
  }

  // Update exports to point to dist
  if (pkg.exports) {
    const newExports = {};
    for (const [key, value] of Object.entries(pkg.exports)) {
      if (typeof value === 'string') {
        newExports[key] = value.replace(/^\.\/src\//, './dist/').replace('.ts', '.js');
      } else if (typeof value === 'object') {
        newExports[key] = {};
        for (const [subKey, subValue] of Object.entries(value)) {
          if (typeof subValue === 'string') {
            newExports[key][subKey] = subValue.replace(/^\.\/src\//, './dist/').replace('.ts', '.js');
          } else {
            newExports[key][subKey] = subValue;
          }
        }
      } else {
        newExports[key] = value;
      }
    }
    pkg.exports = newExports;
  }

  // Replace workspace:* with actual versions
  if (pkg.dependencies) {
    for (const [dep, version] of Object.entries(pkg.dependencies)) {
      if (version === 'workspace:*' || version === 'workspace:^') {
        pkg.dependencies[dep] = `^${VERSION}`;
      }
    }
  }
  if (pkg.peerDependencies) {
    for (const [dep, version] of Object.entries(pkg.peerDependencies)) {
      if (version.includes('workspace:')) {
        pkg.peerDependencies[dep] = `^${VERSION}`;
      }
    }
  }

  // Write back
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`✅ ${pkgName}: Updated for publishing`);
}

function updateMainPackage() {
  const pkgPath = path.join(v3Root, 'claude-flow', 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

  pkg.version = VERSION;
  pkg.publishConfig = {
    access: 'public',
    tag: TAG,
  };

  // Replace workspace:* with actual versions
  if (pkg.dependencies) {
    for (const [dep, version] of Object.entries(pkg.dependencies)) {
      if (version === 'workspace:*' || version === 'workspace:^') {
        pkg.dependencies[dep] = `^${VERSION}`;
      }
    }
  }

  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`✅ claude-flow: Updated for publishing`);
}

console.log('📦 Preparing V3 packages for npm publishing...\n');

// Update all @claude-flow packages
for (const pkg of packages) {
  updatePackageJson(pkg);
}

// Update main claude-flow package
updateMainPackage();

console.log('\n✅ All packages prepared for publishing!');
console.log(`\n📋 Publish order (${publishOrder.length} packages + main):`);
publishOrder.forEach((pkg, i) => console.log(`   ${i + 1}. @claude-flow/${pkg}`));
console.log(`   ${publishOrder.length + 1}. claude-flow`);

console.log('\n🚀 To publish, run:');
console.log('   npm login');
console.log('   cd v3 && npm run build');
for (const pkg of publishOrder) {
  console.log(`   cd @claude-flow/${pkg} && npm publish --tag v3alpha && cd ../..`);
}
console.log('   cd claude-flow && npm publish --tag v3alpha');
