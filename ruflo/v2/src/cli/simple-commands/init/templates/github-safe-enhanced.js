#!/usr/bin/env node

/**
 * Enhanced Safe GitHub CLI Helper - Production Ready
 * Uses the comprehensive GitHubCliSafe wrapper for secure command execution
 * 
 * Prevents:
 * - Timeout issues with large content
 * - Command injection attacks  
 * - Process resource leaks
 * - Rate limiting issues
 * - Input validation bypasses
 * 
 * Usage:
 *   ./github-safe-enhanced.js issue comment 123 "Message with `backticks` and $(dangerous) content"
 *   ./github-safe-enhanced.js pr create --title "Title" --body "Complex body with special chars"
 *   ./github-safe-enhanced.js issue create --title "Bug Report" --body "Long description..." --labels "bug,urgent"
 *   ./github-safe-enhanced.js release create v1.0.0 --title "Release v1.0.0" --body "Release notes..."
 */

// Import the production-ready GitHub CLI safety wrapper
import { githubCli, GitHubCliError, GitHubCliTimeoutError, GitHubCliValidationError } from '../../../utils/github-cli-safety-wrapper.js';

const args = process.argv.slice(2);

/**
 * Show help message
 */
function showHelp() {
  console.log(`
🛡️  Enhanced Safe GitHub CLI Helper

FEATURES:
  ✅ Injection attack prevention
  ✅ Timeout handling with cleanup
  ✅ Input validation and sanitization
  ✅ Rate limiting protection
  ✅ Comprehensive error handling
  ✅ Process resource management

USAGE:
  ./github-safe-enhanced.js <command> <subcommand> [arguments] [options]

COMMANDS:
  Issue Operations:
    issue create --title "Title" --body "Body" [--labels "label1,label2"] [--assignees "user1,user2"]
    issue comment <number> "Comment body"
    
  Pull Request Operations:
    pr create --title "Title" --body "Body" [--base branch] [--head branch] [--draft]
    pr comment <number> "Comment body"
    
  Release Operations:
    release create <tag> --title "Title" --body "Body" [--prerelease] [--draft]

OPTIONS:
  --timeout <ms>     Override default timeout (30000ms)
  --verbose          Enable detailed logging
  --dry-run         Show what would be executed without running
  --help            Show this help message

EXAMPLES:
  # Create issue with special characters safely
  ./github-safe-enhanced.js issue create \\
    --title "Bug: Login fails with special chars" \\
    --body "Steps: 1. Enter \`user@domain.com\` 2. Use password with \$(special) chars" \\
    --labels "bug,high-priority"

  # Add comment with code blocks
  ./github-safe-enhanced.js issue comment 123 \\
    "Fixed in commit abc123. Test with: \`npm test && npm run build\`"

  # Create PR with complex body
  ./github-safe-enhanced.js pr create \\
    --title "Feature: Add authentication" \\
    --body "## Changes\\n- Added JWT auth\\n- Updated tests\\n\\n\`\`\`js\\nconst token = jwt.sign(payload);\\n\`\`\`" \\
    --base main --head feature/auth

  # Create release with detailed notes
  ./github-safe-enhanced.js release create v2.1.0 \\
    --title "Version 2.1.0 - Security Update" \\
    --body "## Features\\n- Enhanced security\\n- Bug fixes\\n\\n## Breaking Changes\\nNone"

SECURITY FEATURES:
  🔒 Blocks dangerous patterns: \$(cmd), \`cmd\`, eval(), exec()
  🔒 Prevents command chaining: &&, ||, ;
  🔒 Validates file sizes and input lengths
  🔒 Uses secure temporary files with restricted permissions
  🔒 Implements proper process cleanup and timeout handling
`);
}

/**
 * Parse command line arguments into structured format
 */
function parseArguments(args) {
  if (args.length === 0 || args.includes('--help')) {
    showHelp();
    process.exit(0);
  }

  const [command, subcommand, ...restArgs] = args;
  const options = {};
  const positionalArgs = [];
  
  // Parse flags and options
  for (let i = 0; i < restArgs.length; i++) {
    const arg = restArgs[i];
    
    if (arg.startsWith('--')) {
      const flagName = arg.substring(2);
      const nextArg = restArgs[i + 1];
      
      if (nextArg && !nextArg.startsWith('--')) {
        options[flagName] = nextArg;
        i++; // Skip the next argument
      } else {
        options[flagName] = true;
      }
    } else {
      positionalArgs.push(arg);
    }
  }
  
  return { command, subcommand, positionalArgs, options };
}

/**
 * Execute GitHub CLI command safely
 */
async function executeCommand(command, subcommand, positionalArgs, options) {
  try {
    // Handle dry-run mode
    if (options['dry-run']) {
      console.log('🔍 DRY RUN MODE - Would execute:');
      console.log(`Command: ${command} ${subcommand}`);
      console.log(`Arguments:`, positionalArgs);
      console.log(`Options:`, options);
      return;
    }
    
    // Configure GitHub CLI wrapper
    const cliOptions = {
      timeout: parseInt(options.timeout) || 30000,
      enableLogging: options.verbose || false
    };
    
    let result;
    
    // Route to appropriate method based on command
    if (command === 'issue') {
      result = await handleIssueCommand(subcommand, positionalArgs, options, cliOptions);
    } else if (command === 'pr') {
      result = await handlePRCommand(subcommand, positionalArgs, options, cliOptions);
    } else if (command === 'release') {
      result = await handleReleaseCommand(subcommand, positionalArgs, options, cliOptions);
    } else {
      throw new Error(`Unsupported command: ${command}`);
    }
    
    // Output result
    console.log('✅ Command executed successfully');
    if (options.verbose && result.stdout) {
      console.log('Output:', result.stdout);
    }
    
  } catch (error) {
    console.error('❌ Command failed:', error.message);
    
    if (error instanceof GitHubCliTimeoutError) {
      console.error('💡 Try increasing timeout with --timeout <ms>');
    } else if (error instanceof GitHubCliValidationError) {
      console.error('💡 Input validation failed. Check for dangerous characters or patterns.');
    }
    
    if (options.verbose && error.details) {
      console.error('Details:', error.details);
    }
    
    process.exit(1);
  }
}

/**
 * Handle issue commands
 */
async function handleIssueCommand(subcommand, positionalArgs, options, cliOptions) {
  if (subcommand === 'create') {
    if (!options.title || !options.body) {
      throw new Error('Issue creation requires --title and --body options');
    }
    
    return await githubCli.createIssue({
      title: options.title,
      body: options.body,
      labels: options.labels ? options.labels.split(',') : [],
      assignees: options.assignees ? options.assignees.split(',') : [],
      ...cliOptions
    });
    
  } else if (subcommand === 'comment') {
    const [issueNumber] = positionalArgs;
    const body = positionalArgs[1] || options.body;
    
    if (!issueNumber || !body) {
      throw new Error('Issue comment requires issue number and body');
    }
    
    return await githubCli.addIssueComment(parseInt(issueNumber), body, cliOptions);
    
  } else {
    throw new Error(`Unsupported issue subcommand: ${subcommand}`);
  }
}

/**
 * Handle PR commands
 */
async function handlePRCommand(subcommand, positionalArgs, options, cliOptions) {
  if (subcommand === 'create') {
    if (!options.title || !options.body) {
      throw new Error('PR creation requires --title and --body options');
    }
    
    return await githubCli.createPR({
      title: options.title,
      body: options.body,
      base: options.base || 'main',
      head: options.head,
      draft: options.draft || false,
      ...cliOptions
    });
    
  } else if (subcommand === 'comment') {
    const [prNumber] = positionalArgs;
    const body = positionalArgs[1] || options.body;
    
    if (!prNumber || !body) {
      throw new Error('PR comment requires PR number and body');
    }
    
    return await githubCli.addPRComment(parseInt(prNumber), body, cliOptions);
    
  } else {
    throw new Error(`Unsupported PR subcommand: ${subcommand}`);
  }
}

/**
 * Handle release commands
 */
async function handleReleaseCommand(subcommand, positionalArgs, options, cliOptions) {
  if (subcommand === 'create') {
    const [tag] = positionalArgs;
    
    if (!tag || !options.title || !options.body) {
      throw new Error('Release creation requires tag, --title, and --body');
    }
    
    return await githubCli.createRelease({
      tag,
      title: options.title,
      body: options.body,
      prerelease: options.prerelease || false,
      draft: options.draft || false,
      ...cliOptions
    });
    
  } else {
    throw new Error(`Unsupported release subcommand: ${subcommand}`);
  }
}

/**
 * Main execution
 */
async function main() {
  try {
    // Parse arguments
    const { command, subcommand, positionalArgs, options } = parseArguments(args);
    
    // Check GitHub CLI availability
    const isAvailable = await githubCli.checkGitHubCli();
    if (!isAvailable) {
      console.error('❌ GitHub CLI is not installed or not in PATH');
      console.error('💡 Install from: https://cli.github.com/');
      process.exit(1);
    }
    
    // Check authentication (unless dry-run)
    if (!options['dry-run']) {
      const isAuthenticated = await githubCli.checkAuthentication();
      if (!isAuthenticated) {
        console.error('❌ GitHub CLI is not authenticated');
        console.error('💡 Run: gh auth login');
        process.exit(1);
      }
    }
    
    // Execute command
    await executeCommand(command, subcommand, positionalArgs, options);
    
  } catch (error) {
    console.error('❌ Unexpected error:', error.message);
    if (args.includes('--verbose')) {
      console.error('Stack trace:', error.stack);
    }
    process.exit(1);
  }
}

// Handle process cleanup
process.on('SIGINT', async () => {
  console.log('\n🛑 Received interrupt signal, cleaning up...');
  await githubCli.cleanup();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Received termination signal, cleaning up...');
  await githubCli.cleanup();
  process.exit(0);
});

// Run if called directly
if (import.meta.main || process.argv[1].endsWith('github-safe-enhanced.js')) {
  main().catch(error => {
    console.error('💥 Fatal error:', error.message);
    process.exit(1);
  });
}

export { executeCommand, handleIssueCommand, handlePRCommand, handleReleaseCommand };