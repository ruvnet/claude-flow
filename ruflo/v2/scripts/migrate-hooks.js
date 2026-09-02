#!/usr/bin/env node

/**
 * Migration script to update Claude Flow settings.json to new hooks format
 * Compatible with Claude Code 1.0.51+
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function migrateSettingsFile(settingsPath) {
  try {
    // Read existing settings
    const content = await fs.readFile(settingsPath, 'utf8');
    const settings = JSON.parse(content);
    
    // Check if hooks already in new format
    if (settings.hooks && settings.hooks.PreToolUse) {
      console.log('✅ Hooks already in new format, no migration needed');
      return;
    }
    
    // Backup original file
    const backupPath = settingsPath + '.backup-' + Date.now();
    await fs.writeFile(backupPath, content);
    console.log(`📦 Backed up original settings to: ${backupPath}`);
    
    // Convert old hooks format to new format
    const newHooks = {
      PreToolUse: [],
      PostToolUse: [],
      Stop: []
    };
    
    // Convert preCommandHook
    if (settings.hooks?.preCommandHook) {
      newHooks.PreToolUse.push({
        matcher: "Bash",
        hooks: [{
          type: "command",
          command: `npx claude-flow@alpha hooks pre-command --command "\${command}" --validate-safety true --prepare-resources true`
        }]
      });
    }
    
    // Convert preEditHook
    if (settings.hooks?.preEditHook) {
      newHooks.PreToolUse.push({
        matcher: "Write|Edit|MultiEdit",
        hooks: [{
          type: "command",
          command: `npx claude-flow@alpha hooks pre-edit --file "\${file}" --auto-assign-agents true --load-context true`
        }]
      });
    }
    
    // Convert postCommandHook
    if (settings.hooks?.postCommandHook) {
      newHooks.PostToolUse.push({
        matcher: "Bash",
        hooks: [{
          type: "command",
          command: `npx claude-flow@alpha hooks post-command --command "\${command}" --track-metrics true --store-results true`
        }]
      });
    }
    
    // Convert postEditHook
    if (settings.hooks?.postEditHook) {
      newHooks.PostToolUse.push({
        matcher: "Write|Edit|MultiEdit",
        hooks: [{
          type: "command",
          command: `npx claude-flow@alpha hooks post-edit --file "\${file}" --format true --update-memory true --train-neural true`
        }]
      });
    }
    
    // Convert sessionEndHook
    if (settings.hooks?.sessionEndHook) {
      newHooks.Stop.push({
        hooks: [{
          type: "command",
          command: `npx claude-flow@alpha hooks session-end --generate-summary true --persist-state true --export-metrics true`
        }]
      });
    }
    
    // Update settings with new hooks format
    settings.hooks = newHooks;
    
    // Remove unrecognized fields for Claude Code 1.0.51+
    delete settings.mcpServers;
    delete settings.features;
    delete settings.performance;
    
    // Write updated settings
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));
    console.log('✅ Successfully migrated settings.json to new hooks format');
    
    // Show removed fields
    console.log('\n📝 Note: The following fields were removed (not supported by Claude Code 1.0.51+):');
    console.log('   - mcpServers (use "claude mcp add" command instead)');
    console.log('   - features');
    console.log('   - performance');
    
  } catch (error) {
    console.error('❌ Error migrating settings:', error.message);
    process.exit(1);
  }
}

async function findSettingsFiles() {
  const locations = [
    path.join(process.cwd(), '.claude', 'settings.json'),
    path.join(process.cwd(), 'settings.json'),
    path.join(process.env.HOME || '', '.claude', 'settings.json')
  ];
  
  const found = [];
  for (const location of locations) {
    try {
      await fs.access(location);
      found.push(location);
    } catch {
      // File doesn't exist, skip
    }
  }
  
  return found;
}

async function main() {
  console.log('🔄 Claude Flow Hooks Migration Script\n');
  
  // Check if specific file provided
  const args = process.argv.slice(2);
  if (args.length > 0) {
    const targetFile = args[0];
    console.log(`Migrating specific file: ${targetFile}`);
    await migrateSettingsFile(targetFile);
  } else {
    // Find and migrate all settings files
    const files = await findSettingsFiles();
    
    if (files.length === 0) {
      console.log('❌ No settings.json files found to migrate');
      console.log('\nSearched locations:');
      console.log('  - .claude/settings.json');
      console.log('  - settings.json');
      console.log('  - ~/.claude/settings.json');
      return;
    }
    
    console.log(`Found ${files.length} settings file(s) to migrate:\n`);
    
    for (const file of files) {
      console.log(`\n📍 Migrating: ${file}`);
      await migrateSettingsFile(file);
    }
  }
  
  console.log('\n✨ Migration complete!');
  console.log('\nNext steps:');
  console.log('1. Restart Claude Code to apply changes');
  console.log('2. Run "claude mcp add claude-flow npx claude-flow@alpha mcp start" to add MCP server');
  console.log('3. Check /doctor in Claude Code to verify settings are valid');
}

main().catch(console.error);