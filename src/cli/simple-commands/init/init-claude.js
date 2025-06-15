// init-claude.js - Core initialization logic for Claude Code integration

import { join, dirname } from 'https://deno.land/std@0.210.0/path/mod.ts';
import { fromFileUrl } from 'https://deno.land/std@0.210.0/path/mod.ts';
import { createClaudeFlowCommands } from './claude-commands/claude-flow-commands.js';
import { createSparcSlashCommand, createMainSparcCommand } from './claude-commands/sparc-commands.js';
import { getClaudeMdTemplate } from './templates/claude-md.js';
import { showInitHelp } from './help.js';

const __dirname = dirname(fromFileUrl(import.meta.url));

export async function initClaude(options = {}) {
  // Handle help flag
  if (options.help) {
    showInitHelp();
    return;
  }

  console.log('🚀 Initializing Claude Code integration...\n');

  const projectRoot = Deno.cwd();
  const force = options.force || false;
  const minimal = options.minimal || false;
  const sparc = options.sparc || false;

  try {
    // Create basic directory structure
    const directories = ['memory', 'coordination'];
    if (!minimal) {
      directories.push('.claude/commands', '.claude/logs');
    }

    for (const dir of directories) {
      const dirPath = join(projectRoot, dir);
      try {
        await Deno.stat(dirPath);
        if (!force) {
          console.log(`⏭️  ${dir}/ already exists (use --force to overwrite)`);
        }
      } catch {
        await Deno.mkdir(dirPath, { recursive: true });
        console.log(`✅ Created ${dir}/ directory`);
      }
    }

    // Create CLAUDE.md file
    const claudeMdPath = join(projectRoot, 'CLAUDE.md');
    try {
      await Deno.stat(claudeMdPath);
      if (force) {
        const claudeMdContent = getClaudeMdTemplate(sparc);
        await Deno.writeTextFile(claudeMdPath, claudeMdContent);
        console.log('✅ Created CLAUDE.md with project instructions');
      } else {
        console.log('⏭️  CLAUDE.md already exists (use --force to overwrite)');
      }
    } catch {
      const claudeMdContent = getClaudeMdTemplate(sparc);
      await Deno.writeTextFile(claudeMdPath, claudeMdContent);
      console.log('✅ Created CLAUDE.md with project instructions');
    }

    // Create .roomodes file for SPARC modes if --sparc flag is used
    if (sparc) {
      const roomodesPath = join(projectRoot, '.roomodes');
      try {
        await Deno.stat(roomodesPath);
        if (force) {
          const roomodesContent = await createRoomodesFile();
          await Deno.writeTextFile(roomodesPath, JSON.stringify(roomodesContent, null, 2));
          console.log('✅ Created .roomodes with 17 SPARC development modes');
        } else {
          console.log('⏭️  .roomodes already exists (use --force to overwrite)');
        }
      } catch {
        const roomodesContent = await createRoomodesFile();
        await Deno.writeTextFile(roomodesPath, JSON.stringify(roomodesContent, null, 2));
        console.log('✅ Created .roomodes with 17 SPARC development modes');
      }

      // Create Claude Code slash commands
      if (!minimal) {
        await createClaudeCodeCommands(projectRoot, force);
      }
    }

    // Create local claude-flow wrapper
    const wrapperPath = join(projectRoot, 'claude-flow');
    try {
      await Deno.stat(wrapperPath);
      if (force) {
        const wrapperContent = `#!/usr/bin/env node
// Local Claude-Flow wrapper
import { runCLI } from 'claude-code-flow';
runCLI();
`;
        await Deno.writeTextFile(wrapperPath, wrapperContent);
        await Deno.chmod(wrapperPath, 0o755);
        console.log('✅ Created local ./claude-flow executable');
      }
    } catch {
      const wrapperContent = `#!/usr/bin/env node
// Local Claude-Flow wrapper
import { runCLI } from 'claude-code-flow';
runCLI();
`;
      await Deno.writeTextFile(wrapperPath, wrapperContent);
      await Deno.chmod(wrapperPath, 0o755);
      console.log('✅ Created local ./claude-flow executable');
    }

    // Create .gitignore entries
    await updateGitignore(projectRoot, force);

    console.log('\n✨ Claude Code integration initialized successfully!\n');

    if (sparc) {
      console.log('🎯 SPARC Development Environment Ready!\n');
      console.log('You can now use:');
      console.log('  • Claude Code slash commands: Type / in Claude Code');
      console.log('  • SPARC modes: ./claude-flow sparc modes');
      console.log('  • TDD workflow: ./claude-flow sparc tdd "feature name"');
      console.log('  • Memory system: ./claude-flow memory store/query');
      console.log('\nNext steps:');
      console.log('  1. Review CLAUDE.md for project instructions');
      console.log('  2. Try: ./claude-flow sparc info architect');
      console.log('  3. Start building: ./claude-flow sparc tdd "your first feature"');
    } else {
      console.log('Next steps:');
      console.log('  • Review CLAUDE.md for project instructions');
      console.log('  • Use ./claude-flow memory to store/query context');
      console.log('  • Run ./claude-flow init --sparc for full SPARC setup');
    }

  } catch (error) {
    console.error('❌ Error during initialization:', error.message);
    Deno.exit(1);
  }
}

async function createRoomodesFile() {
  // Return comprehensive SPARC modes configuration
  return {
    "modes": {
      "architect": {
        "name": "System Architect",
        "description": "Design system architecture and create component diagrams",
        "tools": ["read", "write", "edit", "browser", "mcp"],
        "capabilities": {
          "system_design": true,
          "architecture_diagrams": true,
          "api_design": true,
          "database_schemas": true,
          "component_relationships": true
        }
      },
      "code": {
        "name": "Code Generator",
        "description": "Generate clean, modular, and well-documented code",
        "tools": ["read", "write", "edit", "execute"],
        "capabilities": {
          "code_generation": true,
          "refactoring": true,
          "optimization": true,
          "best_practices": true
        }
      },
      "tdd": {
        "name": "Test-Driven Developer",
        "description": "Follow Red-Green-Refactor TDD cycle",
        "tools": ["read", "write", "edit", "execute"],
        "capabilities": {
          "test_first": true,
          "red_green_refactor": true,
          "test_coverage": true,
          "regression_testing": true
        }
      },
      "debug": {
        "name": "Debug Specialist",
        "description": "Advanced debugging and troubleshooting",
        "tools": ["read", "edit", "execute", "browser"],
        "capabilities": {
          "error_analysis": true,
          "performance_profiling": true,
          "memory_debugging": true,
          "trace_analysis": true
        }
      },
      "security-review": {
        "name": "Security Analyst",
        "description": "Security analysis and vulnerability assessment",
        "tools": ["read", "edit", "browser"],
        "capabilities": {
          "vulnerability_scanning": true,
          "security_best_practices": true,
          "penetration_testing": true,
          "compliance_checking": true
        }
      },
      "docs-writer": {
        "name": "Documentation Expert",
        "description": "Create comprehensive documentation",
        "tools": ["read", "write", "edit"],
        "capabilities": {
          "api_documentation": true,
          "user_guides": true,
          "technical_specs": true,
          "readme_generation": true
        }
      },
      "integration": {
        "name": "Integration Engineer",
        "description": "System integration and API coordination",
        "tools": ["read", "write", "edit", "execute", "browser", "mcp"],
        "capabilities": {
          "api_integration": true,
          "service_orchestration": true,
          "data_mapping": true,
          "protocol_handling": true
        }
      },
      "spec-pseudocode": {
        "name": "Specification Designer",
        "description": "Create detailed specifications and pseudocode",
        "tools": ["read", "write", "edit"],
        "capabilities": {
          "requirement_analysis": true,
          "algorithm_design": true,
          "data_flow_modeling": true,
          "edge_case_analysis": true
        }
      },
      "devops": {
        "name": "DevOps Engineer",
        "description": "Deployment, CI/CD, and infrastructure management",
        "tools": ["read", "write", "edit", "execute"],
        "capabilities": {
          "ci_cd_pipelines": true,
          "containerization": true,
          "infrastructure_as_code": true,
          "monitoring_setup": true
        }
      },
      "swarm": {
        "name": "Swarm Coordinator",
        "description": "Multi-agent task coordination",
        "tools": ["read", "write", "edit", "execute", "mcp"],
        "capabilities": {
          "agent_orchestration": true,
          "parallel_processing": true,
          "task_delegation": true,
          "result_aggregation": true
        }
      },
      "mcp": {
        "name": "MCP Integration Specialist",
        "description": "Model Context Protocol integration",
        "tools": ["read", "write", "edit", "execute", "mcp"],
        "capabilities": {
          "protocol_implementation": true,
          "service_integration": true,
          "context_management": true,
          "tool_development": true
        }
      },
      "refinement-optimization-mode": {
        "name": "Performance Optimizer",
        "description": "Code refinement and performance optimization",
        "tools": ["read", "edit", "execute"],
        "capabilities": {
          "performance_analysis": true,
          "code_optimization": true,
          "memory_optimization": true,
          "algorithm_improvement": true
        }
      },
      "monitoring": {
        "name": "System Monitor",
        "description": "Real-time monitoring and observability",
        "tools": ["read", "write", "execute", "browser"],
        "capabilities": {
          "metrics_collection": true,
          "log_analysis": true,
          "alerting_setup": true,
          "dashboard_creation": true
        }
      },
      "ask": {
        "name": "Interactive Assistant",
        "description": "Interactive Q&A and guidance",
        "tools": ["read", "browser"],
        "capabilities": {
          "question_answering": true,
          "code_explanation": true,
          "best_practice_guidance": true,
          "learning_support": true
        }
      },
      "generic": {
        "name": "General Purpose",
        "description": "Flexible mode for various tasks",
        "tools": ["read", "write", "edit", "execute", "browser", "mcp"],
        "capabilities": {
          "general_coding": true,
          "problem_solving": true,
          "research": true,
          "prototyping": true
        }
      },
      "supabase-admin": {
        "name": "Supabase Administrator",
        "description": "Supabase database and backend management",
        "tools": ["read", "write", "edit", "execute", "browser", "mcp"],
        "capabilities": {
          "database_management": true,
          "auth_configuration": true,
          "realtime_setup": true,
          "storage_management": true
        }
      },
      "tutorial": {
        "name": "Tutorial Creator",
        "description": "Create interactive tutorials and learning materials",
        "tools": ["read", "write", "edit"],
        "capabilities": {
          "step_by_step_guides": true,
          "code_examples": true,
          "interactive_exercises": true,
          "concept_explanation": true
        }
      }
    }
  };
}

async function createClaudeCodeCommands(projectRoot, force) {
  const commandsDir = join(projectRoot, '.claude', 'commands');
  
  // Ensure commands directory exists
  await Deno.mkdir(commandsDir, { recursive: true });
  
  // Create Claude-Flow commands
  await createClaudeFlowCommands(projectRoot);
  console.log('✅ Created Claude-Flow slash commands');

  // Create SPARC commands
  // First, we need to get the list of modes from the roomodes file
  const roomodesPath = join(projectRoot, '.roomodes');
  let modeObjects = [];
  try {
    const roomodesContent = await Deno.readTextFile(roomodesPath);
    const roomodes = JSON.parse(roomodesContent);
    // Convert to array of mode objects
    modeObjects = Object.entries(roomodes.modes || {}).map(([slug, mode]) => ({
      slug,
      name: mode.name || slug,
      description: mode.description || '',
      roleDefinition: mode.roleDefinition || mode.description || '',
      customInstructions: mode.customInstructions || '',
      groups: mode.tools || mode.groups || ['read', 'write', 'edit']
    }));
  } catch {
    // Use default modes if roomodes doesn't exist yet
    const defaultModes = {
      'architect': 'System Architect',
      'code': 'Code Generator',
      'tdd': 'Test-Driven Developer',
      'debug': 'Debug Specialist',
      'security-review': 'Security Analyst',
      'docs-writer': 'Documentation Expert',
      'integration': 'Integration Engineer',
      'spec-pseudocode': 'Specification Designer',
      'devops': 'DevOps Engineer',
      'swarm': 'Swarm Coordinator',
      'mcp': 'MCP Integration Specialist',
      'refinement-optimization-mode': 'Performance Optimizer',
      'monitoring': 'System Monitor',
      'ask': 'Interactive Assistant',
      'generic': 'General Purpose',
      'supabase-admin': 'Supabase Administrator',
      'tutorial': 'Tutorial Creator'
    };
    
    modeObjects = Object.entries(defaultModes).map(([slug, name]) => ({
      slug,
      name,
      description: name,
      roleDefinition: name,
      customInstructions: '',
      groups: ['read', 'write', 'edit']
    }));
  }
  
  // Create individual SPARC mode commands
  try {
    for (const mode of modeObjects) {
      try {
        const commandContent = createSparcSlashCommand(mode);
        const filename = `sparc-${mode.slug}.md`;
        const filepath = join(commandsDir, filename);
        
        try {
          await Deno.stat(filepath);
          if (force) {
            await Deno.writeTextFile(filepath, commandContent);
          }
        } catch {
          await Deno.writeTextFile(filepath, commandContent);
        }
      } catch (e) {
        console.error(`Error creating command for mode ${mode.slug}:`, e.message);
        console.error('Mode object:', mode);
        throw e;
      }
    }
    
    // Create main SPARC command
    try {
      const mainSparcContent = createMainSparcCommand(modeObjects);
      await Deno.writeTextFile(join(commandsDir, 'sparc.md'), mainSparcContent);
    } catch (e) {
      console.error('Error creating main SPARC command:', e.message);
      console.error('Mode objects:', modeObjects);
      throw e;
    }
  } catch (e) {
    console.error('Error creating SPARC commands:', e.message);
    throw e;
  }
  
  console.log('✅ Created SPARC mode slash commands (17 modes)');
}

async function updateGitignore(projectRoot, force) {
  const gitignorePath = join(projectRoot, '.gitignore');
  const entriesToAdd = [
    '\n# Claude-Flow',
    'memory/',
    'coordination/',
    '.claude/logs/',
    '*.log'
  ];

  try {
    const content = await Deno.readTextFile(gitignorePath);
    const missingEntries = entriesToAdd.filter(entry => !content.includes(entry.replace('\n# ', '')));
    
    if (missingEntries.length > 0) {
      await Deno.writeTextFile(gitignorePath, content + '\n' + missingEntries.join('\n'));
      console.log('✅ Updated .gitignore with Claude-Flow entries');
    }
  } catch {
    if (force) {
      await Deno.writeTextFile(gitignorePath, entriesToAdd.join('\n'));
      console.log('✅ Created .gitignore with Claude-Flow entries');
    }
  }
}