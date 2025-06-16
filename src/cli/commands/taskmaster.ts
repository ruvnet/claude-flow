import { CommandContext, info, success, error, warning } from "../cli-core.ts";
import { cyan, bold, yellow, green, gray } from "https://deno.land/std@0.224.0/fmt/colors.ts";
import { TaskMasterDenoBridge } from "../../integrations/taskmaster/deno-bridge.ts";
import { TaskMasterAIBridge } from "../../integrations/taskmaster/deno-bridge-ai.ts";
import { join } from "https://deno.land/std@0.224.0/path/mod.ts";
import { createTaskMasterTemplateCommands } from "./taskmaster-templates.ts";

export async function taskmasterAction(ctx: CommandContext): Promise<void> {
  const { args, flags = {} } = ctx;
  const subcommand = args[0];
  const options = flags; // Map flags to options for consistency

  // Show help if no subcommand provided
  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    showTaskmasterHelp();
    return;
  }

  try {
    switch (subcommand) {
      case "parse":
        await handleParse(args[1], options);
        break;

      case "generate":
        await handleGenerate(args[1], options);
        break;

      case "sync":
        // Check if it's a sync server command
        if (args[1] === 'server') {
          await handleSyncServer(args.slice(2), options);
        } else {
          await handleSync(options);
        }
        break;
        
      case "list":
        await handleList(options);
        break;
        
      case "update":
        await handleUpdate(args[1], args[2], options);
        break;
        
      case "export":
        await handleExport(options);
        break;

      case "templates":
        await handleTemplates(args.slice(1), options);
        break;

      case "info":
        await handleInfo();
        break;
        
      case "analyze":
        await handleAnalyze(args[1], options);
        break;
        
      case "ai-status":
        await handleAIStatus();
        break;

      case "help":
        showTaskmasterHelp();
        break;

      default:
        error(`Unknown taskmaster subcommand: ${subcommand}`);
        showTaskmasterHelp();
    }
  } catch (err) {
    error(`TaskMaster command failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function handleParse(prdPath: string | undefined, options: any): Promise<void> {
  if (!prdPath) {
    error("PRD file path is required");
    return;
  }

  info(`Parsing PRD from: ${prdPath}`);
  
  try {
    // Use AI bridge if --ai flag is present
    const aiOptions = options.ai ? { apiKey: options.apiKey, model: options.model } : undefined;
    const taskmaster = options.ai 
      ? new TaskMasterAIBridge(aiOptions)
      : new TaskMasterDenoBridge();
    
    const prd = await taskmaster.parsePRD(prdPath, {
      ...options,
      useAI: options.ai,
      extractDetailedFeatures: options.detailed
    });
    
    success(`PRD parsed successfully: ${prd.title}`);
    if (options.verbose) {
      console.log(`  Sections: ${prd.sections.length}`);
      console.log(`  Created: ${prd.metadata.created}`);
    }
  } catch (err) {
    error(`Failed to parse PRD: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function handleGenerate(prdPath: string | undefined, options: any): Promise<void> {
  if (!prdPath) {
    error("PRD file path is required");
    return;
  }

  info(`Generating tasks from PRD: ${prdPath}`);
  
  try {
    // Use AI bridge if --ai flag is present
    const aiOptions = options.ai ? { apiKey: options.apiKey, model: options.model } : undefined;
    const taskmaster = options.ai 
      ? new TaskMasterAIBridge(aiOptions)
      : new TaskMasterDenoBridge();
      
    // Enable SPARC mapping and AI features
    const enhancedOptions = { 
      ...options, 
      sparcMapping: true,
      useAI: options.ai,
      enhanceDescriptions: options.ai && options.enhance !== false,
      extractDetailedFeatures: options.detailed,
      aiSuggestSparcModes: options.ai
    };
    const tasks = await taskmaster.generateTasks(prdPath, enhancedOptions);
    
    success(`Generated ${tasks.length} tasks successfully`);
    
    // Show tasks (temporarily always show for testing)
    tasks.forEach((task, index) => {
      console.log(`  ${index + 1}. ${cyan(task.title)} [${task.priority}]`);
      if (task.sparc_mode) {
        console.log(`     SPARC Mode: ${task.sparc_mode}`);
      }
    });
    
    // For testing, always save to a JSON file
    const outputPath = options.output || 'taskmaster-output.json';
    const outputFormat = options.format || 'json';
    
    let outputContent: string;
    if (outputFormat === 'json') {
      outputContent = JSON.stringify(tasks, null, 2);
    } else if (outputFormat === 'markdown') {
      outputContent = `# Generated Tasks\n\n${tasks.map((t, i) => 
        `## ${i + 1}. ${t.title}\n- **Priority**: ${t.priority}\n- **Type**: ${t.type}\n- **Status**: ${t.status}\n${t.sparc_mode ? `- **SPARC Mode**: ${t.sparc_mode}\n` : ''}- **Description**: ${t.description}\n`
      ).join('\n')}`;
    } else {
      outputContent = tasks.map(t => `- ${t.title}: ${t.description}`).join('\n');
    }
    
    await Deno.writeTextFile(outputPath, outputContent);
    info(`Tasks written to: ${outputPath}`);
  } catch (err) {
    error(`Failed to generate tasks: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function handleSync(options: any): Promise<void> {
  info("Syncing TaskMaster data...");
  
  try {
    const taskmaster = new TaskMasterDenoBridge();
    
    if (options.verbose) {
      taskmaster.on('sync:started', () => console.log('  Starting sync...'));
      taskmaster.on('sync:completed', () => console.log('  Sync completed'));
      taskmaster.on('sync:error', (err) => console.log(`  Sync error: ${err.message}`));
    }
    
    await taskmaster.syncWithVSCode();
    success("TaskMaster sync completed");
  } catch (err) {
    error(`Failed to sync: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function handleSyncServer(args: string[], options: any): Promise<void> {
  const action = args[0] || 'start';
  
  switch (action) {
    case 'start':
      info("Starting VS Code sync server...");
      console.log(cyan("\nSync Server Configuration:"));
      console.log(`  Port: ${options.port || 8765}`);
      console.log(`  Host: ${options.host || 'localhost'}`);
      console.log(`  WebSocket: ${options.websocket !== false ? 'Enabled' : 'Disabled'}`);
      console.log(`  HTTP: ${options.http !== false ? 'Enabled' : 'Disabled'}`);
      
      console.log("\n" + yellow("Note: This feature is still in development."));
      console.log("The VS Code extension sync server will start here when fully implemented.");
      console.log("\nFor now, use manual sync with: " + cyan("taskmaster sync"));
      break;
      
    case 'stop':
      info("Stopping VS Code sync server...");
      console.log(yellow("Sync server stop functionality not yet implemented."));
      break;
      
    case 'status':
      info("VS Code sync server status:");
      console.log(yellow("Server status functionality not yet implemented."));
      break;
      
    default:
      error(`Unknown sync server action: ${action}`);
      console.log("\nAvailable actions: start, stop, status");
  }
}

async function handleList(options: any): Promise<void> {
  try {
    const taskmaster = new TaskMasterDenoBridge();
    const storedPRDs = await taskmaster.getStoredPRDs();
    const storedTasks = await taskmaster.getStoredTasks();
    
    console.log();
    console.log(bold(cyan("Stored TaskMaster Data")));
    console.log();
    
    if (storedPRDs.length > 0) {
      console.log(bold("Recent PRDs:"));
      storedPRDs.forEach((prd, index) => {
        console.log(`  ${index + 1}. ${cyan(prd.title)}`);
        console.log(`     Path: ${prd.path}`);
        console.log(`     Created: ${new Date(prd.created).toLocaleString()}`);
      });
      console.log();
    }
    
    if (storedTasks.length > 0) {
      console.log(bold("Task Summaries:"));
      storedTasks.forEach((summary, index) => {
        console.log(`  ${index + 1}. ${cyan(summary.prdTitle)}`);
        console.log(`     Total Tasks: ${summary.taskCount}`);
        console.log(`     High Priority: ${summary.priorities.high}`);
        console.log(`     Medium Priority: ${summary.priorities.medium}`);
        console.log(`     Low Priority: ${summary.priorities.low}`);
        console.log(`     Generated: ${new Date(summary.created).toLocaleString()}`);
      });
    }
    
    if (storedPRDs.length === 0 && storedTasks.length === 0) {
      console.log("No TaskMaster data stored yet.");
      console.log("Use 'taskmaster generate <prd-file>' to get started.");
    }
  } catch (err) {
    error(`Failed to list stored data: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function handleUpdate(taskId: string | undefined, status: string | undefined, options: any): Promise<void> {
  if (!taskId || !status) {
    error("Task ID and status are required");
    console.log("Usage: taskmaster update <task-id> <status>");
    console.log("Status options: pending, in_progress, completed, blocked");
    return;
  }
  
  const validStatuses = ['pending', 'in_progress', 'completed', 'blocked'];
  if (!validStatuses.includes(status)) {
    error(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
    return;
  }
  
  try {
    const taskmaster = new TaskMasterDenoBridge();
    const updated = await taskmaster.updateTaskStatus(taskId, status);
    
    if (updated) {
      success(`Task ${taskId} updated to status: ${status}`);
      
      // Show task details if verbose
      if (options.verbose) {
        const task = await taskmaster.getTaskById(taskId);
        if (task) {
          console.log(`  Title: ${cyan(task.title)}`);
          console.log(`  Type: ${task.type}`);
          console.log(`  Priority: ${task.priority}`);
          console.log(`  Updated: ${new Date(task.updatedAt!).toLocaleString()}`);
        }
      }
    } else {
      error(`Task ${taskId} not found`);
    }
  } catch (err) {
    error(`Failed to update task: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function handleTemplates(args: string[], options: any): Promise<void> {
  // Delegate to template commands handler
  const templateCommands = createTaskMasterTemplateCommands();
  const subcommand = args[0] || 'help';
  
  // Convert to commander-compatible format
  const argv = ['node', 'taskmaster', 'templates', subcommand, ...args.slice(1)];
  
  // Add options as flags
  Object.entries(options).forEach(([key, value]) => {
    if (typeof value === 'boolean' && value) {
      argv.push(`--${key}`);
    } else if (value !== undefined && value !== null) {
      argv.push(`--${key}`, String(value));
    }
  });
  
  await templateCommands.parseAsync(argv);
}

async function handleExport(options: any): Promise<void> {
  try {
    const taskmaster = new TaskMasterDenoBridge();
    const format = options.format || 'json';
    const validFormats = ['json', 'markdown', 'csv'];
    
    if (!validFormats.includes(format)) {
      error(`Invalid format. Must be one of: ${validFormats.join(', ')}`);
      return;
    }
    
    info(`Exporting all tasks as ${format}...`);
    const content = await taskmaster.exportTasks(format as 'json' | 'markdown' | 'csv');
    
    const outputPath = options.output || `taskmaster-export.${format === 'markdown' ? 'md' : format}`;
    await Deno.writeTextFile(outputPath, content);
    
    success(`Tasks exported to: ${outputPath}`);
  } catch (err) {
    error(`Failed to export tasks: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function handleInfo(): Promise<void> {
  console.log();
  console.log(bold(cyan("TaskMaster Integration")));
  console.log();
  console.log("TaskMaster provides intelligent task generation from PRD documents.");
  console.log();
  console.log(bold("Features:"));
  console.log("  • Parse PRD documents (with optional AI enhancement)");
  console.log("  • Generate hierarchical task structures");
  console.log("  • SPARC methodology integration");
  console.log("  • VS Code extension sync");
  console.log("  • Memory-based storage and retrieval");
  console.log();
  console.log(bold("AI Features (when enabled):"));
  console.log("  • Enhanced PRD analysis and summarization");
  console.log("  • Detailed feature extraction");
  console.log("  • Intelligent task descriptions");
  console.log("  • Automatic SPARC mode suggestions");
  console.log("  • Effort estimation");
  console.log();
  console.log(bold("Available Commands:"));
  console.log(`  ${cyan("parse")}     Parse a PRD document`);
  console.log(`  ${cyan("generate")}  Generate tasks from PRD`);
  console.log(`  ${cyan("sync")}      Sync with VS Code extension`);
  console.log(`  ${cyan("list")}      Show stored PRDs and tasks`);
  console.log(`  ${cyan("update")}    Update task status`);
  console.log(`  ${cyan("export")}    Export all tasks`);
  console.log(`  ${cyan("templates")} Manage task templates`);
  console.log(`  ${cyan("analyze")} <prd>  Analyze PRD with AI (requires API key)`);
  console.log(`  ${cyan("ai-status")}  Check AI service status`);
  console.log(`  ${cyan("info")}      Show TaskMaster information`);
  console.log();
}

async function handleAnalyze(prdPath: string | undefined, options: any): Promise<void> {
  if (!prdPath) {
    error("PRD file path is required");
    return;
  }
  
  info(`Analyzing PRD with AI: ${prdPath}`);
  
  try {
    const taskmaster = new TaskMasterAIBridge({ apiKey: options.apiKey, model: options.model });
    const analysis = await taskmaster.analyzePRD(prdPath);
    
    console.log();
    console.log(bold(cyan("PRD Analysis Results")));
    console.log();
    console.log(bold("Summary:"));
    console.log(`  ${analysis.analysis.summary}`);
    console.log();
    console.log(bold("Complexity:"), analysis.analysis.complexity);
    console.log(bold("Estimated Effort:"), analysis.analysis.estimatedEffort);
    console.log();
    console.log(bold("Features Identified:"));
    analysis.analysis.features.forEach((feature: string, index: number) => {
      console.log(`  ${index + 1}. ${feature}`);
    });
    console.log();
    console.log(bold("Requirements:"));
    analysis.analysis.requirements.forEach((req: string, index: number) => {
      console.log(`  ${index + 1}. ${req}`);
    });
    
    success("PRD analysis completed");
  } catch (err) {
    error(`Failed to analyze PRD: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function handleAIStatus(): Promise<void> {
  try {
    const taskmaster = new TaskMasterAIBridge();
    const status = taskmaster.getAIStatus();
    
    console.log();
    console.log(bold(cyan("AI Service Status")));
    console.log();
    console.log(`Status: ${status.available ? green("✅ Available") : yellow("⚠️  Not Available")}`);
    
    if (status.available) {
      console.log(`Model: ${status.model}`);
      console.log();
      console.log(bold("Available Features:"));
      status.features.forEach(feature => {
        console.log(`  • ${feature}`);
      });
    } else {
      console.log();
      console.log(yellow("To enable AI features:"));
      console.log("  1. Get an API key from https://console.anthropic.com");
      console.log("  2. Set the environment variable:");
      console.log(gray("     export ANTHROPIC_API_KEY='your-key-here'"));
      console.log("  3. Or use the --api-key flag when running commands");
    }
    console.log();
  } catch (err) {
    error(`Failed to check AI status: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function showTaskmasterHelp(): void {
  console.log();
  console.log(bold(cyan("TaskMaster - PRD Parsing and Task Generation")));
  console.log();
  console.log("Usage: claude-flow taskmaster <command> [options]");
  console.log();
  console.log(bold("Commands:"));
  console.log();
  
  // Parse command
  console.log(`  ${cyan("parse")} <prd-file>        Parse and validate a PRD document`);
  console.log(`    ${gray("Options:")}`);
  console.log(`    ${gray("--ai                  Use AI for enhanced parsing")}`);
  console.log(`    ${gray("--detailed            Extract detailed features")}`);
  console.log(`    ${gray("--verbose             Show detailed parsing info")}`);
  console.log();
  
  // Generate command
  console.log(`  ${cyan("generate")} <prd-file>     Generate tasks from PRD`);
  console.log(`    ${gray("Options:")}`);
  console.log(`    ${gray("--output <file>       Output file path (default: stdout)")}`);
  console.log(`    ${gray("--format <type>       Output format: json|markdown|csv (default: json)")}`);
  console.log(`    ${gray("--depth <number>      Task hierarchy depth (default: 3)")}`);
  console.log(`    ${gray("--sparc-mapping       Enable SPARC mode mapping (default: true)")}`);
  console.log(`    ${gray("--ai                  Enable AI enhancement")}`);
  console.log(`    ${gray("--detailed            Generate detailed descriptions")}`);
  console.log(`    ${gray("--enhance             Enhance with AI suggestions")}`);
  console.log(`    ${gray("--verbose             Show generation progress")}`);
  console.log();
  
  // List command
  console.log(`  ${cyan("list")}                    Display stored PRDs and task summaries`);
  console.log(`    ${gray("No options")}`);
  console.log();
  
  // Update command
  console.log(`  ${cyan("update")} <task-id> <status>  Update task status`);
  console.log(`    ${gray("Status options: pending | in_progress | completed | blocked")}`);
  console.log();
  
  // Export command
  console.log(`  ${cyan("export")}                  Export all stored tasks`);
  console.log(`    ${gray("Options:")}`);
  console.log(`    ${gray("--format <type>       Export format: json|markdown|csv")}`);
  console.log(`    ${gray("--output <file>       Output file path")}`);
  console.log(`    ${gray("--filter <status>     Filter by status")}`);
  console.log();
  
  // AI Status command
  console.log(`  ${cyan("ai-status")}               Check AI configuration status`);
  console.log(`    ${gray("No options")}`);
  console.log();
  
  // Analyze command
  console.log(`  ${cyan("analyze")} <prd-file>      Analyze PRD with AI (requires API key)`);
  console.log(`    ${gray("Returns: Executive summary, complexity assessment, feature breakdown")}`);
  console.log(`    ${gray("         effort estimation, and risk analysis")}`);
  console.log();
  
  // Sync commands
  console.log(`  ${cyan("sync")}                    Sync with VS Code extension`);
  console.log(`    ${gray("Options:")}`);
  console.log(`    ${gray("--verbose             Show sync details")}`);
  console.log();
  
  console.log(`  ${cyan("sync server start")}       Start VS Code sync server`);
  console.log(`    ${gray("Options:")}`);
  console.log(`    ${gray("--port <number>       Server port (default: 5173)")}`);
  console.log(`    ${gray("--host <address>      Host address (default: localhost)")}`);
  console.log();
  
  console.log(`  ${cyan("sync server stop")}        Stop VS Code sync server`);
  console.log(`  ${cyan("sync server status")}      Check sync server status`);
  console.log();
  
  // Templates command
  console.log(`  ${cyan("templates list")}          List available templates`);
  console.log(`    ${gray("Note: Template system is partially implemented")}`);
  console.log();
  
  // Info and help
  console.log(`  ${cyan("info")}                    Display TaskMaster capabilities`);
  console.log(`  ${cyan("help")}                    Show this help message`);
  console.log();
  
  console.log(bold("Global Options:"));
  console.log("  --ai                    Enable AI features (requires ANTHROPIC_API_KEY)");
  console.log("  --api-key <key>         Anthropic API key (overrides env var)");
  console.log("  --model <name>          AI model (default: claude-3-haiku-20240307)");
  console.log();
  
  console.log(bold("Examples:"));
  console.log();
  console.log(`  ${yellow("# Basic task generation (no AI):")}`);  
  console.log(`  ${gray("claude-flow taskmaster generate requirements.prd --output tasks.json")}`);
  console.log();
  console.log(`  ${yellow("# Generate with SPARC mapping and markdown output:")}`);  
  console.log(`  ${gray("claude-flow taskmaster generate app.prd --sparc-mapping --format markdown")}`);
  console.log();
  console.log(`  ${yellow("# AI-enhanced generation (requires API key):")}`);
  console.log(`  ${gray("export ANTHROPIC_API_KEY='your-key'")}`);
  console.log(`  ${gray("claude-flow taskmaster generate app.prd --ai --detailed --enhance")}`);
  console.log();
  console.log(`  ${yellow("# Analyze PRD with AI:")}`);  
  console.log(`  ${gray("claude-flow taskmaster analyze requirements.prd")}`);
  console.log();
  console.log(`  ${yellow("# Export tasks in different formats:")}`);
  console.log(`  ${gray("claude-flow taskmaster export --format markdown --output tasks.md")}`);
  console.log(`  ${gray("claude-flow taskmaster export --format csv --output tasks.csv")}`);
  console.log();
  console.log(`  ${yellow("# Update task status:")}`);
  console.log(`  ${gray("claude-flow taskmaster update task-001 completed")}`);
  console.log();
  console.log(`  ${yellow("# Check AI configuration:")}`);
  console.log(`  ${gray("claude-flow taskmaster ai-status")}`);
  console.log();
}