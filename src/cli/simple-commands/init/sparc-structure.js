// sparc-structure.js - Create SPARC development structure

import { createBasicRoomodesConfig } from './sparc/roomodes-config.js';
import { createBasicSparcWorkflow } from './sparc/workflows.js';
import { createRooReadme } from './sparc/roo-readme.js';
import { createClaudeSlashCommands } from './claude-commands/slash-commands.js';

// Helper function to create SPARC structure manually
export async function createSparcStructureManually() {
  try {
    // Ensure we're in the working directory
    const workingDir = Deno.env.get('PWD') || Deno.cwd();
    
    // Create .roo directory structure in working directory (legacy support)
    const rooDirectories = [
      `${workingDir}/.roo`,
      `${workingDir}/.roo/templates`,
      `${workingDir}/.roo/workflows`,
      `${workingDir}/.roo/modes`,
      `${workingDir}/.roo/configs`
    ];
    
    for (const dir of rooDirectories) {
      try {
        await Deno.mkdir(dir, { recursive: true });
        console.log(`  ✓ Created ${dir}/`);
      } catch (err) {
        if (!(err instanceof Deno.errors.AlreadyExists)) {
          throw err;
        }
      }
    }
    
    // Create .roomodes file (copy from existing if available, or create basic version)
    let roomodesContent;
    try {
      // Check if .roomodes already exists and read it
      roomodesContent = await Deno.readTextFile(`${workingDir}/.roomodes`);
      console.log('  ✓ Using existing .roomodes configuration');
    } catch {
      // Create basic .roomodes configuration
      roomodesContent = createBasicRoomodesConfig();
      await Deno.writeTextFile(`${workingDir}/.roomodes`, roomodesContent);
      console.log('  ✓ Created .roomodes configuration');
    }
    
    // Create basic workflow templates
    const basicWorkflow = createBasicSparcWorkflow();
    await Deno.writeTextFile(`${workingDir}/.roo/workflows/basic-tdd.json`, basicWorkflow);
    console.log('  ✓ Created .roo/workflows/basic-tdd.json');
    
    // Create README for .roo directory
    const rooReadme = createRooReadme();
    await Deno.writeTextFile(`${workingDir}/.roo/README.md`, rooReadme);
    console.log('  ✓ Created .roo/README.md');
    
    // Create Claude Code slash commands for SPARC modes
    await createClaudeSlashCommands(workingDir);
    
    console.log('  ✅ Basic SPARC structure created successfully');
    
  } catch (err) {
    console.log(`  ❌ Failed to create SPARC structure: ${err.message}`);
  }
}