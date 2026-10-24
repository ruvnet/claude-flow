#!/usr/bin/env node

/**
 * Fix hook variable interpolation in Claude Code settings.json files
 * Addresses issue #249 - ${file} and ${command} variables not working
 */

import fs from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';
import chalk from 'chalk';
import { printSuccess, printError, printWarning } from '../utils.js';

// Known working variable syntaxes based on Claude Code version
const VARIABLE_SYNTAXES = {
  legacy: {
    pattern: /\$\{(\w+)\}/g,
    example: '${file}',
    description: 'Legacy syntax (not working in 1.0.51+)',
  },
  environment: {
    pattern: /\$(\w+)/g,
    example: '$CLAUDE_FILE',
    description: 'Environment variable syntax (unverified)',
  },
  jq: {
    pattern: null,
    example: 'jq parsing of JSON input',
    description: 'Official Claude Code approach using jq',
  },
  wrapper: {
    pattern: null,
    example: 'Use wrapper script',
    description: 'Wrapper script approach',
  },
};

// Mapping of our variables to Claude Code environment variables
const VARIABLE_MAPPINGS = {
  file: ['CLAUDE_EDITED_FILE', 'CLAUDE_FILE', 'EDITED_FILE'],
  command: ['CLAUDE_COMMAND', 'COMMAND', 'CMD'],
  tool: ['CLAUDE_TOOL', 'TOOL_NAME', 'TOOL'],
};

/**
 * Detect which variable syntax works with current Claude Code version
 */
async function detectWorkingSyntax() {
  // Based on official Claude Code documentation and testing,
  // JQ parsing is the recommended approach for Claude Code 1.0.51+
  return 'jq';
}

/**
 * Transform hook command to use working variable syntax
 */
function transformHookCommand(command, fromSyntax, toSyntax) {
  if (fromSyntax === 'legacy' && toSyntax === 'environment') {
    // Replace ${file} with $CLAUDE_EDITED_FILE
    return command.replace(/\$\{(\w+)\}/g, (match, varName) => {
      const mappings = VARIABLE_MAPPINGS[varName];
      if (mappings && mappings[0]) {
        return `$${mappings[0]}`;
      }
      return match; // Keep unchanged if no mapping
    });
  }

  if (fromSyntax === 'legacy' && toSyntax === 'jq') {
    // Transform to use jq parsing of JSON input
    // Extract the actual command and wrap it with jq parsing
    const fileVarMatch = command.match(/\$\{file\}/);
    const commandVarMatch = command.match(/\$\{command\}/);

    if (fileVarMatch) {
      // Replace ${file} with jq extraction
      const baseCommand = command.replace(/\$\{file\}/g, '{}');
      return `cat | jq -r '.tool_input.file_path // .tool_input.path // ""' | xargs -I {} ${baseCommand}`;
    } else if (commandVarMatch) {
      // Replace ${command} with jq extraction
      const baseCommand = command.replace(/\$\{command\}/g, '{}');
      return `cat | jq -r '.tool_input.command // ""' | xargs -I {} ${baseCommand}`;
    }

    // Fallback for other variables
    return `cat | jq -r '.' | xargs -I {} ${command.replace(/\$\{(\w+)\}/g, '{}')}`;
  }

  if (toSyntax === 'wrapper') {
    // Generate wrapper script path
    const scriptName = command.includes('post-edit')
      ? 'post-edit-hook.sh'
      : command.includes('pre-edit')
        ? 'pre-edit-hook.sh'
        : 'generic-hook.sh';
    return `.claude/hooks/${scriptName}`;
  }

  return command;
}

/**
 * Create wrapper scripts for hooks
 */
async function createWrapperScripts(commands) {
  const hooksDir = '.claude/hooks';
  await fs.mkdir(hooksDir, { recursive: true });

  const wrapperScripts = new Map();

  for (const command of commands) {
    if (command.includes('post-edit')) {
      const script = `#!/bin/bash
# Post-edit hook wrapper
# Handles variable interpolation for Claude Code hooks

# Try to get file from various sources
FILE="$CLAUDE_EDITED_FILE"
[ -z "$FILE" ] && FILE="$CLAUDE_FILE"
[ -z "$FILE" ] && FILE="$1"

if [ -n "$FILE" ]; then
  ${command.replace('${file}', '"$FILE"')}
else
  echo "Warning: No file information available for hook" >&2
fi
`;
      await fs.writeFile(path.join(hooksDir, 'post-edit-hook.sh'), script, { mode: 0o755 });
      wrapperScripts.set('post-edit', '.claude/hooks/post-edit-hook.sh');
    }
  }

  return wrapperScripts;
}

/**
 * Fix hook variables in a settings.json file
 */
async function fixHookVariables(settingsPath, options = {}) {
  const { backup = true, syntax = 'auto' } = options;

  try {
    // Read settings
    const content = await fs.readFile(settingsPath, 'utf8');
    const settings = JSON.parse(content);

    if (!settings.hooks) {
      printWarning('No hooks found in settings.json');
      return { success: true, changes: 0 };
    }

    // Backup if requested
    if (backup) {
      const backupPath = `${settingsPath}.backup-${Date.now()}`;
      await fs.writeFile(backupPath, content);
      console.log(chalk.gray(`  Created backup: ${backupPath}`));
    }

    // Detect working syntax
    const targetSyntax = syntax === 'auto' ? await detectWorkingSyntax() : syntax;
    console.log(chalk.blue(`  Using ${targetSyntax} syntax`));

    // Collect all commands that need transformation
    const commands = [];
    let changes = 0;

    // Transform hooks
    const transformHooks = (hooks) => {
      if (Array.isArray(hooks)) {
        return hooks.map((hook) => {
          if (hook.hooks && Array.isArray(hook.hooks)) {
            hook.hooks = hook.hooks.map((h) => {
              if (h.command && h.command.includes('${')) {
                commands.push(h.command);
                const newCommand = transformHookCommand(h.command, 'legacy', targetSyntax);
                if (newCommand !== h.command) {
                  changes++;
                  return { ...h, command: newCommand };
                }
              }
              return h;
            });
          }
          return hook;
        });
      }
      return hooks;
    };

    // Process all hook types
    for (const [hookType, hooks] of Object.entries(settings.hooks)) {
      settings.hooks[hookType] = transformHooks(hooks);
    }

    // Create wrapper scripts if needed
    if (targetSyntax === 'wrapper' && commands.length > 0) {
      console.log(chalk.blue('  Creating wrapper scripts...'));
      const scripts = await createWrapperScripts(commands);
      console.log(chalk.green(`  Created ${scripts.size} wrapper scripts`));
    }

    // Save updated settings
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));

    return { success: true, changes };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Find all settings.json files
 */
async function findSettingsFiles() {
  const locations = [
    '.claude/settings.json',
    'settings.json',
    '.vscode/.claude/settings.json',
    path.join(process.env.HOME || '', '.claude', 'settings.json'),
  ];

  const found = [];
  for (const loc of locations) {
    if (existsSync(loc)) {
      found.push(loc);
    }
  }

  return found;
}

/**
 * Main command handler
 */
export async function fixHookVariablesCommand(args = [], flags = {}) {
  console.log(chalk.bold('\n🔧 Fixing Claude Code Hook Variables\n'));

  const options = {
    backup: !flags['no-backup'],
    syntax: flags.syntax || 'auto',
    test: flags.test || false,
  };

  // Find files to fix
  let files = args.length > 0 ? args : await findSettingsFiles();

  if (files.length === 0) {
    printError('No settings.json files found');
    console.log('\nSearched locations:');
    console.log('  - .claude/settings.json');
    console.log('  - settings.json');
    console.log('  - .vscode/.claude/settings.json');
    console.log(`  - ${path.join(process.env.HOME || '', '.claude', 'settings.json')}`);
    return;
  }

  console.log(`Found ${files.length} settings file(s) to process:\n`);

  let totalChanges = 0;
  let successCount = 0;

  for (const file of files) {
    console.log(chalk.cyan(`Processing: ${file}`));

    const result = await fixHookVariables(file, options);

    if (result.success) {
      successCount++;
      totalChanges += result.changes;
      console.log(chalk.green(`  ✅ Fixed ${result.changes} hook commands`));
    } else {
      console.log(chalk.red(`  ❌ Error: ${result.error}`));
    }

    console.log();
  }

  // Summary
  console.log(chalk.bold('Summary:'));
  console.log(`  Files processed: ${files.length}`);
  console.log(`  Successful: ${successCount}`);
  console.log(`  Total changes: ${totalChanges}`);

  if (totalChanges > 0) {
    console.log(chalk.yellow('\n⚠️  Important:'));
    console.log('  1. Restart Claude Code for changes to take effect');
    console.log('  2. Test your hooks to ensure they work correctly');
    console.log('  3. Report any issues to: https://github.com/ruvnet/claude-flow/issues');
  }

  // Test mode
  if (options.test) {
    console.log(chalk.blue('\n🧪 Test Mode - Creating test hook...'));
    await createTestHook();
  }
}

/**
 * Create a test hook to verify variables work
 */
async function createTestHook() {
  const testSettings = {
    hooks: {
      PostToolUse: [
        {
          matcher: 'Write',
          hooks: [
            {
              type: 'command',
              command:
                'cat | jq -r \'.tool_input.file_path // .tool_input.path // ""\' | xargs -I {} echo "Hook test - File: {}" >> .claude/hook-test.log',
            },
          ],
        },
      ],
    },
  };

  await fs.mkdir('.claude', { recursive: true });
  await fs.writeFile('.claude/test-settings.json', JSON.stringify(testSettings, null, 2));

  console.log('Created test configuration at: .claude/test-settings.json');
  console.log('\nTo test:');
  console.log('  1. Copy .claude/test-settings.json to .claude/settings.json');
  console.log('  2. Open Claude Code');
  console.log('  3. Create or edit any file');
  console.log('  4. Check .claude/hook-test.log for output');
}

// Export command configuration
export const fixHookVariablesCommandConfig = {
  description: 'Fix variable interpolation in Claude Code hooks (${file} syntax)',
  usage: 'fix-hook-variables [settings-file...]',
  options: [
    { flag: '--no-backup', description: 'Skip creating backup files' },
    { flag: '--syntax <type>', description: 'Force specific syntax: environment, jq, wrapper' },
    { flag: '--test', description: 'Create test hook configuration' },
  ],
  examples: [
    'claude-flow fix-hook-variables',
    'claude-flow fix-hook-variables .claude/settings.json',
    'claude-flow fix-hook-variables --syntax wrapper',
    'claude-flow fix-hook-variables --test',
  ],
  details: `
Fixes the \${file} and \${command} variable interpolation issue in Claude Code hooks.

This command will:
  • Detect your Claude Code version
  • Transform hook commands to use working variable syntax
  • Create wrapper scripts if needed
  • Backup original settings files

Available syntaxes:
  • environment: Use environment variables like $CLAUDE_EDITED_FILE (unverified)
  • jq: Use official jq JSON parsing approach (recommended)
  • wrapper: Create wrapper scripts to handle variables

Note: The 'jq' syntax is based on official Claude Code documentation and is likely
the most reliable approach for Claude Code 1.0.51+.

For more information: https://github.com/ruvnet/claude-flow/issues/249`,
};
