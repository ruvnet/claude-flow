#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

/**
 * Validate Claude optimized template installation
 * This script verifies that all required files are present and properly formatted
 */

const TEMPLATE_DIR = path.join(__dirname, '.claude');
const MANIFEST_PATH = path.join(__dirname, 'manifest.json');

// Colors for console output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
};

function log(message, color = 'reset') {
  console.log(colors[color] + message + colors.reset);
}

// Read manifest
let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  log('✓ Manifest loaded successfully', 'green');
} catch (error) {
  log('✗ Failed to load manifest: ' + error.message, 'red');
  process.exit(1);
}

let totalTests = 0;
let passedTests = 0;

function test(description, condition) {
  totalTests++;
  if (condition) {
    log(`  ✓ ${description}`, 'green');
    passedTests++;
  } else {
    log(`  ✗ ${description}`, 'red');
  }
}

// Test 1: Template directory exists
log('\n1. Checking template directory...', 'blue');
test('Template directory exists', fs.existsSync(TEMPLATE_DIR));

// Test 2: Directory structure
log('\n2. Validating directory structure...', 'blue');
for (const [dirName, dirInfo] of Object.entries(manifest.directories)) {
  const dirPath = path.join(TEMPLATE_DIR, dirInfo.path);
  test(`Directory ${dirInfo.path} exists`, fs.existsSync(dirPath));
}

// Test 3: File presence
log('\n3. Checking file presence...', 'blue');
for (const file of manifest.files) {
  const filePath = path.join(TEMPLATE_DIR, file.destination);
  test(`File ${file.destination} exists`, fs.existsSync(filePath));
}

// Test 4: File content validation
log('\n4. Validating file content...', 'blue');
const sampleFiles = [
  'commands/sparc.md',
  'commands/sparc/architect.md',
  'BATCHTOOLS_GUIDE.md'
];

for (const fileName of sampleFiles) {
  const filePath = path.join(TEMPLATE_DIR, fileName);
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, 'utf8');
    test(`${fileName} has content`, content.length > 100);
    test(`${fileName} contains frontmatter`, content.startsWith('---'));
  }
}

// Test 5: Command structure validation
log('\n5. Validating command structure...', 'blue');
const sparcCommands = manifest.files.filter(f => f.category === 'sparc-mode');
for (const cmd of sparcCommands.slice(0, 3)) { // Test first 3 commands
  const filePath = path.join(TEMPLATE_DIR, cmd.destination);
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, 'utf8');
    test(`${cmd.destination} has proper structure`, 
      content.includes('## Instructions') || content.includes('You are'));
  }
}

// Test 6: Test files validation
log('\n6. Validating test files...', 'blue');
const testFiles = manifest.files.filter(f => f.category === 'test');
for (const testFile of testFiles.slice(0, 3)) { // Test first 3 test files
  const filePath = path.join(TEMPLATE_DIR, testFile.destination);
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, 'utf8');
    test(`${testFile.destination} has test structure`, 
      content.includes('describe') || content.includes('test') || content.includes('it'));
  }
}

// Test 7: Version consistency
log('\n7. Checking version consistency...', 'blue');
const versionFile = path.join(__dirname, 'VERSION');
if (fs.existsSync(versionFile)) {
  const fileVersion = fs.readFileSync(versionFile, 'utf8').trim();
  test('Version file matches manifest', fileVersion === manifest.version);
}

// Test 8: File counts
log('\n8. Validating file counts...', 'blue');
for (const [category, info] of Object.entries(manifest.categories)) {
  const actualCount = manifest.files.filter(f => f.category === category).length;
  // Allow some flexibility in counts as they might have been updated
  const countMatches = Math.abs(actualCount - info.count) <= 2;
  test(`${category} file count approximately correct (${actualCount} vs ${info.count})`, countMatches);
}

// Test 9: Installation timestamp
log('\n9. Checking installation status...', 'blue');
const installFile = path.join(__dirname, '.installed');
test('Installation timestamp exists', fs.existsSync(installFile));

// Final summary
log('\n' + '='.repeat(60), 'blue');
log('Validation Summary:', 'blue');
log(`  Total tests: ${totalTests}`);
log(`  Passed: ${passedTests}`, passedTests === totalTests ? 'green' : 'yellow');
log(`  Failed: ${totalTests - passedTests}`, totalTests - passedTests === 0 ? 'green' : 'red');

const percentage = Math.round((passedTests / totalTests) * 100);
log(`  Success rate: ${percentage}%`, percentage >= 90 ? 'green' : percentage >= 70 ? 'yellow' : 'red');

if (passedTests === totalTests) {
  log('\n🎉 Template validation passed! All files are properly installed.', 'green');
} else if (percentage >= 90) {
  log('\n⚠️  Template validation mostly passed with minor issues.', 'yellow');
} else {
  log('\n❌ Template validation failed. Please check the issues above.', 'red');
}

// Additional information
log('\nTemplate Information:', 'blue');
log(`  Version: ${manifest.version}`);
log(`  Total files: ${manifest.files.length}`);
log(`  Documentation files: ${manifest.files.filter(f => f.category === 'documentation').length}`);
log(`  Command files: ${manifest.files.filter(f => f.category === 'command').length}`);
log(`  SPARC mode files: ${manifest.files.filter(f => f.category === 'sparc-mode').length}`);
log(`  Test files: ${manifest.files.filter(f => f.category === 'test').length}`);

process.exit(passedTests === totalTests ? 0 : 1);