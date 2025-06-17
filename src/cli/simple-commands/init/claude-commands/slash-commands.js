// slash-commands.js - Create Claude Code slash commands

import { createSparcSlashCommand, createMainSparcCommand } from './sparc-commands.js';
import { createClaudeFlowCommands } from './claude-flow-commands.js';

// Create Claude Code slash commands for SPARC modes
export async function createClaudeSlashCommands(workingDir) {
  try {
    console.log('\n📝 Creating Claude Code slash commands...');
    
    // Parse .roomodes to get all SPARC modes
    const roomodesContent = await Deno.readTextFile(`${workingDir}/.roomodes`);
    const roomodes = JSON.parse(roomodesContent);
    
    // Create slash commands for each SPARC mode
    for (const mode of roomodes.customModes) {
      const commandPath = `${workingDir}/.claude/commands/sparc/${mode.slug}.md`;
      const commandContent = createSparcSlashCommand(mode);
      
      await Deno.writeTextFile(commandPath, commandContent);
      console.log(`  ✓ Created slash command: /sparc-${mode.slug}`);
    }
    
    // Create main SPARC command
    const mainSparcCommand = createMainSparcCommand(roomodes.customModes);
    await Deno.writeTextFile(`${workingDir}/.claude/commands/sparc.md`, mainSparcCommand);
    console.log('  ✓ Created main slash command: /sparc');
    
    // Create claude-flow specific commands
    await createClaudeFlowCommands(workingDir);
    
  } catch (err) {
    console.log(`  ⚠️  Could not create Claude Code slash commands: ${err.message}`);
  }
}