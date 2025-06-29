/**
 * Claude instance management commands
 */

import { Command } from '../../utils/cliffy-compat/command.js';
import { colors } from '../../utils/cliffy-compat/colors.js';
import { processPool } from '../../core/process-pool.js';
import { promises as fs } from 'node:fs';
import { generateId } from '../../utils/helpers.js';

export const claudeCommand = new Command()
  .description('Manage Claude instances')
  .action(() => {
    claudeCommand.showHelp();
  })
  .command('spawn')
    .description('Spawn a new Claude instance with specific configuration')
    .arguments('<task:string>')
    .option('-t, --tools <tools:string>', 'Allowed tools (comma-separated)', { 
      default: 'View,Edit,Replace,GlobTool,GrepTool,LS,Bash' 
    })
    .option('--no-permissions', 'Use --dangerously-skip-permissions flag')
    .option('-c, --config <config:string>', 'MCP config file path')
    .option('-m, --mode <mode:string>', 'Development mode (full, backend-only, frontend-only, api-only)', {
      default: 'full'
    })
    .option('--parallel', 'Enable parallel execution with BatchTool')
    .option('--research', 'Enable web research with WebFetchTool')
    .option('--coverage <coverage:number>', 'Test coverage target', { default: 80 })
    .option('--commit <frequency:string>', 'Commit frequency (phase, feature, manual)', {
      default: 'phase'
    })
    .option('-v, --verbose', 'Enable verbose output')
    .option('--dry-run', 'Show what would be executed without running')
    .action(async (options: any, task: string) => {
      try {
        const instanceId = generateId('claude');
        
        // Build allowed tools list
        let tools = options.tools;
        if (options.parallel && !tools.includes('BatchTool')) {
          tools += ',BatchTool,dispatch_agent';
        }
        if (options.research && !tools.includes('WebFetchTool')) {
          tools += ',WebFetchTool';
        }
        
        // Build Claude command
        const claudeArgs = [task];
        claudeArgs.push('--allowedTools', tools);
        
        if (options.noPermissions) {
          claudeArgs.push('--dangerously-skip-permissions');
        }
        
        if (options.config) {
          claudeArgs.push('--mcp-config', options.config);
        }
        
        if (options.verbose) {
          claudeArgs.push('--verbose');
        }
        
        if (options.dryRun) {
          console.log(colors.yellow('DRY RUN - Would execute:'));
          console.log(colors.gray(`claude ${claudeArgs.join(' ')}`));
          console.log('\nConfiguration:');
          console.log(`  Instance ID: ${instanceId}`);
          console.log(`  Task: ${task}`);
          console.log(`  Tools: ${tools}`);
          console.log(`  Mode: ${options.mode}`);
          console.log(`  Coverage: ${options.coverage}%`);
          console.log(`  Commit: ${options.commit}`);
          return;
        }
        
        console.log(colors.green(`Spawning Claude instance: ${instanceId}`));
        console.log(colors.gray(`Task: ${task}`));
        console.log(colors.gray(`Tools: ${tools}`));
        
        // Execute Claude process using ProcessPool
        try {
          const result = await processPool.executeClaude(task, {
            tools: tools.split(','),
            noPermissions: options.noPermissions,
            config: options.config,
            stdio: 'inherit',
            env: {
              CLAUDE_INSTANCE_ID: instanceId,
              CLAUDE_FLOW_MODE: options.mode,
              CLAUDE_FLOW_COVERAGE: options.coverage.toString(),
              CLAUDE_FLOW_COMMIT: options.commit,
            },
            processName: `claude-${instanceId}`,
            processType: 'agent',
            metadata: {
              instanceId,
              task,
              mode: options.mode,
              coverage: options.coverage
            }
          });
          
          if (result.success) {
            console.log(colors.green(`Claude instance ${instanceId} completed successfully`));
          } else {
            console.log(colors.red(`Claude instance ${instanceId} exited with code ${result.exitCode}`));
          }
        } catch (err) {
          console.error(colors.red('Failed to execute Claude:'), (err as Error).message);
        }
        
      } catch (error) {
        console.error(colors.red('Failed to spawn Claude:'), (error as Error).message);
      }
    })
  .command('batch')
    .description('Spawn multiple Claude instances from workflow')
    .arguments('<workflow-file:string>')
    .option('--dry-run', 'Show what would be executed without running')
    .action(async (options: any, workflowFile: string) => {
      try {
        const content = await fs.readFile(workflowFile, 'utf-8');
        const workflow = JSON.parse(content);
        
        console.log(colors.green('Loading workflow:'), workflow.name || 'Unnamed');
        console.log(colors.gray(`Tasks: ${workflow.tasks?.length || 0}`));
        
        if (!workflow.tasks || workflow.tasks.length === 0) {
          console.log(colors.yellow('No tasks found in workflow'));
          return;
        }
        
        const executeTask = async (task: any) => {
          const claudeArgs = [task.description || task.name];
          
          // Add tools
          if (task.tools) {
            claudeArgs.push('--allowedTools', Array.isArray(task.tools) ? task.tools.join(',') : task.tools);
          }
          
          // Add flags
          if (task.skipPermissions) {
            claudeArgs.push('--dangerously-skip-permissions');
          }
          
          if (task.config) {
            claudeArgs.push('--mcp-config', task.config);
          }
          
          if (options.dryRun) {
            console.log(colors.yellow(`\nDRY RUN - Task: ${task.name || task.id}`));
            console.log(colors.gray(`claude ${claudeArgs.join(' ')}`));
            return { success: true, taskId: task.id || task.name };
          } else {
            console.log(colors.blue(`\nExecuting Claude for task: ${task.name || task.id}`));
            
            try {
              const result = await processPool.executeClaude(
                task.description || task.name,
                {
                  tools: Array.isArray(task.tools) ? task.tools : task.tools?.split(','),
                  noPermissions: task.skipPermissions,
                  config: task.config,
                  stdio: 'inherit',
                  env: {
                    CLAUDE_TASK_ID: task.id || generateId('task'),
                    CLAUDE_TASK_TYPE: task.type || 'general',
                  },
                  processName: `claude-batch-${task.id || generateId('task')}`,
                  processType: 'agent',
                  metadata: {
                    taskId: task.id,
                    taskType: task.type,
                    workflowParallel: workflow.parallel
                  }
                }
              );
              
              console.log(colors.green(`Task ${task.name || task.id} completed with exit code ${result.exitCode}`));
              return { success: result.success, taskId: task.id || task.name, exitCode: result.exitCode };
            } catch (err) {
              console.error(colors.red(`Task ${task.name || task.id} failed:`), (err as Error).message);
              return { success: false, taskId: task.id || task.name, error: (err as Error).message };
            }
          }
        };
        
        if (workflow.parallel && !options.dryRun) {
          // Execute all tasks in parallel
          console.log(colors.blue('\nExecuting all tasks in parallel...'));
          const results = await Promise.allSettled(
            workflow.tasks.map((task: any) => executeTask(task))
          );
          
          const successCount = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
          const failureCount = results.length - successCount;
          
          console.log(colors.green(`\nParallel execution completed: ${successCount} successful, ${failureCount} failed`));
        } else {
          // Execute tasks sequentially
          for (const task of workflow.tasks) {
            const result = await executeTask(task);
            if (!result.success && !options.dryRun) {
              console.log(colors.red('Stopping sequential execution due to task failure'));
              break;
            }
          }
        }
        
      } catch (error) {
        console.error(colors.red('Failed to process workflow:'), (error as Error).message);
      }
    });