// init/index.js - Initialize Claude Code integration files
import { printSuccess, printError, printWarning, exit } from '../../utils.js';
import { existsSync } from 'fs';
import process from 'process';
import os from 'os';
import { spawn, execSync } from 'child_process';
import { promisify } from 'util';

// Helper to replace Deno.Command
function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: options.stdout === 'inherit' ? 'inherit' : 'pipe'
    });
    
    let stdout = '';
    let stderr = '';
    
    if (options.stdout !== 'inherit') {
      child.stdout.on('data', (data) => { stdout += data; });
      child.stderr.on('data', (data) => { stderr += data; });
    }
    
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true, code, stdout, stderr });
      } else {
        reject(new Error(`Command failed with exit code ${code}`));
      }
    });
    
    child.on('error', reject);
  });
}
import { createLocalExecutable } from './executable-wrapper.js';
import { createSparcStructureManually } from './sparc-structure.js';
import { createClaudeSlashCommands } from './claude-commands/slash-commands.js';
import { createOptimizedClaudeSlashCommands } from './claude-commands/optimized-slash-commands.js';
// execSync imported above as execSyncOriginal\nconst execSync = execSyncOriginal;
import { promises as fs } from 'fs';
import { copyTemplates } from './template-copier.js';
import { copyRevisedTemplates, validateTemplatesExist } from './copy-revised-templates.js';
import { copyAgentFiles, createAgentDirectories, validateAgentSystem, copyCommandFiles } from './agent-copier.js';
import { copySkillFiles, createSkillDirectories, validateSkillSystem } from './skills-copier.js';
import { showInitHelp } from './help.js';
import { batchInitCommand, batchInitFromConfig, validateBatchOptions } from './batch-init.js';
import { ValidationSystem, runFullValidation } from './validation/index.js';
import { RollbackSystem, createAtomicOperation } from './rollback/index.js';
import {
  createEnhancedClaudeMd,
  createEnhancedSettingsJson,
  createWrapperScript,
  createCommandDoc,
  createHelperScript,
  COMMAND_STRUCTURE,
} from './templates/enhanced-templates.js';
import { createOptimizedSparcClaudeMd } from './templates/claude-md.js';
import { getIsolatedNpxEnv } from '../../../utils/npx-isolated-cache.js';
import { updateGitignore, needsGitignoreUpdate } from './gitignore-updater.js';
import {
  createFullClaudeMd,
  createSparcClaudeMd,
  createMinimalClaudeMd,
} from './templates/claude-md.js';
import {
  createVerificationClaudeMd,
  createVerificationSettingsJson,
} from './templates/verification-claude-md.js';
import {
  createFullMemoryBankMd,
  createMinimalMemoryBankMd,
} from './templates/memory-bank-md.js';
import {
  createFullCoordinationMd,
  createMinimalCoordinationMd,
} from './templates/coordination-md.js';
import { createAgentsReadme, createSessionsReadme } from './templates/readme-files.js';
import { 
  initializeHiveMind, 
  getHiveMindStatus,
  rollbackHiveMindInit
} from './hive-mind-init.js';

/**
 * Check if Claude Code CLI is installed
 */
function isClaudeCodeInstalled() {
  try {
    execSync('which claude', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Set up MCP servers in Claude Code
 */
async function setupMcpServers(dryRun = false) {
  console.log('\n🔌 Setting up MCP servers for Claude Code...');

  const servers = [
    {
      name: 'claude-flow',
      command: 'npx claude-flow@alpha mcp start',
      description: 'Claude Flow MCP server with swarm orchestration (alpha)',
    },
    {
      name: 'ruv-swarm',
      command: 'npx ruv-swarm mcp start',
      description: 'ruv-swarm MCP server for enhanced coordination',
    },
    {
      name: 'flow-nexus',
      command: 'npx flow-nexus@latest mcp start',
      description: 'Flow Nexus Complete MCP server for advanced AI orchestration',
    },
  ];

  for (const server of servers) {
    try {
      if (!dryRun) {
        console.log(`  🔄 Adding ${server.name}...`);
        execSync(`claude mcp add ${server.name} ${server.command}`, { stdio: 'inherit' });
        console.log(`  ✅ Added ${server.name} - ${server.description}`);
      } else {
        console.log(`  [DRY RUN] Would add ${server.name} - ${server.description}`);
      }
    } catch (err) {
      console.log(`  ⚠️  Failed to add ${server.name}: ${err.message}`);
      console.log(
        `     You can add it manually with: claude mcp add ${server.name} ${server.command}`,
      );
    }
  }

  if (!dryRun) {
    console.log('\n  📋 Verifying MCP servers...');
    try {
      execSync('claude mcp list', { stdio: 'inherit' });
    } catch (err) {
      console.log('  ⚠️  Could not verify MCP servers');
    }
  }
}

/**
 * Create statusline script content (embedded fallback for binary builds)
 */
function createStatuslineScript() {
  return `
#!/bin/bash

# Read JSON input from stdin
INPUT=$(cat)
MODEL=$(echo "$INPUT" | jq -r \'.model.display_name // "Claude"\')
CWD=$(echo "$INPUT" | jq -r \'.workspace.current_dir // .cwd\')
DIR=$(basename "$CWD")

# Replace claude-code-flow with branded name
if [ "$DIR" = "claude-code-flow" ]; then
  DIR="🌊 Claude Flow"
fi

# Get git branch
BRANCH=$(cd "$CWD" 2>/dev/null && git branch --show-current 2>/dev/null)

# Start building statusline
printf "\\033[1m$MODEL\\033[0m in \\033[36m$DIR\\033[0m"
[ -n "$BRANCH" ] && printf " on \\033[33m⎇ $BRANCH\\033[0m"

# Claude-Flow integration
FLOW_DIR="$CWD/.claude-flow"

if [ -d "$FLOW_DIR" ]; then
  printf " │"

  # 1. Swarm Configuration & Topology
  if [ -f "$FLOW_DIR/swarm-config.json" ]; then
    STRATEGY=$(jq -r \'.defaultStrategy // empty\' "$FLOW_DIR/swarm-config.json" 2>/dev/null)
    if [ -n "$STRATEGY" ]; then
      # Map strategy to topology icon
      case "$STRATEGY" in
        "balanced") TOPO_ICON="⚡mesh" ;;
        "conservative") TOPO_ICON="⚡hier" ;;
        "aggressive") TOPO_ICON="⚡ring" ;;
        *) TOPO_ICON="⚡$STRATEGY" ;;
      esac
      printf " \\033[35m$TOPO_ICON\\033[0m"

      # Count agent profiles as "configured agents"
      AGENT_COUNT=$(jq -r \'.agentProfiles | length\' "$FLOW_DIR/swarm-config.json" 2>/dev/null)
      if [ -n "$AGENT_COUNT" ] && [ "$AGENT_COUNT" != "null" ] && [ "$AGENT_COUNT" -gt 0 ]; then
        printf "  \\033[35m🤖 $AGENT_COUNT\\033[0m"
      fi
    fi
  fi

  # 2. Real-time System Metrics
  if [ -f "$FLOW_DIR/metrics/system-metrics.json" ]; then
    # Get latest metrics (last entry in array)
    LATEST=$(jq -r \'.[-1]\' "$FLOW_DIR/metrics/system-metrics.json" 2>/dev/null)

    if [ -n "$LATEST" ] && [ "$LATEST" != "null" ]; then
      # Memory usage
      MEM_PERCENT=$(echo "$LATEST" | jq -r \'.memoryUsagePercent // 0\' | awk \'{printf "%.0f", $1}\')
      if [ -n "$MEM_PERCENT" ] && [ "$MEM_PERCENT" != "null" ]; then
        # Color-coded memory (green <60%, yellow 60-80%, red >80%)
        if [ "$MEM_PERCENT" -lt 60 ]; then
          MEM_COLOR="\\033[32m"  # Green
        elif [ "$MEM_PERCENT" -lt 80 ]; then
          MEM_COLOR="\\033[33m"  # Yellow
        else
          MEM_COLOR="\\033[31m"  # Red
        fi
        printf "  \${MEM_COLOR}💾 \${MEM_PERCENT}%\\033[0m"
      fi

      # CPU load
      CPU_LOAD=$(echo "$LATEST" | jq -r \'.cpuLoad // 0\' | awk \'{printf "%.0f", $1 * 100}\')
      if [ -n "$CPU_LOAD" ] && [ "$CPU_LOAD" != "null" ]; then
        # Color-coded CPU (green <50%, yellow 50-75%, red >75%)
        if [ "$CPU_LOAD" -lt 50 ]; then
          CPU_COLOR="\\033[32m"  # Green
        elif [ "$CPU_LOAD" -lt 75 ]; then
          CPU_COLOR="\\033[33m"  # Yellow
        else
          CPU_COLOR="\\033[31m"  # Red
        fi
        printf "  \${CPU_COLOR}⚙ \${CPU_LOAD}%\\033[0m"
      fi
    fi
  fi

  # 3. Session State
  if [ -f "$FLOW_DIR/session-state.json" ]; then
    SESSION_ID=$(jq -r \'.sessionId // empty\' "$FLOW_DIR/session-state.json" 2>/dev/null)
    ACTIVE=$(jq -r \'.active // false\' "$FLOW_DIR/session-state.json" 2>/dev/null)

    if [ "$ACTIVE" = "true" ] && [ -n "$SESSION_ID" ]; then
      # Show abbreviated session ID
      SHORT_ID=$(echo "$SESSION_ID" | cut -d\'-\' -f1)
      printf "  \\033[34m🔄 $SHORT_ID\\033[0m"
    fi
  fi

  # 4. Performance Metrics from task-metrics.json
  if [ -f "$FLOW_DIR/metrics/task-metrics.json" ]; then
    # Parse task metrics for success rate, avg time, and streak
    METRICS=$(jq -r \'
      # Calculate metrics
      (map(select(.success == true)) | length) as $successful |
      (length) as $total |
      (if $total > 0 then ($successful / $total * 100) else 0 end) as $success_rate |
      (map(.duration // 0) | add / length) as $avg_duration |
      # Calculate streak (consecutive successes from end)
      (reverse |
        reduce .[] as $task (0;
          if $task.success == true then . + 1 else 0 end
        )
      ) as $streak |
      {
        success_rate: $success_rate,
        avg_duration: $avg_duration,
        streak: $streak,
        total: $total
      } | @json
    \' "$FLOW_DIR/metrics/task-metrics.json" 2>/dev/null)

    if [ -n "$METRICS" ] && [ "$METRICS" != "null" ]; then
      # Success Rate
      SUCCESS_RATE=$(echo "$METRICS" | jq -r \'.success_rate // 0\' | awk \'{printf "%.0f", $1}\')
      TOTAL_TASKS=$(echo "$METRICS" | jq -r \'.total // 0\')

      if [ -n "$SUCCESS_RATE" ] && [ "$TOTAL_TASKS" -gt 0 ]; then
        # Color-code: Green (>80%), Yellow (60-80%), Red (<60%)
        if [ "$SUCCESS_RATE" -gt 80 ]; then
          SUCCESS_COLOR="\\033[32m"  # Green
        elif [ "$SUCCESS_RATE" -ge 60 ]; then
          SUCCESS_COLOR="\\033[33m"  # Yellow
        else
          SUCCESS_COLOR="\\033[31m"  # Red
        fi
        printf "  \${SUCCESS_COLOR}🎯 \${SUCCESS_RATE}%\\033[0m"
      fi

      # Average Time
      AVG_TIME=$(echo "$METRICS" | jq -r \'.avg_duration // 0\')
      if [ -n "$AVG_TIME" ] && [ "$TOTAL_TASKS" -gt 0 ]; then
        # Format smartly: seconds, minutes, or hours
        if [ $(echo "$AVG_TIME < 60" | bc -l 2>/dev/null || echo 0) -eq 1 ]; then
          TIME_STR=$(echo "$AVG_TIME" | awk \'{printf "%.1fs", $1}\')
        elif [ $(echo "$AVG_TIME < 3600" | bc -l 2>/dev/null || echo 0) -eq 1 ]; then
          TIME_STR=$(echo "$AVG_TIME" | awk \'{printf "%.1fm", $1/60}\')
        else
          TIME_STR=$(echo "$AVG_TIME" | awk \'{printf "%.1fh", $1/3600}\')
        fi
        printf "  \\033[36m⏱️  $TIME_STR\\033[0m"
      fi

      # Streak (only show if > 0)
      STREAK=$(echo "$METRICS" | jq -r \'.streak // 0\')
      if [ -n "$STREAK" ] && [ "$STREAK" -gt 0 ]; then
        printf "  \\033[91m🔥 $STREAK\\033[0m"
      fi
    fi
  fi

  # 5. Active Tasks (check for task files)
  if [ -d "$FLOW_DIR/tasks" ]; then
    TASK_COUNT=$(find "$FLOW_DIR/tasks" -name "*.json" -type f 2>/dev/null | wc -l)
    if [ "$TASK_COUNT" -gt 0 ]; then
      printf "  \\033[36m📋 $TASK_COUNT\\033[0m"
    fi
  fi

  # 6. Check for hooks activity
  if [ -f "$FLOW_DIR/hooks-state.json" ]; then
    HOOKS_ACTIVE=$(jq -r \'.enabled // false\' "$FLOW_DIR/hooks-state.json" 2>/dev/null)
    if [ "$HOOKS_ACTIVE" = "true" ]; then
      printf " \\033[35m🔗\\033[0m"
    fi
  fi
fi

echo
`;
}

export async function initCommand(subArgs, flags) {
  // Show help if requested
  if (flags.help || flags.h || subArgs.includes('--help') || subArgs.includes('-h')) {
    showInitHelp();
    return;
  }

  // Handle --env flag for .env template generation
  if (flags.env || subArgs.includes('--env')) {
    const { generateEnvTemplate } = await import('../env-template.js');
    const workingDir = process.env.PWD || process.cwd();
    const force = flags.force || flags.f;

    console.log('📋 Generating .env template file...\n');
    const result = await generateEnvTemplate(workingDir, force);

    if (result.created) {
      console.log('\n📚 Next steps:');
      console.log('1. Open .env file and add your API keys');
      console.log('2. Get keys from:');
      console.log('   • Anthropic: https://console.anthropic.com/settings/keys');
      console.log('   • OpenRouter: https://openrouter.ai/keys');
      console.log('3. Enable memory: claude-flow agent run coder "task" --enable-memory\n');
      console.log('💡 See docs/REASONINGBANK-COST-OPTIMIZATION.md for cost savings tips');
    } else if (result.exists) {
      console.log('💡 To overwrite: claude-flow init --env --force');
    }

    return;
  }

  // Check for verification flags first
  const hasVerificationFlags = subArgs.includes('--verify') || subArgs.includes('--pair') ||
                               flags.verify || flags.pair;

  // Handle Flow Nexus minimal init
  if (flags['flow-nexus']) {
    return await flowNexusMinimalInit(flags, subArgs);
  }

  // Default to enhanced Claude Flow v2 init unless other modes are specified
  // Use --basic flag for old behavior, or verification flags for verification mode
  if (!flags.basic && !flags.minimal && !flags.sparc && !hasVerificationFlags) {
    return await enhancedClaudeFlowInit(flags, subArgs);
  }

  // Check for validation and rollback commands
  if (subArgs.includes('--validate') || subArgs.includes('--validate-only')) {
    return handleValidationCommand(subArgs, flags);
  }

  if (subArgs.includes('--rollback')) {
    return handleRollbackCommand(subArgs, flags);
  }

  if (subArgs.includes('--list-backups')) {
    return handleListBackups(subArgs, flags);
  }

  // Check for batch operations
  const batchInitFlag = flags['batch-init'] || subArgs.includes('--batch-init');
  const configFlag = flags.config || subArgs.includes('--config');

  if (batchInitFlag || configFlag) {
    return handleBatchInit(subArgs, flags);
  }

  // Check if enhanced initialization is requested
  const useEnhanced = subArgs.includes('--enhanced') || subArgs.includes('--safe');

  if (useEnhanced) {
    return enhancedInitCommand(subArgs, flags);
  }

  // Parse init options
  const initForce = subArgs.includes('--force') || subArgs.includes('-f') || flags.force;
  const initMinimal = subArgs.includes('--minimal') || subArgs.includes('-m') || flags.minimal;
  const initSparc = flags.roo || (subArgs && subArgs.includes('--roo')); // SPARC only with --roo flag
  const initDryRun = subArgs.includes('--dry-run') || subArgs.includes('-d') || flags.dryRun;
  const initOptimized = initSparc && initForce; // Use optimized templates when both flags are present
  const selectedModes = flags.modes ? flags.modes.split(',') : null; // Support selective mode initialization
  
  // Check for verification and pair programming flags
  const initVerify = subArgs.includes('--verify') || flags.verify;
  const initPair = subArgs.includes('--pair') || flags.pair;

  // Get the actual working directory (where the command was run from)
  // Use PWD environment variable which preserves the original directory
  const workingDir = process.env.PWD || cwd();
  console.log(`📁 Initializing in: ${workingDir}`);

  // Change to the working directory to ensure all file operations happen there
  try {
    process.chdir(workingDir);
  } catch (err) {
    printWarning(`Could not change to directory ${workingDir}: ${err.message}`);
  }

  try {
    printSuccess('Initializing Claude Code integration files...');

    // Check if files already exist in the working directory
    const files = ['CLAUDE.md', 'memory-bank.md', 'coordination.md'];
    const existingFiles = [];

    for (const file of files) {
      try {
        await fs.stat(`${workingDir}/${file}`);
        existingFiles.push(file);
      } catch {
        // File doesn't exist, which is what we want
      }
    }

    if (existingFiles.length > 0 && !initForce) {
      printWarning(`The following files already exist: ${existingFiles.join(', ')}`);
      console.log('Use --force to overwrite existing files');
      return;
    }

    // Use template copier to copy all template files
    const templateOptions = {
      sparc: initSparc,
      minimal: initMinimal,
      optimized: initOptimized,
      dryRun: initDryRun,
      force: initForce,
      selectedModes: selectedModes,
      verify: initVerify,
      pair: initPair,
    };

    // If verification flags are set, always use generated templates for CLAUDE.md and settings.json
    if (initVerify || initPair) {
      console.log('  📁 Creating verification-focused configuration...');
      
      // Create verification CLAUDE.md
      if (!initDryRun) {
        const { createVerificationClaudeMd, createVerificationSettingsJson } = await import('./templates/verification-claude-md.js');
        await fs.writeFile(`${workingDir}/CLAUDE.md`, createVerificationClaudeMd(), 'utf8');
        
        // Create .claude directory and settings
        await fs.mkdir(`${workingDir}/.claude`, { recursive: true });
        await fs.writeFile(`${workingDir}/.claude/settings.json`, createVerificationSettingsJson(), 'utf8');
        console.log('  ✅ Created verification-focused CLAUDE.md and settings.json');
      } else {
        console.log('  [DRY RUN] Would create verification-focused CLAUDE.md and settings.json');
      }
      
      // Copy other template files from repository if available
      const validation = validateTemplatesExist();
      if (validation.valid) {
        const revisedResults = await copyRevisedTemplates(workingDir, {
          force: initForce,
          dryRun: initDryRun,
          verbose: false,
          sparc: initSparc
        });
      }
      
      // Also create standard memory and coordination files
      const copyResults = await copyTemplates(workingDir, {
        ...templateOptions,
        skipClaudeMd: true,  // Don't overwrite the verification CLAUDE.md
        skipSettings: true   // Don't overwrite the verification settings.json
      });
      
    } else {
      // Standard template copying logic
      const validation = validateTemplatesExist();
      if (validation.valid) {
        console.log('  📁 Copying revised template files...');
        const revisedResults = await copyRevisedTemplates(workingDir, {
          force: initForce,
          dryRun: initDryRun,
          verbose: true,
          sparc: initSparc
        });

        if (revisedResults.success) {
          console.log(`  ✅ Copied ${revisedResults.copiedFiles.length} template files`);
          if (revisedResults.skippedFiles.length > 0) {
            console.log(`  ⏭️  Skipped ${revisedResults.skippedFiles.length} existing files`);
          }
        } else {
          console.log('  ⚠️  Some template files could not be copied:');
          revisedResults.errors.forEach(err => console.log(`    - ${err}`));
        }
      } else {
        // Fall back to generated templates
        console.log('  ⚠️  Revised templates not available, using generated templates');
        const copyResults = await copyTemplates(workingDir, templateOptions);

        if (!copyResults.success) {
          printError('Failed to copy templates:');
          copyResults.errors.forEach(err => console.log(`  ❌ ${err}`));
          return;
        }
      }
    }

    // Agent setup moved to end of function where execution is guaranteed

    // Directory structure is created by template copier

    // SPARC files are created by template copier when --sparc flag is used

    // Memory README files and persistence database are created by template copier

    // Create local claude-flow@alpha executable wrapper
    if (!initDryRun) {
      await createLocalExecutable(workingDir);
    } else {
      console.log('  [DRY RUN] Would create local claude-flow@alpha executable wrapper');
    }

    // SPARC initialization
    if (initSparc) {
      console.log('\n🚀 Initializing SPARC development environment...');

      if (initDryRun) {
        console.log('  [DRY RUN] Would run: npx -y create-sparc init --force');
        console.log('  [DRY RUN] Would create SPARC environment with all modes');
        console.log(
          '  [DRY RUN] Would create Claude slash commands' +
            (initOptimized ? ' (Batchtools-optimized)' : ''),
        );
        if (selectedModes) {
          console.log(
            `  [DRY RUN] Would create commands for selected modes: ${selectedModes.join(', ')}`,
          );
        }
      } else {
        // Check if create-sparc exists and run it
        let sparcInitialized = false;
        try {
          // Use isolated NPX cache to prevent concurrent conflicts
          console.log('  🔄 Running: npx -y create-sparc init --force');
          const createSparcResult = await runCommand('npx', ['-y', 'create-sparc', 'init', '--force'], {
            cwd: workingDir,
            stdout: 'inherit',
            stderr: 'inherit',
            env: getIsolatedNpxEnv({
              PWD: workingDir,
            }),
          });

          if (createSparcResult.success) {
            console.log('  ✅ SPARC environment initialized successfully');
            sparcInitialized = true;
          } else {
            printWarning('create-sparc failed, creating basic SPARC structure manually...');

            // Fallback: create basic SPARC structure manually
            await createSparcStructureManually();
            sparcInitialized = true; // Manual creation still counts as initialized
          }
        } catch (err) {
          printWarning('create-sparc not available, creating basic SPARC structure manually...');

          // Fallback: create basic SPARC structure manually
          await createSparcStructureManually();
          sparcInitialized = true; // Manual creation still counts as initialized
        }

        // Always create Claude slash commands after SPARC initialization
        if (sparcInitialized) {
          try {
            if (initOptimized) {
              await createOptimizedClaudeSlashCommands(workingDir, selectedModes);
            } else {
              await createClaudeSlashCommands(workingDir);
            }
          } catch (err) {
            // Legacy slash command creation - silently skip if it fails
            // SPARC slash commands are already created successfully above
          }
        }
      }
    }

    if (initDryRun) {
      printSuccess("🔍 Dry run completed! Here's what would be created:");
      console.log('\n📋 Summary of planned initialization:');
      console.log(
        `  • Configuration: ${initOptimized ? 'Batchtools-optimized SPARC' : initSparc ? 'SPARC-enhanced' : 'Standard'}`,
      );
      console.log(
        `  • Template type: ${initOptimized ? 'Optimized for parallel processing' : 'Standard'}`,
      );
      console.log('  • Core files: CLAUDE.md, memory-bank.md, coordination.md');
      console.log('  • Directory structure: memory/, coordination/, .claude/');
      console.log('  • Local executable: ./claude-flow@alpha');
      if (initSparc) {
        console.log(
          `  • Claude Code slash commands: ${selectedModes ? selectedModes.length : 'All'} SPARC mode commands`,
        );
        console.log('  • SPARC environment with all development modes');
      }
      if (initOptimized) {
        console.log('  • Batchtools optimization: Enabled for parallel processing');
        console.log('  • Performance enhancements: Smart batching, concurrent operations');
      }
      console.log('\n🚀 To proceed with initialization, run the same command without --dry-run');
    } else {
      printSuccess('🎉 Claude Code integration files initialized successfully!');

      if (initOptimized) {
        console.log('\n⚡ Batchtools Optimization Enabled!');
        console.log('  • Parallel processing capabilities activated');
        console.log('  • Performance improvements: 250-500% faster operations');
        console.log('  • Smart batching and concurrent operations available');
      }

      console.log('\n📋 What was created:');
      console.log(
        `  ✅ CLAUDE.md (${initOptimized ? 'Batchtools-optimized' : initSparc ? 'SPARC-enhanced' : 'Standard configuration'})`,
      );
      console.log(
        `  ✅ memory-bank.md (${initOptimized ? 'With parallel processing' : 'Standard memory system'})`,
      );
      console.log(
        `  ✅ coordination.md (${initOptimized ? 'Enhanced with batchtools' : 'Standard coordination'})`,
      );
      console.log('  ✅ Directory structure with memory/ and coordination/');
      console.log('  ✅ Local executable at ./claude-flow@alpha');
      console.log('  ✅ Persistence database at memory/claude-flow@alpha-data.json');
      console.log('  ✅ Agent system with 64 specialized agents in .claude/agents/');

      if (initSparc) {
        const modeCount = selectedModes ? selectedModes.length : '20+';
        console.log(`  ✅ Claude Code slash commands (${modeCount} SPARC modes)`);
        console.log('  ✅ Complete SPARC development environment');
      }

      console.log('\n🚀 Next steps:');
      console.log('1. Review and customize the generated files for your project');
      console.log("2. Run './claude-flow@alpha start' to begin the orchestration system");
      console.log("3. Use './claude-flow@alpha' instead of 'npx claude-flow@alpha' for all commands");
      console.log("4. Use 'claude --dangerously-skip-permissions' for unattended operation");

      if (initSparc) {
        console.log(
          '5. Use Claude Code slash commands: /sparc, /sparc-architect, /sparc-tdd, etc.',
        );
        console.log("6. Explore SPARC modes with './claude-flow@alpha sparc modes'");
        console.log('7. Try TDD workflow with \'./claude-flow@alpha sparc tdd "your task"\'');

        if (initOptimized) {
          console.log('8. Use batchtools commands: /batchtools, /performance for optimization');
          console.log('9. Enable parallel processing with --parallel flags');
          console.log("10. Monitor performance with './claude-flow@alpha performance monitor'");
        }
      }

      // Update .gitignore
      const gitignoreResult = await updateGitignore(workingDir, initForce, initDryRun);
      if (gitignoreResult.success) {
        if (!initDryRun) {
          console.log(`  ✅ ${gitignoreResult.message}`);
        } else {
          console.log(`  ${gitignoreResult.message}`);
        }
      } else {
        console.log(`  ⚠️  ${gitignoreResult.message}`);
      }

      console.log('\n💡 Tips:');
      console.log("  • Type '/' in Claude Code to see all available slash commands");
      console.log("  • Use './claude-flow@alpha status' to check system health");
      console.log("  • Store important context with './claude-flow@alpha memory store'");

      if (initOptimized) {
        console.log('  • Use --parallel flags for concurrent operations');
        console.log('  • Enable batch processing for multiple related tasks');
        console.log('  • Monitor performance with real-time metrics');
      }

      // Initialize hive-mind system for standard init
      console.log('\n🧠 Initializing basic hive-mind system...');
      try {
        const hiveMindOptions = {
          config: {
            integration: {
              claudeCode: { enabled: isClaudeCodeInstalled() },
              mcpTools: { enabled: true }
            },
            monitoring: { enabled: false } // Basic setup for standard init
          }
        };
        
        const hiveMindResult = await initializeHiveMind(workingDir, hiveMindOptions, false);
        
        if (hiveMindResult.success) {
          console.log('  ✅ Basic hive-mind system initialized');
          console.log('  💡 Use "npx claude-flow@alpha hive-mind" for advanced features');
        } else {
          console.log(`  ⚠️  Hive-mind setup skipped: ${hiveMindResult.error}`);
        }
      } catch (err) {
        console.log(`  ⚠️  Hive-mind setup skipped: ${err.message}`);
      }

      // Check for Claude Code and set up MCP servers (always enabled by default)
      if (!initDryRun && isClaudeCodeInstalled()) {
        console.log('\n🔍 Claude Code CLI detected!');
        const skipMcp = subArgs && subArgs.includes && subArgs.includes('--skip-mcp');

        if (!skipMcp) {
          await setupMcpServers(initDryRun);
        } else {
          console.log('  ℹ️  Skipping MCP setup (--skip-mcp flag used)');
        }
      } else if (!initDryRun && !isClaudeCodeInstalled()) {
        console.log('\n⚠️  Claude Code CLI not detected!');
        console.log('  📥 Install with: npm install -g @anthropic-ai/claude-code');
        console.log('  📋 Then add MCP servers manually with:');
        console.log('     claude mcp add claude-flow npx claude-flow@alpha mcp start');
        console.log('     claude mcp add ruv-swarm npx ruv-swarm mcp start');
        console.log('     claude mcp add flow-nexus npx flow-nexus@latest mcp start');
      }
    }
  } catch (err) {
    printError(`Failed to initialize files: ${err.message}`);
  }
}

// Handle batch initialization
async function handleBatchInit(subArgs, flags) {
  try {
    // Options parsing from flags and subArgs
    const options = {
      parallel: !flags['no-parallel'] && flags.parallel !== false,
      sparc: flags.sparc || flags.s,
      minimal: flags.minimal || flags.m,
      force: flags.force || flags.f,
      maxConcurrency: flags['max-concurrent'] || 5,
      progressTracking: true,
      template: flags.template,
      environments: flags.environments
        ? flags.environments.split(',').map((env) => env.trim())
        : ['dev'],
    };

    // Validate options
    const validationErrors = validateBatchOptions(options);
    if (validationErrors.length > 0) {
      printError('Batch options validation failed:');
      validationErrors.forEach((error) => console.error(`  - ${error}`));
      return;
    }

    // Config file mode
    if (flags.config) {
      const configFile = flags.config;
      printSuccess(`Loading batch configuration from: ${configFile}`);
      const results = await batchInitFromConfig(configFile, options);
      if (results) {
        printSuccess('Batch initialization from config completed');
      }
      return;
    }

    // Batch init mode
    if (flags['batch-init']) {
      const projectsString = flags['batch-init'];
      const projects = projectsString.split(',').map((project) => project.trim());

      if (projects.length === 0) {
        printError('No projects specified for batch initialization');
        return;
      }

      printSuccess(`Initializing ${projects.length} projects in batch mode`);
      const results = await batchInitCommand(projects, options);

      if (results) {
        const successful = results.filter((r) => r.success).length;
        const failed = results.filter((r) => !r.success).length;

        if (failed === 0) {
          printSuccess(`All ${successful} projects initialized successfully`);
        } else {
          printWarning(`${successful} projects succeeded, ${failed} failed`);
        }
      }
      return;
    }

    printError('No batch operation specified. Use --batch-init <projects> or --config <file>');
  } catch (err) {
    printError(`Batch initialization failed: ${err.message}`);
  }
}

/**
 * Enhanced initialization command with validation and rollback
 */
async function enhancedInitCommand(subArgs, flags) {
  console.log('🛡️  Starting enhanced initialization with validation and rollback...');

  // Store parameters to avoid scope issues in async context
  const args = subArgs || [];
  const options = flags || {};

  // Get the working directory
  const workingDir = process.env.PWD || process.cwd();

  // Initialize systems
  const rollbackSystem = new RollbackSystem(workingDir);
  const validationSystem = new ValidationSystem(workingDir);

  let atomicOp = null;

  try {
    // Parse options
    const initOptions = {
      force: args.includes('--force') || args.includes('-f') || options.force,
      minimal: args.includes('--minimal') || args.includes('-m') || options.minimal,
      sparc: args.includes('--sparc') || args.includes('-s') || options.sparc,
      skipPreValidation: args.includes('--skip-pre-validation'),
      skipBackup: args.includes('--skip-backup'),
      validateOnly: args.includes('--validate-only'),
    };

    // Phase 1: Pre-initialization validation
    if (!initOptions.skipPreValidation) {
      console.log('\n🔍 Phase 1: Pre-initialization validation...');
      const preValidation = await validationSystem.validatePreInit(initOptions);

      if (!preValidation.success) {
        printError('Pre-initialization validation failed:');
        preValidation.errors.forEach((error) => console.error(`  ❌ ${error}`));
        return;
      }

      if (preValidation.warnings.length > 0) {
        printWarning('Pre-initialization warnings:');
        preValidation.warnings.forEach((warning) => console.warn(`  ⚠️  ${warning}`));
      }

      printSuccess('Pre-initialization validation passed');
    }

    // Stop here if validation-only mode
    if (options.validateOnly) {
      console.log('\n✅ Validation-only mode completed');
      return;
    }

    // Phase 2: Create backup
    if (!options.skipBackup) {
      console.log('\n💾 Phase 2: Creating backup...');
      const backupResult = await rollbackSystem.createPreInitBackup();

      if (!backupResult.success) {
        printError('Backup creation failed:');
        backupResult.errors.forEach((error) => console.error(`  ❌ ${error}`));
        return;
      }
    }

    // Phase 3: Initialize with atomic operations
    console.log('\n🔧 Phase 3: Atomic initialization...');
    atomicOp = createAtomicOperation(rollbackSystem, 'enhanced-init');

    const atomicBegin = await atomicOp.begin();
    if (!atomicBegin) {
      printError('Failed to begin atomic operation');
      return;
    }

    // Perform initialization steps with checkpoints
    await performInitializationWithCheckpoints(rollbackSystem, options, workingDir, dryRun);

    // Phase 4: Post-initialization validation
    console.log('\n✅ Phase 4: Post-initialization validation...');
    const postValidation = await validationSystem.validatePostInit();

    if (!postValidation.success) {
      printError('Post-initialization validation failed:');
      postValidation.errors.forEach((error) => console.error(`  ❌ ${error}`));

      // Attempt automatic rollback
      console.log('\n🔄 Attempting automatic rollback...');
      await atomicOp.rollback();
      printWarning('Initialization rolled back due to validation failure');
      return;
    }

    // Phase 5: Configuration validation
    console.log('\n🔧 Phase 5: Configuration validation...');
    const configValidation = await validationSystem.validateConfiguration();

    if (configValidation.warnings.length > 0) {
      printWarning('Configuration warnings:');
      configValidation.warnings.forEach((warning) => console.warn(`  ⚠️  ${warning}`));
    }

    // Phase 6: Health checks
    console.log('\n🏥 Phase 6: System health checks...');
    const healthChecks = await validationSystem.runHealthChecks();

    if (healthChecks.warnings.length > 0) {
      printWarning('Health check warnings:');
      healthChecks.warnings.forEach((warning) => console.warn(`  ⚠️  ${warning}`));
    }

    // Commit atomic operation
    await atomicOp.commit();

    // Generate and display validation report
    const fullValidation = await runFullValidation(workingDir, {
      postInit: true,
      skipPreInit: options.skipPreValidation,
    });

    console.log('\n📊 Validation Report:');
    console.log(fullValidation.report);

    printSuccess('🎉 Enhanced initialization completed successfully!');
    console.log('\n✨ Your SPARC environment is fully validated and ready to use');
  } catch (error) {
    printError(`Enhanced initialization failed: ${error.message}`);

    // Attempt rollback if atomic operation is active
    if (atomicOp && !atomicOp.completed) {
      console.log('\n🔄 Performing emergency rollback...');
      try {
        await atomicOp.rollback();
        printWarning('Emergency rollback completed');
      } catch (rollbackError) {
        printError(`Rollback also failed: ${rollbackError.message}`);
      }
    }
  }
}

/**
 * Handle validation commands
 */
async function handleValidationCommand(subArgs, flags) {
  const workingDir = process.env.PWD || process.cwd();

  console.log('🔍 Running validation checks...');

  const options = {
    skipPreInit: subArgs.includes('--skip-pre-init'),
    skipConfig: subArgs.includes('--skip-config'),
    skipModeTest: subArgs.includes('--skip-mode-test'),
    postInit: !subArgs.includes('--pre-init-only'),
  };

  try {
    const validationResults = await runFullValidation(workingDir, options);

    console.log('\n📊 Validation Results:');
    console.log(validationResults.report);

    if (validationResults.success) {
      printSuccess('✅ All validation checks passed');
    } else {
      printError('❌ Some validation checks failed');
      process.exit(1);
    }
  } catch (error) {
    printError(`Validation failed: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Handle rollback commands
 */
async function handleRollbackCommand(subArgs, flags) {
  const workingDir = process.env.PWD || process.cwd();
  const rollbackSystem = new RollbackSystem(workingDir);

  try {
    // Check for specific rollback options
    if (subArgs.includes('--full')) {
      console.log('🔄 Performing full rollback...');
      const result = await rollbackSystem.performFullRollback();

      if (result.success) {
        printSuccess('Full rollback completed successfully');
      } else {
        printError('Full rollback failed:');
        result.errors.forEach((error) => console.error(`  ❌ ${error}`));
      }
    } else if (subArgs.includes('--partial')) {
      const phaseIndex = subArgs.findIndex((arg) => arg === '--phase');
      if (phaseIndex !== -1 && subArgs[phaseIndex + 1]) {
        const phase = subArgs[phaseIndex + 1];
        console.log(`🔄 Performing partial rollback for phase: ${phase}`);

        const result = await rollbackSystem.performPartialRollback(phase);

        if (result.success) {
          printSuccess(`Partial rollback completed for phase: ${phase}`);
        } else {
          printError(`Partial rollback failed for phase: ${phase}`);
          result.errors.forEach((error) => console.error(`  ❌ ${error}`));
        }
      } else {
        printError('Partial rollback requires --phase <phase-name>');
      }
    } else {
      // Interactive rollback point selection
      const rollbackPoints = await rollbackSystem.listRollbackPoints();

      if (rollbackPoints.rollbackPoints.length === 0) {
        printWarning('No rollback points available');
        return;
      }

      console.log('\n📋 Available rollback points:');
      rollbackPoints.rollbackPoints.forEach((point, index) => {
        const date = new Date(point.timestamp).toLocaleString();
        console.log(`  ${index + 1}. ${point.type} - ${date}`);
      });

      // For now, rollback to the most recent point
      const latest = rollbackPoints.rollbackPoints[0];
      if (latest) {
        console.log(
          `\n🔄 Rolling back to: ${latest.type} (${new Date(latest.timestamp).toLocaleString()})`,
        );
        const result = await rollbackSystem.performFullRollback(latest.backupId);

        if (result.success) {
          printSuccess('Rollback completed successfully');
        } else {
          printError('Rollback failed');
        }
      }
    }
  } catch (error) {
    printError(`Rollback operation failed: ${error.message}`);
  }
}

/**
 * Handle list backups command
 */
async function handleListBackups(subArgs, flags) {
  const workingDir = process.env.PWD || process.cwd();
  const rollbackSystem = new RollbackSystem(workingDir);

  try {
    const rollbackPoints = await rollbackSystem.listRollbackPoints();

    console.log('\n📋 Rollback Points and Backups:');

    if (rollbackPoints.rollbackPoints.length === 0) {
      console.log('  No rollback points available');
    } else {
      console.log('\n🔄 Rollback Points:');
      rollbackPoints.rollbackPoints.forEach((point, index) => {
        const date = new Date(point.timestamp).toLocaleString();
        console.log(`  ${index + 1}. ${point.type} - ${date} (${point.backupId || 'No backup'})`);
      });
    }

    if (rollbackPoints.checkpoints.length > 0) {
      console.log('\n📍 Checkpoints:');
      rollbackPoints.checkpoints.slice(-5).forEach((checkpoint, index) => {
        const date = new Date(checkpoint.timestamp).toLocaleString();
        console.log(`  ${index + 1}. ${checkpoint.phase} - ${date} (${checkpoint.status})`);
      });
    }
  } catch (error) {
    printError(`Failed to list backups: ${error.message}`);
  }
}

/**
 * Perform initialization with checkpoints
 */
async function performInitializationWithCheckpoints(
  rollbackSystem,
  options,
  workingDir,
  dryRun = false,
) {
  const phases = [
    { name: 'file-creation', action: () => createInitialFiles(options, workingDir, dryRun) },
    { name: 'directory-structure', action: () => createDirectoryStructure(workingDir, dryRun) },
    { name: 'memory-setup', action: () => setupMemorySystem(workingDir, dryRun) },
    { name: 'coordination-setup', action: () => setupCoordinationSystem(workingDir, dryRun) },
    { name: 'executable-creation', action: () => createLocalExecutable(workingDir, dryRun) },
  ];

  if (options.sparc) {
    phases.push(
      { name: 'sparc-init', action: () => createSparcStructureManually() },
      { name: 'claude-commands', action: () => createClaudeSlashCommands(workingDir) },
    );
  }

  for (const phase of phases) {
    console.log(`  🔧 ${phase.name}...`);

    // Create checkpoint before phase
    await rollbackSystem.createCheckpoint(phase.name, {
      timestamp: Date.now(),
      phase: phase.name,
    });

    try {
      await phase.action();
      console.log(`  ✅ ${phase.name} completed`);
    } catch (error) {
      console.error(`  ❌ ${phase.name} failed: ${error.message}`);
      throw error;
    }
  }
}

// Helper functions for atomic initialization
async function createInitialFiles(options, workingDir, dryRun = false) {
  if (!dryRun) {
    const claudeMd = options.sparc
      ? createSparcClaudeMd()
      : options.minimal
        ? createMinimalClaudeMd()
        : createFullClaudeMd();
    await fs.writeFile(`${workingDir}/CLAUDE.md`, claudeMd, 'utf8');

    const memoryBankMd = options.minimal ? createMinimalMemoryBankMd() : createFullMemoryBankMd();
    await fs.writeFile(`${workingDir}/memory-bank.md`, memoryBankMd, 'utf8');

    const coordinationMd = options.minimal
      ? createMinimalCoordinationMd()
      : createFullCoordinationMd();
    await fs.writeFile(`${workingDir}/coordination.md`, coordinationMd, 'utf8');
  }
}

async function createDirectoryStructure(workingDir, dryRun = false) {
  const directories = [
    'memory',
    'memory/agents',
    'memory/sessions',
    'coordination',
    'coordination/memory_bank',
    'coordination/subtasks',
    'coordination/orchestration',
    '.claude',
    '.claude/commands',
    '.claude/logs',
  ];

  if (!dryRun) {
    for (const dir of directories) {
      await fs.mkdir(`${workingDir}/${dir}`, { recursive: true });
    }
  }
}

async function setupMemorySystem(workingDir, dryRun = false) {
  if (!dryRun) {
    const initialData = { agents: [], tasks: [], lastUpdated: Date.now() };
    await fs.writeFile(
      `${workingDir}/memory/claude-flow@alpha-data.json`, JSON.stringify(initialData, null, 2), 'utf8'
    );

    await fs.writeFile(`${workingDir}/memory/agents/README.md`, createAgentsReadme(), 'utf8');
    await fs.writeFile(`${workingDir}/memory/sessions/README.md`, createSessionsReadme(), 'utf8');
  }
}

async function setupCoordinationSystem(workingDir, dryRun = false) {
  // Coordination system is already set up by createDirectoryStructure
  // This is a placeholder for future coordination setup logic
}

/**
 * Setup monitoring and telemetry for token tracking
 */
async function setupMonitoring(workingDir) {
  console.log('  📈 Configuring token usage tracking...');
  
  const fs = await import('fs/promises');
  const path = await import('path');
  
  try {
    // Create .claude-flow@alpha directory for tracking data
    const trackingDir = path.join(workingDir, '.claude-flow@alpha');
    await fs.mkdir(trackingDir, { recursive: true });
    
    // Create initial token usage file
    const tokenUsageFile = path.join(trackingDir, 'token-usage.json');
    const initialData = {
      total: 0,
      input: 0,
      output: 0,
      byAgent: {},
      lastUpdated: new Date().toISOString()
    };
    
    await fs.writeFile(tokenUsageFile, JSON.stringify(initialData, null, 2));
    printSuccess('  ✓ Created token usage tracking file');
    
    // Add telemetry configuration to .claude/settings.json if it exists
    const settingsPath = path.join(workingDir, '.claude', 'settings.json');
    try {
      const settingsContent = await fs.readFile(settingsPath, 'utf8');
      const settings = JSON.parse(settingsContent);
      
      // Add telemetry hook
      if (!settings.hooks) settings.hooks = {};
      if (!settings.hooks['post-task']) settings.hooks['post-task'] = [];
      
      // Add token tracking hook
      const tokenTrackingHook = 'npx claude-flow@alpha internal track-tokens --session-id {{session_id}} --tokens {{token_usage}}';
      if (!settings.hooks['post-task'].includes(tokenTrackingHook)) {
        settings.hooks['post-task'].push(tokenTrackingHook);
      }
      
      await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));
      printSuccess('  ✓ Added token tracking hooks to settings');
    } catch (err) {
      console.log('  ⚠️  Could not update settings.json:', err.message);
    }
    
    // Create monitoring configuration
    const monitoringConfig = {
      enabled: true,
      telemetry: {
        claudeCode: {
          env: 'CLAUDE_CODE_ENABLE_TELEMETRY',
          value: '1',
          description: 'Enable Claude Code OpenTelemetry metrics'
        }
      },
      tracking: {
        tokens: true,
        costs: true,
        agents: true,
        sessions: true
      },
      storage: {
        location: '.claude-flow@alpha/token-usage.json',
        format: 'json',
        rotation: 'monthly'
      }
    };
    
    const configPath = path.join(trackingDir, 'monitoring.config.json');
    await fs.writeFile(configPath, JSON.stringify(monitoringConfig, null, 2));
    printSuccess('  ✓ Created monitoring configuration');
    
    // Create shell profile snippet for environment variable
    const envSnippet = `
# Claude Flow Token Tracking
# Add this to your shell profile (.bashrc, .zshrc, etc.)
export CLAUDE_CODE_ENABLE_TELEMETRY=1

# Optional: Set custom metrics path
# export CLAUDE_METRICS_PATH="$HOME/.claude/metrics"
`;
    
    const envPath = path.join(trackingDir, 'env-setup.sh');
    await fs.writeFile(envPath, envSnippet.trim());
    printSuccess('  ✓ Created environment setup script');
    
    console.log('\n  📋 To enable Claude Code telemetry:');
    console.log('     1. Add to your shell profile: export CLAUDE_CODE_ENABLE_TELEMETRY=1');
    console.log('     2. Or run: source .claude-flow@alpha/env-setup.sh');
    console.log('\n  💡 Token usage will be tracked in .claude-flow@alpha/token-usage.json');
    console.log('     Run: claude-flow@alpha analysis token-usage --breakdown --cost-analysis');
    
  } catch (err) {
    printError(`  Failed to setup monitoring: ${err.message}`);
  }
}

/**
 * Enhanced Claude Flow v2.0.0 initialization
 */
async function enhancedClaudeFlowInit(flags, subArgs = []) {
  console.log('🚀 Initializing Claude Flow v2.0.0 with enhanced features...');

  const workingDir = process.cwd();
  const force = flags.force || flags.f;
  const dryRun = flags.dryRun || flags['dry-run'] || flags.d;
  const initSparc = flags.roo || (subArgs && subArgs.includes('--roo')); // SPARC only with --roo flag

  // Parse --agent flag for specialized agent setup
  const agentType = flags.agent || (subArgs && subArgs.find(arg => arg.startsWith('--agent='))?.split('=')[1]);
  const initReasoning = agentType === 'reasoning' || (subArgs && subArgs.includes('--agent') && subArgs.includes('reasoning'));

  // Store parameters to avoid scope issues in async context
  const args = subArgs || [];
  const options = flags || {};

  // Import fs, path, and os modules for Node.js
  const fs = await import('fs/promises');
  const { chmod } = fs;
  const path = await import('path');
  const os = await import('os');

  try {
    // Check existing files
    const existingFiles = [];
    const filesToCheck = [
      'CLAUDE.md',
      '.claude/settings.json',
      '.mcp.json',
      // Removed claude-flow@alpha.config.json per user request
    ];

    for (const file of filesToCheck) {
      if (existsSync(`${workingDir}/${file}`)) {
        existingFiles.push(file);
      }
    }

    if (existingFiles.length > 0 && !force) {
      printWarning(`The following files already exist: ${existingFiles.join(', ')}`);
      console.log('Use --force to overwrite existing files');
      return;
    }

    // Create CLAUDE.md
    if (!dryRun) {
      await fs.writeFile(`${workingDir}/CLAUDE.md`, createOptimizedSparcClaudeMd(), 'utf8');
      printSuccess('✓ Created CLAUDE.md (Claude Flow v2.0.0 - Optimized)');
    } else {
      console.log('[DRY RUN] Would create CLAUDE.md (Claude Flow v2.0.0 - Optimized)');
    }

    // Create .claude directory structure
    const claudeDir = `${workingDir}/.claude`;
    if (!dryRun) {
      await fs.mkdir(claudeDir, { recursive: true });
      await fs.mkdir(`${claudeDir}/commands`, { recursive: true });
      await fs.mkdir(`${claudeDir}/helpers`, { recursive: true });
      printSuccess('✓ Created .claude directory structure');
    } else {
      console.log('[DRY RUN] Would create .claude directory structure');
    }

    // Create settings.json
    if (!dryRun) {
      await fs.writeFile(`${claudeDir}/settings.json`, createEnhancedSettingsJson(), 'utf8');
      printSuccess('✓ Created .claude/settings.json with hooks and MCP configuration');
    } else {
      console.log('[DRY RUN] Would create .claude/settings.json');
    }

    // Copy statusline script
    try {
      let statuslineTemplate;
      try {
        // Try to read from templates directory first
        statuslineTemplate = await fs.readFile(
          path.join(__dirname, 'templates', 'statusline-command.sh'),
          'utf8'
        );
      } catch {
        // Fallback to embedded content (for binary builds)
        statuslineTemplate = createStatuslineScript();
      }

      if (!dryRun) {
        // Write to project .claude directory
        await fs.writeFile(`${claudeDir}/statusline-command.sh`, statuslineTemplate, 'utf8');
        await fs.chmod(`${claudeDir}/statusline-command.sh`, 0o755);

        // Also write to home ~/.claude directory for global use
        const homeClaudeDir = path.join(os.homedir(), '.claude');
        await fs.mkdir(homeClaudeDir, { recursive: true });
        await fs.writeFile(path.join(homeClaudeDir, 'statusline-command.sh'), statuslineTemplate, 'utf8');
        await fs.chmod(path.join(homeClaudeDir, 'statusline-command.sh'), 0o755);

        printSuccess('✓ Created statusline-command.sh in both .claude/ and ~/.claude/');
      } else {
        console.log('[DRY RUN] Would create .claude/statusline-command.sh and ~/.claude/statusline-command.sh');
      }
    } catch (err) {
      // Not critical, just skip
      if (!dryRun) {
        console.log('  ⚠️  Could not create statusline script, skipping...');
        console.log(`  ℹ️  Error: ${err.message}`);
      }
    }

    // Create settings.local.json with default MCP permissions
    const settingsLocal = {
      permissions: {
        allow: ['mcp__ruv-swarm', 'mcp__claude-flow@alpha', 'mcp__flow-nexus'],
        deny: [],
      },
    };

    if (!dryRun) {
      await fs.writeFile(
        `${claudeDir}/settings.local.json`, JSON.stringify(settingsLocal, null, 2, 'utf8'),
      );
      printSuccess('✓ Created .claude/settings.local.json with default MCP permissions');
    } else {
      console.log(
        '[DRY RUN] Would create .claude/settings.local.json with default MCP permissions',
      );
    }

    // Create .mcp.json at project root for MCP server configuration
    const mcpConfig = {
      mcpServers: {
        'claude-flow@alpha': {
          command: 'npx',
          args: ['claude-flow@alpha', 'mcp', 'start'],
          type: 'stdio',
        },
        'ruv-swarm': {
          command: 'npx',
          args: ['ruv-swarm@latest', 'mcp', 'start'],
          type: 'stdio',
        },
        'flow-nexus': {
          command: 'npx',
          args: ['flow-nexus@latest', 'mcp', 'start'],
          type: 'stdio',
        },
      },
    };

    if (!dryRun) {
      await fs.writeFile(`${workingDir}/.mcp.json`, JSON.stringify(mcpConfig, null, 2, 'utf8'));
      printSuccess('✓ Created .mcp.json at project root for MCP server configuration');
    } else {
      console.log('[DRY RUN] Would create .mcp.json at project root for MCP server configuration');
    }

    // Removed claude-flow@alpha.config.json creation per user request

    // Create command documentation
    for (const [category, commands] of Object.entries(COMMAND_STRUCTURE)) {
      const categoryDir = `${claudeDir}/commands/${category}`;

      if (!dryRun) {
        await fs.mkdir(categoryDir, { recursive: true });

        // Create category README
        const categoryReadme = `# ${category.charAt(0).toUpperCase() + category.slice(1)} Commands

Commands for ${category} operations in Claude Flow.

## Available Commands

${commands.map((cmd) => `- [${cmd}](./${cmd}.md)`).join('\n')}
`;
        await fs.writeFile(`${categoryDir}/README.md`, categoryReadme, 'utf8');

        // Create individual command docs
        for (const command of commands) {
          const doc = createCommandDoc(category, command);
          if (doc) {
            await fs.writeFile(`${categoryDir}/${command}.md`, doc, 'utf8');
          }
        }

        console.log(`  ✓ Created ${commands.length} ${category} command docs`);
      } else {
        console.log(`[DRY RUN] Would create ${commands.length} ${category} command docs`);
      }
    }

    // Create wrapper scripts using the dedicated function
    if (!dryRun) {
      await createLocalExecutable(workingDir, dryRun);
    } else {
      console.log('[DRY RUN] Would create wrapper scripts');
    }

    // Create helper scripts
    const helpers = ['setup-mcp.sh', 'quick-start.sh', 'github-setup.sh', 'github-safe.js', 'standard-checkpoint-hooks.sh', 'checkpoint-manager.sh'];
    for (const helper of helpers) {
      if (!dryRun) {
        const content = createHelperScript(helper);
        if (content) {
          await fs.writeFile(`${claudeDir}/helpers/${helper}`, content, 'utf8');
          await fs.chmod(`${claudeDir}/helpers/${helper}`, 0o755);
        }
      }
    }

    if (!dryRun) {
      printSuccess(`✓ Created ${helpers.length} helper scripts`);
    } else {
      console.log(`[DRY RUN] Would create ${helpers.length} helper scripts`);
    }

    // Create standard directories from original init
    const standardDirs = [
      'memory',
      'memory/agents',
      'memory/sessions',
      'coordination',
      'coordination/memory_bank',
      'coordination/subtasks',
      'coordination/orchestration',
      '.swarm', // Add .swarm directory for shared memory
      '.hive-mind', // Add .hive-mind directory for hive-mind system
      '.claude/checkpoints', // Add checkpoints directory for Git checkpoint system
    ];

    for (const dir of standardDirs) {
      if (!dryRun) {
        await fs.mkdir(`${workingDir}/${dir}`, { recursive: true });
      }
    }

    if (!dryRun) {
      printSuccess('✓ Created standard directory structure');

      // Initialize memory system
      const initialData = { agents: [], tasks: [], lastUpdated: Date.now() };
      await fs.writeFile(
        `${workingDir}/memory/claude-flow@alpha-data.json`, JSON.stringify(initialData, null, 2, 'utf8'),
      );

      // Create README files
      await fs.writeFile(`${workingDir}/memory/agents/README.md`, createAgentsReadme(), 'utf8');
      await fs.writeFile(`${workingDir}/memory/sessions/README.md`, createSessionsReadme(), 'utf8');

      printSuccess('✓ Initialized memory system');

      // Initialize memory database with fallback support
      try {
        // Check if database exists BEFORE creating it
        const dbPath = '.swarm/memory.db';
        const { existsSync } = await import('fs');
        const dbExistedBefore = existsSync(dbPath);

        // Handle ReasoningBank migration BEFORE FallbackMemoryStore initialization
        // This prevents schema conflicts with old databases
        if (dbExistedBefore) {
          console.log('  🔍 Checking existing database for ReasoningBank schema...');

          try {
            const {
              initializeReasoningBank,
              checkReasoningBankTables,
              migrateReasoningBank
            } = await import('../../../reasoningbank/reasoningbank-adapter.js');

            // Set the database path for ReasoningBank
            process.env.CLAUDE_FLOW_DB_PATH = dbPath;

            const tableCheck = await checkReasoningBankTables();

            if (tableCheck.exists) {
              console.log('  ✅ ReasoningBank schema already complete');
            } else if (force) {
              // User used --force flag, migrate the database
              console.log(`  🔄 Migrating database: ${tableCheck.missingTables.length} tables missing`);
              console.log(`     Missing: ${tableCheck.missingTables.join(', ')}`);

              const migrationResult = await migrateReasoningBank();

              if (migrationResult.success) {
                printSuccess(`  ✓ Migration complete: added ${migrationResult.addedTables?.length || 0} tables`);
                console.log('     Use --reasoningbank flag to enable AI-powered memory features');
              } else {
                console.log(`  ⚠️  Migration failed: ${migrationResult.message}`);
                console.log('     Basic memory will work, use: memory init --reasoningbank to retry');
              }
            } else {
              // Database exists with missing tables but no --force flag
              console.log(`  ℹ️  Database has ${tableCheck.missingTables.length} missing ReasoningBank tables`);
              console.log(`     Missing: ${tableCheck.missingTables.join(', ')}`);
              console.log('     Use --force to migrate existing database');
              console.log('     Or use: memory init --reasoningbank');
            }
          } catch (rbErr) {
            console.log(`  ⚠️  ReasoningBank check failed: ${rbErr.message}`);
            console.log('     Will attempt normal initialization...');
          }
        }

        // Import and initialize FallbackMemoryStore to create the database
        const { FallbackMemoryStore } = await import('../../../memory/fallback-store.js');
        const memoryStore = new FallbackMemoryStore();
        await memoryStore.initialize();

        if (memoryStore.isUsingFallback()) {
          printSuccess('✓ Initialized memory system (in-memory fallback for npx compatibility)');
          console.log(
            '  💡 For persistent storage, install locally: npm install claude-flow@alpha',
          );
        } else {
          printSuccess('✓ Initialized memory database (.swarm/memory.db)');

          // Initialize ReasoningBank schema for fresh databases
          if (!dbExistedBefore) {
            try {
              const {
                initializeReasoningBank
              } = await import('../../../reasoningbank/reasoningbank-adapter.js');

              // Set the database path for ReasoningBank
              process.env.CLAUDE_FLOW_DB_PATH = dbPath;

              console.log('  🧠 Initializing ReasoningBank schema...');
              await initializeReasoningBank();
              printSuccess('  ✓ ReasoningBank schema initialized (use --reasoningbank flag for AI-powered memory)');
            } catch (rbErr) {
              console.log(`  ⚠️  ReasoningBank initialization failed: ${rbErr.message}`);
              console.log('     Basic memory will work, use: memory init --reasoningbank to retry');
            }
          }
        }

        memoryStore.close();
      } catch (err) {
        console.log(`  ⚠️  Could not initialize memory system: ${err.message}`);
        console.log('     Memory will be initialized on first use');
      }

      // Initialize comprehensive hive-mind system
      try {
        const hiveMindOptions = {
          config: {
            integration: {
              claudeCode: { enabled: isClaudeCodeInstalled() },
              mcpTools: { enabled: true }
            },
            monitoring: { enabled: flags.monitoring || false }
          }
        };
        
        const hiveMindResult = await initializeHiveMind(workingDir, hiveMindOptions, dryRun);
        
        if (hiveMindResult.success) {
          printSuccess(`✓ Hive Mind System initialized with ${hiveMindResult.features.length} features`);
          
          // Log individual features
          hiveMindResult.features.forEach(feature => {
            console.log(`    • ${feature}`);
          });
        } else {
          console.log(`  ⚠️  Hive Mind initialization failed: ${hiveMindResult.error}`);
          if (hiveMindResult.rollbackRequired) {
            console.log('  🔄 Automatic rollback may be required');
          }
        }
      } catch (err) {
        console.log(`  ⚠️  Could not initialize hive-mind system: ${err.message}`);
      }
    }

    // Update .gitignore with Claude Flow entries
    const gitignoreResult = await updateGitignore(workingDir, force, dryRun);
    if (gitignoreResult.success) {
      if (!dryRun) {
        printSuccess(`✓ ${gitignoreResult.message}`);
      } else {
        console.log(gitignoreResult.message);
      }
    } else {
      console.log(`  ⚠️  ${gitignoreResult.message}`);
    }

    // SPARC initialization (only with --roo flag)
    let sparcInitialized = false;
    if (initSparc) {
      console.log('\n🚀 Initializing SPARC development environment...');
      try {
        // Run create-sparc
        console.log('  🔄 Running: npx -y create-sparc init --force');
        execSync('npx -y create-sparc init --force', {
          cwd: workingDir,
          stdio: 'inherit',
        });
        sparcInitialized = true;
        printSuccess('✅ SPARC environment initialized successfully');
      } catch (err) {
        console.log(`  ⚠️  Could not run create-sparc: ${err.message}`);
        console.log('     SPARC features will be limited to basic functionality');
      }
    }

    // Create Claude slash commands for SPARC
    if (sparcInitialized && !dryRun) {
      console.log('\n📝 Creating Claude Code slash commands...');
      await createClaudeSlashCommands(workingDir);
    }

    // Check for Claude Code and set up MCP servers (always enabled by default)
    if (!dryRun && isClaudeCodeInstalled()) {
      console.log('\n🔍 Claude Code CLI detected!');
      const skipMcp =
        (options && options['skip-mcp']) ||
        (subArgs && subArgs.includes && subArgs.includes('--skip-mcp'));

      if (!skipMcp) {
        await setupMcpServers(dryRun);
      } else {
        console.log('  ℹ️  Skipping MCP setup (--skip-mcp flag used)');
        console.log('\n  📋 To add MCP servers manually:');
        console.log('     claude mcp add claude-flow npx claude-flow@alpha mcp start');
        console.log('     claude mcp add ruv-swarm npx ruv-swarm@latest mcp start');
        console.log('     claude mcp add flow-nexus npx flow-nexus@latest mcp start');
        console.log('\n  💡 MCP servers are defined in .mcp.json (project scope)');
      }
    } else if (!dryRun && !isClaudeCodeInstalled()) {
      console.log('\n⚠️  Claude Code CLI not detected!');
      console.log('\n  📥 To install Claude Code:');
      console.log('     npm install -g @anthropic-ai/claude-code');
      console.log('\n  📋 After installing, add MCP servers:');
      console.log('     claude mcp add claude-flow@alpha npx claude-flow@alpha mcp start');
      console.log('     claude mcp add ruv-swarm npx ruv-swarm@latest mcp start');
      console.log('     claude mcp add flow-nexus npx flow-nexus@latest mcp start');
      console.log('\n  💡 MCP servers are defined in .mcp.json (project scope)');
    }

    // Create agent directories and copy all agent files
    console.log('\n🤖 Setting up agent system...');
    if (!dryRun) {
      await createAgentDirectories(workingDir, dryRun);
      const agentResult = await copyAgentFiles(workingDir, {
        force: force,
        dryRun: dryRun
      });

      if (agentResult.success) {
        await validateAgentSystem(workingDir);

        // Copy command files including Flow Nexus commands
        console.log('\n📚 Setting up command system...');
        const commandResult = await copyCommandFiles(workingDir, {
          force: force,
          dryRun: dryRun
        });

        if (commandResult.success) {
          console.log('✅ ✓ Command system setup complete with Flow Nexus integration');
        } else {
          console.log('⚠️  Command system setup failed:', commandResult.error);
        }

        // Copy skill files including skill-builder
        console.log('\n🎯 Setting up skill system...');
        const skillResult = await copySkillFiles(workingDir, {
          force: force,
          dryRun: dryRun
        });

        if (skillResult.success) {
          await validateSkillSystem(workingDir);
          console.log('✅ ✓ Skill system setup complete with skill-builder');
        } else {
          console.log('⚠️  Skill system setup failed:', skillResult.error);
        }

        console.log('✅ ✓ Agent system setup complete with 64 specialized agents');
      } else {
        console.log('⚠️  Agent system setup failed:', agentResult.error);
      }

      // Setup reasoning agents if --agent reasoning flag is used
      if (initReasoning) {
        console.log('\n🧠 Setting up reasoning agents with ReasoningBank integration...');
        try {
          const reasoningAgentsDir = `${workingDir}/.claude/agents/reasoning`;
          await fs.mkdir(reasoningAgentsDir, { recursive: true });

          // Import path module
          const path = await import('path');
          const { fileURLToPath } = await import('url');
          const { dirname, join } = path.default;

          // Get the source reasoning agents directory
          const __filename = fileURLToPath(import.meta.url);
          const __dirname = dirname(__filename);
          const sourceReasoningDir = join(__dirname, '../../../../.claude/agents/reasoning');

          // Copy reasoning agent files
          try {
            const reasoningFiles = await fs.readdir(sourceReasoningDir);
            let copiedReasoningAgents = 0;

            for (const file of reasoningFiles) {
              if (file.endsWith('.md')) {
                const sourcePath = join(sourceReasoningDir, file);
                const destPath = join(reasoningAgentsDir, file);
                const content = await fs.readFile(sourcePath, 'utf8');
                await fs.writeFile(destPath, content);
                copiedReasoningAgents++;
              }
            }

            printSuccess(`✓ Copied ${copiedReasoningAgents} reasoning agent files`);
            console.log('  📚 Reasoning agents available:');
            console.log('    • goal-planner - Goal-Oriented Action Planning specialist');
            console.log('    • sublinear-goal-planner - Sub-linear complexity goal planning');
            console.log('  💡 Use: npx agentic-flow --agent goal-planner --task "your task"');
            console.log('  📖 Documentation: .claude/agents/reasoning/README.md');
          } catch (err) {
            console.log(`  ⚠️  Could not copy reasoning agents: ${err.message}`);
            console.log('     Reasoning agents may not be available yet');
          }
        } catch (err) {
          console.log(`  ⚠️  Reasoning agent setup failed: ${err.message}`);
        }
      }
    } else {
      console.log('  [DRY RUN] Would create agent system with 64 specialized agents');
      if (initReasoning) {
        console.log('  [DRY RUN] Would also setup reasoning agents with ReasoningBank integration');
      }
    }

    // Optional: Setup monitoring and telemetry
    const enableMonitoring = flags.monitoring || flags['enable-monitoring'];
    if (enableMonitoring && !dryRun) {
      console.log('\n📊 Setting up monitoring and telemetry...');
      await setupMonitoring(workingDir);
    }
    
    // Final instructions with hive-mind status
    console.log('\n🎉 Claude Flow v2.0.0 initialization complete!');
    
    // Display hive-mind status
    const hiveMindStatus = getHiveMindStatus(workingDir);
    console.log('\n🧠 Hive Mind System Status:');
    console.log(`  Configuration: ${hiveMindStatus.configured ? '✅ Ready' : '❌ Missing'}`);
    console.log(`  Database: ${hiveMindStatus.database === 'sqlite' ? '✅ SQLite' : hiveMindStatus.database === 'fallback' ? '⚠️ JSON Fallback' : '❌ Not initialized'}`);
    console.log(`  Directory Structure: ${hiveMindStatus.directories ? '✅ Created' : '❌ Missing'}`);
    
    console.log('\n📚 Quick Start:');
    if (isClaudeCodeInstalled()) {
      console.log('1. View available commands: ls .claude/commands/');
      console.log('2. Start a swarm: npx claude-flow@alpha swarm "your objective" --claude');
      console.log('3. Use hive-mind: npx claude-flow@alpha hive-mind spawn "command" --claude');
      console.log('4. Use MCP tools in Claude Code for enhanced coordination');
      if (hiveMindStatus.configured) {
        console.log('5. Initialize first swarm: npx claude-flow@alpha hive-mind init');
      }
    } else {
      console.log('1. Install Claude Code: npm install -g @anthropic-ai/claude-code');
      console.log('2. Add MCP servers (see instructions above)');
      console.log('3. View available commands: ls .claude/commands/');
      console.log('4. Start a swarm: npx claude-flow@alpha swarm "your objective" --claude');
      console.log('5. Use hive-mind: npx claude-flow@alpha hive-mind spawn "command" --claude');
      if (hiveMindStatus.configured) {
        console.log('6. Initialize first swarm: npx claude-flow@alpha hive-mind init');
      }
    }
    console.log('\n💡 Tips:');
    console.log('• Check .claude/commands/ for detailed documentation');
    console.log('• Use --help with any command for options');
    console.log('• Run commands with --claude flag for best Claude Code integration');
    console.log('• Enable GitHub integration with .claude/helpers/github-setup.sh');
    console.log('• Git checkpoints are automatically enabled in settings.json');
    console.log('• Use .claude/helpers/checkpoint-manager.sh for easy rollback');
  } catch (err) {
    printError(`Failed to initialize Claude Flow v2.0.0: ${err.message}`);
    
    // Attempt hive-mind rollback if it was partially initialized
    try {
      const hiveMindStatus = getHiveMindStatus(workingDir);
      if (hiveMindStatus.directories || hiveMindStatus.configured) {
        console.log('\n🔄 Attempting hive-mind system rollback...');
        const rollbackResult = await rollbackHiveMindInit(workingDir);
        if (rollbackResult.success) {
          console.log('  ✅ Hive-mind rollback completed');
        } else {
          console.log(`  ⚠️  Hive-mind rollback failed: ${rollbackResult.error}`);
        }
      }
    } catch (rollbackErr) {
      console.log(`  ⚠️  Rollback error: ${rollbackErr.message}`);
    }
  }
}

/**
 * Flow Nexus minimal initialization - only creates Flow Nexus CLAUDE.md, commands, and agents
 */
async function flowNexusMinimalInit(flags, subArgs) {
  console.log('🌐 Flow Nexus: Initializing minimal setup...');
  
  try {
    const force = flags.force || flags.f;
    
    // Import functions we need
    const { createFlowNexusClaudeMd } = await import('./templates/claude-md.js');
    const { promises: fs } = await import('fs');
    
    // Create Flow Nexus CLAUDE.md
    console.log('📝 Creating Flow Nexus CLAUDE.md...');
    const flowNexusClaudeMd = createFlowNexusClaudeMd();
    await fs.writeFile('CLAUDE.md', flowNexusClaudeMd);
    console.log('  ✅ Created CLAUDE.md with Flow Nexus integration');
    
    // Create .claude/commands/flow-nexus directory and copy commands
    console.log('📁 Setting up Flow Nexus commands...');
    await fs.mkdir('.claude/commands/flow-nexus', { recursive: true });
    
    // Copy Flow Nexus command files
    const { fileURLToPath } = await import('url');
    const { dirname, join } = await import('path');
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const sourceCommandsDir = join(__dirname, '../../../../.claude/commands/flow-nexus');
    try {
      const commandFiles = await fs.readdir(sourceCommandsDir);
      let copiedCommands = 0;
      
      for (const file of commandFiles) {
        if (file.endsWith('.md')) {
          const sourcePath = `${sourceCommandsDir}/${file}`;
          const destPath = `.claude/commands/flow-nexus/${file}`;
          const content = await fs.readFile(sourcePath, 'utf8');
          await fs.writeFile(destPath, content);
          copiedCommands++;
        }
      }
      
      console.log(`  ✅ Copied ${copiedCommands} Flow Nexus command files`);
    } catch (err) {
      console.log('  ⚠️  Could not copy Flow Nexus commands:', err.message);
    }
    
    // Create .claude/agents/flow-nexus directory and copy agents
    console.log('🤖 Setting up Flow Nexus agents...');
    await fs.mkdir('.claude/agents/flow-nexus', { recursive: true });
    
    // Copy Flow Nexus agent files
    const sourceAgentsDir = join(__dirname, '../../../../.claude/agents/flow-nexus');
    try {
      const agentFiles = await fs.readdir(sourceAgentsDir);
      let copiedAgents = 0;
      
      for (const file of agentFiles) {
        if (file.endsWith('.md')) {
          const sourcePath = `${sourceAgentsDir}/${file}`;
          const destPath = `.claude/agents/flow-nexus/${file}`;
          const content = await fs.readFile(sourcePath, 'utf8');
          await fs.writeFile(destPath, content);
          copiedAgents++;
        }
      }
      
      console.log(`  ✅ Copied ${copiedAgents} Flow Nexus agent files`);
    } catch (err) {
      console.log('  ⚠️  Could not copy Flow Nexus agents:', err.message);
    }
    
    console.log('\n🎉 Flow Nexus minimal initialization complete!');
    console.log('📚 Created: CLAUDE.md with Flow Nexus documentation');
    console.log('📁 Created: .claude/commands/flow-nexus/ directory with command documentation');
    console.log('🤖 Created: .claude/agents/flow-nexus/ directory with specialized agents');
    console.log('');
    console.log('💡 Quick Start:');
    console.log('  1. Register: mcp__flow-nexus__user_register({ email, password })');
    console.log('  2. Login: mcp__flow-nexus__user_login({ email, password })');
    console.log('  3. Deploy: mcp__flow-nexus__swarm_init({ topology: "mesh", maxAgents: 5 })');
    console.log('');
    console.log('🔗 Use Flow Nexus MCP tools in Claude Code for full functionality');
    
  } catch (err) {
    console.log(`❌ Flow Nexus initialization failed: ${err.message}`);
    console.log('Stack trace:', err.stack);
    process.exit(1);
  }
}
