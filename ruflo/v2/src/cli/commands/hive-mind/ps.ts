#!/usr/bin/env node
/**
 * Hive Mind PS (Process Status) Command
 *
 * Show active sessions and their processes
 */

import { Command } from '../commander-fix.js';
import chalk from 'chalk';
import { HiveMindSessionManager } from '../../simple-commands/hive-mind/session-manager.js';
import Table from 'cli-table3';

export const psCommand = new Command('ps')
  .description('Show active hive mind sessions and processes')
  .option('-a, --all', 'Show all sessions including stopped ones')
  .option('-v, --verbose', 'Show detailed process information')
  .action(async (options) => {
    const sessionManager = new HiveMindSessionManager();

    try {
      const sessions = options.all
        ? sessionManager.getActiveSessionsWithProcessInfo()
        : sessionManager
            .getActiveSessionsWithProcessInfo()
            .filter((s: any) => s.status === 'active' || s.status === 'paused');

      if (sessions.length === 0) {
        console.log(chalk.yellow('No sessions found'));
        return;
      }

      // Clean up orphaned processes first
      const cleanedCount = sessionManager.cleanupOrphanedProcesses();
      if (cleanedCount > 0) {
        console.log(chalk.blue(`Cleaned up ${cleanedCount} orphaned session(s)\n`));
      }

      // Create table
      const table = new Table({
        head: [
          chalk.cyan('Session ID'),
          chalk.cyan('Swarm'),
          chalk.cyan('Status'),
          chalk.cyan('Parent PID'),
          chalk.cyan('Child PIDs'),
          chalk.cyan('Progress'),
          chalk.cyan('Duration'),
        ],
        style: {
          head: [],
          border: ['gray'],
        },
      });

      for (const session of sessions) {
        const duration = new Date().getTime() - new Date(session.created_at).getTime();
        const durationStr = formatDuration(duration);

        const statusColor =
          session.status === 'active'
            ? chalk.green
            : session.status === 'paused'
              ? chalk.yellow
              : session.status === 'stopped'
                ? chalk.red
                : chalk.gray;

        table.push([
          session.id.substring(0, 20) + '...',
          session.swarm_name,
          statusColor(session.status),
          session.parent_pid || '-',
          session.child_pids.length > 0 ? session.child_pids.join(', ') : '-',
          `${session.completion_percentage}%`,
          durationStr,
        ]);
      }

      console.log(table.toString());

      if (options.verbose) {
        console.log('\n' + chalk.bold('Detailed Session Information:'));

        for (const session of sessions) {
          console.log('\n' + chalk.cyan(`Session: ${session.id}`));
          console.log(chalk.gray(`  Objective: ${session.objective || 'N/A'}`));
          console.log(chalk.gray(`  Created: ${new Date(session.created_at).toLocaleString()}`));
          console.log(chalk.gray(`  Updated: ${new Date(session.updated_at).toLocaleString()}`));

          if (session.paused_at) {
            console.log(chalk.gray(`  Paused: ${new Date(session.paused_at).toLocaleString()}`));
          }

          console.log(chalk.gray(`  Agents: ${session.agent_count || 0}`));
          console.log(
            chalk.gray(
              `  Tasks: ${session.task_count || 0} (${session.completed_tasks || 0} completed)`,
            ),
          );

          if (session.child_pids.length > 0) {
            console.log(chalk.gray(`  Active Processes:`));
            for (const pid of session.child_pids) {
              console.log(chalk.gray(`    - PID ${pid}`));
            }
          }
        }
      }

      // Summary
      const activeSessions = sessions.filter((s: any) => s.status === 'active').length;
      const pausedSessions = sessions.filter((s: any) => s.status === 'paused').length;
      const totalProcesses = sessions.reduce((sum: any, s: any) => sum + s.total_processes, 0);

      console.log('\n' + chalk.bold('Summary:'));
      console.log(chalk.gray(`  Active sessions: ${activeSessions}`));
      console.log(chalk.gray(`  Paused sessions: ${pausedSessions}`));
      console.log(chalk.gray(`  Total processes: ${totalProcesses}`));
    } catch (error) {
      console.error(chalk.red('Error listing sessions:'), (error as Error).message);
      process.exit(1);
    } finally {
      sessionManager.close();
    }
  });

function formatDuration(ms: number) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}
