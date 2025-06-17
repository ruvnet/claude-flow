#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

/**
 * Install Claude optimized template files
 * This script copies all template files from the source .claude directory
 * to the template directory for packaging and distribution
 */

const SOURCE_DIR = path.join(__dirname, '../../../.claude');
const DEST_DIR = path.join(__dirname, '.claude');
const MANIFEST_PATH = path.join(__dirname, 'manifest.json');

// Read manifest
const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));

// Create destination directory
if (!fs.existsSync(DEST_DIR)) {
  fs.mkdirSync(DEST_DIR, { recursive: true });
}

// Create directories first
console.log('Creating directory structure...');
for (const [dirName, dirInfo] of Object.entries(manifest.directories)) {
  const destPath = path.join(DEST_DIR, dirInfo.path);
  if (!fs.existsSync(destPath)) {
    fs.mkdirSync(destPath, { recursive: true });
    console.log(`  ✓ Created ${dirInfo.path}`);
  }
  
  // Create README for empty directories
  if (dirInfo.createEmpty) {
    const readmePath = path.join(destPath, 'README.md');
    if (!fs.existsSync(readmePath)) {
      fs.writeFileSync(readmePath, `# ${dirName}\n\nThis directory is intentionally empty and will be populated during usage.\n`);
    }
  }
}

// Copy files
console.log('\nCopying template files...');
let successCount = 0;
let errorCount = 0;

for (const file of manifest.files) {
  const sourcePath = path.join(SOURCE_DIR, file.source);
  const destPath = path.join(DEST_DIR, file.destination);
  
  try {
    if (fs.existsSync(sourcePath)) {
      // Ensure destination directory exists
      const destDir = path.dirname(destPath);
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }
      
      // Copy file
      fs.copyFileSync(sourcePath, destPath);
      console.log(`  ✓ ${file.destination} (${file.category})`);
      successCount++;
    } else {
      console.error(`  ✗ ${file.source} - File not found`);
      errorCount++;
    }
  } catch (error) {
    console.error(`  ✗ ${file.destination} - Error: ${error.message}`);
    errorCount++;
  }
}

// Summary
console.log('\n' + '='.repeat(50));
console.log('Installation Summary:');
console.log(`  Files copied: ${successCount}`);
console.log(`  Errors: ${errorCount}`);
console.log(`  Total files in manifest: ${manifest.files.length}`);

// Category summary
console.log('\nFiles by category:');
for (const [category, info] of Object.entries(manifest.categories)) {
  const copied = manifest.files.filter(f => f.category === category && 
    fs.existsSync(path.join(DEST_DIR, f.destination))).length;
  console.log(`  ${category}: ${copied}/${info.count} files`);
}

// Verify installation
if (errorCount === 0) {
  console.log('\n✅ Template installation completed successfully!');
  
  // Create a timestamp file
  const timestamp = new Date().toISOString();
  fs.writeFileSync(
    path.join(__dirname, '.installed'), 
    `Installed: ${timestamp}\nVersion: ${manifest.version}\n`
  );
} else {
  console.log('\n⚠️  Template installation completed with errors.');
  console.log('Please check the error messages above and ensure source files exist.');
}

// Display next steps
console.log('\nNext steps:');
console.log('1. Review the installed files in the .claude directory');
console.log('2. Run tests to verify functionality: npm test');
console.log('3. Package for distribution if needed');
console.log('\nFor more information, see README.md');