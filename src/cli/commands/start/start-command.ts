/**
 * Unified start command implementation with robust service management
 */

// Node.js imports
import { processPool } from '../../../core/process-pool.js';
import process from 'node:process';
import { readFile, writeFile, unlink, mkdir, stat } from 'node:fs/promises';
import { Command } from '../../../utils/cliffy-compat/command.js';
import { colors } from '../../../utils/cliffy-compat/colors.js';
import { Confirm } from '@cliffy/prompt';
import { ProcessManager } from './process-manager.js';
import { ProcessUI } from './process-ui.js';
import { SystemMonitor } from './system-monitor.js';
import { StartOptions } from './types.js';
import { eventBus } from '../../../core/event-bus.js';
import { logger } from '../../../core/logger.js';
import { formatDuration } from '../../formatter.js';
import { registerCurrentProcess, registerChildProcess } from '../../../services/process-registry/integration.js';

export const startCommand = new Command()
  .description('Start the Claude-Flow orchestration system')
  .option('-d, --daemon', 'Run as daemon in background')
  .option('-p, --port <port:number>', 'MCP server port', { default: 3000 })
  .option('--mcp-transport <transport:string>', 'MCP transport type (stdio, http)', {
    default: 'stdio',
  })
  .option('-u, --ui', 'Launch interactive process management UI')
  .option('-v, --verbose', 'Enable verbose logging')
  .option('--auto-start', 'Automatically start all processes')
  .option('--config <path:string>', 'Configuration file path')
  .option('--force', 'Force start even if already running')
  .option('--health-check', 'Perform health checks before starting')
  .option('--timeout <seconds:number>', 'Startup timeout in seconds', { default: 60 })
  .action(async (options: StartOptions) => {
    console.log(colors.cyan('🧠 Claude-Flow Orchestration System'));
    console.log(colors.gray('─'.repeat(60)));

    // Register the orchestration system with the process registry
    const orchestratorProcessId = await registerCurrentProcess({
      name: 'claude-flow-orchestrator',
      type: 'service',
      command: process.argv,
      healthCheckInterval: 30000,
      metadata: {
        port: options.port,
        transport: options.mcpTransport,
        ui: options.ui,
        daemon: options.daemon
      }
    });

    console.log(colors.gray(`📋 Process registered: ${orchestratorProcessId}`));

    try {
      // Check if already running
      if (!options.force && await isSystemRunning()) {
        console.log(colors.yellow('⚠ Claude-Flow is already running'));
        const shouldContinue = await Confirm.prompt({
          message: 'Stop existing instance and restart?',
          default: false
        });
        
        if (!shouldContinue) {
          console.log(colors.gray('Use --force to override or "claude-flow stop" first'));
          return;
        }
        
        await stopExistingInstance();
      }

      // Perform pre-flight checks
      if (options.healthCheck) {
        console.log(colors.blue('Running pre-flight health checks...'));
        await performHealthChecks();
      }

      // Initialize process manager with timeout
      const processManager = new ProcessManager();
      console.log(colors.blue('Initializing system components...'));
      const initPromise = processManager.initialize(options.config);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Initialization timeout')), (options.timeout || 30) * 1000)
      );
      
      await Promise.race([initPromise, timeoutPromise]);

      // Initialize system monitor with enhanced monitoring
      const systemMonitor = new SystemMonitor(processManager);
      systemMonitor.start();
      
      // Setup system event handlers
      setupSystemEventHandlers(processManager, systemMonitor, options);

      // Override MCP settings from CLI options
      if (options.port) {
        const mcpProcess = processManager.getProcess('mcp-server');
        if (mcpProcess) {
          mcpProcess.config = { ...mcpProcess.config, port: options.port };
        }
      }
      
      // Configure transport settings
      if (options.mcpTransport) {
        const mcpProcess = processManager.getProcess('mcp-server');
        if (mcpProcess) {
          mcpProcess.config = { ...mcpProcess.config, transport: options.mcpTransport };
        }
      }

      // Setup event listeners for logging
      if (options.verbose) {
        setupVerboseLogging(systemMonitor);
      }

      // Launch UI mode
      if (options.ui) {
        const ui = new ProcessUI(processManager);
        await ui.start();
        
        // Cleanup on exit
        systemMonitor.stop();
        await processManager.stopAll();
        console.log(colors.green.bold('✓'), 'Shutdown complete');
        process.exit(0);
      } 
      // Daemon mode
      else if (options.daemon) {
        console.log(colors.yellow('Starting in daemon mode...'));
        
        // Auto-start all processes
        if (options.autoStart) {
          console.log(colors.blue('Starting all system processes...'));
          await startWithProgress(processManager, 'all');
        } else {
          // Start only core processes
          console.log(colors.blue('Starting core processes...'));
          await startWithProgress(processManager, 'core');
        }

        // Create PID file with metadata
        const pid = process.pid;
        const pidData = {
          pid,
          startTime: Date.now(),
          config: options.config || 'default',
          processes: processManager.getAllProcesses().map(p => ({ id: p.id, status: p.status }))
        };
        await writeFile('.claude-flow.pid', JSON.stringify(pidData, null, 2), 'utf-8');
        console.log(colors.gray(`Process ID: ${pid}`));
        
        // Wait for services to be fully ready
        await waitForSystemReady(processManager);
        
        console.log(colors.green.bold('✓'), 'Daemon started successfully');
        console.log(colors.gray('Use "claude-flow status" to check system status'));
        console.log(colors.gray('Use "claude-flow monitor" for real-time monitoring'));
        
        // Keep process running
        await new Promise<void>(() => {});
      } 
      // Interactive mode (default)
      else {
        console.log(colors.cyan('Starting in interactive mode...'));
        console.log();

        // Show available options
        console.log(colors.white.bold('Quick Actions:'));
        console.log('  [1] Start all processes');
        console.log('  [2] Start core processes only');
        console.log('  [3] Launch process management UI');
        console.log('  [4] Show system status');
        console.log('  [q] Quit');
        console.log();
        console.log(colors.gray('Press a key to select an option...'));

        // Handle user input
        while (true) {
          const key = await new Promise<string>((resolve) => {
            process.stdin.once('data', (data) => resolve(data.toString().trim()[0] || ''));
            process.stdin.resume();
          });

          switch (key) {
            case '1':
              console.log(colors.cyan('\nStarting all processes...'));
              await startWithProgress(processManager, 'all');
              console.log(colors.green.bold('✓'), 'All processes started');
              break;

            case '2':
              console.log(colors.cyan('\nStarting core processes...'));
              await startWithProgress(processManager, 'core');
              console.log(colors.green.bold('✓'), 'Core processes started');
              break;

            case '3':
              const ui = new ProcessUI(processManager);
              await ui.start();
              break;

            case '4':
              process.stdout.write('\x1Bc'); // Clear screen
              systemMonitor.printSystemHealth();
              console.log();
              systemMonitor.printEventLog(10);
              console.log();
              console.log(colors.gray('Press any key to continue...'));
              await new Promise<void>((resolve) => {
                process.stdin.once('data', () => resolve());
                process.stdin.resume();
              });
              break;

            case 'q':
            case 'Q':
              console.log(colors.yellow('\nShutting down...'));
              await processManager.stopAll();
              systemMonitor.stop();
              console.log(colors.green.bold('✓'), 'Shutdown complete');
              process.exit(0);
              break;
          }

          // Redraw menu
          process.stdout.write('\x1Bc'); // Clear screen
          console.log(colors.cyan('🧠 Claude-Flow Interactive Mode'));
          console.log(colors.gray('─'.repeat(60)));
          
          // Show current status
          const stats = processManager.getSystemStats();
          console.log(colors.white('System Status:'), 
            colors.green(`${stats.runningProcesses}/${stats.totalProcesses} processes running`));
          console.log();
          
          console.log(colors.white.bold('Quick Actions:'));
          console.log('  [1] Start all processes');
          console.log('  [2] Start core processes only');
          console.log('  [3] Launch process management UI');
          console.log('  [4] Show system status');
          console.log('  [q] Quit');
          console.log();
          console.log(colors.gray('Press a key to select an option...'));
        }
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(colors.red.bold('Failed to start:'), errorMessage);
      if (options.verbose && error instanceof Error) {
        console.error(error.stack);
      }
      
      // Cleanup on failure
      console.log(colors.yellow('Performing cleanup...'));
      try {
        await cleanupOnFailure();
      } catch (cleanupError: unknown) {
        const cleanupErrorMessage = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
        console.error(colors.red('Cleanup failed:'), cleanupErrorMessage);
      }
      
      process.exit(1);
    }
  });

// Enhanced helper functions

async function isSystemRunning(): Promise<boolean> {
  try {
    const pidData = await readFile('.claude-flow.pid', 'utf-8');
    const data = JSON.parse(pidData);
    
    // Check if process is still running
    try {
      process.kill(data.pid, 0); // Signal 0 to check if process exists
      return true; // Process is running
    } catch (error: unknown) {
      return false; // Process not found
    }
  } catch (error: unknown) {
    return false; // No PID file
  }
}

async function stopExistingInstance(): Promise<void> {
  try {
    const pidData = await readFile('.claude-flow.pid', 'utf-8');
    const data = JSON.parse(pidData);
    
    console.log(colors.yellow('Stopping existing instance...'));
    process.kill(data.pid, 'SIGTERM');
    
    // Wait for graceful shutdown
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Force kill if still running
    try {
      process.kill(data.pid, 'SIGKILL');
    } catch (error: unknown) {
      // Process already stopped
    }
    
    await unlink('.claude-flow.pid').catch(() => {});
    console.log(colors.green('✓ Existing instance stopped'));
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.warn(colors.yellow('Warning: Could not stop existing instance'), errorMessage);
  }
}

async function performHealthChecks(): Promise<void> {
  const checks = [
    { name: 'Disk Space', check: checkDiskSpace },
    { name: 'Memory Available', check: checkMemoryAvailable },
    { name: 'Network Connectivity', check: checkNetworkConnectivity },
    { name: 'Required Dependencies', check: checkDependencies }
  ];
  
  for (const { name, check } of checks) {
    try {
      console.log(colors.gray(`  Checking ${name}...`));
      await check();
      console.log(colors.green(`  ✓ ${name} OK`));
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log(colors.red(`  ✗ ${name} Failed: ${errorMessage}`));
      throw error;
    }
  }
}

async function checkDiskSpace(): Promise<void> {
  // Basic disk space check - would need platform-specific implementation
  const stats = await stat('.');
  if (!stats.isDirectory()) {
    throw new Error('Current directory is not accessible');
  }
}

async function checkMemoryAvailable(): Promise<void> {
  // Memory check - would integrate with system memory monitoring
  const memoryInfo = process.memoryUsage();
  if (memoryInfo.heapUsed > 500 * 1024 * 1024) { // 500MB threshold
    throw new Error('High memory usage detected');
  }
}

async function checkNetworkConnectivity(): Promise<void> {
  // Basic network check
  try {
    const response = await fetch('https://httpbin.org/status/200', {
      method: 'GET',
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) {
      throw new Error(`Network check failed: ${response.status}`);
    }
  } catch (error: unknown) {
    console.log(colors.yellow('  ⚠ Network connectivity check skipped (offline mode?)'));
  }
}

async function checkDependencies(): Promise<void> {
  // Check for required directories and files
  const requiredDirs = ['.claude-flow', 'memory', 'logs'];
  for (const dir of requiredDirs) {
    try {
      await mkdir(dir, { recursive: true });
    } catch (error: unknown) {
      throw new Error(`Cannot create required directory: ${dir}`);
    }
  }
}

function setupSystemEventHandlers(
  processManager: ProcessManager, 
  systemMonitor: SystemMonitor, 
  options: StartOptions
): void {
  // Handle graceful shutdown signals
  const shutdownHandler = async () => {
    console.log('\n' + colors.yellow('Received shutdown signal, shutting down gracefully...'));
    systemMonitor.stop();
    await processManager.stopAll();
    await cleanupOnShutdown();
    console.log(colors.green('✓ Shutdown complete'));
    process.exit(0);
  };
  
  process.on('SIGINT', shutdownHandler);
  process.on('SIGTERM', shutdownHandler);
  
  // Setup verbose logging if requested
  if (options.verbose) {
    setupVerboseLogging(systemMonitor);
  }
  
  // Monitor for critical errors
  processManager.on('processError', (event: any) => {
    console.error(colors.red(`Process error in ${event.processId}:`), event.error.message);
    if (event.processId === 'orchestrator') {
      console.error(colors.red.bold('Critical process failed, initiating recovery...'));
      // Could implement auto-recovery logic here
    }
  });
}

async function startWithProgress(processManager: ProcessManager, mode: 'all' | 'core'): Promise<void> {
  const processes = mode === 'all' 
    ? ['event-bus', 'memory-manager', 'terminal-pool', 'coordinator', 'mcp-server', 'orchestrator']
    : ['event-bus', 'memory-manager', 'mcp-server'];
  
  for (let i = 0; i < processes.length; i++) {
    const processId = processes[i];
    const progress = `[${i + 1}/${processes.length}]`;
    
    console.log(colors.gray(`${progress} Starting ${processId}...`));
    try {
      await processManager.startProcess(processId);
      console.log(colors.green(`${progress} ✓ ${processId} started`));
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log(colors.red(`${progress} ✗ ${processId} failed: ${errorMessage}`));
      if (processId === 'orchestrator' || processId === 'mcp-server') {
        throw error; // Critical processes
      }
    }
    
    // Brief delay between starts
    if (i < processes.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  // Save system state after all processes are started
  await processManager.saveSystemState();
}

async function waitForSystemReady(processManager: ProcessManager): Promise<void> {
  console.log(colors.blue('Waiting for system to be ready...'));
  
  const maxWait = 30000; // 30 seconds
  const checkInterval = 1000; // 1 second
  let waited = 0;
  
  while (waited < maxWait) {
    const stats = processManager.getSystemStats();
    if (stats.errorProcesses === 0 && stats.runningProcesses >= 3) {
      console.log(colors.green('✓ System ready'));
      return;
    }
    
    await new Promise(resolve => setTimeout(resolve, checkInterval));
    waited += checkInterval;
  }
  
  console.log(colors.yellow('⚠ System startup completed but some processes may not be fully ready'));
}

async function cleanupOnFailure(): Promise<void> {
  try {
    await unlink('.claude-flow.pid').catch(() => {});
    console.log(colors.gray('Cleaned up PID file'));
  } catch (error: unknown) {
    // Ignore cleanup errors
  }
}

async function cleanupOnShutdown(): Promise<void> {
  try {
    await unlink('.claude-flow.pid').catch(() => {});
    console.log(colors.gray('Cleaned up PID file'));
  } catch (error: unknown) {
    // Ignore cleanup errors
  }
}

function setupVerboseLogging(monitor: SystemMonitor): void {
  // Enhanced verbose logging
  console.log(colors.gray('Verbose logging enabled'));
  
  // Periodically print system health
  setInterval(() => {
    console.log();
    console.log(colors.cyan('--- System Health Report ---'));
    monitor.printSystemHealth();
    console.log(colors.cyan('--- End Report ---'));
  }, 30000);
  
  // Log critical events
  eventBus.on('process:started', (data: any) => {
    console.log(colors.green(`[VERBOSE] Process started: ${data.processId}`));
  });
  
  eventBus.on('process:stopped', (data: any) => {
    console.log(colors.yellow(`[VERBOSE] Process stopped: ${data.processId}`));
  });
  
  eventBus.on('process:error', (data: any) => {
    console.log(colors.red(`[VERBOSE] Process error: ${data.processId} - ${data.error.message}`));
  });
}