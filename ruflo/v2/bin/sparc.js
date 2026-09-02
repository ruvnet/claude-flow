// sparc.js - SPARC development mode commands
import { printSuccess, printError, printWarning } from '../utils.js';
import { promises as fs } from 'fs';
import { spawn } from 'child_process';
import { promisify } from 'util';
import { createSparcPrompt } from './sparc-modes/index.js';
import { cwd, exit, existsSync } from '../node-compat.js';
import process from 'process';

export async function sparcCommand(subArgs, flags) {
  const sparcCmd = subArgs[0];

  // Show help if requested or no args
  if (
    flags.help ||
    flags.h ||
    sparcCmd === '--help' ||
    sparcCmd === '-h' ||
    (!sparcCmd && Object.keys(flags).length === 0)
  ) {
    showSparcHelp();
    return;
  }

  // Merge flags back into subArgs for backward compatibility
  const mergedArgs = [...subArgs];
  for (const [key, value] of Object.entries(flags)) {
    if (key === 'non-interactive' || key === 'n') {
      mergedArgs.push('--non-interactive');
    } else if (key === 'dry-run' || key === 'd') {
      mergedArgs.push('--dry-run');
    } else if (key === 'verbose' || key === 'v') {
      mergedArgs.push('--verbose');
    } else if (key === 'no-permissions') {
      mergedArgs.push('--no-permissions');
    } else if (key === 'enable-permissions') {
      mergedArgs.push('--enable-permissions');
    } else if (key === 'namespace') {
      mergedArgs.push('--namespace', value);
    } else if (key === 'config') {
      mergedArgs.push('--config', value);
    } else if (key === 'interactive' || key === 'i') {
      mergedArgs.push('--interactive');
    }
  }

  // Check if first arg is a known subcommand
  const knownSubcommands = ['modes', 'info', 'run', 'tdd'];

  if (!knownSubcommands.includes(sparcCmd)) {
    // If not a known subcommand, treat it as a task description for sparc orchestrator
    // Insert 'run' and 'sparc' to make it: ['run', 'sparc', ...rest of args]
    mergedArgs.unshift('run', 'sparc');
  }

  // Now process the command
  const actualCmd = mergedArgs[0];

  switch (actualCmd) {
    case 'modes':
      await listSparcModes(mergedArgs);
      break;

    case 'info':
      await showModeInfo(mergedArgs);
      break;

    case 'run':
      await runSparcMode(mergedArgs, flags);
      break;

    case 'tdd':
      await runTddWorkflow(mergedArgs);
      break;

    default:
      showSparcHelp();
  }
}

async function listSparcModes(subArgs) {
  try {
    // Get the actual working directory where the command was run from
    const workingDir = process.env.PWD || cwd();
    const configPath = `${workingDir}/.roomodes`;
    let configContent;
    try {
      configContent = await fs.readFile(configPath, 'utf8');
    } catch (error) {
      printError('SPARC configuration file (.roomodes) not found');
      console.log(`Please ensure .roomodes file exists in: ${workingDir}`);
      console.log();
      console.log('To enable SPARC development modes, run:');
      console.log('  npx claude-flow@latest init --sparc');
      console.log();
      console.log('This will create:');
      console.log('  • .roomodes file with 17+ SPARC development modes');
      console.log('  • .roo/ directory with templates and workflows');
      console.log('  • SPARC-enhanced CLAUDE.md configuration');
      return;
    }

    const config = JSON.parse(configContent);
    const verbose = subArgs.includes('--verbose') || subArgs.includes('-v');

    printSuccess('Available SPARC Modes:');
    console.log();

    for (const mode of config.customModes) {
      console.log(`• ${mode.name} (${mode.slug})`);
      if (verbose) {
        console.log(`  ${mode.roleDefinition}`);
        console.log(`  Tools: ${mode.groups.join(', ')}`);
        console.log();
      }
    }

    if (!verbose) {
      console.log();
      console.log('Use --verbose for detailed descriptions');
    }
  } catch (err) {
    printError(`Failed to list SPARC modes: ${err.message}`);
  }
}

async function showModeInfo(subArgs) {
  const modeSlug = subArgs[1];
  if (!modeSlug) {
    printError('Usage: sparc info <mode-slug>');
    return;
  }

  try {
    // Get the actual working directory where the command was run from
    const workingDir = process.env.PWD || cwd();
    const configPath = `${workingDir}/.roomodes`;
    let configContent;
    try {
      configContent = await fs.readFile(configPath, 'utf8');
    } catch (error) {
      printError('SPARC configuration file (.roomodes) not found');
      console.log(`Please ensure .roomodes file exists in: ${workingDir}`);
      console.log();
      console.log('To enable SPARC development modes, run:');
      console.log('  npx claude-flow@latest init --sparc');
      return;
    }
    const config = JSON.parse(configContent);
    const mode = config.customModes.find((m) => m.slug === modeSlug);

    if (!mode) {
      printError(`Mode not found: ${modeSlug}`);
      console.log('Available modes:');
      for (const m of config.customModes) {
        console.log(`  ${m.slug} - ${m.name}`);
      }
      return;
    }

    printSuccess(`SPARC Mode: ${mode.name}`);
    console.log();
    console.log('Role Definition:');
    console.log(mode.roleDefinition);
    console.log();
    console.log('Custom Instructions:');
    console.log(mode.customInstructions);
    console.log();
    console.log('Tool Groups:');
    console.log(mode.groups.join(', '));
    console.log();
    console.log('Source:');
    console.log(mode.source);
  } catch (err) {
    printError(`Failed to show mode info: ${err.message}`);
  }
}

async function runSparcMode(subArgs, flags) {
  const runModeSlug = subArgs[1];
  const taskDescription = subArgs
    .slice(2)
    .filter((arg) => !arg.startsWith('--'))
    .join(' ');

  if (!runModeSlug || !taskDescription) {
    printError('Usage: sparc run <mode-slug> <task-description>');
    return;
  }

  try {
    // Get the actual working directory where the command was run from
    const workingDir = process.env.PWD || cwd();
    const configPath = `${workingDir}/.roomodes`;
    let configContent;
    try {
      configContent = await fs.readFile(configPath, 'utf8');
    } catch (error) {
      printError('SPARC configuration file (.roomodes) not found');
      console.log(`Please ensure .roomodes file exists in: ${workingDir}`);
      console.log();
      console.log('To enable SPARC development modes, run:');
      console.log('  npx claude-flow@latest init --sparc');
      return;
    }
    const config = JSON.parse(configContent);
    const mode = config.customModes.find((m) => m.slug === runModeSlug);

    if (!mode) {
      printError(`Mode not found: ${runModeSlug}`);
      return;
    }

    // Build enhanced SPARC prompt
    const memoryNamespace = subArgs.includes('--namespace')
      ? subArgs[subArgs.indexOf('--namespace') + 1]
      : mode.slug;

    const enhancedTask = createSparcPrompt(mode, taskDescription, memoryNamespace);

    // Build tools based on mode groups
    const tools = buildToolsFromGroups(mode.groups);
    const toolsList = Array.from(tools).join(',');
    const instanceId = `sparc-${runModeSlug}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    if (subArgs.includes('--dry-run') || subArgs.includes('-d')) {
      printWarning('DRY RUN - SPARC Mode Configuration:');
      console.log(`Mode: ${mode.name} (${mode.slug})`);
      console.log(`Instance ID: ${instanceId}`);

      const enablePermissions = subArgs.includes('--enable-permissions');
      if (!enablePermissions) {
        console.log(`Tools: ALL (via --dangerously-skip-permissions)`);
        console.log(`Permissions: Will be auto-skipped`);
      } else {
        console.log(`Tools: ${toolsList}`);
        console.log(`Permissions: Will prompt for actions`);
      }

      console.log(`Task: ${taskDescription}`);
      console.log();
      console.log('Enhanced prompt preview:');
      console.log(enhancedTask.substring(0, 300) + '...');
      return;
    }

    printSuccess(`Starting SPARC mode: ${mode.name}`);
    console.log(`📝 Instance ID: ${instanceId}`);
    console.log(`🎯 Mode: ${mode.slug}`);

    const isNonInteractive = subArgs.includes('--non-interactive') || subArgs.includes('-n');
    const enablePermissions = subArgs.includes('--enable-permissions');

    if (!enablePermissions) {
      console.log(`🔧 Tools: ALL (including MCP and WebSearch via --dangerously-skip-permissions)`);
      console.log(`⚡ Permissions: Auto-skipped (--dangerously-skip-permissions)`);
    } else {
      console.log(`🔧 Tools: ${toolsList}`);
      console.log(`✅ Permissions: Enabled (will prompt for actions)`);
    }
    console.log(`📋 Task: ${taskDescription}`);

    if (isNonInteractive) {
      console.log(`🚀 Running in non-interactive mode with stream-json output`);
      console.log();

      // Show debug info immediately for non-interactive mode
      console.log('🔍 Debug: Preparing claude command...');
      console.log(`Enhanced prompt length: ${enhancedTask.length} characters`);
      console.log(`First 200 chars of prompt: ${enhancedTask.substring(0, 200)}...`);
    }
    console.log();

    // Execute Claude with SPARC configuration
    await executeClaude(enhancedTask, toolsList, instanceId, memoryNamespace, subArgs);
  } catch (err) {
    printError(`Failed to run SPARC mode: ${err.message}`);
  }
}

async function runTddWorkflow(subArgs) {
  const tddTaskDescription = subArgs.slice(1).join(' ');

  if (!tddTaskDescription) {
    printError('Usage: sparc tdd <task-description>');
    return;
  }

  printSuccess('Starting SPARC TDD Workflow');
  console.log('Following Test-Driven Development with SPARC methodology');
  console.log();

  const phases = [
    { name: 'Red', description: 'Write failing tests', mode: 'tdd' },
    { name: 'Green', description: 'Minimal implementation', mode: 'code' },
    { name: 'Refactor', description: 'Optimize and clean', mode: 'tdd' },
  ];

  console.log('TDD Phases:');
  for (const phase of phases) {
    console.log(`  ${phase.name}: ${phase.description} (${phase.mode} mode)`);
  }
  console.log();

  if (subArgs.includes('--interactive') || subArgs.includes('-i')) {
    printSuccess('Starting interactive TDD workflow');
    console.log('This would walk through each phase interactively');
    console.log('Run each phase with: sparc run <mode> "Phase: <task>"');
  } else {
    printSuccess('Starting full TDD workflow');
    console.log('This would execute all phases automatically');
    console.log('Use --interactive for step-by-step control');
  }
}

// Remove the createSparcPrompt function from here as it's now imported from sparc-modes/index.js

function buildToolsFromGroups(groups) {
  const toolMappings = {
    read: ['View', 'LS', 'GlobTool', 'GrepTool'],
    edit: ['Edit', 'Replace', 'MultiEdit', 'Write'],
    browser: ['WebFetch'],
    mcp: ['mcp_tools'],
    command: ['Bash', 'Terminal'],
  };

  const tools = new Set(['View', 'Edit', 'Bash']); // Always include basic tools

  for (const group of groups) {
    if (Array.isArray(group)) {
      const groupName = group[0];
      if (toolMappings[groupName]) {
        toolMappings[groupName].forEach((tool) => tools.add(tool));
      }
    } else if (toolMappings[group]) {
      toolMappings[group].forEach((tool) => tools.add(tool));
    }
  }

  return tools;
}

async function executeClaude(enhancedTask, toolsList, instanceId, memoryNamespace, subArgs) {
  // Check for non-interactive mode
  const isNonInteractive = subArgs.includes('--non-interactive') || subArgs.includes('-n');
  const enablePermissions = subArgs.includes('--enable-permissions');

  // Build arguments array correctly
  const claudeArgs = [];
  claudeArgs.push(enhancedTask);

  // Add --dangerously-skip-permissions by default unless --enable-permissions is set
  if (!enablePermissions) {
    claudeArgs.push('--dangerously-skip-permissions');
  }

  if (isNonInteractive) {
    // Non-interactive mode: add additional flags
    claudeArgs.push('-p'); // Use short form for print
    claudeArgs.push('--output-format', 'stream-json');
    claudeArgs.push('--verbose');
  } else {
    // Interactive mode - check for verbose flag
    if (subArgs.includes('--verbose') || subArgs.includes('-v')) {
      claudeArgs.push('--verbose');
    }
  }

  // When using --dangerously-skip-permissions, we don't need to specify individual tools
  // as it enables ALL tools including mcp and websearch
  // Only add --allowedTools if permissions are enabled
  if (enablePermissions) {
    claudeArgs.push('--allowedTools', toolsList);
  }

  if (subArgs.includes('--config')) {
    const configIndex = subArgs.indexOf('--config');
    claudeArgs.push('--mcp-config', subArgs[configIndex + 1]);
  }

  // Show debug info for non-interactive mode or when verbose
  if (isNonInteractive || subArgs.includes('--verbose') || subArgs.includes('-v')) {
    console.log('\n🔍 Debug: Executing claude with:');
    console.log('Command: claude');
    console.log(
      'Permissions:',
      enablePermissions
        ? '✅ Enabled (will prompt)'
        : '⚡ Skipped (--dangerously-skip-permissions)',
    );
    console.log(
      'Tools:',
      enablePermissions ? `Specified: ${toolsList}` : 'ALL tools enabled (MCP, WebSearch, etc.)',
    );
    console.log('Mode:', isNonInteractive ? '🤖 Non-interactive' : '💬 Interactive');
    console.log('Args array length:', claudeArgs.length);
    console.log('First arg (prompt) length:', claudeArgs[0].length, 'characters');

    if (isNonInteractive) {
      console.log('First 200 chars of prompt:', claudeArgs[0].substring(0, 200) + '...');
      console.log('\nAll arguments:');
      claudeArgs.forEach((arg, i) => {
        if (i === 0) {
          console.log(`  [0] <SPARC prompt with ${arg.length} characters>`);
        } else {
          console.log(`  [${i}] ${arg}`);
        }
      });
      console.log('\nFull command structure:');
      console.log('claude "<SPARC prompt>" ' + claudeArgs.slice(1).join(' '));
    }
    console.log();
  }

  try {
    // Log the actual command being executed
    console.log('\n🚀 Executing command:');
    console.log(`Command: claude`);
    console.log(`Working Directory: ${cwd()}`);
    console.log(`Number of args: ${claudeArgs.length}`);

    // Check if claude command exists
    try {
      const checkResult = await new Promise((resolve) => {
        const child = spawn('which', ['claude'], {
          stdio: ['pipe', 'pipe', 'pipe']
        });
        let stdout = '';
        child.stdout?.on('data', (data) => { stdout += data; });
        child.on('close', (code) => {
          resolve({ success: code === 0, stdout: Buffer.from(stdout) });
        });
      });
      if (!checkResult.success) {
        console.error('❌ Error: claude command not found in PATH');
        console.error('Please ensure claude CLI is installed and in your PATH');
        return;
      }
      const claudePath = new TextDecoder().decode(checkResult.stdout).trim();
      console.log(`Claude path: ${claudePath}`);
    } catch (e) {
      console.warn('⚠️  Could not verify claude command location');
    }

    // Use spawn for claude command
    const env = { ...process.env, CLAUDE_INSTANCE_ID: instanceId };

    console.log('\n📡 Spawning claude process...\n');
    const child = spawn('claude', claudeArgs, {
      cwd: cwd(),
      env: env,
      stdio: 'inherit'
    });
    const status = await new Promise((resolve) => {
      child.on('close', (code) => {
        resolve({ code, success: code === 0 });
      });
    });

    if (status.success) {
      printSuccess(`SPARC instance ${instanceId} completed successfully`);
    } else {
      printError(`SPARC instance ${instanceId} exited with code ${status.code}`);
    }
  } catch (err) {
    printError(`Failed to execute Claude: ${err.message}`);
    console.error('Stack trace:', err.stack);
  }
}

function showSparcHelp() {
  console.log('SPARC commands:');
  console.log('  <task>                   Run SPARC orchestrator (default mode)');
  console.log('  modes                    List available SPARC development modes');
  console.log('  info <mode>              Show detailed information about a mode');
  console.log('  run <mode> <task>        Execute a task in specified SPARC mode');
  console.log('  tdd <task>               Run Test-Driven Development workflow');
  console.log();
  console.log('Examples:');
  console.log('  claude-flow sparc "orchestrate app development"    # Uses sparc orchestrator');
  console.log('  claude-flow sparc modes --verbose');
  console.log('  claude-flow sparc info architect');
  console.log('  claude-flow sparc run code "implement user authentication"');
  console.log('  claude-flow sparc run code "add login feature" --non-interactive');
  console.log('  claude-flow sparc run tdd "create test suite" --namespace tests');
  console.log('  claude-flow sparc tdd "payment processing system" --interactive');
  console.log();
  console.log('Parallel Execution with BatchTool:');
  console.log('  # Run multiple SPARC modes concurrently');
  console.log('  batchtool run --parallel \\');
  console.log('    "npx claude-flow sparc run code \'user service\' --non-interactive" \\');
  console.log('    "npx claude-flow sparc run code \'auth service\' --non-interactive" \\');
  console.log('    "npx claude-flow sparc run tdd \'test suite\' --non-interactive"');
  console.log();
  console.log('  # Boomerang orchestration pattern');
  console.log('  batchtool orchestrate --boomerang \\');
  console.log(
    '    --research "npx claude-flow sparc run ask \'requirements\' --non-interactive" \\',
  );
  console.log('    --design "npx claude-flow sparc run architect \'system\' --non-interactive" \\');
  console.log('    --implement "npx claude-flow sparc run code \'features\' --non-interactive" \\');
  console.log('    --test "npx claude-flow sparc run tdd \'validation\' --non-interactive"');
  console.log();
  console.log('Flags:');
  console.log('  --dry-run, -d            Show configuration without executing');
  console.log('  --verbose, -v            Show detailed output');
  console.log('  --interactive, -i        Run TDD workflow interactively');
  console.log('  --non-interactive, -n    Run in non-interactive mode with stream-json output');
  console.log('  --enable-permissions     Enable permission prompts (default: skip permissions)');
  console.log('  --namespace <ns>         Use custom memory namespace (default: mode slug)');
  console.log('  --config <path>          Use custom MCP configuration file');
  console.log();
  console.log('Permission Behavior:');
  console.log('  By default, SPARC runs with --dangerously-skip-permissions for efficiency');
  console.log('  Use --enable-permissions to restore permission prompts if needed');
  console.log();
  console.log('Non-Interactive Mode:');
  console.log('  When using --non-interactive, claude will be executed with:');
  console.log('  - --dangerously-skip-permissions (unless --enable-permissions is set)');
  console.log('  - -p (print mode for streaming output)');
  console.log('  - --output-format stream-json (structured output format)');
  console.log('  - --verbose (detailed execution logs)');
  console.log();
  console.log('Boomerang Pattern:');
  console.log('  A cyclical orchestration where outputs from one phase feed into the next:');
  console.log('  Research → Design → Implement → Test → Optimize → Loop back');
  console.log('  Perfect for iterative development with continuous refinement');
}
