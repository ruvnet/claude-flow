#!/usr/bin/env node
/**
 * Checkpoint Management Commands
 * Uses SDK checkpoint manager for Git-like checkpointing
 */

import { Command } from './commander-fix.js';
import chalk from 'chalk';
import { checkpointManager } from '../../sdk/checkpoint-manager.js';
import Table from 'cli-table3';
import inquirer from 'inquirer';

export const checkpointCommand = new Command()
  .name('checkpoint')
  .description('Manage session checkpoints (Git-like time travel for AI sessions)')
  .action(() => {
    checkpointCommand.help();
  });

// Create checkpoint
checkpointCommand
  .command('create')
  .description('Create a checkpoint for a session')
  .argument('<session-id>', 'Session ID to checkpoint')
  .argument('[description]', 'Checkpoint description')
  .action(async (sessionId: string, description?: string) => {
    try {
      console.log(chalk.cyan(`Creating checkpoint for session: ${sessionId}`));

      const checkpointId = await checkpointManager.createCheckpoint(
        sessionId,
        description || `Manual checkpoint at ${new Date().toLocaleString()}`
      );

      console.log(chalk.green('✓ Checkpoint created'));
      console.log(`${chalk.white('ID:')} ${checkpointId}`);
      console.log(`${chalk.white('Session:')} ${sessionId}`);
      console.log(`${chalk.white('Description:')} ${description || '(auto-generated)'}`);
      console.log(chalk.gray(`  Use 'claude-flow checkpoint rollback ${checkpointId}' to restore`));
    } catch (error) {
      console.error(chalk.red('Failed to create checkpoint:'), (error as Error).message);
      process.exit(1);
    }
  });

// List checkpoints
checkpointCommand
  .command('list')
  .description('List checkpoints for a session')
  .argument('<session-id>', 'Session ID')
  .option('--format <format>', 'Output format (table, json)', 'table')
  .action(async (sessionId: string, options: any) => {
    try {
      const checkpoints = checkpointManager.listCheckpoints(sessionId);

      if (checkpoints.length === 0) {
        console.log(chalk.gray(`No checkpoints found for session: ${sessionId}`));
        return;
      }

      if (options.format === 'json') {
        console.log(JSON.stringify(checkpoints, null, 2));
        return;
      }

      console.log(chalk.cyan.bold(`Checkpoints for ${sessionId} (${checkpoints.length})`));
      console.log('─'.repeat(80));

      const table = new Table({
        head: ['ID', 'Description', 'Messages', 'Tokens', 'Files', 'Created'],
      });

      for (const cp of checkpoints) {
        table.push([
          chalk.gray(cp.id.substring(0, 8) + '...'),
          cp.description.substring(0, 30) + (cp.description.length > 30 ? '...' : ''),
          cp.messageCount.toString(),
          cp.totalTokens.toString(),
          cp.filesModified.length.toString(),
          new Date(cp.timestamp).toLocaleString(),
        ]);
      }

      console.log(table.toString());
    } catch (error) {
      console.error(chalk.red('Failed to list checkpoints:'), (error as Error).message);
      process.exit(1);
    }
  });

// Get checkpoint info
checkpointCommand
  .command('info')
  .description('Show detailed checkpoint information')
  .argument('<checkpoint-id>', 'Checkpoint ID')
  .action(async (checkpointId: string) => {
    try {
      const checkpoint = checkpointManager.getCheckpoint(checkpointId);

      if (!checkpoint) {
        console.error(chalk.red(`Checkpoint '${checkpointId}' not found`));
        process.exit(1);
      }

      console.log(chalk.cyan.bold('Checkpoint Information'));
      console.log('─'.repeat(50));
      console.log(`${chalk.white('ID:')} ${checkpoint.id}`);
      console.log(`${chalk.white('Session:')} ${checkpoint.sessionId}`);
      console.log(`${chalk.white('Description:')} ${checkpoint.description}`);
      console.log(`${chalk.white('Created:')} ${new Date(checkpoint.timestamp).toLocaleString()}`);
      console.log();

      console.log(chalk.cyan.bold('Statistics'));
      console.log('─'.repeat(50));
      console.log(`${chalk.white('Messages:')} ${checkpoint.messageCount}`);
      console.log(`${chalk.white('Total Tokens:')} ${checkpoint.totalTokens}`);
      console.log(`${chalk.white('Files Modified:')} ${checkpoint.filesModified.length}`);

      if (checkpoint.filesModified.length > 0) {
        console.log();
        console.log(chalk.cyan.bold('Modified Files'));
        console.log('─'.repeat(50));
        for (const file of checkpoint.filesModified) {
          console.log(`  • ${file}`);
        }
      }
    } catch (error) {
      console.error(chalk.red('Failed to show checkpoint info:'), (error as Error).message);
      process.exit(1);
    }
  });

// Rollback to checkpoint
checkpointCommand
  .command('rollback')
  .description('Rollback session to a checkpoint (Git-like time travel)')
  .argument('<checkpoint-id>', 'Checkpoint ID to restore')
  .option('-p, --prompt <prompt>', 'Continue prompt after rollback')
  .option('-f, --force', 'Skip confirmation')
  .action(async (checkpointId: string, options: any) => {
    try {
      const checkpoint = checkpointManager.getCheckpoint(checkpointId);

      if (!checkpoint) {
        console.error(chalk.red(`Checkpoint '${checkpointId}' not found`));
        process.exit(1);
      }

      console.log(chalk.cyan.bold('Checkpoint to restore:'));
      console.log(`${chalk.white('Description:')} ${checkpoint.description}`);
      console.log(`${chalk.white('Created:')} ${new Date(checkpoint.timestamp).toLocaleString()}`);
      console.log(`${chalk.white('Messages:')} ${checkpoint.messageCount}`);
      console.log(`${chalk.white('Files:')} ${checkpoint.filesModified.length}`);

      if (!options.force) {
        const { confirmed } = await inquirer.prompt({
          type: 'confirm',
          name: 'confirmed',
          message: 'Rollback to this checkpoint? (Current progress will be lost)',
          default: false,
        });

        if (!confirmed) {
          console.log(chalk.gray('Rollback cancelled'));
          return;
        }
      }

      console.log(chalk.yellow('Rolling back...'));
      console.log(chalk.blue('  • Using SDK resumeSessionAt to rewind'));

      await checkpointManager.rollbackToCheckpoint(
        checkpointId,
        options.prompt || 'Continue from checkpoint'
      );

      console.log(chalk.green('✓ Rolled back to checkpoint successfully'));
      console.log(chalk.gray('  Session rewound to exact point using SDK'));
    } catch (error) {
      console.error(chalk.red('Failed to rollback:'), (error as Error).message);
      process.exit(1);
    }
  });

// Delete checkpoint
checkpointCommand
  .command('delete')
  .description('Delete a checkpoint')
  .argument('<checkpoint-id>', 'Checkpoint ID')
  .option('-f, --force', 'Skip confirmation')
  .action(async (checkpointId: string, options: any) => {
    try {
      const checkpoint = checkpointManager.getCheckpoint(checkpointId);

      if (!checkpoint) {
        console.error(chalk.red(`Checkpoint '${checkpointId}' not found`));
        process.exit(1);
      }

      if (!options.force) {
        const { confirmed } = await inquirer.prompt({
          type: 'confirm',
          name: 'confirmed',
          message: `Delete checkpoint '${checkpoint.description}'?`,
          default: false,
        });

        if (!confirmed) {
          console.log(chalk.gray('Delete cancelled'));
          return;
        }
      }

      await checkpointManager.deleteCheckpoint(checkpointId);
      console.log(chalk.green('✓ Checkpoint deleted'));
    } catch (error) {
      console.error(chalk.red('Failed to delete checkpoint:'), (error as Error).message);
      process.exit(1);
    }
  });
