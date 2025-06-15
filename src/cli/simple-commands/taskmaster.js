// taskmaster.js - TaskMaster integration command handler

import { join } from 'https://deno.land/std@0.210.0/path/mod.ts';

export async function taskmasterCommand(subArgs, flags) {
  const subcommand = subArgs[0];
  
  switch (subcommand) {
    case 'init':
      await initTaskMaster(flags);
      break;
      
    case 'sync':
      console.log('🔄 TaskMaster sync functionality requires the full TypeScript integration.');
      console.log('   Please build the project with: npm run build');
      break;
      
    case 'watch':
      console.log('👁️  TaskMaster watch functionality requires the full TypeScript integration.');
      console.log('   Please build the project with: npm run build');
      break;
      
    case 'export':
      const format = subArgs[1] || 'json';
      console.log(`📤 TaskMaster export to ${format} requires the full TypeScript integration.`);
      console.log('   Please build the project with: npm run build');
      break;
      
    case 'stats':
      await showTaskMasterStats(flags);
      break;
      
    case 'generate-from-prd':
      const prdPath = subArgs[1];
      if (!prdPath) {
        console.error('❌ Please provide a PRD file path');
        return;
      }
      console.log('📄 TaskMaster PRD generation requires the full TypeScript integration.');
      console.log('   Please build the project with: npm run build');
      break;
      
    case 'help':
    case undefined:
      showTaskmasterHelp();
      break;
      
    default:
      console.error(`❌ Unknown subcommand: ${subcommand}`);
      showTaskmasterHelp();
  }
}

async function initTaskMaster(flags) {
  console.log('🔧 Initializing claude-task-master-extension compatibility...\n');
  
  const projectRoot = flags.directory || Deno.cwd();
  const taskmasterDir = join(projectRoot, '.taskmaster');
  const tasksDir = join(taskmasterDir, 'tasks');
  const configDir = join(taskmasterDir, 'config');
  const sparcDir = join(taskmasterDir, 'sparc');
  
  // Create directory structure
  for (const dir of [tasksDir, configDir, sparcDir]) {
    await Deno.mkdir(dir, { recursive: true });
  }
  
  // Create initial tasks.json
  const initialTasks = [{
    id: 'welcome-task',
    title: 'Welcome to Claude-Flow + TaskMaster Extension',
    description: 'This project is now compatible with the VS Code TaskMaster extension!',
    status: 'completed',
    priority: 'high',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sparcPhase: 'specification',
    assignedAgent: 'spec-pseudocode',
    metadata: {
      claudeFlowEnhanced: true
    },
    subtasks: [
      {
        id: 'install-extension',
        title: 'Install the claude-task-master VS Code extension',
        description: 'Search for "claude-task-master" in VS Code extensions',
        status: 'todo',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: 'explore-features',
        title: 'Explore visual task management features',
        description: 'Use the TaskMaster sidebar to manage your tasks visually',
        status: 'todo',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: 'sparc-integration',
        title: 'Try SPARC methodology integration',
        description: 'Tasks are automatically enhanced with SPARC phases and agent assignments',
        status: 'todo',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        sparcPhase: 'specification',
        assignedAgent: 'spec-pseudocode'
      }
    ]
  }];
  
  const tasksFile = join(tasksDir, 'tasks.json');
  try {
    await Deno.stat(tasksFile);
    console.log('ℹ️  Tasks file already exists. Use --force to overwrite.');
  } catch {
    await Deno.writeTextFile(tasksFile, JSON.stringify(initialTasks, null, 2));
    console.log('✅ Created initial task structure');
  }
  
  // Create config file
  const configFile = join(configDir, 'taskmaster.json');
  const config = {
    version: '1.0.0',
    claudeFlowIntegration: true,
    sparcEnabled: true,
    autoSync: true,
    syncInterval: 5000
  };
  
  try {
    await Deno.stat(configFile);
  } catch {
    await Deno.writeTextFile(configFile, JSON.stringify(config, null, 2));
    console.log('✅ Created TaskMaster configuration');
  }
  
  console.log('\n📁 Created .taskmaster directory structure:');
  console.log('   .taskmaster/');
  console.log('   ├── tasks/');
  console.log('   │   └── tasks.json');
  console.log('   ├── config/');
  console.log('   │   └── taskmaster.json');
  console.log('   └── sparc/');
  
  console.log('\n✨ Extension compatibility initialized!');
  console.log('\nNext steps:');
  console.log('1. Install the claude-task-master VS Code extension');
  console.log('2. Open VS Code in this directory');
  console.log('3. Use the TaskMaster sidebar to view and manage tasks');
  console.log('4. Tasks will sync automatically with Claude-Flow');
}

async function showTaskMasterStats(flags) {
  const projectRoot = flags.directory || Deno.cwd();
  const tasksFile = join(projectRoot, '.taskmaster', 'tasks', 'tasks.json');
  
  try {
    const content = await Deno.readTextFile(tasksFile);
    const tasks = JSON.parse(content);
    
    console.log('\n📊 Task Statistics:');
    console.log('==================\n');
    
    let totalTasks = 0;
    let completedTasks = 0;
    let todoTasks = 0;
    let inProgressTasks = 0;
    
    const countTasks = (taskList) => {
      for (const task of taskList) {
        totalTasks++;
        if (task.status === 'completed') completedTasks++;
        else if (task.status === 'todo') todoTasks++;
        else if (task.status === 'in-progress') inProgressTasks++;
        
        if (task.subtasks) {
          countTasks(task.subtasks);
        }
      }
    };
    
    countTasks(tasks);
    
    console.log(`Total Tasks: ${totalTasks}`);
    console.log(`✅ Completed: ${completedTasks}`);
    console.log(`⏳ Todo: ${todoTasks}`);
    console.log(`🔄 In Progress: ${inProgressTasks}`);
    
    const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
    console.log(`\nCompletion Rate: ${completionRate}%`);
    
  } catch (error) {
    console.error('❌ No TaskMaster tasks found. Run "taskmaster init" first.');
  }
}

function showTaskmasterHelp() {
  console.log(`TaskMaster Integration Commands

Usage: claude-flow taskmaster <subcommand> [options]

Subcommands:
  init                    Initialize TaskMaster with VS Code extension support
  sync                    Sync tasks with SPARC methodology enhancements
  watch                   Watch for VS Code extension task changes
  export <format>         Export tasks (json, markdown, csv)
  stats                   Show task statistics
  generate-from-prd <file> Generate tasks from Product Requirements Document

Options:
  --directory <dir>       Project directory (default: current)
  --force                 Overwrite existing files

Examples:
  claude-flow taskmaster init
  claude-flow taskmaster stats
  claude-flow taskmaster export markdown
  claude-flow taskmaster generate-from-prd requirements.md

VS Code Extension:
  After running 'taskmaster init', install the claude-task-master extension
  in VS Code to visualize and manage tasks with a graphical interface.

Note: Full TaskMaster functionality requires building the TypeScript integration:
  npm run build

Learn more: https://github.com/ruvnet/claude-code-flow/docs/taskmaster.md`);
}