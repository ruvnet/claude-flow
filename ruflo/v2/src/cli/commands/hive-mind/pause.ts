#!/usr/bin/env node
/**
 * Hive Mind Pause Command
 *
 * Pause active swarm sessions
 */

import { Command } from '../commander-fix.js';
import chalk from 'chalk';
import { HiveMindSessionManager } from '../../simple-commands/hive-mind/session-manager.js';
import inquirer from 'inquirer';

export const pauseCommand = new Command('pause')
  .description('Pause active hive mind sessions')
  .option('-s, --session <id>', 'Pause specific session by ID')
  .action(async (options) => {
    const sessionManager = new HiveMindSessionManager();

    try {
      if (options.session) {
        // Pause specific session
        const sessionId = options.session;
        const session = await sessionManager.getSession(sessionId);

        if (!session) {
          console.log(chalk.red(`Session ${sessionId} not found`));
          return;
        }

        if ((session as any).status === 'paused') {
          console.log(chalk.yellow(`Session ${sessionId} is already paused`));
          return;
        }

        if ((session as any).status !== 'active') {
          console.log(
            chalk.yellow(`Session ${sessionId} is not active (status: ${(session as any).status})`),
          );
          return;
        }

        console.log(chalk.cyan(`Pausing session ${sessionId}...`));
        const result = await sessionManager.pauseSession(sessionId);

        if (result) {
          console.log(chalk.green(`✓ Session ${sessionId} paused successfully`));
          console.log(chalk.gray(`Use 'claude-flow hive-mind resume -s ${sessionId}' to resume`));
        } else {
          console.log(chalk.red(`Failed to pause session ${sessionId}`));
        }
      } else {
        // Interactive selection
        const sessions = await sessionManager.getActiveSessions();
        const activeSessions = sessions.filter((s: any) => s.status === 'active');

        if (activeSessions.length === 0) {
          console.log(chalk.yellow('No active sessions found to pause'));
          return;
        }

        const { sessionId } = await inquirer.prompt([
          {
            type: 'list',
            name: 'sessionId',
            message: 'Select session to pause:',
            choices: activeSessions.map((s: any) => ({
              name: `${s.swarm_name} (${s.id}) - ${s.completion_percentage}% complete`,
              value: s.id,
            })),
          },
        ]);

        console.log(chalk.cyan(`Pausing session ${sessionId}...`));
        const result = await sessionManager.pauseSession(sessionId);

        if (result) {
          console.log(chalk.green(`✓ Session paused successfully`));
          console.log(chalk.gray(`Use 'claude-flow hive-mind resume -s ${sessionId}' to resume`));
        } else {
          console.log(chalk.red(`Failed to pause session`));
        }
      }
    } catch (error) {
      console.error(chalk.red('Error pausing session:'), (error as Error).message);
      process.exit(1);
    } finally {
      sessionManager.close();
    }
  });
