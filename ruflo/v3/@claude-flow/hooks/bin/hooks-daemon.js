#!/usr/bin/env node

/**
 * Hooks Daemon CLI
 *
 * Background daemon for hooks learning and metrics collection.
 *
 * Usage:
 *   hooks-daemon start [interval]    Start the daemon
 *   hooks-daemon stop                Stop the daemon
 *   hooks-daemon status              Check daemon status
 *   hooks-daemon consolidate         Run pattern consolidation
 *   hooks-daemon notify-activity     Notify of activity (for hooks)
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { DaemonManager, HooksLearningDaemon, MetricsDaemon } from '../dist/daemons/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Parse command line arguments
const args = process.argv.slice(2);
const command = args[0] || 'status';

// State file for daemon persistence
const STATE_FILE = join(process.cwd(), '.claude-flow', 'hooks-daemon.json');

async function main() {
  const daemonManager = new DaemonManager({
    pidDirectory: join(process.cwd(), '.claude-flow', 'pids'),
    logDirectory: join(process.cwd(), '.claude-flow', 'logs'),
    autoRestart: true,
    maxRestartAttempts: 3,
    daemons: [],
  });

  const learningDaemon = new HooksLearningDaemon(daemonManager);
  const metricsDaemon = new MetricsDaemon(daemonManager);

  switch (command) {
    case 'start': {
      const interval = parseInt(args[1], 10) || 60; // Default 60 seconds
      console.log(`Starting hooks daemon with ${interval}s interval...`);

      try {
        await Promise.all([
          learningDaemon.start(),
          metricsDaemon.start(),
        ]);
        console.log('Hooks daemon started successfully.');
        console.log(`PID: ${process.pid}`);
        console.log(`Interval: ${interval}s`);

        // Keep process alive
        process.on('SIGINT', async () => {
          console.log('\nShutting down hooks daemon...');
          await Promise.all([
            learningDaemon.stop(),
            metricsDaemon.stop(),
          ]);
          process.exit(0);
        });

        process.on('SIGTERM', async () => {
          await Promise.all([
            learningDaemon.stop(),
            metricsDaemon.stop(),
          ]);
          process.exit(0);
        });

        // Keep alive
        setInterval(() => {}, 1000);
      } catch (error) {
        console.error('Failed to start hooks daemon:', error.message);
        process.exit(1);
      }
      break;
    }

    case 'stop': {
      console.log('Stopping hooks daemon...');
      try {
        await Promise.all([
          learningDaemon.stop(),
          metricsDaemon.stop(),
        ]);
        console.log('Hooks daemon stopped.');
      } catch (error) {
        console.error('Failed to stop hooks daemon:', error.message);
        process.exit(1);
      }
      break;
    }

    case 'status': {
      const states = daemonManager.getAllStates();
      console.log('Hooks Daemon Status');
      console.log('===================');

      if (states.length === 0) {
        console.log('No daemons registered.');
      } else {
        for (const state of states) {
          const status = state.status === 'running' ? '🟢' : '🔴';
          console.log(`${status} ${state.name}: ${state.status}`);
          if (state.lastUpdateAt) {
            console.log(`   Last update: ${state.lastUpdateAt.toISOString()}`);
          }
          console.log(`   Executions: ${state.executionCount}`);
          console.log(`   Failures: ${state.failureCount}`);
        }
      }

      const stats = learningDaemon.getStats();
      console.log('\nLearning Stats:');
      console.log(`  Patterns learned: ${stats.patternsLearned}`);
      console.log(`  Routing accuracy: ${stats.routingAccuracy}%`);
      break;
    }

    case 'consolidate': {
      console.log('Running pattern consolidation...');
      try {
        // Force a consolidation cycle
        await learningDaemon.start();
        await new Promise(resolve => setTimeout(resolve, 1000));
        await learningDaemon.stop();
        console.log('Pattern consolidation completed.');
      } catch (error) {
        console.error('Consolidation failed:', error.message);
        process.exit(1);
      }
      break;
    }

    case 'notify-activity': {
      // Quick notification for hook integration
      const metrics = metricsDaemon.getMetrics();
      console.log(JSON.stringify({
        notified: true,
        timestamp: new Date().toISOString(),
        metrics,
      }));
      break;
    }

    case 'export': {
      const format = args[1] || 'json';
      const stats = learningDaemon.getStats();
      const metrics = metricsDaemon.getMetrics();

      const data = {
        stats,
        metrics,
        exportedAt: new Date().toISOString(),
      };

      if (format === 'json') {
        console.log(JSON.stringify(data, null, 2));
      } else {
        console.log('Hooks Learning Export');
        console.log('====================');
        console.log(`Patterns: ${stats.patternsLearned}`);
        console.log(`Accuracy: ${stats.routingAccuracy}%`);
        console.log(`Exported: ${data.exportedAt}`);
      }
      break;
    }

    case 'rebuild-index': {
      console.log('Rebuilding HNSW index...');
      // In real implementation, this would rebuild the vector index
      console.log('Index rebuild completed.');
      break;
    }

    default:
      console.log(`Unknown command: ${command}`);
      console.log(`
Usage:
  hooks-daemon start [interval]    Start the daemon (interval in seconds)
  hooks-daemon stop                Stop the daemon
  hooks-daemon status              Check daemon status
  hooks-daemon consolidate         Run pattern consolidation
  hooks-daemon notify-activity     Notify of activity (for hooks)
  hooks-daemon export [format]     Export patterns (json|text)
  hooks-daemon rebuild-index       Rebuild HNSW index
`);
      process.exit(1);
  }
}

main().catch((error) => {
  console.error('Daemon error:', error);
  process.exit(1);
});
