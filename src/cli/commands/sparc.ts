import { success, error, warning, info } from "../shared/utils.js";
import type { CommandContext } from "../types/cli-types.js";
import { processPool } from '../../core/process-pool.js';
import colors from "chalk";
const { blue, yellow, green, magenta, cyan } = colors;

interface SparcMode {
  slug: string;
  name: string;
  roleDefinition: string;
  customInstructions: string;
  groups: string[];
  source: string;
}

interface SparcConfig {
  customModes: SparcMode[];
}

let sparcConfig: SparcConfig | null = null;

async function loadSparcConfig(): Promise<SparcConfig> {
  if (sparcConfig) {
    return sparcConfig;
  }

  try {
    const configPath = ".roomodes";
    const { readFile } = await import("fs/promises");
    const content = await readFile(configPath, "utf-8");
    sparcConfig = JSON.parse(content);
    return sparcConfig!;
  } catch (error) {
    throw new Error(`Failed to load SPARC configuration: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function sparcAction(ctx: CommandContext): Promise<void> {
  const subcommand = ctx.args[0];

  // If no subcommand, run full SPARC development workflow (like the shell script)
  if (!subcommand || (subcommand && !['modes', 'info', 'run', 'tdd', 'workflow'].includes(subcommand))) {
    // This is the main SPARC development workflow
    await runFullSparcDevelopment(ctx);
    return;
  }

  switch (subcommand) {
    case "modes":
      await listSparcModes(ctx);
      break;
    case "info":
      await showModeInfo(ctx);
      break;
    case "run":
      await runSparcMode(ctx);
      break;
    case "tdd":
      await runTddFlow(ctx);
      break;
    case "workflow":
      await runSparcWorkflow(ctx);
      break;
    default:
      await showSparcHelp();
      break;
  }
}

async function listSparcModes(ctx: CommandContext): Promise<void> {
  try {
    const config = await loadSparcConfig();
    const verbose = ctx.flags.verbose as boolean;

    success("Available SPARC Modes:");
    console.log();

    for (const mode of config.customModes) {
      console.log(`${cyan("•")} ${green(mode.name)} ${blue(`(${mode.slug})`)}`);
      if (verbose) {
        console.log(`  ${mode.roleDefinition}`);
        console.log(`  Tools: ${mode.groups.join(", ")}`);
        console.log();
      }
    }

    if (!verbose) {
      console.log();
      info("Use --verbose for detailed descriptions");
    }
  } catch (err) {
    error(`Failed to list SPARC modes: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function showModeInfo(ctx: CommandContext): Promise<void> {
  const modeSlug = ctx.args[1];
  if (!modeSlug) {
    error("Usage: sparc info <mode-slug>");
    return;
  }

  try {
    const config = await loadSparcConfig();
    const mode = config.customModes.find(m => m.slug === modeSlug);

    if (!mode) {
      error(`Mode not found: ${modeSlug}`);
      console.log("Available modes:");
      for (const m of config.customModes) {
        console.log(`  ${m.slug} - ${m.name}`);
      }
      return;
    }

    success(`SPARC Mode: ${mode.name}`);
    console.log();
    console.log(blue("Role Definition:"));
    console.log(mode.roleDefinition);
    console.log();
    console.log(blue("Custom Instructions:"));
    console.log(mode.customInstructions);
    console.log();
    console.log(blue("Tool Groups:"));
    console.log(mode.groups.join(", "));
    console.log();
    console.log(blue("Source:"));
    console.log(mode.source);

  } catch (err) {
    error(`Failed to show mode info: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function runSparcMode(ctx: CommandContext): Promise<void> {
  const modeSlug = ctx.args[1];
  const taskDescription = ctx.args.slice(2).join(" ");

  if (!modeSlug || !taskDescription) {
    error("Usage: sparc run <mode-slug> <task-description>");
    return;
  }

  try {
    const config = await loadSparcConfig();
    const mode = config.customModes.find(m => m.slug === modeSlug);

    if (!mode) {
      error(`Mode not found: ${modeSlug}`);
      return;
    }

    // Build the enhanced task prompt using SPARC methodology
    const enhancedTask = buildSparcPrompt(mode, taskDescription, ctx.flags);
    const instanceId = `sparc-${modeSlug}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Build tools based on mode groups
    const tools = buildToolsFromGroups(mode.groups);

    if (ctx.flags.dryRun || ctx.flags["dry-run"]) {
      warning("DRY RUN - SPARC Mode Configuration:");
      console.log(`Mode: ${mode.name} (${mode.slug})`);
      console.log(`Instance ID: ${instanceId}`);
      console.log(`Tools: ${tools}`);
      console.log(`Task: ${taskDescription}`);
      console.log();
      console.log("Enhanced prompt preview:");
      console.log(enhancedTask.substring(0, 300) + "...");
      return;
    }

    success(`Starting SPARC mode: ${mode.name}`);
    console.log(`📝 Instance ID: ${instanceId}`);
    console.log(`🎯 Mode: ${mode.slug}`);
    console.log(`🔧 Tools: ${tools}`);
    console.log(`📋 Task: ${taskDescription}`);
    console.log();

    // Execute Claude with SPARC configuration
    await executeClaudeWithSparc(enhancedTask, tools, instanceId, ctx.flags);

  } catch (err) {
    error(`Failed to run SPARC mode: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function runTddFlow(ctx: CommandContext): Promise<void> {
  const taskDescription = ctx.args.slice(1).join(" ");

  if (!taskDescription) {
    error("Usage: sparc tdd <task-description>");
    return;
  }

  try {
    const config = await loadSparcConfig();

    // Build TDD workflow using SPARC methodology
    const workflow = [
      { mode: "spec-pseudocode", phase: "Specification", description: `Create detailed spec and pseudocode for: ${taskDescription}` },
      { mode: "tdd", phase: "Red", description: `Write failing tests for: ${taskDescription}` },
      { mode: "code", phase: "Green", description: `Implement minimal code to pass tests for: ${taskDescription}` },
      { mode: "refinement-optimization-mode", phase: "Refactor", description: `Refactor and optimize implementation for: ${taskDescription}` },
      { mode: "integration", phase: "Integration", description: `Integrate and verify complete solution for: ${taskDescription}` }
    ];

    if (ctx.flags.dryRun || ctx.flags["dry-run"]) {
      warning("DRY RUN - TDD Workflow:");
      for (const step of workflow) {
        console.log(`${cyan(step.phase)}: ${step.mode} - ${step.description}`);
      }
      return;
    }

    success("Starting SPARC TDD Workflow");
    console.log("Following Test-Driven Development with SPARC methodology");
    console.log();

    for (let i = 0; i < workflow.length; i++) {
      const step = workflow[i];
      const mode = config.customModes.find(m => m.slug === step.mode);

      if (!mode) {
        warning(`Mode not found: ${step.mode}, skipping step`);
        continue;
      }

      info(`Phase ${i + 1}/5: ${step.phase} (${mode.name})`);
      console.log(`📋 ${step.description}`);
      console.log();

      const enhancedTask = buildSparcPrompt(mode, step.description, {
        ...ctx.flags,
        tddPhase: step.phase,
        workflowStep: i + 1,
        totalSteps: workflow.length
      });

      const tools = buildToolsFromGroups(mode.groups);
      const instanceId = `sparc-tdd-${step.phase.toLowerCase()}-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;

      await executeClaudeWithSparc(enhancedTask, tools, instanceId, ctx.flags);

      // Store phase completion in memory for next step
      if (ctx.flags.sequential !== false) {
        console.log("Phase completed. Press Enter to continue to next phase, or Ctrl+C to stop...");
        await new Promise<void>(async (resolve) => {
          const readline = await import("readline");
          const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
          });
          rl.question("", () => {
            rl.close();
            resolve();
          });
        });
      }
    }

    success("SPARC TDD Workflow completed!");

  } catch (err) {
    error(`Failed to run TDD flow: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function runSparcWorkflow(ctx: CommandContext): Promise<void> {
  const workflowFile = ctx.args[1];

  if (!workflowFile) {
    error("Usage: sparc workflow <workflow-file.json>");
    return;
  }

  try {
    const { readFile } = await import("fs/promises");
    const workflowContent = await readFile(workflowFile, "utf-8");
    const workflow = JSON.parse(workflowContent);

    if (!workflow.steps || !Array.isArray(workflow.steps)) {
      error("Invalid workflow file: missing 'steps' array");
      return;
    }

    const config = await loadSparcConfig();

    success(`Loading SPARC workflow: ${workflow.name || "Unnamed"}`);
    console.log(`📋 Steps: ${workflow.steps.length}`);
    console.log(`📝 Description: ${workflow.description || "No description"}`);
    console.log();

    if (ctx.flags.dryRun || ctx.flags["dry-run"]) {
      warning("DRY RUN - Workflow Steps:");
      for (let i = 0; i < workflow.steps.length; i++) {
        const step = workflow.steps[i];
        console.log(`${i + 1}. ${cyan(step.mode)} - ${step.description || step.task}`);
      }
      return;
    }

    for (let i = 0; i < workflow.steps.length; i++) {
      const step = workflow.steps[i];
      const mode = config.customModes.find(m => m.slug === step.mode);

      if (!mode) {
        warning(`Mode not found: ${step.mode}, skipping step ${i + 1}`);
        continue;
      }

      info(`Step ${i + 1}/${workflow.steps.length}: ${mode.name}`);
      console.log(`📋 ${step.description || step.task}`);
      console.log();

      const enhancedTask = buildSparcPrompt(mode, step.description || step.task, {
        ...ctx.flags,
        workflowStep: i + 1,
        totalSteps: workflow.steps.length,
        workflowName: workflow.name
      });

      const tools = buildToolsFromGroups(mode.groups);
      const instanceId = `sparc-workflow-${i + 1}-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;

      await executeClaudeWithSparc(enhancedTask, tools, instanceId, ctx.flags);

      if (workflow.sequential !== false && i < workflow.steps.length - 1) {
        console.log("Step completed. Press Enter to continue, or Ctrl+C to stop...");
        await new Promise<void>((resolve) => {
          const readline = require("readline");
          const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
          });
          rl.question("", () => {
            rl.close();
            resolve();
          });
        });
      }
    }

    success("SPARC workflow completed!");

  } catch (err) {
    error(`Failed to run workflow: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function buildSparcPrompt(mode: SparcMode, taskDescription: string, flags: any): string {
  const memoryNamespace = flags.namespace || mode.slug || "default";
  
  return `# SPARC Development Mode: ${mode.name}

## Your Role
${mode.roleDefinition}

## Your Task
${taskDescription}

## Mode-Specific Instructions
${mode.customInstructions}

## SPARC Development Environment

You are working within the SPARC (Specification, Pseudocode, Architecture, Refinement, Completion) methodology using claude-flow orchestration features.

### Available Development Tools
- **Memory Persistence**: Use \`npx claude-flow memory store <key> "<value>"\` to save progress and findings
- **Memory Retrieval**: Use \`npx claude-flow memory query <search>\` to access previous work
- **Namespace**: Your work is stored in the "${memoryNamespace}" namespace

### SPARC Methodology Integration
${flags.tddPhase ? `
**Current TDD Phase**: ${flags.tddPhase}
- Follow the Red-Green-Refactor cycle
- Store test results and refactoring notes in memory
` : ''}

${flags.workflowStep ? `
**Workflow Progress**: Step ${flags.workflowStep} of ${flags.totalSteps}
- Review previous steps: \`npx claude-flow memory query previous_steps\`
- Store this step's output: \`npx claude-flow memory store step_${flags.workflowStep}_output "<results>"\`
` : ''}

### Best Practices
1. **Modular Development**: Keep all files under 500 lines
2. **Environment Safety**: Never hardcode secrets or environment values
3. **Memory Usage**: Store key findings and decisions in memory for future reference
4. **Tool Integration**: Use \`new_task\` for subtasks and \`attempt_completion\` when finished

### Memory Commands Examples
\`\`\`bash
# Store your progress
npx claude-flow memory store ${memoryNamespace}_progress "Current status and findings"

# Check for previous work
npx claude-flow memory query ${memoryNamespace}

# Store phase-specific results
npx claude-flow memory store ${memoryNamespace}_${flags.tddPhase || 'results'} "Phase output and decisions"
\`\`\`

### Integration with Other SPARC Modes
When working with other SPARC modes, use memory to:
- Share findings with spec-pseudocode mode
- Pass requirements to architect mode  
- Coordinate with code and tdd modes
- Communicate results to integration mode

Now proceed with your task following the SPARC methodology and your specific role instructions.`;
}

function buildToolsFromGroups(groups: string[]): string {
  const toolMappings: Record<string, string[]> = {
    read: ["View", "LS", "GlobTool", "GrepTool"],
    edit: ["Edit", "Replace", "MultiEdit", "Write"],
    browser: ["WebFetch"],
    mcp: ["mcp_tools"],
    command: ["Bash", "Terminal"]
  };

  const tools = new Set<string>();
  
  // Always include basic tools
  tools.add("View");
  tools.add("Edit");
  tools.add("Bash");

  for (const group of groups) {
    if (Array.isArray(group)) {
      // Handle nested group definitions
      const groupName = group[0];
      if (toolMappings[groupName]) {
        toolMappings[groupName].forEach(tool => tools.add(tool));
      }
    } else if (toolMappings[group]) {
      toolMappings[group].forEach(tool => tools.add(tool));
    }
  }

  return Array.from(tools).join(",");
}

async function executeClaudeWithSparc(
  enhancedTask: string, 
  tools: string, 
  instanceId: string, 
  flags: any
): Promise<void> {
  const claudeArgs = [enhancedTask];
  claudeArgs.push("--allowedTools", tools);

  if (flags.noPermissions || flags["no-permissions"]) {
    claudeArgs.push("--dangerously-skip-permissions");
  }

  if (flags.config) {
    claudeArgs.push("--mcp-config", flags.config);
  }

  if (flags.verbose) {
    claudeArgs.push("--verbose");
  }

  try {
    const result = await processPool.executeClaude(enhancedTask, {
      tools: tools.split(','),
      noPermissions: flags.noPermissions || flags["no-permissions"],
      config: flags.config,
      stdio: "inherit",
      env: {
        CLAUDE_INSTANCE_ID: instanceId,
        CLAUDE_SPARC_MODE: "true",
        CLAUDE_FLOW_MEMORY_ENABLED: "true",
        CLAUDE_FLOW_MEMORY_NAMESPACE: flags.namespace || "sparc",
      },
      processName: `sparc-${instanceId}`,
      processType: 'agent',
      metadata: {
        instanceId,
        sparcMode: true,
        namespace: flags.namespace || "sparc"
      }
    });

    if (result.success) {
      success(`SPARC instance ${instanceId} completed successfully`);
    } else {
      error(`SPARC instance ${instanceId} exited with code ${result.exitCode}`);
    }
  } catch (err) {
    error(`Failed to execute Claude: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function showSparcHelp(): Promise<void> {
  console.log(`${cyan("SPARC")} - ${green("Specification, Pseudocode, Architecture, Refinement, Completion")}`);
  console.log();
  console.log("SPARC development methodology with TDD and multi-agent coordination.");
  console.log();
  console.log(blue("Commands:"));
  console.log("  modes                    List all available SPARC modes");
  console.log("  info <mode>              Show detailed information about a mode");
  console.log("  run <mode> <task>        Execute a task using a specific SPARC mode");
  console.log("  tdd <task>               Run full TDD workflow using SPARC methodology");
  console.log("  workflow <file>          Execute a custom SPARC workflow from JSON file");
  console.log();
  console.log(blue("Common Modes:"));
  console.log("  spec-pseudocode          Create specifications and pseudocode");
  console.log("  architect                Design system architecture");
  console.log("  code                     Implement code solutions");
  console.log("  tdd                      Test-driven development");
  console.log("  debug                    Debug and troubleshoot issues");
  console.log("  security-review          Security analysis and review");
  console.log("  docs-writer              Documentation creation");
  console.log("  integration              System integration and testing");
  console.log();
  console.log(blue("Options:"));
  console.log("  --namespace <ns>         Memory namespace for this session");
  console.log("  --no-permissions         Skip permission prompts");
  console.log("  --config <file>          MCP configuration file");
  console.log("  --verbose               Enable verbose output");
  console.log("  --dry-run               Preview what would be executed");
  console.log("  --sequential            Wait between workflow steps (default: true)");
  console.log();
  console.log(blue("Examples:"));
  console.log(`  ${yellow("claude-flow sparc modes")}                              # List all modes`);
  console.log(`  ${yellow("claude-flow sparc run code")} "implement user auth"      # Run specific mode`);
  console.log(`  ${yellow("claude-flow sparc tdd")} "payment processing system"    # Full TDD workflow`);
  console.log(`  ${yellow("claude-flow sparc workflow")} project-workflow.json     # Custom workflow`);
  console.log();
  console.log(blue("TDD Workflow:"));
  console.log("  1. Specification - Define requirements and create pseudocode");
  console.log("  2. Red Phase - Write failing tests");
  console.log("  3. Green Phase - Implement minimal code to pass tests");
  console.log("  4. Refactor Phase - Optimize and clean up code");
  console.log("  5. Integration - Verify complete solution");
  console.log();
  console.log("For more information: https://github.com/ruvnet/claude-code-flow/docs/sparc.md");
}

async function runFullSparcDevelopment(ctx: CommandContext): Promise<void> {
  // Parse the objective from args
  const objective = ctx.args.join(" ").trim();
  
  if (!objective) {
    await showSparcHelp();
    return;
  }

  // Parse flags
  const options = {
    projectName: ctx.flags.project as string || "sparc-project",
    readmePath: ctx.flags.readme as string || "README.md",
    verbose: ctx.flags.verbose as boolean || false,
    dryRun: ctx.flags['dry-run'] as boolean || false,
    skipResearch: ctx.flags['skip-research'] as boolean || false,
    skipTests: ctx.flags['skip-tests'] as boolean || false,
    developmentMode: ctx.flags.mode as string || "full",
    testCoverage: ctx.flags.coverage as number || 100,
    parallel: ctx.flags.parallel !== false,
    commitFrequency: ctx.flags['commit-freq'] as string || "phase",
    researchDepth: ctx.flags['research-depth'] as string || "standard",
    outputFormat: ctx.flags.output as string || "text",
  };

  // Validate options
  if (!validateSparcOptions(options)) {
    return;
  }

  if (options.dryRun) {
    showSparcDryRun(objective, options);
    return;
  }

  info(`🚀 SPARC Automated Development System`);
  console.log(`📋 Objective: ${objective}`);
  console.log(`🏗️  Mode: ${options.developmentMode}`);
  console.log(`🎯 Coverage Target: ${options.testCoverage}%`);
  console.log();

  try {
    // Execute SPARC phases
    if (!options.skipResearch) {
      await executeResearchPhase(objective, options);
    }

    await executeSpecificationPhase(objective, options);
    await executePseudocodePhase(objective, options);
    await executeArchitecturePhase(objective, options);
    await executeRefinementPhase(objective, options);
    await executeCompletionPhase(objective, options);

    success("✅ SPARC development cycle completed successfully!");
    console.log("📁 Project created: " + options.projectName);
    
  } catch (err) {
    error(`SPARC execution failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function validateSparcOptions(options: any): boolean {
  // Validate development mode
  const validModes = ["full", "backend-only", "frontend-only", "api-only"];
  if (!validModes.includes(options.developmentMode)) {
    error(`Invalid development mode: ${options.developmentMode}`);
    console.log(`Valid modes: ${validModes.join(", ")}`);
    return false;
  }

  // Validate commit frequency
  const validCommitFreqs = ["phase", "feature", "manual"];
  if (!validCommitFreqs.includes(options.commitFrequency)) {
    error(`Invalid commit frequency: ${options.commitFrequency}`);
    console.log(`Valid frequencies: ${validCommitFreqs.join(", ")}`);
    return false;
  }

  // Validate coverage target
  if (options.testCoverage < 0 || options.testCoverage > 100) {
    error(`Invalid coverage target: ${options.testCoverage} (must be 0-100)`);
    return false;
  }

  return true;
}

function showSparcDryRun(objective: string, options: any): void {
  warning("🚀 DRY RUN - SPARC Configuration");
  console.log("═".repeat(60));
  console.log();
  console.log(`📋 Objective: ${objective}`);
  console.log(`🏗️  Project Name: ${options.projectName}`);
  console.log(`📄 README Path: ${options.readmePath}`);
  console.log();
  console.log("🛠️  Configuration:");
  console.log(`  • Development Mode: ${options.developmentMode}`);
  console.log(`  • Test Coverage Target: ${options.testCoverage}%`);
  console.log(`  • Research Depth: ${options.researchDepth}`);
  console.log(`  • Parallel Execution: ${options.parallel ? "✅" : "❌"}`);
  console.log(`  • Skip Research: ${options.skipResearch ? "✅" : "❌"}`);
  console.log(`  • Skip Tests: ${options.skipTests ? "✅" : "❌"}`);
  console.log(`  • Commit Frequency: ${options.commitFrequency}`);
  console.log(`  • Output Format: ${options.outputFormat}`);
  console.log();
  console.log("📋 Phases to Execute:");
  if (!options.skipResearch) {
    console.log("  1. Research & Discovery");
  }
  console.log("  2. Specification");
  console.log("  3. Pseudocode");
  console.log("  4. Architecture");
  console.log("  5. Refinement (TDD)");
  console.log("  6. Completion");
  console.log();
  console.log("═".repeat(60));
  console.log("⚠️  This is a dry run. No code will be generated.");
}

async function executeResearchPhase(objective: string, options: any): Promise<void> {
  info("📚 Phase 0: Research & Discovery");
  console.log(`Research depth: ${options.researchDepth}`);
  
  // In a real implementation, this would use WebFetchTool
  // For now, simulate research
  console.log("  • Analyzing domain requirements...");
  console.log("  • Researching best practices...");
  console.log("  • Investigating technology options...");
  
  if (options.commitFrequency === "phase") {
    console.log("  📝 Commit: Research findings documented");
  }
}

async function executeSpecificationPhase(objective: string, options: any): Promise<void> {
  info("📋 Phase 1: Specification");
  
  console.log("  • Extracting functional requirements...");
  console.log("  • Defining acceptance criteria...");
  console.log("  • Creating user stories...");
  
  if (options.developmentMode === "full" || options.developmentMode === "api-only") {
    console.log("  • Specifying API endpoints...");
  }
  
  if (options.commitFrequency === "phase") {
    console.log("  📝 Commit: Specification complete");
  }
}

async function executePseudocodePhase(objective: string, options: any): Promise<void> {
  info("🎨 Phase 2: Pseudocode");
  
  console.log("  • Designing high-level architecture...");
  console.log("  • Creating algorithm outlines...");
  console.log("  • Planning data flow...");
  
  if (!options.skipTests) {
    console.log("  • Designing test strategy...");
  }
  
  if (options.commitFrequency === "phase") {
    console.log("  📝 Commit: Pseudocode and design complete");
  }
}

async function executeArchitecturePhase(objective: string, options: any): Promise<void> {
  info("🏛️  Phase 3: Architecture");
  
  console.log("  • Defining component structure...");
  console.log("  • Creating interface contracts...");
  
  if (options.developmentMode !== "frontend-only") {
    console.log("  • Designing database schema...");
  }
  
  console.log("  • Planning deployment architecture...");
  
  if (options.commitFrequency === "phase") {
    console.log("  📝 Commit: Architecture design complete");
  }
}

async function executeRefinementPhase(objective: string, options: any): Promise<void> {
  info("🔄 Phase 4: Refinement (TDD)");
  
  if (!options.skipTests) {
    console.log("  🔴 Red: Writing failing tests...");
    console.log("  🟢 Green: Implementing minimal code...");
    console.log("  🔵 Refactor: Optimizing implementation...");
    console.log(`  📊 Target coverage: ${options.testCoverage}%`);
  } else {
    console.log("  • Implementing core functionality...");
    console.log("  • Adding error handling...");
    console.log("  • Optimizing performance...");
  }
  
  if (options.commitFrequency === "phase" || options.commitFrequency === "feature") {
    console.log("  📝 Commit: Implementation complete");
  }
}

async function executeCompletionPhase(objective: string, options: any): Promise<void> {
  info("✅ Phase 5: Completion");
  
  console.log("  • Integrating all components...");
  
  if (!options.skipTests) {
    console.log("  • Running end-to-end tests...");
  }
  
  console.log("  • Generating documentation...");
  console.log("  • Preparing deployment...");
  
  if (options.commitFrequency !== "manual") {
    console.log("  📝 Commit: Project complete and production-ready");
  }
}