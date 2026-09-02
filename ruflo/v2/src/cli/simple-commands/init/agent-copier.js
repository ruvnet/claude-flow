// agent-copier.js - Copy all agent files during initialization
import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Copy all agent files from the installed package to project directory
 */
export async function copyAgentFiles(targetDir, options = {}) {
  const { force = false, dryRun = false } = options;
  
  // Path to agent files - try multiple locations
  const packageAgentsDir = join(__dirname, '../../../../.claude/agents'); // From npm package
  const localAgentsDir = '/workspaces/claude-code-flow/.claude/agents';   // Local development
  const cwdAgentsDir = join(process.cwd(), '.claude/agents');              // Current working directory
  
  let sourceAgentsDir;
  
  // Try local development first, then package, then cwd
  try {
    await fs.access(localAgentsDir);
    sourceAgentsDir = localAgentsDir;
    console.log('  📁 Using local development agent files');
  } catch {
    try {
      await fs.access(packageAgentsDir);
      sourceAgentsDir = packageAgentsDir;
      console.log('  📁 Using packaged agent files');
    } catch {
      try {
        await fs.access(cwdAgentsDir);
        sourceAgentsDir = cwdAgentsDir;
        console.log('  📁 Using current directory agent files');
      } catch {
        console.log('  ⚠️  No agent files found in any location');
        return { success: false, error: 'Agent files not found' };
      }
    }
  }
  const targetAgentsDir = join(targetDir, '.claude/agents');
  
  console.log('📁 Copying agent system files...');
  console.log(`  📂 Source: ${sourceAgentsDir}`);
  console.log(`  📂 Target: ${targetAgentsDir}`);
  
  try {
    
    // Create target directory
    if (!dryRun) {
      await fs.mkdir(targetAgentsDir, { recursive: true });
    }
    
    const copiedFiles = [];
    const errors = [];
    
    // Recursively copy all agent files
    async function copyRecursive(srcDir, destDir) {
      const items = await fs.readdir(srcDir, { withFileTypes: true });
      
      for (const item of items) {
        const srcPath = join(srcDir, item.name);
        const destPath = join(destDir, item.name);
        
        if (item.isDirectory()) {
          if (!dryRun) {
            await fs.mkdir(destPath, { recursive: true });
          }
          await copyRecursive(srcPath, destPath);
        } else if (item.isFile() && item.name.endsWith('.md')) {
          try {
            // Check if file already exists
            let shouldCopy = force;
            if (!force) {
              try {
                await fs.access(destPath);
                // File exists, skip unless force is true
                continue;
              } catch {
                // File doesn't exist, safe to copy
                shouldCopy = true;
              }
            }
            
            if (shouldCopy && !dryRun) {
              const content = await fs.readFile(srcPath, 'utf8');
              await fs.writeFile(destPath, content, 'utf8');
              copiedFiles.push(destPath.replace(targetDir + '/', ''));
            } else if (dryRun) {
              copiedFiles.push(destPath.replace(targetDir + '/', ''));
            }
          } catch (err) {
            errors.push(`Failed to copy ${item.name}: ${err.message}`);
          }
        }
      }
    }
    
    await copyRecursive(sourceAgentsDir, targetAgentsDir);
    
    if (!dryRun && copiedFiles.length > 0) {
      console.log(`  ✅ Copied ${copiedFiles.length} agent files`);
      console.log('  📋 Agent system initialized with 64 specialized agents');
      console.log('  🎯 Available categories: Core, Swarm, Consensus, Performance, GitHub, SPARC, Testing');
    } else if (dryRun) {
      console.log(`  [DRY RUN] Would copy ${copiedFiles.length} agent files`);
    }
    
    if (errors.length > 0) {
      console.log('  ⚠️  Some agent files could not be copied:');
      errors.forEach(error => console.log(`    - ${error}`));
    }
    
    return {
      success: true,
      copiedFiles,
      errors,
      totalAgents: copiedFiles.length
    };
    
  } catch (err) {
    console.log(`  ❌ Failed to copy agent files: ${err.message}`);
    return {
      success: false,
      error: err.message,
      copiedFiles: [],
      errors: [err.message]
    };
  }
}

/**
 * Create agent directories structure
 */
export async function createAgentDirectories(targetDir, dryRun = false) {
  const agentDirs = [
    '.claude',
    '.claude/agents',
    '.claude/agents/core',
    '.claude/agents/swarm', 
    '.claude/agents/hive-mind',
    '.claude/agents/consensus',
    '.claude/agents/optimization',
    '.claude/agents/github',
    '.claude/agents/sparc',
    '.claude/agents/testing',
    '.claude/agents/testing/unit',
    '.claude/agents/testing/validation',
    '.claude/agents/templates',
    '.claude/agents/analysis',
    '.claude/agents/analysis/code-review',
    '.claude/agents/architecture',
    '.claude/agents/architecture/system-design',
    '.claude/agents/data',
    '.claude/agents/data/ml',
    '.claude/agents/development',
    '.claude/agents/development/backend',
    '.claude/agents/devops',
    '.claude/agents/devops/ci-cd',
    '.claude/agents/documentation',
    '.claude/agents/documentation/api-docs',
    '.claude/agents/specialized',
    '.claude/agents/specialized/mobile',
    '.claude/agents/flow-nexus',
    '.claude/commands',
    '.claude/commands/flow-nexus'
  ];
  
  if (dryRun) {
    console.log(`  [DRY RUN] Would create ${agentDirs.length} agent directories`);
    return;
  }
  
  for (const dir of agentDirs) {
    await fs.mkdir(join(targetDir, dir), { recursive: true });
  }
  
  console.log(`  ✅ Created ${agentDirs.length} agent directories`);
}

/**
 * Validate agent system after copying
 */
/**
 * Copy all command files from the installed package to project directory
 */
export async function copyCommandFiles(targetDir, options = {}) {
  const { force = false, dryRun = false } = options;
  
  // Path to command files - try multiple locations
  const packageCommandsDir = join(__dirname, '../../../../.claude/commands'); // From npm package
  const localCommandsDir = '/workspaces/claude-code-flow/.claude/commands';   // Local development
  const cwdCommandsDir = join(process.cwd(), '.claude/commands');              // Current working directory
  
  let sourceCommandsDir;
  
  // Try local development first, then package, then cwd
  try {
    await fs.access(localCommandsDir);
    sourceCommandsDir = localCommandsDir;
    console.log('  📁 Using local development command files');
  } catch {
    try {
      await fs.access(packageCommandsDir);
      sourceCommandsDir = packageCommandsDir;
      console.log('  📁 Using packaged command files');
    } catch {
      try {
        await fs.access(cwdCommandsDir);
        sourceCommandsDir = cwdCommandsDir;
        console.log('  📁 Using current directory command files');
      } catch {
        console.log('  ⚠️  No command files found in any location');
        return { success: false, error: 'Command files not found' };
      }
    }
  }
  
  const targetCommandsDir = join(targetDir, '.claude/commands');
  
  console.log('📁 Copying command system files...');
  console.log(`  📂 Source: ${sourceCommandsDir}`);
  console.log(`  📂 Target: ${targetCommandsDir}`);
  
  try {
    // Create target directory
    if (!dryRun) {
      await fs.mkdir(targetCommandsDir, { recursive: true });
    }
    
    const copiedFiles = [];
    const errors = [];
    
    // Recursively copy all command files
    async function copyRecursive(srcDir, destDir) {
      const items = await fs.readdir(srcDir, { withFileTypes: true });
      
      for (const item of items) {
        const srcPath = join(srcDir, item.name);
        const destPath = join(destDir, item.name);
        
        if (item.isDirectory()) {
          if (!dryRun) {
            await fs.mkdir(destPath, { recursive: true });
          }
          await copyRecursive(srcPath, destPath);
        } else if (item.isFile() && item.name.endsWith('.md')) {
          try {
            // Check if file already exists
            let shouldCopy = force;
            if (!force) {
              try {
                await fs.access(destPath);
                // File exists, skip unless force is true
                continue;
              } catch {
                // File doesn't exist, safe to copy
                shouldCopy = true;
              }
            }
            
            if (shouldCopy && !dryRun) {
              const content = await fs.readFile(srcPath, 'utf8');
              await fs.writeFile(destPath, content, 'utf8');
              copiedFiles.push(destPath.replace(targetDir + '/', ''));
            } else if (dryRun) {
              copiedFiles.push(destPath.replace(targetDir + '/', ''));
            }
          } catch (err) {
            errors.push(`Failed to copy ${item.name}: ${err.message}`);
          }
        }
      }
    }
    
    await copyRecursive(sourceCommandsDir, targetCommandsDir);
    
    if (!dryRun && copiedFiles.length > 0) {
      console.log(`  ✅ Copied ${copiedFiles.length} command files`);
      console.log('  📋 Command system initialized with comprehensive documentation');
      console.log('  🎯 Available categories: Analysis, Automation, GitHub, Hooks, Memory, Flow Nexus');
    } else if (dryRun) {
      console.log(`  [DRY RUN] Would copy ${copiedFiles.length} command files`);
    }
    
    if (errors.length > 0) {
      console.log('  ⚠️  Some command files could not be copied:');
      errors.forEach(error => console.log(`    - ${error}`));
    }
    
    return {
      success: true,
      copiedFiles,
      errors,
      totalCommands: copiedFiles.length
    };
    
  } catch (err) {
    console.log(`  ❌ Failed to copy command files: ${err.message}`);
    return {
      success: false,
      error: err.message,
      copiedFiles: [],
      errors: [err.message]
    };
  }
}

export async function validateAgentSystem(targetDir) {
  const agentsDir = join(targetDir, '.claude/agents');
  
  try {
    const categories = await fs.readdir(agentsDir, { withFileTypes: true });
    const agentCategories = categories.filter(item => item.isDirectory()).map(item => item.name);
    
    let totalAgents = 0;
    for (const category of agentCategories) {
      const categoryPath = join(agentsDir, category);
      const items = await fs.readdir(categoryPath, { withFileTypes: true });
      const agentFiles = items.filter(item => item.isFile() && item.name.endsWith('.md'));
      totalAgents += agentFiles.length;
    }
    
    console.log('  🔍 Agent system validation:');
    console.log(`    • Categories: ${agentCategories.length}`);
    console.log(`    • Total agents: ${totalAgents}`);
    console.log(`    • Categories: ${agentCategories.join(', ')}`);
    
    return {
      valid: totalAgents > 50, // Should have at least 50+ agents
      categories: agentCategories.length,
      totalAgents,
      categoryNames: agentCategories
    };
    
  } catch (err) {
    console.log(`  ⚠️  Agent system validation failed: ${err.message}`);
    return {
      valid: false,
      error: err.message
    };
  }
}