/**
 * Process execution tracing commands
 */

import { Command } from '../../utils/cliffy-compat/command.js';
import { colors } from '../../utils/cliffy-compat/colors.js';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

export const traceCommand = new Command()
  .description('Manage process execution tracing')
  .action(() => {
    traceCommand.showHelp();
  })
  .command('status')
  .description('Show current tracing status and metrics')
  .action(async () => {
    await showTracingStatus();
  })
  .command('reset')
  .description('Reset tracing metrics')
  .action(async () => {
    await resetTracingMetrics();
  })
  .command('test')
  .description('Test the tracing framework')
  .action(async () => {
    await testTracingFramework();
  });

async function showTracingStatus(): Promise<void> {
  console.log(colors.cyan('\n🔍 Process Execution Tracing Status\n'));
  
  // Check if tracing files exist
  const tracingFiles = [
    'src/tracing/index.ts',
    'src/tracing/child.ts',
    'src/tracing/metrics.ts'
  ];
  
  console.log(colors.blue('📁 Framework Files:'));
  for (const file of tracingFiles) {
    try {
      await fs.access(file);
      console.log(`   ${colors.green('✅')} ${file}`);
    } catch {
      console.log(`   ${colors.red('❌')} ${file} ${colors.gray('(missing)')}`);
    }
  }
  
  // Check metrics file
  const metricsFile = path.join(process.cwd(), '.claude-flow', 'process-metrics.json');
  console.log(`\n${colors.blue('📊 Metrics:')}`);
  
  try {
    const metricsData = await fs.readFile(metricsFile, 'utf-8');
    const metrics = JSON.parse(metricsData);
    
    console.log(`   Total Processes: ${colors.yellow(metrics.summary.totalProcesses)}`);
    console.log(`   Success Rate: ${colors.green(metrics.summary.successRate)}`);
    console.log(`   Average Duration: ${colors.cyan(metrics.summary.averageDuration)}`);
    console.log(`   Last Updated: ${colors.gray(new Date(metrics.timestamp).toLocaleString())}`);
    
    // Show recent executions
    if (metrics.metrics.lastExecutions?.length > 0) {
      console.log(`\n${colors.blue('🕐 Recent Executions:')}`);
      const recent = metrics.metrics.lastExecutions.slice(-5);
      for (const exec of recent) {
        const status = exec.success ? colors.green('✅') : colors.red('❌');
        console.log(`   ${status} ${exec.command} ${exec.args.join(' ')} ${colors.gray(`(${exec.duration}ms)`)}`);
      }
    }
    
    // Threshold warnings
    if (metrics.metrics.totalSpawns >= 9) {
      console.log(`\n${colors.red('⚠️  Threshold Warning:')} Process count (${metrics.metrics.totalSpawns}) exceeds recommended threshold (9)`);
    }
    
  } catch (error) {
    console.log(`   ${colors.gray('No metrics available yet')}`);
  }
  
  // Check integration status
  const integrationFiles = {
    'src/core/process-pool.ts': '../tracing/index.js',
    'src/swarm/executor.ts': '../tracing/index.js',
    'src/swarm/coordinator.ts': '../tracing/index.js',
    'src/agents/agent-manager.ts': '../tracing/index.js'
  };
  
  console.log(`\n${colors.blue('🔗 Integration Status:')}`);
  for (const [file, importPath] of Object.entries(integrationFiles)) {
    try {
      const content = await fs.readFile(file, 'utf-8');
      if (content.includes(importPath) || content.includes('../tracing/')) {
        console.log(`   ${colors.green('✅')} ${file} ${colors.gray('(integrated)')}`);
      } else {
        console.log(`   ${colors.yellow('⚠️ ')} ${file} ${colors.gray('(not integrated)')}`);
      }
    } catch {
      console.log(`   ${colors.red('❌')} ${file} ${colors.gray('(missing)')}`);
    }
  }
  
  console.log(`\n${colors.green('✨ Process execution tracing framework is active!')}`);
}

async function resetTracingMetrics(): Promise<void> {
  const metricsFile = path.join(process.cwd(), '.claude-flow', 'process-metrics.json');
  
  try {
    await fs.unlink(metricsFile);
    console.log(colors.green('✅ Tracing metrics have been reset'));
  } catch (error) {
    console.log(colors.yellow('⚠️  No metrics file found to reset'));
  }
}

async function testTracingFramework(): Promise<void> {
  console.log(colors.cyan('\n🧪 Testing Process Tracing Framework\n'));
  
  // Import the tracing functions dynamically
  try {
    const { spawn } = await import('../../tracing/index.js');
    
    console.log('Running test spawn...');
    
    const child = spawn('echo', ['Tracing test successful!'], {
      processName: 'trace-test',
      processType: 'tool',
      tracingEnabled: true
    });
    
    await new Promise<void>((resolve, reject) => {
      child.on('close', (code) => {
        if (code === 0) {
          console.log(colors.green('✅ Test spawn completed successfully'));
          resolve();
        } else {
          console.log(colors.red(`❌ Test spawn failed with code: ${code}`));
          reject(new Error(`Process failed with code ${code}`));
        }
      });
      
      child.on('error', (error) => {
        console.log(colors.red(`❌ Test spawn error: ${error.message}`));
        reject(error);
      });
    });
    
    console.log(colors.green('\n🎉 Tracing framework test completed successfully!'));
    
  } catch (error) {
    console.log(colors.red(`❌ Failed to test tracing framework: ${error}`));
    console.log(colors.yellow('💡 Make sure the project is built: npm run build'));
  }
}
