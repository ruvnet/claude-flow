#!/usr/bin/env node
/**
 * GitHub command wrapper for simple CLI
 * Provides GitHub workflow automation capabilities
 */

import { printSuccess, printError, printWarning } from '../utils.js';
import { platform } from 'os';
import { access, constants } from 'fs/promises';
import { join } from 'path';

/**
 * Cross-platform check for executable availability
 * @param {string} command - The command to check
 * @returns {Promise<boolean>} - True if command is available
 */
async function checkCommandAvailable(command) {
  const { execSync } = await import('child_process');

  if (platform() === 'win32') {
    // Windows: Use 'where' command
    try {
      execSync(`where ${command}`, { stdio: 'ignore' });
      return true;
    } catch (e) {
      return false;
    }
  } else {
    // Unix-like systems: Check common paths and use 'command -v'
    try {
      execSync(`command -v ${command}`, { stdio: 'ignore', shell: true });
      return true;
    } catch (e) {
      // Fallback: Check common installation paths
      const commonPaths = [
        '/usr/local/bin',
        '/usr/bin',
        '/opt/homebrew/bin',
        join(process.env.HOME || '', '.local', 'bin'),
        join(process.env.HOME || '', 'bin'),
      ];

      for (const dir of commonPaths) {
        try {
          await access(join(dir, command), constants.X_OK);
          return true;
        } catch (e) {
          // Continue checking other paths
        }
      }
      return false;
    }
  }
}

/**
 * Check if Claude CLI is available
 * @returns {Promise<boolean>} - True if Claude is available
 */
async function checkClaudeAvailable() {
  return checkCommandAvailable('claude');
}

const GITHUB_MODES = {
  'init': {
    description: 'Initialize GitHub-specific hooks and checkpoint system',
    examples: [
      'github init',
      'github init --force',
      'github init --checkpoints-only',
    ],
  },
  'gh-coordinator': {
    description: 'GitHub workflow orchestration and coordination',
    examples: [
      'github gh-coordinator "setup CI/CD pipeline"',
      'github gh-coordinator "coordinate release process" --auto-approve',
    ],
  },
  'pr-manager': {
    description: 'Pull request management with multi-reviewer coordination',
    examples: [
      'github pr-manager "create feature PR with automated testing"',
      'github pr-manager "coordinate code review for security update"',
    ],
  },
  'issue-tracker': {
    description: 'Issue management and project coordination',
    examples: [
      'github issue-tracker "analyze project roadmap issues"',
      'github issue-tracker "coordinate bug triage process"',
    ],
  },
  'release-manager': {
    description: 'Release coordination and deployment pipelines',
    examples: [
      'github release-manager "prepare v2.0.0 release"',
      'github release-manager "coordinate hotfix deployment"',
    ],
  },
  'repo-architect': {
    description: 'Repository structure optimization',
    examples: [
      'github repo-architect "optimize repository structure"',
      'github repo-architect "setup monorepo architecture"',
    ],
  },
  'sync-coordinator': {
    description: 'Multi-package synchronization and version alignment',
    examples: [
      'github sync-coordinator "sync package versions across repos"',
      'github sync-coordinator "coordinate dependency updates"',
    ],
  },
};

function showGitHubHelp() {
  console.log(`
🐙 Claude Flow GitHub Workflow Automation

USAGE:
  claude-flow github <mode> <objective> [options]

GITHUB AUTOMATION MODES:
`);

  for (const [mode, info] of Object.entries(GITHUB_MODES)) {
    console.log(`  ${mode.padEnd(18)} ${info.description}`);
  }

  console.log(`
EXAMPLES:
  claude-flow github pr-manager "create feature PR with automated testing"
  claude-flow github gh-coordinator "setup CI/CD pipeline" --auto-approve
  claude-flow github release-manager "prepare v2.0.0 release"
  claude-flow github repo-architect "optimize repository structure"
  claude-flow github issue-tracker "analyze project roadmap issues"
  claude-flow github sync-coordinator "sync package versions across repos"

OPTIONS:
  --auto-approve             Auto-approve Claude permissions
  --verbose                  Enable detailed logging
  --dry-run                  Show what would be executed
  --repo <name>              Target specific repository
  --branch <name>            Target specific branch
  --template <name>          Use specific workflow template

ADVANCED FEATURES:
  • Multi-reviewer coordination with automated scheduling
  • Intelligent issue categorization and assignment
  • Automated testing integration and quality gates
  • Release pipeline orchestration with rollback capabilities
  • Repository structure analysis and optimization recommendations
  • Cross-repository dependency management and synchronization

For complete documentation:
https://github.com/ruvnet/claude-code-flow/docs/github.md
`);
}

export async function githubCommand(args, flags) {
  if (!args || args.length === 0) {
    showGitHubHelp();
    return;
  }

  const mode = args[0];
  
  // Handle init mode separately
  if (mode === 'init') {
    const { githubInitCommand } = await import('./github/init.js');
    return await githubInitCommand(flags);
  }
  
  const objective = args.slice(1).join(' ').trim();

  if (!objective) {
    printError(`❌ Usage: github ${mode} <objective>`);

    if (GITHUB_MODES[mode]) {
      console.log(`\nExamples for ${mode}:`);
      for (const example of GITHUB_MODES[mode].examples) {
        console.log(`  ${example}`);
      }
    } else {
      console.log('\nAvailable modes:');
      for (const [modeName, info] of Object.entries(GITHUB_MODES)) {
        console.log(`  ${modeName} - ${info.description}`);
      }
    }
    return;
  }

  if (!GITHUB_MODES[mode]) {
    printError(`❌ Unknown GitHub mode: ${mode}`);
    console.log('\nAvailable modes:');
    for (const [modeName, info] of Object.entries(GITHUB_MODES)) {
      console.log(`  ${modeName} - ${info.description}`);
    }
    return;
  }

  printSuccess(`🐙 GitHub ${mode} mode activated`);
  console.log(`📋 Objective: ${objective}`);

  if (flags['dry-run']) {
    console.log('\n🎛️  Configuration:');
    console.log(`  Mode: ${mode}`);
    console.log(`  Repository: ${flags.repo || 'current'}`);
    console.log(`  Branch: ${flags.branch || 'current'}`);
    console.log(`  Template: ${flags.template || 'default'}`);
    console.log(`  Auto-approve: ${flags['auto-approve'] || false}`);
    console.log(`  Verbose: ${flags.verbose || false}`);
    console.log('\n⚠️  DRY RUN - GitHub workflow configuration preview');
    return;
  }

  try {
    // Check if Claude is available
    const { execSync } = await import('child_process');

    // Cross-platform check for Claude CLI
    const isClaudeAvailable = await checkClaudeAvailable();
    if (!isClaudeAvailable) {
      printWarning('⚠️  Claude CLI not found. GitHub automation requires Claude.');
      console.log('Install Claude: https://claude.ai/code');
      console.log('\nAlternatively, this would execute:');
      console.log(`1. Initialize ${mode} workflow for: ${objective}`);
      console.log('2. Set up GitHub integration and permissions');
      console.log('3. Configure automation rules and triggers');
      console.log('4. Execute workflow with monitoring and reporting');
      return;
    }

    // Build the prompt for Claude using GitHub workflow methodology
    const githubPrompt = `Execute GitHub workflow automation using ${mode} mode:

OBJECTIVE: ${objective}

GITHUB MODE: ${mode}
DESCRIPTION: ${GITHUB_MODES[mode].description}

CONFIGURATION:
- Repository: ${flags.repo || 'current directory repository'}
- Branch: ${flags.branch || 'current branch'}
- Template: ${flags.template || 'default workflow'}
- Auto-approve: ${flags['auto-approve'] || false}
- Verbose: ${flags.verbose || false}

GITHUB WORKFLOW REQUIREMENTS:

1. REPOSITORY ANALYSIS:
   - Analyze current repository structure and configuration
   - Check existing workflows, branches, and protection rules
   - Identify integration points and dependencies
   - Document current state and proposed changes

2. WORKFLOW DESIGN:
   - Design GitHub Actions workflows appropriate for the objective
   - Create or update .github/workflows/ files
   - Configure triggers, jobs, and steps
   - Set up proper permissions and security measures

3. INTEGRATION SETUP:
   - Configure branch protection rules if needed
   - Set up automated testing and quality gates
   - Configure deployment pipelines if applicable
   - Set up notifications and monitoring

4. AUTOMATION IMPLEMENTATION:
   - Create or update GitHub Actions YAML files
   - Set up any required secrets and environment variables
   - Configure automated issue and PR management
   - Implement approval workflows and review assignments

5. MONITORING & REPORTING:
   - Set up workflow monitoring and status reporting
   - Configure failure notifications and alerts
   - Create documentation for the automation
   - Set up metrics and analytics collection

EXECUTION APPROACH:
1. Analyze the current repository and GitHub configuration
2. Design the appropriate workflow automation for the objective
3. Create or update GitHub Actions and configuration files
4. Test the workflow with proper validation
5. Document the automation and provide usage instructions

TARGET DIRECTORY:
Use the current repository's .github/ directory for workflows and configuration.

IMPORTANT:
- Create actual, working GitHub Actions workflows - not templates
- Include proper error handling and security measures
- Add comprehensive documentation and usage instructions
- Follow GitHub Actions best practices and conventions
- Ensure workflows are production-ready and maintainable
- Include proper testing and validation steps

Begin execution now. Create all necessary GitHub workflow files and configuration.`;

    console.log('🚀 Launching GitHub automation via Claude...');

    // Execute Claude with the GitHub prompt
    const { spawn } = await import('child_process');

    const claudeArgs = [];

    // Add auto-permission flag if requested
    if (flags['auto-approve'] || flags['dangerously-skip-permissions']) {
      claudeArgs.push('--dangerously-skip-permissions');
    }

    // Spawn claude process
    const claudeProcess = spawn('claude', claudeArgs, {
      stdio: ['pipe', 'inherit', 'inherit'],
      shell: false,
    });

    // Write the prompt to stdin and close it
    claudeProcess.stdin.write(githubPrompt);
    claudeProcess.stdin.end();

    // Wait for the process to complete
    await new Promise((resolve, reject) => {
      claudeProcess.on('close', (code) => {
        if (code === 0) {
          printSuccess('✅ GitHub automation completed successfully!');
          resolve();
        } else {
          reject(new Error(`Claude process exited with code ${code}`));
        }
      });

      claudeProcess.on('error', (err) => {
        reject(err);
      });
    });
  } catch (error) {
    printError(`❌ GitHub automation failed: ${error.message}`);

    // Fallback implementation details
    console.log('\n📋 Fallback execution plan:');
    console.log(`1. ${mode} workflow would be configured for: ${objective}`);
    console.log('2. GitHub Actions YAML files would be created');
    console.log('3. Repository settings would be configured');
    console.log('4. Automation rules would be established');
    console.log('5. Monitoring and reporting would be set up');

    printWarning('\n⚠️  Note: Full GitHub automation requires Claude CLI.');
    console.log('Install Claude: https://claude.ai/code');
  }
}

// Allow direct execution for testing
if (import.meta.main) {
  const args = [];
  const flags = {};

  // Parse arguments and flags from Deno.args if available
  if (typeof Deno !== 'undefined' && Deno.args) {
    for (let i = 0; i < Deno.args.length; i++) {
      const arg = Deno.args[i];
      if (arg.startsWith('--')) {
        const flagName = arg.substring(2);
        const nextArg = Deno.args[i + 1];

        if (nextArg && !nextArg.startsWith('--')) {
          flags[flagName] = nextArg;
          i++; // Skip the next argument
        } else {
          flags[flagName] = true;
        }
      } else {
        args.push(arg);
      }
    }
  }

  await githubCommand(args, flags);
}
