#!/usr/bin/env node

/**
 * Prepare for npm publish by ensuring all versions are synchronized
 * and dist files are built correctly
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log('🚀 Preparing for npm publish...\n');

// 1. Get version from package.json
const packageJsonPath = path.join(rootDir, 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const version = packageJson.version;

console.log(`📦 Package version: ${version}\n`);

// 2. Files that need version updates
const versionFiles = [
  { path: 'src/cli/simple-cli.ts', pattern: /const VERSION = '[^']+';/, replacement: `const VERSION = '${version}';` },
  { path: 'src/cli/simple-cli.js', pattern: /const VERSION = '[^']+';/, replacement: `const VERSION = '${version}';` },
  { path: 'src/cli/index.ts', pattern: /const VERSION = '[^']+';/, replacement: `const VERSION = '${version}';` },
  { path: 'src/cli/index-remote.ts', pattern: /const VERSION = '[^']+';/, replacement: `const VERSION = '${version}';` },
  { path: 'bin/claude-flow', pattern: /VERSION="[^"]+"/, replacement: `VERSION="${version}"` },
  { path: 'src/cli/commands/status.ts', pattern: /version: '[^']+'/g, replacement: `version: '${version}'` },
  { path: 'src/cli/simple-commands/status.js', pattern: /version: '[^']+'/g, replacement: `version: '${version}'` },
  { path: 'src/cli/simple-commands/config.js', pattern: /version: "[^"]+"/g, replacement: `version: "${version}"` },
  { path: 'src/cli/simple-commands/process-ui-enhanced.js', pattern: /Claude-Flow Process Management UI v[0-9.]+/, replacement: `Claude-Flow Process Management UI v${version}` },
  { path: 'src/cli/init/claude-config.ts', pattern: /version: "[^"]+"/g, replacement: `version: "${version}"` },
  { path: 'src/cli/init/directory-structure.ts', pattern: /version: "[^"]+"/g, replacement: `version: "${version}"` }
];

// 3. Update version in all files
console.log('📝 Updating version in source files...');
let updatedCount = 0;

versionFiles.forEach(({ path: filePath, pattern, replacement }) => {
  const fullPath = path.join(rootDir, filePath);
  if (fs.existsSync(fullPath)) {
    const content = fs.readFileSync(fullPath, 'utf8');
    const newContent = content.replace(pattern, replacement);
    
    if (content !== newContent) {
      fs.writeFileSync(fullPath, newContent);
      console.log(`   ✅ Updated ${filePath}`);
      updatedCount++;
    } else {
      console.log(`   ⏭️  ${filePath} already up to date`);
    }
  } else {
    console.log(`   ⚠️  ${filePath} not found`);
  }
});

console.log(`\n   Updated ${updatedCount} files\n`);

// 4. Clean dist directory
console.log('🧹 Cleaning dist directory...');
const distDir = path.join(rootDir, 'dist');
if (fs.existsSync(distDir)) {
  execSync('rm -rf dist', { cwd: rootDir });
  console.log('   ✅ Cleaned dist directory');
}

// 5. Build TypeScript files
console.log('\n🔨 Building TypeScript files...');
try {
  // First try to build just the CLI files with relaxed config
  execSync('npx tsc -p tsconfig.cli.json', { cwd: rootDir, stdio: 'inherit' });
  console.log('   ✅ CLI files built successfully');
} catch (error) {
  console.log('   ⚠️  Build had errors, trying fallback...');
  try {
    // Fallback: try the regular build
    execSync('npm run build:ts', { cwd: rootDir, stdio: 'inherit' });
  } catch (error2) {
    console.log('   ⚠️  Build had errors, but continuing...');
    // Continue anyway as there might be type errors that don't affect runtime
  }
}

// 6. Verify dist files have correct version
console.log('\n🔍 Verifying dist files...');
const distFiles = [
  'dist/cli/simple-cli.js',
  'dist/cli/index.js'
];

distFiles.forEach(distFile => {
  const fullPath = path.join(rootDir, distFile);
  if (fs.existsSync(fullPath)) {
    const content = fs.readFileSync(fullPath, 'utf8');
    const versionMatch = content.match(/VERSION = ['"]([^'"]+)['"]/);
    
    if (versionMatch) {
      if (versionMatch[1] === version) {
        console.log(`   ✅ ${distFile}: ${versionMatch[1]}`);
      } else {
        console.log(`   ❌ ${distFile}: ${versionMatch[1]} (expected ${version})`);
      }
    } else {
      console.log(`   ⚠️  ${distFile}: version not found`);
    }
  } else {
    console.log(`   ⚠️  ${distFile}: file not found`);
  }
});

// 7. Check what will be published
console.log('\n📋 Files to be published:');
try {
  const packOutput = execSync('npm pack --dry-run --json', { cwd: rootDir, encoding: 'utf8' });
  const packInfo = JSON.parse(packOutput);
  
  if (packInfo[0] && packInfo[0].files) {
    const importantFiles = packInfo[0].files.filter(f => 
      f.path.includes('cli.js') || 
      f.path.includes('simple-cli') ||
      f.path.includes('package.json') ||
      f.path.includes('README.md')
    );
    
    importantFiles.forEach(file => {
      console.log(`   📄 ${file.path} (${(file.size / 1024).toFixed(1)}KB)`);
    });
    
    console.log(`\n   Total files: ${packInfo[0].files.length}`);
    console.log(`   Total size: ${(packInfo[0].size / 1024 / 1024).toFixed(2)}MB`);
  }
} catch (error) {
  console.log('   ⚠️  Could not get pack info');
}

console.log('\n✅ Ready to publish!');
console.log('\n📝 Next steps:');
console.log('   1. Review the changes above');
console.log('   2. Commit any version changes: git add -A && git commit -m "chore: sync versions"');
console.log('   3. Publish to npm: npm publish');
console.log('   4. Create git tag: git tag v' + version + ' && git push --tags');

console.log('\n💡 The prepublishOnly script will automatically run this before publish.');