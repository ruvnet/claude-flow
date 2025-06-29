/**
 * Process Registry Command
 * 
 * CLI commands for managing and viewing the process registry
 */

import { Command } from '../../utils/cliffy-compat/command.js';
import { Table } from '../../utils/cliffy-compat/table.js';
import { colors } from '../../utils/cliffy-compat/colors.js';
import { getProcessRegistry } from '../../services/process-registry/registry';
import { ProcessRegistryRecovery } from '../../services/process-registry/recovery';
import { ProcessRegistryDatabase } from '../../services/process-registry/database';
import { ProcessInfo, ProcessStatus } from '../../services/process-registry/types';
import { getProcessHierarchy } from '../../services/process-registry/integration';
import { Logger } from '../../core/logger';

const logger = Logger.getInstance().child({ component: 'RegistryCommand' });

// Status color mapping
const statusColors: Record<ProcessStatus, (text: string) => string> = {
  starting: colors.yellow,
  running: colors.green,
  stopping: colors.yellow,
  stopped: colors.gray,
  failed: colors.red,
  unresponsive: colors.magenta
};

export const registryCommand = new Command()
  .name('registry')
  .description('Manage and view the process registry')
  .action(() => {
    console.log('Use `registry list` to view processes or `registry --help` for more options');
  })
  
  // List all processes
  .command('list')
  .description('List all registered processes')
  .alias('ls')
  .option('--type <type:string>', 'Filter by process type (swarm, agent, task, service)')
  .option('--status <status:string>', 'Filter by status')
  .option('--parent <id:string>', 'Filter by parent ID')
  .option('--tree', 'Display as tree hierarchy')
  .action(async (options) => {
    const registry = getProcessRegistry();
    await registry.initialize();
    
    const filter: any = {};
    if (options.type) filter.type = options.type;
    if (options.status) filter.status = options.status;
    if (options.parent) filter.parentId = options.parent;
    
    const processes = await registry.query(filter);
    
    if (processes.length === 0) {
      console.log('No processes found');
      return;
    }
    
    if (options.tree) {
      // Display as tree
      const roots = processes.filter(p => !p.parentId);
      for (const root of roots) {
        await displayProcessTree(root, processes, 0);
      }
    } else {
      // Display as table
      const table = new Table()
        .header(['ID', 'Name', 'Type', 'PID', 'Status', 'Start Time', 'Parent'])
        .body(processes.map(p => [
          p.id.substring(0, 8) + '...',
          p.name,
          p.type,
          p.pid.toString(),
          statusColors[p.status](p.status),
          new Date(p.startTime).toLocaleString(),
          p.parentId ? p.parentId.substring(0, 8) + '...' : '-'
        ]));
      
      table.render();
    }
  })
  
  // Get process details
  .command('info')
  .description('Get detailed information about a process')
  .arguments('<processId:string>')
  .action(async ({ processId }) => {
    const registry = getProcessRegistry();
    await registry.initialize();
    
    const processes = await registry.query({ id: processId });
    if (processes.length === 0) {
      console.error(`Process not found: ${processId}`);
      return;
    }
    
    const process = processes[0];
    const health = await registry.getHealth(processId);
    
    console.log(colors.bold('\nProcess Information:'));
    console.log(`  ID:          ${process.id}`);
    console.log(`  Name:        ${process.name}`);
    console.log(`  Type:        ${process.type}`);
    console.log(`  PID:         ${process.pid}`);
    console.log(`  Status:      ${statusColors[process.status](process.status)}`);
    console.log(`  Start Time:  ${new Date(process.startTime).toLocaleString()}`);
    console.log(`  Uptime:      ${formatUptime(Date.now() - process.startTime.getTime())}`);
    console.log(`  Parent ID:   ${process.parentId || 'None'}`);
    console.log(`  Command:     ${process.command.join(' ')}`);
    
    console.log(colors.bold('\nHealth Status:'));
    console.log(`  Status:      ${health.status}`);
    console.log(`  Last Check:  ${new Date(health.lastHeartbeat).toLocaleString()}`);
    console.log(`  Failures:    ${health.consecutiveFailures}`);
    
    if (process.metadata) {
      console.log(colors.bold('\nMetadata:'));
      console.log(JSON.stringify(process.metadata, null, 2));
    }
  })
  
  // Terminate a process
  .command('terminate')
  .description('Terminate a registered process')
  .arguments('<processId:string>')
  .alias('kill')
  .option('--signal <signal:string>', 'Signal to send (default: SIGTERM)')
  .action(async ({ processId }, options) => {
    const registry = getProcessRegistry();
    await registry.initialize();
    
    try {
      await registry.terminate(processId, options.signal);
      console.log(`Process ${processId} terminated`);
    } catch (error) {
      console.error(`Failed to terminate process: ${(error as Error).message}`);
    }
  })
  
  // Restart a process
  .command('restart')
  .description('Restart a registered process')
  .arguments('<processId:string>')
  .action(async ({ processId }) => {
    const registry = getProcessRegistry();
    await registry.initialize();
    
    try {
      await registry.restart(processId);
      console.log(`Process ${processId} restarted`);
    } catch (error) {
      console.error(`Failed to restart process: ${(error as Error).message}`);
    }
  })
  
  // Clean up orphaned processes
  .command('cleanup')
  .description('Clean up orphaned processes')
  .option('--dry-run', 'Show what would be cleaned without making changes')
  .action(async (options) => {
    const registry = getProcessRegistry();
    await registry.initialize();
    
    const processes = await registry.query({});
    let orphanedCount = 0;
    
    for (const proc of processes) {
      try {
        process.kill(proc.pid, 0);
      } catch {
        // Process not running
        orphanedCount++;
        if (options.dryRun) {
          console.log(`Would clean up: ${proc.id} (${proc.name})`);
        } else {
          await registry.unregister(proc.id);
          console.log(`Cleaned up: ${proc.id} (${proc.name})`);
        }
      }
    }
    
    console.log(`\n${orphanedCount} orphaned processes ${options.dryRun ? 'found' : 'cleaned'}`);
  })
  
  // Registry validation and repair
  .command('validate')
  .description('Validate registry integrity')
  .option('--repair', 'Attempt to repair issues')
  .action(async (options) => {
    const db = new ProcessRegistryDatabase();
    await db.initialize();
    
    const recovery = new ProcessRegistryRecovery(db);
    const validation = await recovery.validate();
    
    console.log(colors.bold('\nRegistry Validation Report:'));
    console.log(`  Valid:       ${validation.valid ? colors.green('Yes') : colors.red('No')}`);
    console.log(`  Processes:   ${validation.processCount}`);
    console.log(`  Orphaned:    ${validation.orphanedProcesses.length}`);
    console.log(`  Errors:      ${validation.errors.length}`);
    console.log(`  Warnings:    ${validation.warnings.length}`);
    
    if (validation.errors.length > 0) {
      console.log(colors.bold('\nErrors:'));
      validation.errors.forEach(err => console.log(`  - ${err}`));
    }
    
    if (validation.warnings.length > 0) {
      console.log(colors.bold('\nWarnings:'));
      validation.warnings.forEach(warn => console.log(`  - ${warn}`));
    }
    
    if (options.repair && !validation.valid) {
      console.log(colors.bold('\nRepairing registry...'));
      await recovery.repair();
      console.log('Registry repaired');
    }
    
    await db.shutdown();
  })
  
  // Backup and restore
  .command('backup')
  .description('Create a registry backup')
  .action(async () => {
    const db = new ProcessRegistryDatabase();
    await db.initialize();
    
    const recovery = new ProcessRegistryRecovery(db);
    await recovery.backup();
    
    console.log('Registry backup created');
    await db.shutdown();
  })
  
  .command('restore')
  .description('Restore registry from backup')
  .arguments('<backupPath:string>')
  .action(async ({ backupPath }) => {
    const db = new ProcessRegistryDatabase();
    await db.initialize();
    
    const recovery = new ProcessRegistryRecovery(db);
    await recovery.restore(backupPath);
    
    console.log('Registry restored from backup');
    await db.shutdown();
  });

// Helper functions
async function displayProcessTree(process: ProcessInfo, allProcesses: ProcessInfo[], depth: number): Promise<void> {
  const indent = '  '.repeat(depth);
  const prefix = depth > 0 ? '├─ ' : '';
  
  console.log(`${indent}${prefix}${process.name} (${process.type}) - ${statusColors[process.status](process.status)}`);
  
  const children = allProcesses.filter(p => p.parentId === process.id);
  for (const child of children) {
    await displayProcessTree(child, allProcesses, depth + 1);
  }
}

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}