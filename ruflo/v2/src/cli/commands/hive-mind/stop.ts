#!/usr/bin/env node
/**
 * Hive Mind Stop Command
 *
 * Stop active swarm sessions and terminate child processes
 */

import { Command } from '../commander-fix.js';
import chalk from 'chalk';
import { HiveMindSessionManager } from '../../simple-commands/hive-mind/session-manager.js';
import inquirer from 'inquirer';

export const stopCommand = new Command('stop')
  .description('Stop active hive mind sessions')
  .option('-s, --session <id>', 'Stop specific session by ID')
  .option('-a, --all', 'Stop all active sessions')
  .option('-f, --force', 'Force stop without confirmation')
  .action(async (options) => {
    const sessionManager = new HiveMindSessionManager();

    try {
      if (options.all) {
        // Stop all active sessions
        const sessions = await sessionManager.getActiveSessionsWithProcessInfo();

        if (sessions.length === 0) {
          console.log(chalk.yellow('No active sessions found'));
          return;
        }

        if (!options.force) {
          const { confirm } = await inquirer.prompt([
            {
              type: 'confirm',
              name: 'confirm',
              message: `Stop all ${sessions.length} active session(s)?`,
              default: false,
            },
          ]);

          if (!confirm) {
            console.log(chalk.gray('Operation cancelled'));
            return;
          }
        }

        for (const session of sessions) {
          console.log(chalk.cyan(`Stopping session ${session.id}...`));
          await sessionManager.stopSession(session.id);
          console.log(chalk.green(`✓ Session ${session.id} stopped`));
        }

        console.log(chalk.green(`\n✅ All sessions stopped successfully`));
      } else if (options.session) {
        // Stop specific session
        const sessionId = options.session;
        const session = await sessionManager.getSession(sessionId);

        if (!session) {
          console.log(chalk.red(`Session ${sessionId} not found`));
          return;
        }

        if ((session as any).status === 'stopped') {
          console.log(chalk.yellow(`Session ${sessionId} is already stopped`));
          return;
        }

        if (!options.force) {
          const { confirm } = await inquirer.prompt([
            {
              type: 'confirm',
              name: 'confirm',
              message: `Stop session ${sessionId} (${(session as any).swarm_name || 'Unknown'})?`,
              default: false,
            },
          ]);

          if (!confirm) {
            console.log(chalk.gray('Operation cancelled'));
            return;
          }
        }

        console.log(chalk.cyan(`Stopping session ${sessionId}...`));
        await sessionManager.stopSession(sessionId);
        console.log(chalk.green(`✓ Session ${sessionId} stopped successfully`));
      } else {
        // Interactive selection
        const sessions = await sessionManager.getActiveSessionsWithProcessInfo();

        if (sessions.length === 0) {
          console.log(chalk.yellow('No active sessions found'));
          return;
        }

        const { sessionId } = await inquirer.prompt([
          {
            type: 'list',
            name: 'sessionId',
            message: 'Select session to stop:',
            choices: sessions.map((s: any) => ({
              name: `${s.swarm_name} (${s.id}) - ${s.total_processes} process(es)`,
              value: s.id,
            })),
          },
        ]);

        const { confirm } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'confirm',
            message: 'Stop this session?',
            default: false,
          },
        ]);

        if (!confirm) {
          console.log(chalk.gray('Operation cancelled'));
          return;
        }

        console.log(chalk.cyan(`Stopping session ${sessionId}...`));
        await sessionManager.stopSession(sessionId);
        console.log(chalk.green(`✓ Session stopped successfully`));
      }

      // Clean up orphaned processes
      const cleanedCount = sessionManager.cleanupOrphanedProcesses();
      if (cleanedCount > 0) {
        console.log(chalk.blue(`\nCleaned up ${cleanedCount} orphaned session(s)`));
      }
    } catch (error) {
      console.error(chalk.red('Error stopping session:'), (error as Error).message);
      process.exit(1);
    } finally {
      sessionManager.close();
    }
  });
