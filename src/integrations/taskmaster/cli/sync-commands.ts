/**
 * VS Code Extension Sync Commands for TaskMaster CLI
 */

import { Command } from '@cliffy/command';
import { colors } from '@cliffy/ansi/colors';
import { Table } from '@cliffy/table';
import { VSCodeSyncService, SyncServiceConfig } from '../services/vscode-sync-service.ts';
import { logger } from '../../../core/logger.ts';
import { formatError } from '../../../cli/formatter.ts';

let syncService: VSCodeSyncService | null = null;

/**
 * Main sync command
 */
export const syncCommand = new Command()
  .name('sync')
  .description('Manage VS Code extension synchronization')
  .action(() => {
    console.log(colors.blue('TaskMaster VS Code Extension Sync'));
    console.log('\nAvailable commands:');
    console.log('  start    - Start sync service');
    console.log('  stop     - Stop sync service');
    console.log('  status   - Show sync status');
    console.log('  trigger  - Trigger manual sync');
    console.log('  config   - Configure sync settings');
    console.log('\nUse "claude-flow taskmaster sync <command> --help" for more information');
  });

/**
 * Start sync service
 */
syncCommand
  .command('start')
  .description('Start VS Code extension sync service')
  .option('-p, --port <port:number>', 'WebSocket/HTTP port', { default: 8765 })
  .option('-h, --host <host:string>', 'Host to bind to', { default: 'localhost' })
  .option('--no-websocket', 'Disable WebSocket server')
  .option('--no-http', 'Disable HTTP server')
  .option('-i, --interval <ms:number>', 'Auto-sync interval in milliseconds', { default: 5000 })
  .option('-s, --strategy <strategy:string>', 'Conflict resolution strategy', {
    default: 'newest_wins',
    enum: ['cli_wins', 'vscode_wins', 'newest_wins', 'manual']
  })
  .option('-t, --token <token:string>', 'Authentication token')
  .action(async (options) => {
    try {
      if (syncService) {
        console.log(colors.yellow('Sync service is already running'));
        return;
      }

      const config: Partial<SyncServiceConfig> = {
        port: options.port,
        host: options.host,
        enableWebSocket: options.websocket !== false,
        enableHttp: options.http !== false,
        syncInterval: options.interval,
        conflictResolutionStrategy: options.strategy as any,
        authToken: options.token
      };

      console.log(colors.blue('Starting VS Code sync service...'));
      
      syncService = new VSCodeSyncService(config);
      
      // Set up event listeners
      setupSyncEventListeners(syncService);
      
      await syncService.start();
      
      console.log(colors.green('✓ Sync service started successfully'));
      console.log(`\nService details:`);
      console.log(`  WebSocket: ${config.enableWebSocket ? `ws://${config.host}:${config.port}` : 'disabled'}`);
      console.log(`  HTTP API:  ${config.enableHttp ? `http://${config.host}:${config.port}` : 'disabled'}`);
      console.log(`  Strategy:  ${config.conflictResolutionStrategy}`);
      console.log(`  Interval:  ${config.syncInterval}ms`);
      
      if (config.enableWebSocket) {
        console.log('\nVS Code extension can now connect to the sync service');
      }
      
    } catch (error) {
      console.error(colors.red('Failed to start sync service:'), formatError(error));
      process.exit(1);
    }
  });

/**
 * Stop sync service
 */
syncCommand
  .command('stop')
  .description('Stop VS Code extension sync service')
  .action(async () => {
    try {
      if (!syncService) {
        console.log(colors.yellow('Sync service is not running'));
        return;
      }

      console.log(colors.blue('Stopping sync service...'));
      await syncService.stop();
      syncService = null;
      
      console.log(colors.green('✓ Sync service stopped'));
      
    } catch (error) {
      console.error(colors.red('Failed to stop sync service:'), formatError(error));
    }
  });

/**
 * Show sync status
 */
syncCommand
  .command('status')
  .description('Show VS Code extension sync status')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    try {
      if (!syncService) {
        if (options.json) {
          console.log(JSON.stringify({ running: false }));
        } else {
          console.log(colors.yellow('Sync service is not running'));
        }
        return;
      }

      const status = syncService.getSyncStatus();
      
      if (options.json) {
        console.log(JSON.stringify(status, null, 2));
        return;
      }

      console.log(colors.blue('VS Code Extension Sync Status'));
      console.log(colors.gray('─'.repeat(40)));
      
      // Connection status
      console.log(`\n${colors.bold('Connection:')}`);
      console.log(`  Status:         ${status.isConnected ? colors.green('Connected') : colors.red('Disconnected')}`);
      console.log(`  Clients:        ${status.clientCount}`);
      console.log(`  Last Sync:      ${status.lastSync ? new Date(status.lastSync).toLocaleString() : 'Never'}`);
      console.log(`  Sync Version:   ${status.syncVersion}`);
      
      // Sync state
      console.log(`\n${colors.bold('Sync State:')}`);
      console.log(`  Active Sync:    ${status.activeSync ? colors.yellow('In Progress') : colors.gray('Idle')}`);
      console.log(`  Pending:        ${status.pendingChanges.size} changes`);
      console.log(`  Conflicts:      ${status.conflicts.size} unresolved`);
      
      // Show pending changes if any
      if (status.pendingChanges.size > 0) {
        console.log(`\n${colors.bold('Pending Changes:')}`);
        const pendingTable = new Table()
          .header(['Task ID', 'Operation', 'Retries', 'Age'])
          .body(
            Array.from(status.pendingChanges.values()).slice(0, 10).map(change => [
              change.taskId,
              change.operation,
              change.retryCount.toString(),
              formatAge(Date.now() - change.timestamp)
            ])
          );
        pendingTable.render();
        
        if (status.pendingChanges.size > 10) {
          console.log(colors.gray(`  ... and ${status.pendingChanges.size - 10} more`));
        }
      }
      
      // Show conflicts if any
      if (status.conflicts.size > 0) {
        console.log(`\n${colors.bold('Active Conflicts:')}`);
        const conflictTable = new Table()
          .header(['Task ID', 'Field', 'Source'])
          .body(
            Array.from(status.conflicts.values()).slice(0, 5).map(conflict => [
              conflict.taskId,
              conflict.field,
              conflict.source
            ])
          );
        conflictTable.render();
        
        if (status.conflicts.size > 5) {
          console.log(colors.gray(`  ... and ${status.conflicts.size - 5} more`));
        }
      }
      
    } catch (error) {
      console.error(colors.red('Failed to get sync status:'), formatError(error));
    }
  });

/**
 * Trigger manual sync
 */
syncCommand
  .command('trigger')
  .description('Trigger manual synchronization with VS Code extension')
  .option('--force', 'Force sync even if one is in progress')
  .action(async (options) => {
    try {
      if (!syncService) {
        console.log(colors.yellow('Sync service is not running'));
        console.log('Start the service with: claude-flow taskmaster sync start');
        return;
      }

      const status = syncService.getSyncStatus();
      if (!status.isConnected) {
        console.log(colors.yellow('No VS Code clients connected'));
        return;
      }

      if (status.activeSync && !options.force) {
        console.log(colors.yellow('Sync already in progress'));
        console.log('Use --force to trigger anyway');
        return;
      }

      console.log(colors.blue('Triggering synchronization...'));
      const startTime = Date.now();
      
      const result = await syncService.requestSync();
      const duration = Date.now() - startTime;
      
      if (result.success) {
        console.log(colors.green(`✓ Sync completed successfully in ${duration}ms`));
        console.log(`  Synced tasks: ${result.syncedTasks}`);
        
        if (result.conflicts.length > 0) {
          console.log(colors.yellow(`  Conflicts: ${result.conflicts.length}`));
        }
      } else {
        console.log(colors.red('✗ Sync failed'));
        result.errors.forEach(error => {
          console.log(colors.red(`  - ${error}`));
        });
      }
      
    } catch (error) {
      console.error(colors.red('Failed to trigger sync:'), formatError(error));
    }
  });

/**
 * Configure sync settings
 */
syncCommand
  .command('config')
  .description('Configure VS Code extension sync settings')
  .option('--show', 'Show current configuration')
  .option('--set-strategy <strategy:string>', 'Set conflict resolution strategy')
  .option('--set-interval <ms:number>', 'Set auto-sync interval')
  .option('--set-token <token:string>', 'Set authentication token')
  .action(async (options) => {
    try {
      if (options.show) {
        // TODO: Load and show saved configuration
        console.log(colors.blue('Current sync configuration:'));
        console.log('  (Configuration persistence not yet implemented)');
        return;
      }

      if (!options.setStrategy && !options.setInterval && !options.setToken) {
        console.log(colors.yellow('No configuration changes specified'));
        console.log('Use --set-strategy, --set-interval, or --set-token');
        return;
      }

      // TODO: Implement configuration persistence
      console.log(colors.yellow('Configuration persistence not yet implemented'));
      console.log('Settings will only apply to the current session');
      
      if (syncService) {
        console.log(colors.yellow('Please restart the sync service for changes to take effect'));
      }
      
    } catch (error) {
      console.error(colors.red('Failed to configure sync:'), formatError(error));
    }
  });

/**
 * Set up event listeners for the sync service
 */
function setupSyncEventListeners(service: VSCodeSyncService): void {
  // Connection events
  service.on('client:connected', (data) => {
    logger.info('VS Code client connected', data);
    console.log(colors.green(`→ VS Code client connected: ${data.clientId}`));
  });

  service.on('client:disconnected', (data) => {
    logger.info('VS Code client disconnected', data);
    console.log(colors.yellow(`← VS Code client disconnected: ${data.clientId}`));
  });

  // Task events
  service.on('task:created', (task) => {
    logger.info('Task created via VS Code', { taskId: task.id });
    console.log(colors.blue(`+ Task created: ${task.title}`));
  });

  service.on('task:updated', (task) => {
    logger.info('Task updated via VS Code', { taskId: task.id });
    console.log(colors.blue(`~ Task updated: ${task.title}`));
  });

  service.on('task:deleted', (taskId) => {
    logger.info('Task deleted via VS Code', { taskId });
    console.log(colors.red(`- Task deleted: ${taskId}`));
  });

  service.on('task:status:changed', (data) => {
    logger.info('Task status changed', data);
    console.log(colors.cyan(`◆ Status changed: ${data.taskId} → ${data.status}`));
  });

  // PRD events
  service.on('prd:parse:requested', (data) => {
    logger.info('PRD parse requested from VS Code');
    console.log(colors.magenta('📄 PRD parse requested'));
    // TODO: Integrate with PRD parser service
  });

  // Sync events
  service.on('sync:started', () => {
    logger.info('Sync started');
    console.log(colors.blue('🔄 Sync started'));
  });

  service.on('sync:completed', (result) => {
    logger.info('Sync completed', result);
    if (result.success) {
      console.log(colors.green(`✓ Sync completed: ${result.syncedTasks} tasks`));
    } else {
      console.log(colors.red(`✗ Sync failed: ${result.errors.join(', ')}`));
    }
  });

  service.on('sync:conflict', (conflict) => {
    logger.warn('Sync conflict detected', conflict);
    console.log(colors.yellow(`⚠ Conflict: ${conflict.taskId} - ${conflict.field}`));
  });

  service.on('conflict:needs_resolution', (conflict) => {
    logger.warn('Manual conflict resolution needed', conflict);
    console.log(colors.red(`❗ Manual resolution needed: ${conflict.taskId}`));
  });

  // Error events
  service.on('error', (error) => {
    logger.error('Sync service error', error);
    console.error(colors.red('✗ Sync error:'), formatError(error));
  });
}

/**
 * Format age in human-readable format
 */
function formatAge(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

export default syncCommand;