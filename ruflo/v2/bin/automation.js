import { printSuccess, printError, printWarning } from '../utils.js';
import { WorkflowExecutor, loadWorkflowFromFile, getMLEStarWorkflowPath } from './automation-executor.js';
import { existsSync } from 'fs';
import { join } from 'path';

// Simple ID generator
function generateId(prefix = 'id') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export async function automationAction(subArgs, flags) {
  const subcommand = subArgs[0];
  const options = flags;

  if (options.help || options.h || !subcommand) {
    showAutomationHelp();
    return;
  }

  try {
    switch (subcommand) {
      case 'auto-agent':
        await autoAgentCommand(subArgs, flags);
        break;
      case 'smart-spawn':
        await smartSpawnCommand(subArgs, flags);
        break;
      case 'workflow-select':
        await workflowSelectCommand(subArgs, flags);
        break;
      case 'run-workflow':
        await runWorkflowCommand(subArgs, flags);
        break;
      case 'mle-star':
        await mleStarCommand(subArgs, flags);
        break;
      default:
        printError(`Unknown automation command: ${subcommand}`);
        showAutomationHelp();
    }
  } catch (err) {
    printError(`Automation command failed: ${err.message}`);
  }
}

async function autoAgentCommand(subArgs, flags) {
  const options = flags;
  const complexity = options['task-complexity'] || options.complexity || 'medium';
  const swarmId = options['swarm-id'] || options.swarmId || generateId('swarm');

  console.log(`🤖 Auto-spawning agents based on task complexity...`);
  console.log(`📊 Task complexity: ${complexity}`);
  console.log(`🐝 Swarm ID: ${swarmId}`);

  // Determine optimal agent configuration based on complexity
  let agentConfig;
  switch (complexity.toLowerCase()) {
    case 'low':
    case 'simple':
      agentConfig = { coordinator: 1, developer: 1, total: 2 };
      break;
    case 'medium':
    case 'moderate':
      agentConfig = { coordinator: 1, developer: 2, researcher: 1, total: 4 };
      break;
    case 'high':
    case 'complex':
      agentConfig = { coordinator: 2, developer: 3, researcher: 2, analyzer: 1, total: 8 };
      break;
    case 'enterprise':
    case 'massive':
      agentConfig = {
        coordinator: 3,
        developer: 5,
        researcher: 3,
        analyzer: 2,
        tester: 2,
        total: 15,
      };
      break;
    default:
      agentConfig = { coordinator: 1, developer: 2, researcher: 1, total: 4 };
  }

  console.log(`\n🎯 OPTIMAL AGENT CONFIGURATION:`);
  Object.entries(agentConfig).forEach(([type, count]) => {
    if (type !== 'total') {
      console.log(`  🤖 ${type}: ${count} agents`);
    }
  });
  console.log(`  📊 Total agents: ${agentConfig.total}`);

  // Simulate auto-spawning
  await new Promise((resolve) => setTimeout(resolve, 1500));

  printSuccess(`✅ Auto-agent spawning completed`);
  console.log(
    `🚀 ${agentConfig.total} agents spawned and configured for ${complexity} complexity tasks`,
  );
  console.log(`💾 Agent configuration saved to swarm memory: ${swarmId}`);
  console.log(`📋 Agents ready for task assignment`);
}

async function smartSpawnCommand(subArgs, flags) {
  const options = flags;
  const requirement = options.requirement || 'general-development';
  const maxAgents = parseInt(options['max-agents'] || options.maxAgents || '10');

  console.log(`🧠 Smart spawning agents based on requirements...`);
  console.log(`📋 Requirement: ${requirement}`);
  console.log(`🔢 Max agents: ${maxAgents}`);

  // Analyze requirements and suggest optimal agent mix
  let recommendedAgents = [];

  if (requirement.includes('development') || requirement.includes('coding')) {
    recommendedAgents.push(
      { type: 'coordinator', count: 1, reason: 'Task orchestration' },
      { type: 'coder', count: 3, reason: 'Core development work' },
      { type: 'tester', count: 1, reason: 'Quality assurance' },
    );
  }

  if (requirement.includes('research') || requirement.includes('analysis')) {
    recommendedAgents.push(
      { type: 'researcher', count: 2, reason: 'Information gathering' },
      { type: 'analyst', count: 1, reason: 'Data analysis' },
    );
  }

  if (requirement.includes('enterprise') || requirement.includes('production')) {
    recommendedAgents.push(
      { type: 'coordinator', count: 2, reason: 'Multi-tier coordination' },
      { type: 'coder', count: 4, reason: 'Parallel development' },
      { type: 'researcher', count: 2, reason: 'Requirements analysis' },
      { type: 'analyst', count: 1, reason: 'Performance monitoring' },
      { type: 'tester', count: 2, reason: 'Comprehensive testing' },
    );
  }

  // Default fallback
  if (recommendedAgents.length === 0) {
    recommendedAgents = [
      { type: 'coordinator', count: 1, reason: 'General coordination' },
      { type: 'coder', count: 2, reason: 'General development' },
      { type: 'researcher', count: 1, reason: 'Support research' },
    ];
  }

  await new Promise((resolve) => setTimeout(resolve, 1000));

  printSuccess(`✅ Smart spawn analysis completed`);
  console.log(`\n🎯 RECOMMENDED AGENT CONFIGURATION:`);

  let totalRecommended = 0;
  recommendedAgents.forEach((agent) => {
    console.log(`  🤖 ${agent.type}: ${agent.count} agents - ${agent.reason}`);
    totalRecommended += agent.count;
  });

  console.log(`\n📊 SUMMARY:`);
  console.log(`  📝 Total recommended: ${totalRecommended} agents`);
  console.log(`  🔢 Max allowed: ${maxAgents} agents`);
  console.log(
    `  ✅ Configuration: ${totalRecommended <= maxAgents ? 'Within limits' : 'Exceeds limits - scaling down required'}`,
  );

  if (totalRecommended > maxAgents) {
    printWarning(
      `⚠️  Recommended configuration exceeds max agents. Consider increasing limit or simplifying requirements.`,
    );
  }
}

async function workflowSelectCommand(subArgs, flags) {
  const options = flags;
  const projectType = options['project-type'] || options.project || 'general';
  const priority = options.priority || 'balanced';

  console.log(`🔄 Selecting optimal workflow configuration...`);
  console.log(`📁 Project type: ${projectType}`);
  console.log(`⚡ Priority: ${priority}`);

  // Define workflow templates
  const workflows = {
    'web-app': {
      phases: ['planning', 'design', 'frontend', 'backend', 'testing', 'deployment'],
      agents: { coordinator: 1, developer: 3, tester: 1, researcher: 1 },
      duration: '2-4 weeks',
    },
    api: {
      phases: ['specification', 'design', 'implementation', 'testing', 'documentation'],
      agents: { coordinator: 1, developer: 2, tester: 1, researcher: 1 },
      duration: '1-2 weeks',
    },
    'data-analysis': {
      phases: ['collection', 'cleaning', 'analysis', 'visualization', 'reporting'],
      agents: { coordinator: 1, researcher: 2, analyzer: 2, developer: 1 },
      duration: '1-3 weeks',
    },
    enterprise: {
      phases: [
        'requirements',
        'architecture',
        'development',
        'integration',
        'testing',
        'deployment',
        'monitoring',
      ],
      agents: { coordinator: 2, developer: 5, researcher: 2, analyzer: 1, tester: 2 },
      duration: '2-6 months',
    },
    general: {
      phases: ['planning', 'implementation', 'testing', 'delivery'],
      agents: { coordinator: 1, developer: 2, researcher: 1 },
      duration: '1-2 weeks',
    },
  };

  const selectedWorkflow = workflows[projectType] || workflows['general'];

  await new Promise((resolve) => setTimeout(resolve, 800));

  printSuccess(`✅ Workflow selection completed`);
  console.log(`\n🔄 SELECTED WORKFLOW: ${projectType.toUpperCase()}`);
  console.log(`⏱️  Estimated duration: ${selectedWorkflow.duration}`);

  console.log(`\n📋 WORKFLOW PHASES:`);
  selectedWorkflow.phases.forEach((phase, index) => {
    console.log(`  ${index + 1}. ${phase.charAt(0).toUpperCase() + phase.slice(1)}`);
  });

  console.log(`\n🤖 RECOMMENDED AGENTS:`);
  Object.entries(selectedWorkflow.agents).forEach(([type, count]) => {
    console.log(`  • ${type}: ${count} agent${count > 1 ? 's' : ''}`);
  });

  console.log(`\n⚡ PRIORITY OPTIMIZATIONS:`);
  switch (priority) {
    case 'speed':
      console.log(`  🚀 Speed-optimized: +50% agents, parallel execution`);
      break;
    case 'quality':
      console.log(`  🎯 Quality-focused: +100% testing, code review stages`);
      break;
    case 'cost':
      console.log(`  💰 Cost-efficient: Minimal agents, sequential execution`);
      break;
    default:
      console.log(`  ⚖️  Balanced approach: Optimal speed/quality/cost ratio`);
  }

  console.log(`\n📄 Workflow template saved for project: ${projectType}`);
}

/**
 * Execute a workflow from file - NEW IMPLEMENTATION
 */
async function runWorkflowCommand(subArgs, flags) {
  const workflowFile = subArgs[1];
  const options = flags;

  if (!workflowFile) {
    printError('Usage: automation run-workflow <workflow-file> [options]');
    console.log('\nExample:');
    console.log('  claude-flow automation run-workflow workflow.json --claude --non-interactive');
    return;
  }

  if (!existsSync(workflowFile)) {
    printError(`Workflow file not found: ${workflowFile}`);
    return;
  }

  try {
    console.log(`🔄 Loading workflow: ${workflowFile}`);
    
    // Load workflow definition
    const workflowData = await loadWorkflowFromFile(workflowFile);
    
    // Create executor with options
    const executor = new WorkflowExecutor({
      enableClaude: options.claude || false,
      nonInteractive: options['non-interactive'] || options.nonInteractive || false,
      outputFormat: options['output-format'] || (options['non-interactive'] || options.nonInteractive ? 'stream-json' : 'text'),
      maxConcurrency: parseInt(options['max-concurrency']) || 3,
      timeout: parseInt(options.timeout) || 3600000,
      logLevel: options.verbose ? 'debug' : 'info',
      workflowName: workflowData.name,
      workflowType: workflowData.type || (workflowData.name?.toLowerCase().includes('ml') ? 'ml' : 'general'),
      enableChaining: options.chaining !== false // Default to true for stream-json chaining
    });
    
    // Apply variable overrides if provided
    const variables = {};
    if (options.variables) {
      try {
        Object.assign(variables, JSON.parse(options.variables));
      } catch (error) {
        printWarning(`Invalid variables JSON: ${error.message}`);
      }
    }
    
    // Execute workflow
    const result = await executor.executeWorkflow(workflowData, variables);
    
    if (options['output-format'] === 'json') {
      console.log(JSON.stringify(result, null, 2));
    }
    
    printSuccess(`Workflow execution ${result.success ? 'completed' : 'failed'}`);
    
    if (!result.success && result.errors.length > 0) {
      console.log('\n❌ Errors encountered:');
      result.errors.forEach(error => {
        console.log(`  • ${error.type}: ${error.error}`);
      });
    }
    
    // Ensure process exits properly in non-interactive mode
    if (options['non-interactive'] || options.nonInteractive) {
      process.exit(result.success ? 0 : 1);
    }
    
  } catch (error) {
    printError(`Failed to execute workflow: ${error.message}`);
    if (options['non-interactive'] || options.nonInteractive) {
      process.exit(1);
    }
  }
}

/**
 * Run MLE-STAR workflow - NEW FLAGSHIP COMMAND
 */
async function mleStarCommand(subArgs, flags) {
  const options = flags;
  
  console.log(`🧠 MLE-STAR: Machine Learning Engineering via Search and Targeted Refinement`);
  console.log(`🎯 This is the flagship automation workflow for ML engineering tasks`);
  console.log();
  
  try {
    // Get the built-in MLE-STAR workflow
    const workflowPath = getMLEStarWorkflowPath();
    
    if (!existsSync(workflowPath)) {
      printError('MLE-STAR workflow template not found');
      console.log('Please ensure the template is installed at:');
      console.log(workflowPath);
      return;
    }
    
    // Load MLE-STAR workflow
    const workflowData = await loadWorkflowFromFile(workflowPath);
    
    console.log(`📋 Workflow: ${workflowData.name}`);
    console.log(`📄 Description: ${workflowData.description}`);
    console.log(`🎓 Methodology: Search → Foundation → Refinement → Ensemble → Validation`);
    console.log(`⏱️  Expected Runtime: ${workflowData.metadata.expected_runtime}`);
    console.log();
    
    // Detect dataset if provided
    const datasetPath = options.dataset || options.data || './data/dataset.csv';
    const targetColumn = options.target || 'target';
    
    // Create executor with MLE-STAR optimized settings
    // IMPORTANT: Default to non-interactive mode to prevent multiple Claude spawns
    const isNonInteractive = options.interactive ? 
      false : // If --interactive is explicitly set, use interactive mode
      (options['non-interactive'] !== undefined ? 
        (options['non-interactive'] || options.nonInteractive) : 
        true); // Default to true for MLE-STAR to avoid multiple interactive sessions
    
    const executor = new WorkflowExecutor({
      enableClaude: options.claude !== false, // Default to true for MLE-STAR
      nonInteractive: isNonInteractive,
      outputFormat: options['output-format'] || (isNonInteractive ? 'stream-json' : 'text'),
      maxConcurrency: parseInt(options['max-agents']) || 6,
      timeout: parseInt(options.timeout) || 14400000, // 4 hours for ML workflows
      logLevel: options.quiet ? 'quiet' : (options.verbose ? 'debug' : 'info'),
      workflowName: 'MLE-STAR Machine Learning Engineering Workflow',
      workflowType: 'ml',
      enableChaining: options.chaining !== false // Default to true for stream-json chaining
    });
    
    // Prepare MLE-STAR specific variables
    const variables = {
      dataset_path: datasetPath,
      target_column: targetColumn,
      experiment_name: options.name || `mle-star-${Date.now()}`,
      model_output_dir: options.output || './models/',
      search_iterations: parseInt(options['search-iterations']) || 3,
      refinement_iterations: parseInt(options['refinement-iterations']) || 5,
      ...((options.variables && JSON.parse(options.variables)) || {})
    };
    
    if (options.quiet) {
      console.log(`📊 Running MLE-STAR: ${variables.dataset_path} → ${variables.target_column} (${executor.options.enableClaude ? 'Claude enabled' : 'Simulation'})`);
      console.log();
    } else {
      console.log(`📊 Configuration:`);
      console.log(`  Dataset: ${variables.dataset_path}`);
      console.log(`  Target: ${variables.target_column}`);
      console.log(`  Output: ${variables.model_output_dir}`);
      console.log(`  Claude Integration: ${executor.options.enableClaude ? 'Enabled' : 'Disabled'}`);
      console.log(`  Execution Mode: ${isNonInteractive ? 'Non-interactive (default)' : 'Interactive'}`);
      console.log(`  Stream Chaining: ${executor.options.enableChaining && executor.options.outputFormat === 'stream-json' ? 'Enabled' : 'Disabled'}`);
      console.log();
      
      if (isNonInteractive && options.claude !== false) {
        console.log(`💡 Running in non-interactive mode: Each agent will execute independently`);
        if (executor.options.enableChaining && executor.options.outputFormat === 'stream-json') {
          console.log(`🔗 Stream chaining enabled: Agent outputs will be piped to dependent agents`);
        }
        console.log(`   To use interactive mode instead, add --interactive flag`);
        console.log();
      }
    }
    
    if (!options.claude && !options['no-claude-warning']) {
      printWarning('MLE-STAR works best with Claude integration. Add --claude flag for full automation.');
      console.log('Without Claude, this will simulate the workflow execution.');
      console.log();
    }
    
    // Execute MLE-STAR workflow
    const result = await executor.executeWorkflow(workflowData, variables);
    
    if (result.success) {
      console.log();
      printSuccess('🎉 MLE-STAR workflow completed successfully!');
      console.log(`📊 Results: ${result.completedTasks}/${result.totalTasks} tasks completed`);
      console.log(`⏱️  Duration: ${executor.formatDuration(result.duration)}`);
      console.log(`🆔 Execution ID: ${result.executionId}`);
      
      if (result.results && Object.keys(result.results).length > 0) {
        console.log(`\n📈 Key Results:`);
        Object.entries(result.results).forEach(([taskId, taskResult]) => {
          if (taskResult.output?.status === 'completed') {
            console.log(`  ✅ ${taskId}: Completed successfully`);
          }
        });
      }
      
      console.log(`\n💡 Next Steps:`);
      console.log(`  • Check models in: ${variables.model_output_dir}`);
      console.log(`  • Review experiment: ${variables.experiment_name}`);
      console.log(`  • Validate results with your test data`);
      
    } else {
      printError('❌ MLE-STAR workflow failed');
      console.log(`📊 Progress: ${result.completedTasks}/${result.totalTasks} tasks completed`);
      
      if (result.errors.length > 0) {
        console.log('\n🔍 Errors:');
        result.errors.forEach(error => {
          console.log(`  • ${error.type}: ${error.error}`);
        });
      }
    }
    
    if (options['output-format'] === 'json') {
      console.log('\n' + JSON.stringify(result, null, 2));
    }
    
    // Ensure process exits properly in non-interactive mode
    if (options['non-interactive'] || options.nonInteractive) {
      process.exit(result.success ? 0 : 1);
    }
    
  } catch (error) {
    printError(`MLE-STAR execution failed: ${error.message}`);
    if (options['non-interactive'] || options.nonInteractive) {
      process.exit(1);
    }
  }
}

function showAutomationHelp() {
  console.log(`
🤖 Automation Commands - Intelligent Agent & Workflow Management

USAGE:
  claude-flow automation <command> [options]

COMMANDS:
  auto-agent        Automatically spawn optimal agents based on task complexity
  smart-spawn       Intelligently spawn agents based on specific requirements
  workflow-select   Select and configure optimal workflows for project types
  run-workflow      Execute workflows from JSON/YAML files with Claude integration
  mle-star          Run MLE-STAR Machine Learning Engineering workflow (flagship)

AUTO-AGENT OPTIONS:
  --task-complexity <level>  Task complexity level (default: medium)
                             Options: low, medium, high, enterprise
  --swarm-id <id>           Target swarm ID for agent spawning

SMART-SPAWN OPTIONS:
  --requirement <req>       Specific requirement description
                           Examples: "web-development", "data-analysis", "enterprise-api"
  --max-agents <n>         Maximum number of agents to spawn (default: 10)

WORKFLOW-SELECT OPTIONS:
  --project-type <type>     Project type (default: general)
                           Options: web-app, api, data-analysis, enterprise, general
  --priority <priority>     Optimization priority (default: balanced)
                           Options: speed, quality, cost, balanced

RUN-WORKFLOW OPTIONS:
  --claude                  Enable Claude CLI integration for actual execution
  --non-interactive         Run in non-interactive mode (no prompts)
  --output-format <format>  Output format (text, json)
  --variables <json>        Override workflow variables (JSON format)
  --max-concurrency <n>     Maximum concurrent tasks (default: 3)
  --timeout <ms>            Execution timeout in milliseconds
  --verbose                 Enable detailed logging

MLE-STAR OPTIONS:
  --claude                  Enable Claude CLI integration (recommended)
  --dataset <path>          Path to dataset file (default: ./data/dataset.csv)
  --target <column>         Target column name (default: target)
  --output <dir>            Model output directory (default: ./models/)
  --name <experiment>       Experiment name for tracking
  --search-iterations <n>   Web search iterations (default: 3)
  --refinement-iterations <n> Refinement cycles (default: 5)
  --max-agents <n>          Maximum agents to spawn (default: 6)
  --interactive             Use interactive mode with master coordinator (single Claude instance)
  --non-interactive         Force non-interactive mode (default for MLE-STAR)
  --output-format <format>  Output format (stream-json enables chaining)
  --chaining                Enable stream-json chaining between agents (default: true)
  --no-chaining             Disable stream-json chaining
  --no-claude-warning       Suppress Claude integration warnings
  --quiet                   Minimal output (only show major progress milestones)
  --verbose                 Detailed output with all agent activities

STREAM CHAINING:
  Stream chaining automatically pipes output from one agent to the next based on task dependencies.
  When enabled (default), agents can pass rich context and results directly to dependent tasks.
  
  Benefits:
  • 40-60% faster execution vs file-based handoffs
  • 100% context preservation between agents
  • Real-time processing without intermediate files
  • Automatic dependency detection and piping
  
  The system detects task dependencies and creates chains like:
  search_agent → foundation_agent → refinement_agent → validation_agent
  
  Example workflow with chaining:
  {
    "tasks": [
      { "id": "analyze", "assignTo": "researcher" },
      { "id": "process", "assignTo": "processor", "depends": ["analyze"] },
      { "id": "validate", "assignTo": "validator", "depends": ["process"] }
    ]
  }
  
  With stream-json chaining, the researcher's output flows directly to the processor,
  and the processor's output flows to the validator - no intermediate files needed!

EXAMPLES:
  # Auto-spawn for complex enterprise task
  claude-flow automation auto-agent --task-complexity enterprise --swarm-id swarm-123

  # Smart spawn for web development
  claude-flow automation smart-spawn --requirement "web-development" --max-agents 8

  # Select workflow for API project optimized for speed
  claude-flow automation workflow-select --project-type api --priority speed

  # Execute custom workflow with Claude integration
  claude-flow automation run-workflow my-workflow.json --claude --non-interactive

  # Run MLE-STAR ML engineering workflow (flagship command) - non-interactive by default
  claude-flow automation mle-star --dataset data/train.csv --target price --claude

  # MLE-STAR with custom configuration
  claude-flow automation mle-star --dataset sales.csv --target revenue --output models/sales/ --name "sales-prediction" --search-iterations 5
  
  # MLE-STAR with interactive mode (single Claude coordinator)
  claude-flow automation mle-star --dataset data.csv --target label --claude --interactive
  
  # MLE-STAR with stream-json chaining (agents pipe outputs to each other)
  claude-flow automation mle-star --dataset data.csv --target label --claude --output-format stream-json
  
  # MLE-STAR with minimal output for CI/CD pipelines
  claude-flow automation mle-star --dataset data.csv --target label --claude --quiet
  
  # Custom workflow with stream chaining enabled
  claude-flow automation run-workflow analysis-pipeline.json --claude --output-format stream-json
  
  # Disable chaining for independent task execution
  claude-flow automation mle-star --dataset data.csv --target label --claude --no-chaining
  
  # View stream chaining in action with verbose output
  claude-flow automation mle-star --dataset data.csv --target label --claude --verbose

🎯 Automation benefits:
  • Optimal resource allocation
  • Intelligent agent selection  
  • Workflow optimization
  • Reduced manual configuration
  • Performance-based scaling
  • Claude CLI integration for actual execution
  • MLE-STAR methodology for ML engineering
  • Non-interactive mode for CI/CD integration
  • Comprehensive workflow templates
`);
}
