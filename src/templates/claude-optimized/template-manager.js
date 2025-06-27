#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

/**
 * Claude Optimized Template Manager
 * Unified interface for template operations
 */

const commands = {
  install: () => spawnSync('node', ['install-template.js'], { stdio: 'inherit', shell: false }),
  validate: () => spawnSync('node', ['validate-template.js'], { stdio: 'inherit', shell: false }),
  deploy: (targetPath) => {
    if (!targetPath) {
      console.error('Usage: template-manager deploy <target-project-path>');
      process.exit(1);
    }
    // Validate targetPath to prevent injection
    if (typeof targetPath !== 'string' || targetPath.includes('..') || targetPath.includes(';') || targetPath.includes('|')) {
      console.error('Invalid target path provided');
      process.exit(1);
    }
    spawnSync('node', ['deploy-to-project.js', targetPath], { stdio: 'inherit', shell: false });
  },
  info: () => {
    const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
    const version = fs.readFileSync('VERSION', 'utf8').trim();
    
    console.log('Claude Optimized Template');
    console.log('========================');
    console.log(`Version: ${version}`);
    console.log(`Files: ${manifest.files.length}`);
    console.log(`Categories: ${Object.keys(manifest.categories).join(', ')}`);
    console.log('\nFile breakdown:');
    for (const [category, info] of Object.entries(manifest.categories)) {
      const count = manifest.files.filter(f => f.category === category).length;
      console.log(`  ${category}: ${count} files`);
    }
    
    console.log('\nAvailable commands:');
    console.log('  install  - Install template files from source');
    console.log('  validate - Validate template installation');
    console.log('  deploy   - Deploy template to project');
    console.log('  info     - Show template information');
    console.log('  update   - Update template version');
    console.log('  test     - Run test suite');
  },
  update: () => {
    console.log('Updating template...');
    
    // Run install to get latest files
    console.log('1. Refreshing template files...');
    spawnSync('node', ['install-template.js'], { stdio: 'inherit', shell: false });
    
    // Validate
    console.log('2. Validating installation...');
    spawnSync('node', ['validate-template.js'], { stdio: 'inherit', shell: false });
    
    console.log('3. Template updated successfully!');
  },
  test: () => {
    console.log('Running template test suite...');
    if (fs.existsSync('.claude/tests/test-harness.js')) {
      spawnSync('node', ['tests/test-harness.js'], { 
        stdio: 'inherit', 
        shell: false,
        cwd: '.claude'
      });
    } else {
      console.log('Test harness not found. Run "install" first.');
    }
  }
};

// Main execution
const args = process.argv.slice(2);
if (args.length === 0) {
  console.log('Claude Optimized Template Manager');
  console.log('Usage: node template-manager.js <command> [args]');
  console.log('\nCommands:');
  console.log('  install  - Install template files from source');
  console.log('  validate - Validate template installation');
  console.log('  deploy   - Deploy template to project');
  console.log('  info     - Show template information');
  console.log('  update   - Update template version');
  console.log('  test     - Run test suite');
  process.exit(0);
}

const command = args[0];
if (commands[command]) {
  try {
    commands[command](...args.slice(1));
  } catch (error) {
    console.error(`Error executing ${command}:`, error.message);
    process.exit(1);
  }
} else {
  console.error(`Unknown command: ${command}`);
  console.log('Available commands: ' + Object.keys(commands).join(', '));
  process.exit(1);
}