#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

/**
 * Deploy Claude optimized template to a target project
 * Usage: node deploy-to-project.js <target-project-path>
 */

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: node deploy-to-project.js <target-project-path>');
  console.error('Example: node deploy-to-project.js /path/to/my-project');
  process.exit(1);
}

const TARGET_PROJECT = args[0];
const SOURCE_DIR = path.join(__dirname, '.claude');
const TARGET_DIR = path.join(TARGET_PROJECT, '.claude');
const MANIFEST_PATH = path.join(__dirname, 'manifest.json');

console.log('Claude Optimized Template Deployment');
console.log('====================================');
console.log(`Source: ${SOURCE_DIR}`);
console.log(`Target: ${TARGET_DIR}`);

// Validate target project
if (!fs.existsSync(TARGET_PROJECT)) {
  console.error(`Error: Target project directory does not exist: ${TARGET_PROJECT}`);
  process.exit(1);
}

// Check if it's a valid project (has package.json or similar)
const projectFiles = ['package.json', 'tsconfig.json', 'deno.json', 'go.mod', 'Cargo.toml', 'setup.py'];
const hasProjectFile = projectFiles.some(file => fs.existsSync(path.join(TARGET_PROJECT, file)));

if (!hasProjectFile) {
  console.warn('Warning: Target directory does not appear to be a project root (no package.json, etc.)');
  console.log('Continue anyway? (y/n)');
  // For automation, we'll continue
}

// Read manifest
const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));

// Create target .claude directory
if (!fs.existsSync(TARGET_DIR)) {
  fs.mkdirSync(TARGET_DIR, { recursive: true });
  console.log('✓ Created .claude directory');
} else {
  console.log('⚠️  .claude directory already exists - files will be overwritten');
}

// Create directory structure
console.log('\nCreating directory structure...');
for (const [dirName, dirInfo] of Object.entries(manifest.directories)) {
  const targetPath = path.join(TARGET_DIR, dirInfo.path);
  if (!fs.existsSync(targetPath)) {
    fs.mkdirSync(targetPath, { recursive: true });
    console.log(`  ✓ ${dirInfo.path}`);
  }
  
  // Create README for empty directories
  if (dirInfo.createEmpty) {
    const readmePath = path.join(targetPath, 'README.md');
    if (!fs.existsSync(readmePath)) {
      fs.writeFileSync(readmePath, `# ${dirName}\n\nThis directory will be populated during usage.\n`);
    }
  }
}

// Copy files
console.log('\nDeploying template files...');
let successCount = 0;
let errorCount = 0;

for (const file of manifest.files) {
  const sourcePath = path.join(SOURCE_DIR, file.destination);
  const targetPath = path.join(TARGET_DIR, file.destination);
  
  try {
    if (fs.existsSync(sourcePath)) {
      // Ensure target directory exists
      const targetDir = path.dirname(targetPath);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      
      // Copy file
      fs.copyFileSync(sourcePath, targetPath);
      console.log(`  ✓ ${file.destination}`);
      successCount++;
    } else {
      console.error(`  ✗ ${file.destination} - Source file not found`);
      errorCount++;
    }
  } catch (error) {
    console.error(`  ✗ ${file.destination} - Error: ${error.message}`);
    errorCount++;
  }
}

// Create deployment info
const deploymentInfo = {
  deployed: new Date().toISOString(),
  version: manifest.version,
  targetProject: TARGET_PROJECT,
  filesDeployed: successCount,
  errors: errorCount
};

fs.writeFileSync(
  path.join(TARGET_DIR, '.deployment-info.json'),
  JSON.stringify(deploymentInfo, null, 2)
);

// Summary
console.log('\n' + '='.repeat(50));
console.log('Deployment Summary:');
console.log(`  Files deployed: ${successCount}`);
console.log(`  Errors: ${errorCount}`);
console.log(`  Target project: ${TARGET_PROJECT}`);
console.log(`  Template version: ${manifest.version}`);

if (errorCount === 0) {
  console.log('\n🎉 Template deployed successfully!');
  console.log('\nNext steps:');
  console.log('1. Open Claude Code in your project');
  console.log('2. Type / to see available commands');
  console.log('3. Use /sparc for SPARC methodology');
  console.log('4. Use /claude-flow-* for Claude Flow features');
  console.log('\nFor help, see the documentation files in .claude/');
} else {
  console.log('\n⚠️  Template deployed with errors. Please check the messages above.');
}