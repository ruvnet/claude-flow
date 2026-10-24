#!/usr/bin/env node
/**
 * Hive Mind Resume Command
 *
 * Resume paused swarm sessions
 */

import { Command } from '../commander-fix.js';
import chalk from 'chalk';
import { HiveMindSessionManager } from '../../simple-commands/hive-mind/session-manager.js';
import inquirer from 'inquirer';

export const resumeCommand = new Command('resume')
  .description('Resume paused hive mind sessions')
  .option('-s, --session <id>', 'Resume specific session by ID')
  .action(async (options) => {
    const sessionManager = new HiveMindSessionManager();

    try {
      if (options.session) {
        // Resume specific session
        const sessionId = options.session;

        console.log(chalk.cyan(`Resuming session ${sessionId}...`));
        const session = await sessionManager.resumeSession(sessionId);

        console.log(chalk.green(`✓ Session ${sessionId} resumed successfully`));
        console.log(chalk.gray(`Swarm: ${(session as any).swarm_name || 'N/A'}`));
        console.log(chalk.gray(`Objective: ${(session as any).objective || 'N/A'}`));
        console.log(chalk.gray(`Progress: ${session.statistics.completionPercentage}%`));
      } else {
        // Interactive selection
        const sessions = await sessionManager.getActiveSessions();
        const pausedSessions = sessions.filter((s: any) => s.status === 'paused');

        if (pausedSessions.length === 0) {
          console.log(chalk.yellow('No paused sessions found to resume'));
          return;
        }

        const { sessionId } = await inquirer.prompt([
          {
            type: 'list',
            name: 'sessionId',
            message: 'Select session to resume:',
            choices: pausedSessions.map((s: any) => ({
              name: `${s.swarm_name} (${s.id}) - ${s.completion_percentage}% complete`,
              value: s.id,
            })),
          },
        ]);

        console.log(chalk.cyan(`Resuming session ${sessionId}...`));
        const session = await sessionManager.resumeSession(sessionId);

        console.log(chalk.green(`✓ Session resumed successfully`));
        console.log(chalk.gray(`Swarm: ${(session as any).swarm_name || 'N/A'}`));
        console.log(chalk.gray(`Objective: ${(session as any).objective || 'N/A'}`));
        console.log(chalk.gray(`Progress: ${session.statistics.completionPercentage}%`));
      }
    } catch (error) {
      console.error(chalk.red('Error resuming session:'), (error as Error).message);
      process.exit(1);
    } finally {
      sessionManager.close();
    }
  });
