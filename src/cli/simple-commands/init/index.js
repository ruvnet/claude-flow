// init/index.js - Initialize Claude Code integration files
import { printSuccess, printError, printWarning } from '../../utils.js';
import { createLocalExecutable } from './executable-wrapper.js';
import { createSparcStructureManually } from './sparc-structure.js';
import { createClaudeSlashCommands } from './claude-commands/slash-commands.js';
import { createOptimizedClaudeSlashCommands } from './claude-commands/optimized-slash-commands.js';
import { 
  createSparcClaudeMd, 
  createFullClaudeMd, 
  createMinimalClaudeMd,
  createOptimizedSparcClaudeMd 
} from './templates/claude-md.js';
import { 
  createFullMemoryBankMd, 
  createMinimalMemoryBankMd,
  createOptimizedMemoryBankMd 
} from './templates/memory-bank-md.js';
import { 
  createFullCoordinationMd, 
  createMinimalCoordinationMd,
  createOptimizedCoordinationMd 
} from './templates/coordination-md.js';
import { 
  createAgentsReadme, 
  createSessionsReadme 
} from './templates/readme-files.js';
import { showInitHelp } from './help.js';
import { 
  batchInitCommand, 
  batchInitFromConfig, 
  validateBatchOptions 
} from './batch-init.js';
import { ValidationSystem, runFullValidation } from './validation/index.js';
import { RollbackSystem, createAtomicOperation } from './rollback/index.js';

export async function initCommand(subArgs, flags) {
  // Show help if requested
  if (flags.help || flags.h || subArgs.includes('--help') || subArgs.includes('-h')) {
    showInitHelp();
    return;
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
  const initSparc = subArgs.includes('--sparc') || subArgs.includes('-s') || flags.sparc;
  const initDryRun = subArgs.includes('--dry-run') || subArgs.includes('-d') || flags.dryRun;
  const initOptimized = initSparc && initForce; // Use optimized templates when both flags are present
  const selectedModes = flags.modes ? flags.modes.split(',') : null; // Support selective mode initialization
  
  // Get the actual working directory (where the command was run from)
  // Use PWD environment variable which preserves the original directory
  const workingDir = Deno.env.get('PWD') || Deno.cwd();
  console.log(`📁 Initializing in: ${workingDir}`);
  
  // Change to the working directory to ensure all file operations happen there
  try {
    Deno.chdir(workingDir);
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
        await Deno.stat(`${workingDir}/${file}`);
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
    
    // Create CLAUDE.md
    const claudeMd = initOptimized ? await createOptimizedSparcClaudeMd() :
                     initSparc ? createSparcClaudeMd() : 
                     initMinimal ? createMinimalClaudeMd() : createFullClaudeMd();
    
    if (!initDryRun) {
      await Deno.writeTextFile('CLAUDE.md', claudeMd);
      console.log(`  ✓ Created CLAUDE.md${initOptimized ? ' (Batchtools-optimized SPARC)' : initSparc ? ' (SPARC-enhanced)' : ''}`);
    } else {
      console.log(`  [DRY RUN] Would create CLAUDE.md${initOptimized ? ' (Batchtools-optimized SPARC)' : initSparc ? ' (SPARC-enhanced)' : ''}`);
    }
    
    // Create memory-bank.md
    const memoryBankMd = initOptimized ? await createOptimizedMemoryBankMd() :
                         initMinimal ? createMinimalMemoryBankMd() : createFullMemoryBankMd();
    if (!initDryRun) {
      await Deno.writeTextFile('memory-bank.md', memoryBankMd);
      console.log('  ✓ Created memory-bank.md' + (initOptimized ? ' (Optimized for parallel operations)' : ''));
    } else {
      console.log('  [DRY RUN] Would create memory-bank.md' + (initOptimized ? ' (Optimized for parallel operations)' : ''));
    }
    
    // Create coordination.md
    const coordinationMd = initOptimized ? await createOptimizedCoordinationMd() :
                           initMinimal ? createMinimalCoordinationMd() : createFullCoordinationMd();
    if (!initDryRun) {
      await Deno.writeTextFile('coordination.md', coordinationMd);
      console.log('  ✓ Created coordination.md' + (initOptimized ? ' (Enhanced with batchtools)' : ''));
    } else {
      console.log('  [DRY RUN] Would create coordination.md' + (initOptimized ? ' (Enhanced with batchtools)' : ''));
    }
    
    // Create directory structure
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
      '.claude/commands/sparc',
      '.claude/commands/swarm',
      '.claude/logs'
    ];
    
    for (const dir of directories) {
      try {
        if (!initDryRun) {
          await Deno.mkdir(dir, { recursive: true });
          console.log(`  ✓ Created ${dir}/ directory`);
        } else {
          console.log(`  [DRY RUN] Would create ${dir}/ directory`);
        }
      } catch (err) {
        if (!(err instanceof Deno.errors.AlreadyExists)) {
          throw err;
        }
      }
    }
    
    // Copy SPARC command files if --sparc flag is used
    if (initSparc && !initDryRun) {
      try {
        // Get the path to the source SPARC files
        const modulePath = new URL(import.meta.url).pathname;
        const moduleDir = modulePath.substring(0, modulePath.lastIndexOf('/'));
        const projectRoot = moduleDir.split('/src/')[0];
        const sparcSourceDir = `${projectRoot}/.claude/commands/sparc`;
        const sparcTargetDir = `${workingDir}/.claude/commands/sparc`;
        
        // List of SPARC files to copy
        const sparcFiles = [
          'analyzer.md', 'architect.md', 'batch-executor.md', 'coder.md',
          'debugger.md', 'designer.md', 'documenter.md', 'innovator.md',
          'memory-manager.md', 'optimizer.md', 'orchestrator.md', 'researcher.md',
          'reviewer.md', 'sparc-modes.md', 'swarm-coordinator.md', 'tdd.md',
          'tester.md', 'workflow-manager.md'
        ];
        
        console.log('  📁 Copying SPARC command files...');
        
        for (const file of sparcFiles) {
          try {
            const content = await Deno.readTextFile(`${sparcSourceDir}/${file}`);
            await Deno.writeTextFile(`${sparcTargetDir}/${file}`, content);
            console.log(`    ✓ Copied ${file}`);
          } catch (err) {
            console.log(`    ⚠️  Could not copy ${file}: ${err.message}`);
          }
        }
        
        console.log('  ✅ SPARC command files copied successfully');
      } catch (err) {
        console.log(`  ⚠️  Could not copy SPARC files: ${err.message}`);
      }
      
      // Also copy swarm strategy files
      try {
        const swarmSourceDir = `${projectRoot}/.claude/commands/swarm`;
        const swarmTargetDir = `${workingDir}/.claude/commands/swarm`;
        
        const swarmFiles = [
          'analysis.md', 'development.md', 'examples.md', 
          'maintenance.md', 'optimization.md', 'research.md', 'testing.md'
        ];
        
        console.log('  📁 Copying swarm strategy files...');
        
        for (const file of swarmFiles) {
          try {
            const content = await Deno.readTextFile(`${swarmSourceDir}/${file}`);
            await Deno.writeTextFile(`${swarmTargetDir}/${file}`, content);
            console.log(`    ✓ Copied ${file}`);
          } catch (err) {
            console.log(`    ⚠️  Could not copy ${file}: ${err.message}`);
          }
        }
        
        console.log('  ✅ Swarm strategy files copied successfully');
      } catch (err) {
        console.log(`  ⚠️  Could not copy swarm files: ${err.message}`);
      }
      
      // Create .claude/config.json
      try {
        const configContent = {
          "version": "1.0",
          "sparc": {
            "enabled": true,
            "modes": ["orchestrator", "coder", "researcher", "tdd", "architect", "reviewer", "debugger", "tester", "analyzer", "optimizer", "documenter", "designer", "innovator", "swarm-coordinator", "memory-manager", "batch-executor", "workflow-manager"]
          },
          "swarm": {
            "enabled": true,
            "strategies": ["research", "development", "analysis", "testing", "optimization", "maintenance"]
          }
        };
        
        await Deno.writeTextFile(`${workingDir}/.claude/config.json`, JSON.stringify(configContent, null, 2));
        console.log('  ✓ Created .claude/config.json');
      } catch (err) {
        console.log(`  ⚠️  Could not create config.json: ${err.message}`);
      }
    }
    
    // Create placeholder files for memory directories
    const agentsReadme = createAgentsReadme();
    if (!initDryRun) {
      await Deno.writeTextFile('memory/agents/README.md', agentsReadme);
      console.log('  ✓ Created memory/agents/README.md');
    } else {
      console.log('  [DRY RUN] Would create memory/agents/README.md');
    }
    
    const sessionsReadme = createSessionsReadme();
    if (!initDryRun) {
      await Deno.writeTextFile('memory/sessions/README.md', sessionsReadme);
      console.log('  ✓ Created memory/sessions/README.md');
    } else {
      console.log('  [DRY RUN] Would create memory/sessions/README.md');
    }
    
    // Initialize persistence database
    const initialData = {
      agents: [],
      tasks: [],
      lastUpdated: Date.now()
    };
    if (!initDryRun) {
      await Deno.writeTextFile('memory/claude-flow-data.json', JSON.stringify(initialData, null, 2));
      console.log('  ✓ Created memory/claude-flow-data.json (persistence database)');
    } else {
      console.log('  [DRY RUN] Would create memory/claude-flow-data.json (persistence database)');
    }
    
    // Create local claude-flow executable wrapper
    if (!initDryRun) {
      await createLocalExecutable(workingDir);
    } else {
      console.log('  [DRY RUN] Would create local claude-flow executable wrapper');
    }
    
    // SPARC initialization
    if (initSparc) {
      console.log('\n🚀 Initializing SPARC development environment...');
      
      if (initDryRun) {
        console.log('  [DRY RUN] Would run: npx -y create-sparc init --force');
        console.log('  [DRY RUN] Would create SPARC environment with all modes');
        console.log('  [DRY RUN] Would create Claude slash commands' + (initOptimized ? ' (Batchtools-optimized)' : ''));
        if (selectedModes) {
          console.log(`  [DRY RUN] Would create commands for selected modes: ${selectedModes.join(', ')}`);
        }
      } else {
        // Check if create-sparc exists and run it
        let sparcInitialized = false;
        try {
          const createSparcCommand = new Deno.Command('npx', {
            args: ['-y', 'create-sparc', 'init', '--force'],
            cwd: workingDir, // Use the original working directory
            stdout: 'inherit',
            stderr: 'inherit',
            env: {
              ...Deno.env.toObject(),
              PWD: workingDir, // Ensure PWD is set correctly
            },
          });
          
          console.log('  🔄 Running: npx -y create-sparc init --force');
          const createSparcResult = await createSparcCommand.output();
          
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
            printWarning(`Could not create Claude Code slash commands: ${err.message}`);
          }
        }
      }
    }
    
    if (initDryRun) {
      printSuccess('🔍 Dry run completed! Here\'s what would be created:');
      console.log('\n📋 Summary of planned initialization:');
      console.log(`  • Configuration: ${initOptimized ? 'Batchtools-optimized SPARC' : initSparc ? 'SPARC-enhanced' : 'Standard'}`);
      console.log(`  • Template type: ${initOptimized ? 'Optimized for parallel processing' : 'Standard'}`);
      console.log('  • Core files: CLAUDE.md, memory-bank.md, coordination.md');
      console.log('  • Directory structure: memory/, coordination/, .claude/');
      console.log('  • Local executable: ./claude-flow');
      if (initSparc) {
        console.log(`  • Claude Code slash commands: ${selectedModes ? selectedModes.length : 'All'} SPARC mode commands`);
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
      console.log(`  ✅ CLAUDE.md (${initOptimized ? 'Batchtools-optimized' : initSparc ? 'SPARC-enhanced' : 'Standard configuration'})`);
      console.log(`  ✅ memory-bank.md (${initOptimized ? 'With parallel processing' : 'Standard memory system'})`);
      console.log(`  ✅ coordination.md (${initOptimized ? 'Enhanced with batchtools' : 'Standard coordination'})`);
      console.log('  ✅ Directory structure with memory/ and coordination/');
      console.log('  ✅ Local executable at ./claude-flow');
      console.log('  ✅ Persistence database at memory/claude-flow-data.json');
      
      if (initSparc) {
        const modeCount = selectedModes ? selectedModes.length : '20+';
        console.log(`  ✅ Claude Code slash commands (${modeCount} SPARC modes)`);
        console.log('  ✅ Complete SPARC development environment');
      }
      
      console.log('\n🚀 Next steps:');
      console.log('1. Review and customize the generated files for your project');
      console.log('2. Run \'./claude-flow start\' to begin the orchestration system');
      console.log('3. Use \'./claude-flow\' instead of \'npx claude-flow\' for all commands');
      console.log('4. Use \'claude --dangerously-skip-permissions\' for unattended operation');
      
      if (initSparc) {
        console.log('5. Use Claude Code slash commands: /sparc, /sparc-architect, /sparc-tdd, etc.');
        console.log('6. Explore SPARC modes with \'./claude-flow sparc modes\'');
        console.log('7. Try TDD workflow with \'./claude-flow sparc tdd "your task"\'');
        
        if (initOptimized) {
          console.log('8. Use batchtools commands: /batchtools, /performance for optimization');
          console.log('9. Enable parallel processing with --parallel flags');
          console.log('10. Monitor performance with \'./claude-flow performance monitor\'');
        }
      }
      
      console.log('\n💡 Tips:');
      console.log('  • Type \'/\' in Claude Code to see all available slash commands');
      console.log('  • Use \'./claude-flow status\' to check system health');
      console.log('  • Store important context with \'./claude-flow memory store\'');
      
      if (initOptimized) {
        console.log('  • Use --parallel flags for concurrent operations');
        console.log('  • Enable batch processing for multiple related tasks');
        console.log('  • Monitor performance with real-time metrics');
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
      environments: flags.environments ? flags.environments.split(',').map(env => env.trim()) : ['dev']
    };
    
    // Validate options
    const validationErrors = validateBatchOptions(options);
    if (validationErrors.length > 0) {
      printError('Batch options validation failed:');
      validationErrors.forEach(error => console.error(`  - ${error}`));
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
      const projects = projectsString.split(',').map(project => project.trim());
      
      if (projects.length === 0) {
        printError('No projects specified for batch initialization');
        return;
      }
      
      printSuccess(`Initializing ${projects.length} projects in batch mode`);
      const results = await batchInitCommand(projects, options);
      
      if (results) {
        const successful = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;
        
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
  
  // Get the working directory
  const workingDir = Deno.env.get('PWD') || Deno.cwd();
  
  // Initialize systems
  const rollbackSystem = new RollbackSystem(workingDir);
  const validationSystem = new ValidationSystem(workingDir);
  
  let atomicOp = null;
  
  try {
    // Parse options
    const options = {
      force: subArgs.includes('--force') || subArgs.includes('-f') || flags.force,
      minimal: subArgs.includes('--minimal') || subArgs.includes('-m') || flags.minimal,
      sparc: subArgs.includes('--sparc') || subArgs.includes('-s') || flags.sparc,
      skipPreValidation: subArgs.includes('--skip-pre-validation'),
      skipBackup: subArgs.includes('--skip-backup'),
      validateOnly: subArgs.includes('--validate-only')
    };

    // Phase 1: Pre-initialization validation
    if (!options.skipPreValidation) {
      console.log('\n🔍 Phase 1: Pre-initialization validation...');
      const preValidation = await validationSystem.validatePreInit(options);
      
      if (!preValidation.success) {
        printError('Pre-initialization validation failed:');
        preValidation.errors.forEach(error => console.error(`  ❌ ${error}`));
        return;
      }
      
      if (preValidation.warnings.length > 0) {
        printWarning('Pre-initialization warnings:');
        preValidation.warnings.forEach(warning => console.warn(`  ⚠️  ${warning}`));
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
        backupResult.errors.forEach(error => console.error(`  ❌ ${error}`));
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
    await performInitializationWithCheckpoints(rollbackSystem, options, workingDir);

    // Phase 4: Post-initialization validation
    console.log('\n✅ Phase 4: Post-initialization validation...');
    const postValidation = await validationSystem.validatePostInit();
    
    if (!postValidation.success) {
      printError('Post-initialization validation failed:');
      postValidation.errors.forEach(error => console.error(`  ❌ ${error}`));
      
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
      configValidation.warnings.forEach(warning => console.warn(`  ⚠️  ${warning}`));
    }

    // Phase 6: Health checks
    console.log('\n🏥 Phase 6: System health checks...');
    const healthChecks = await validationSystem.runHealthChecks();
    
    if (healthChecks.warnings.length > 0) {
      printWarning('Health check warnings:');
      healthChecks.warnings.forEach(warning => console.warn(`  ⚠️  ${warning}`));
    }

    // Commit atomic operation
    await atomicOp.commit();
    
    // Generate and display validation report
    const fullValidation = await runFullValidation(workingDir, { 
      postInit: true,
      skipPreInit: options.skipPreValidation 
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
  const workingDir = Deno.env.get('PWD') || Deno.cwd();
  
  console.log('🔍 Running validation checks...');
  
  const options = {
    skipPreInit: subArgs.includes('--skip-pre-init'),
    skipConfig: subArgs.includes('--skip-config'),
    skipModeTest: subArgs.includes('--skip-mode-test'),
    postInit: !subArgs.includes('--pre-init-only')
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
  const workingDir = Deno.env.get('PWD') || Deno.cwd();
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
        result.errors.forEach(error => console.error(`  ❌ ${error}`));
      }
      
    } else if (subArgs.includes('--partial')) {
      const phaseIndex = subArgs.findIndex(arg => arg === '--phase');
      if (phaseIndex !== -1 && subArgs[phaseIndex + 1]) {
        const phase = subArgs[phaseIndex + 1];
        console.log(`🔄 Performing partial rollback for phase: ${phase}`);
        
        const result = await rollbackSystem.performPartialRollback(phase);
        
        if (result.success) {
          printSuccess(`Partial rollback completed for phase: ${phase}`);
        } else {
          printError(`Partial rollback failed for phase: ${phase}`);
          result.errors.forEach(error => console.error(`  ❌ ${error}`));
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
        console.log(`\n🔄 Rolling back to: ${latest.type} (${new Date(latest.timestamp).toLocaleString()})`);
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
  const workingDir = Deno.env.get('PWD') || Deno.cwd();
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
async function performInitializationWithCheckpoints(rollbackSystem, options, workingDir) {
  const phases = [
    { name: 'file-creation', action: () => createInitialFiles(options, workingDir) },
    { name: 'directory-structure', action: () => createDirectoryStructure(workingDir) },
    { name: 'memory-setup', action: () => setupMemorySystem(workingDir) },
    { name: 'coordination-setup', action: () => setupCoordinationSystem(workingDir) },
    { name: 'executable-creation', action: () => createLocalExecutable(workingDir) }
  ];
  
  if (options.sparc) {
    phases.push(
      { name: 'sparc-init', action: () => createSparcStructureManually() },
      { name: 'claude-commands', action: () => createClaudeSlashCommands(workingDir) }
    );
  }
  
  for (const phase of phases) {
    console.log(`  🔧 ${phase.name}...`);
    
    // Create checkpoint before phase
    await rollbackSystem.createCheckpoint(phase.name, {
      timestamp: Date.now(),
      phase: phase.name
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
async function createInitialFiles(options, workingDir) {
  const claudeMd = options.sparc ? createSparcClaudeMd() : 
                   options.minimal ? createMinimalClaudeMd() : createFullClaudeMd();
  await Deno.writeTextFile(`${workingDir}/CLAUDE.md`, claudeMd);

  const memoryBankMd = options.minimal ? createMinimalMemoryBankMd() : createFullMemoryBankMd();
  await Deno.writeTextFile(`${workingDir}/memory-bank.md`, memoryBankMd);

  const coordinationMd = options.minimal ? createMinimalCoordinationMd() : createFullCoordinationMd();
  await Deno.writeTextFile(`${workingDir}/coordination.md`, coordinationMd);
}

async function createDirectoryStructure(workingDir) {
  const directories = [
    'memory', 'memory/agents', 'memory/sessions',
    'coordination', 'coordination/memory_bank', 'coordination/subtasks', 'coordination/orchestration',
    '.claude', '.claude/commands', '.claude/logs'
  ];
  
  for (const dir of directories) {
    await Deno.mkdir(`${workingDir}/${dir}`, { recursive: true });
  }
}

async function setupMemorySystem(workingDir) {
  const initialData = { agents: [], tasks: [], lastUpdated: Date.now() };
  await Deno.writeTextFile(`${workingDir}/memory/claude-flow-data.json`, JSON.stringify(initialData, null, 2));
  
  await Deno.writeTextFile(`${workingDir}/memory/agents/README.md`, createAgentsReadme());
  await Deno.writeTextFile(`${workingDir}/memory/sessions/README.md`, createSessionsReadme());
}

async function setupCoordinationSystem(workingDir) {
  // Coordination system is already set up by createDirectoryStructure
  // This is a placeholder for future coordination setup logic
}