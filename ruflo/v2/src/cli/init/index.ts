// init/index.ts - Main init command orchestrator
import { printSuccess, printError } from '../utils.js';
import { createDirectoryStructure } from './directory-structure.js';
import { createSwarmCommands } from './swarm-commands.js';
import { createSparcEnvironment } from './sparc-environment.js';
import { createClaudeConfig } from './claude-config.js';
import { createBatchToolsGuide } from './batch-tools.js';
import { errorRecovery } from '../../utils/error-recovery.js';

export interface InitOptions {
  sparc?: boolean;
  force?: boolean;
}

export async function initCommand(options: InitOptions = {}) {
  // Wrap entire initialization in retry logic with automatic recovery
  return errorRecovery.retryWithRecovery(
    async () => {
      try {
        const fs = await import('fs/promises');
        const path = await import('path');

        printSuccess('Initializing Claude-Flow project...');

        // Check WSL environment and apply fixes proactively
        if (errorRecovery.isWSL()) {
          console.log('🔍 WSL environment detected');
          const wslCheck = await errorRecovery.recoverWSLErrors();
          if (wslCheck.recovered) {
            console.log('✅ WSL environment optimized\n');
          }
        }

        // Phase 1: Create directory structure
        console.log('\n📁 Phase 1: Creating directory structure...');
        await createDirectoryStructure();

        // Phase 2: Create base configuration
        console.log('\n⚙️  Phase 2: Creating configuration...');
        await createClaudeConfig(options);

        // Phase 3: Create swarm commands and documentation
        console.log('\n🤖 Phase 3: Creating swarm commands...');
        await createSwarmCommands();

        // Phase 4: Create batch tools guides
        console.log('\n🔧 Phase 4: Creating batch tools guides...');
        await createBatchToolsGuide();

        // Phase 5: SPARC environment (if requested)
        if (options.sparc) {
          console.log('\n🚀 Phase 5: Creating SPARC environment...');
          await createSparcEnvironment();
        }

        // Success summary
        console.log('\n🎉 Project initialized successfully!');
        console.log('   📁 Created .claude/ directory structure');
        console.log('   📋 Created comprehensive swarm command documentation');
        console.log('   🔧 Created batch tools coordination guides');
        console.log('   📖 Created detailed usage examples with orchestration');

        console.log('\n   Next steps:');
        console.log('   1. Run "claude-flow swarm --help" to see swarm options');
        console.log('   2. Check .claude/commands/swarm/ for detailed documentation');
        console.log('   3. Review batch tools guide for orchestration patterns');
        console.log('   4. Run "claude-flow help" for all available commands');

        if (options.sparc) {
          console.log('   5. Run "claude-flow sparc modes" to see available SPARC modes');
          console.log('   6. Use TodoWrite/TodoRead for task coordination');
          console.log('   7. Use Task tool for parallel agent execution');
        }
      } catch (error) {
        // Attempt automatic error recovery
        const recovery = await errorRecovery.recoverInitErrors(error);

        if (recovery.recovered) {
          console.log('✅ Recovered from error, retrying initialization...\n');
          throw error; // Trigger retry
        } else {
          printError(
            `Failed to initialize project: ${error instanceof Error ? error.message : String(error)}`,
          );
          throw error;
        }
      }
    },
    {
      maxRetries: options.force ? 5 : 3,
      delay: 1000,
      onRetry: (attempt, error) => {
        console.log(`\n🔄 Retry attempt ${attempt} after error recovery...`);
      }
    }
  );
}
