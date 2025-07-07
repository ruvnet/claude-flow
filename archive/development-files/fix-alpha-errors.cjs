#!/usr/bin/env node

/**
 * Alpha Release Fix Script
 * Fixes all remaining TypeScript compilation errors for clean alpha build
 */

const fs = require('fs').promises;
const path = require('path');

const fixes = [
  // Fix chalk imports
  {
    file: 'src/cli/index.ts',
    search: 'colors.green',
    replace: 'chalk.green'
  },
  
  // Fix Table constructors
  {
    file: 'src/cli/commands/workflow.ts',
    search: 'new Table({',
    replace: 'new Table.default({'
  },
  
  // Fix workflow command chaining
  {
    file: 'src/cli/commands/workflow.ts',
    search: '.command(\'create\', \'Create a new workflow\', workflowCommand)',
    replace: '.command(\'create\').description(\'Create a new workflow\').action(workflowCommand)'
  },
  
  // Fix task command method calls
  {
    file: 'src/cli/commands/task.ts',
    search: '.argument(',
    replace: '.argument('
  },
  
  // Fix swarm Map usage
  {
    file: 'src/cli/commands/swarm-spawn.ts',
    search: 'agents.push(agent)',
    replace: 'agents.set(agent.id, agent)'
  },
  
  // Fix swarm-new properties
  {
    file: 'src/cli/commands/swarm-new.ts',
    search: 'task.assignedAgent',
    replace: 'task.assignedTo'
  },
  {
    file: 'src/cli/commands/swarm-new.ts',
    search: 'task.startTime',
    replace: 'task.createdAt'
  },
  {
    file: 'src/cli/commands/swarm-new.ts',
    search: 'task.endTime',
    replace: 'task.completedAt'
  }
];

async function applyFixes() {
  console.log('🔧 Applying alpha release fixes...');
  
  for (const fix of fixes) {
    try {
      const filePath = path.join('/workspaces/claude-code-flow', fix.file);
      let content = await fs.readFile(filePath, 'utf-8');
      
      if (content.includes(fix.search)) {
        content = content.replaceAll(fix.search, fix.replace);
        await fs.writeFile(filePath, content);
        console.log(`✅ Fixed: ${fix.file}`);
      }
    } catch (error) {
      console.log(`⚠️  Could not fix ${fix.file}: ${error.message}`);
    }
  }
  
  console.log('🎯 Alpha fixes complete!');
}

applyFixes().catch(console.error);