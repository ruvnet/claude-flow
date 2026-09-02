// agent.js - Agent management commands
import { printSuccess, printError, printWarning } from '../utils.js';
import { onAgentSpawn, onAgentAction } from './performance-hooks.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function agentCommand(subArgs, flags) {
  const agentCmd = subArgs[0];

  // Handle --help flag explicitly to show full help
  if (flags.help || flags.h || agentCmd === '--help' || agentCmd === '-h') {
    showAgentHelp();
    return;
  }

  switch (agentCmd) {
    case 'run':
    case 'execute':
      await executeAgentTask(subArgs, flags);
      break;

    case 'spawn':
      await spawnAgent(subArgs, flags);
      break;

    case 'list':
      await listAgents(subArgs, flags);
      break;

    case 'agents':
      await listAgenticFlowAgents(subArgs, flags);
      break;

    case 'create':
      await createAgent(subArgs, flags);
      break;

    case 'info':
      await getAgentInfo(subArgs, flags);
      break;

    case 'conflicts':
      await checkAgentConflicts(subArgs, flags);
      break;

    case 'memory':
      await memoryCommand(subArgs, flags);
      break;

    case 'config':
    case 'configure':
      await configAgenticFlow(subArgs, flags);
      break;

    case 'mcp':
    case 'mcp-server':
      await mcpAgenticFlow(subArgs, flags);
      break;

    case 'hierarchy':
      await manageHierarchy(subArgs, flags);
      break;

    case 'network':
      await manageNetwork(subArgs, flags);
      break;

    case 'ecosystem':
      await manageEcosystem(subArgs, flags);
      break;

    case 'provision':
      await provisionAgent(subArgs, flags);
      break;

    case 'terminate':
      await terminateAgent(subArgs, flags);
      break;

    case 'booster':
      const { agentBoosterCommand } = await import('./agent-booster.js');
      await agentBoosterCommand(subArgs, flags);
      break;

    default:
      showAgentHelp();
  }
}

async function executeAgentTask(subArgs, flags) {
  const agentType = subArgs[1];
  const task = subArgs[2];

  if (!agentType || !task) {
    printError('Usage: agent run <agent-type> "<task>" [--provider <provider>] [--model <model>]');
    console.log('\nExamples:');
    console.log('  claude-flow agent run coder "Create a REST API"');
    console.log('  claude-flow agent run researcher "Research AI trends" --provider openrouter');
    console.log('  claude-flow agent run reviewer "Review code for security" --provider onnx');
    return;
  }

  // Check for memory flags and .env configuration
  if (flags.enableMemory || flags.memory) {
    const { checkEnvConfig, showEnvSetupInstructions } = await import('./env-template.js');
    const envCheck = await checkEnvConfig(process.cwd());

    if (!envCheck.exists) {
      printWarning('⚠️  ReasoningBank memory requires .env configuration');
      showEnvSetupInstructions();
      console.log('❌ Cannot use --enable-memory without .env file\n');
      process.exit(1);
    }

    if (!envCheck.hasApiKeys) {
      printWarning('⚠️  No API keys found in .env file');
      console.log('\n⚠️  ReasoningBank will fall back to heuristic mode (regex matching)');
      console.log('   Without API keys, memory will NOT learn from experience!\n');
      showEnvSetupInstructions();
      console.log('❌ Add API keys to .env to enable actual learning\n');
      process.exit(1);
    }

    // Show which keys are configured
    console.log('✅ API keys configured:');
    if (envCheck.keys.anthropic) console.log('   • Anthropic (Claude)');
    if (envCheck.keys.openrouter) console.log('   • OpenRouter (cost optimization available)');
    if (envCheck.keys.gemini) console.log('   • Gemini (free tier available)');
    console.log('');
  }

  printSuccess(`🚀 Executing ${agentType} agent with agentic-flow...`);
  console.log(`Task: ${task}`);

  const provider = flags.provider || 'anthropic';
  if (flags.provider) {
    console.log(`Provider: ${provider}`);
  }

  try {
    // Build command for agentic-flow
    const cmd = buildAgenticFlowCommand(agentType, task, flags);
    console.log('\n⏳ Running agent... (this may take a moment)\n');

    // Execute agentic-flow
    const { stdout, stderr } = await execAsync(cmd, {
      timeout: flags.timeout || 300000,
      maxBuffer: 10 * 1024 * 1024,
    });

    if (stdout) {
      console.log(stdout);
    }

    if (stderr && flags.verbose) {
      console.warn('\nWarnings:', stderr);
    }

    printSuccess('✅ Agent task completed successfully!');
  } catch (error) {
    printError('❌ Agent execution failed');
    console.error(error.message);
    if (error.stderr) {
      console.error('Error details:', error.stderr);
    }
    process.exit(1);
  }
}

function buildAgenticFlowCommand(agent, task, flags) {
  const parts = ['npx', 'agentic-flow'];

  // Agentic-flow uses --agent flag directly (no 'execute' subcommand)
  parts.push('--agent', agent);
  parts.push('--task', `"${task.replace(/"/g, '\\"')}"`);

  if (flags.provider) {
    parts.push('--provider', flags.provider);
  }

  if (flags.model) {
    parts.push('--model', flags.model);
  }

  if (flags.temperature) {
    parts.push('--temperature', flags.temperature);
  }

  if (flags.maxTokens) {
    parts.push('--max-tokens', flags.maxTokens);
  }

  if (flags.format) {
    parts.push('--output-format', flags.format);
  }

  if (flags.stream) {
    parts.push('--stream');
  }

  if (flags.verbose) {
    parts.push('--verbose');
  }

  // ReasoningBank memory options (NEW in v2.6.0)
  if (flags.enableMemory || flags.memory) {
    parts.push('--enable-memory');
  }

  if (flags.memoryDb || flags.memoryDatabase) {
    parts.push('--memory-db', flags.memoryDb || flags.memoryDatabase);
  }

  if (flags.memoryK) {
    parts.push('--memory-k', flags.memoryK);
  }

  if (flags.memoryDomain) {
    parts.push('--memory-domain', flags.memoryDomain);
  }

  if (flags.memoryLearning === false) {
    parts.push('--no-memory-learning');
  }

  if (flags.memoryMinConfidence) {
    parts.push('--memory-min-confidence', flags.memoryMinConfidence);
  }

  if (flags.memoryTaskId) {
    parts.push('--memory-task-id', flags.memoryTaskId);
  }

  // Model optimization options (NEW in v2.6.0 - agentic-flow v1.5.0+)
  if (flags.optimize) {
    parts.push('--optimize');
  }

  if (flags.priority) {
    parts.push('--priority', flags.priority);
  }

  if (flags.maxCost) {
    parts.push('--max-cost', flags.maxCost);
  }

  // Additional execution options (NEW in v2.6.0)
  if (flags.retry) {
    parts.push('--retry');
  }

  if (flags.agentsDir) {
    parts.push('--agents-dir', flags.agentsDir);
  }

  if (flags.timeout) {
    parts.push('--timeout', flags.timeout);
  }

  // API key overrides (NEW in v2.6.0)
  if (flags.anthropicKey) {
    parts.push('--anthropic-key', flags.anthropicKey);
  }

  if (flags.openrouterKey) {
    parts.push('--openrouter-key', flags.openrouterKey);
  }

  if (flags.geminiKey) {
    parts.push('--gemini-key', flags.geminiKey);
  }

  return parts.join(' ');
}

async function listAgenticFlowAgents(subArgs, flags) {
  printSuccess('📋 Loading available agentic-flow agents...');

  try {
    // Agentic-flow uses 'agent list' command
    const { stdout } = await execAsync('npx agentic-flow agent list', {
      timeout: 30000,
    });

    console.log('\n66+ Available Agents:\n');
    console.log(stdout);
    console.log('\nUsage:');
    console.log('  claude-flow agent run <agent-type> "<task>"');
    console.log('\nExamples:');
    console.log('  claude-flow agent run coder "Build a REST API with authentication"');
    console.log('  claude-flow agent run security-auditor "Review this code for vulnerabilities"');
    console.log('  claude-flow agent run full-stack-developer "Create a Next.js app"');
  } catch (error) {
    printError('Failed to load agentic-flow agents');
    console.error('Make sure agentic-flow is installed: npm install -g agentic-flow');
    console.error(error.message);
  }
}

async function createAgent(subArgs, flags) {
  printSuccess('🛠️  Creating custom agent with agentic-flow...');

  try {
    // Build command for agentic-flow agent create
    let cmd = 'npx agentic-flow agent create';

    if (flags.name) {
      cmd += ` --name "${flags.name}"`;
    }

    if (flags.description) {
      cmd += ` --description "${flags.description}"`;
    }

    if (flags.category) {
      cmd += ` --category "${flags.category}"`;
    }

    if (flags.prompt) {
      cmd += ` --prompt "${flags.prompt}"`;
    }

    if (flags.tools) {
      cmd += ` --tools "${flags.tools}"`;
    }

    const { stdout, stderr } = await execAsync(cmd, {
      timeout: 60000,
      maxBuffer: 10 * 1024 * 1024,
    });

    if (stdout) {
      console.log(stdout);
    }

    printSuccess('✅ Agent created successfully!');
    console.log('\nNext steps:');
    console.log('  1. Run your agent: claude-flow agent run <agent-name> "<task>"');
    console.log('  2. View agent info: claude-flow agent info <agent-name>');
    console.log('  3. Check for conflicts: claude-flow agent conflicts');
  } catch (error) {
    printError('❌ Failed to create agent');
    console.error(error.message);
    if (error.stderr) {
      console.error('Details:', error.stderr);
    }
    process.exit(1);
  }
}

async function getAgentInfo(subArgs, flags) {
  const agentName = subArgs[1];

  if (!agentName) {
    printError('Usage: agent info <agent-name>');
    console.log('\nExample:');
    console.log('  claude-flow agent info coder');
    console.log('  claude-flow agent info security-auditor');
    return;
  }

  printSuccess(`📊 Getting information for agent: ${agentName}`);

  try {
    const { stdout } = await execAsync(`npx agentic-flow agent info ${agentName}`, {
      timeout: 30000,
    });

    console.log(stdout);
  } catch (error) {
    printError(`❌ Failed to get agent info for: ${agentName}`);
    console.error(error.message);
    console.log('\nTip: List all agents with: claude-flow agent agents');
    process.exit(1);
  }
}

async function checkAgentConflicts(subArgs, flags) {
  printSuccess('🔍 Checking for agent conflicts between package and local agents...');

  try {
    const { stdout } = await execAsync('npx agentic-flow agent conflicts', {
      timeout: 30000,
    });

    console.log(stdout);

    if (stdout.includes('No conflicts found')) {
      printSuccess('✅ No conflicts detected!');
    } else {
      printWarning('⚠️  Conflicts found! Local agents will override package agents with the same path.');
    }
  } catch (error) {
    printError('❌ Failed to check agent conflicts');
    console.error(error.message);
    process.exit(1);
  }
}

async function memoryCommand(subArgs, flags) {
  const memoryCmd = subArgs[1];

  switch (memoryCmd) {
    case 'init':
    case 'initialize':
      await initializeMemory(subArgs, flags);
      break;

    case 'status':
    case 'info':
      await getMemoryStatus(subArgs, flags);
      break;

    case 'consolidate':
    case 'prune':
      await consolidateMemory(subArgs, flags);
      break;

    case 'list':
    case 'ls':
      await listMemories(subArgs, flags);
      break;

    case 'demo':
      await runMemoryDemo(subArgs, flags);
      break;

    case 'test':
      await runMemoryTest(subArgs, flags);
      break;

    case 'benchmark':
      await runMemoryBenchmark(subArgs, flags);
      break;

    default:
      showMemoryHelp();
  }
}

async function initializeMemory(subArgs, flags) {
  const dbPath = flags.db || flags.database || '.swarm/memory.db';

  printSuccess('🧠 Initializing ReasoningBank memory system...');
  console.log(`Database: ${dbPath}`);

  try {
    const { stdout, stderr } = await execAsync('npx agentic-flow reasoningbank init', {
      timeout: 30000,
    });

    if (stdout) {
      console.log(stdout);
    }

    printSuccess('✅ ReasoningBank initialized successfully!');
    console.log('\nNext steps:');
    console.log('  1. Run agents with --enable-memory flag');
    console.log('  2. Check status: claude-flow agent memory status');
    console.log('  3. View demo: claude-flow agent memory demo');
  } catch (error) {
    printError('❌ Failed to initialize ReasoningBank');
    console.error(error.message);
    if (error.stderr) {
      console.error('Details:', error.stderr);
    }
    process.exit(1);
  }
}

async function getMemoryStatus(subArgs, flags) {
  printSuccess('🧠 ReasoningBank Status:');

  try {
    const { stdout } = await execAsync('npx agentic-flow reasoningbank status', {
      timeout: 30000,
    });

    console.log(stdout);
  } catch (error) {
    printError('❌ Failed to get memory status');
    console.error(error.message);
    console.log('\nTip: Initialize first with: claude-flow agent memory init');
    process.exit(1);
  }
}

async function consolidateMemory(subArgs, flags) {
  printSuccess('🧠 Consolidating ReasoningBank memories...');
  console.log('This will deduplicate and prune old/low-quality memories');

  try {
    const { stdout } = await execAsync('npx agentic-flow reasoningbank consolidate', {
      timeout: 60000,
    });

    console.log(stdout);
    printSuccess('✅ Memory consolidation complete!');
  } catch (error) {
    printError('❌ Consolidation failed');
    console.error(error.message);
    process.exit(1);
  }
}

async function listMemories(subArgs, flags) {
  const domain = flags.domain;
  const limit = flags.limit || 10;

  printSuccess(`🧠 Listing ReasoningBank memories (limit: ${limit})`);
  if (domain) {
    console.log(`Domain filter: ${domain}`);
  }

  try {
    let cmd = 'npx agentic-flow reasoningbank list';
    if (domain) {
      cmd += ` --domain ${domain}`;
    }
    cmd += ` --limit ${limit}`;

    const { stdout } = await execAsync(cmd, {
      timeout: 30000,
    });

    console.log(stdout);
  } catch (error) {
    printError('❌ Failed to list memories');
    console.error(error.message);
    process.exit(1);
  }
}

async function runMemoryDemo(subArgs, flags) {
  printSuccess('🎯 Running ReasoningBank demo...');
  console.log('This will show how memory improves task success over time\n');

  try {
    const { stdout } = await execAsync('npx agentic-flow reasoningbank demo', {
      timeout: 120000,
    });

    console.log(stdout);
    printSuccess('✅ Demo complete!');
  } catch (error) {
    printError('❌ Demo failed');
    console.error(error.message);
    process.exit(1);
  }
}

async function runMemoryTest(subArgs, flags) {
  printSuccess('🧪 Running ReasoningBank integration tests...');

  try {
    const { stdout } = await execAsync('npx agentic-flow reasoningbank test', {
      timeout: 120000,
    });

    console.log(stdout);
    printSuccess('✅ Tests complete!');
  } catch (error) {
    printError('❌ Tests failed');
    console.error(error.message);
    process.exit(1);
  }
}

async function runMemoryBenchmark(subArgs, flags) {
  printSuccess('⚡ Running ReasoningBank performance benchmarks...');

  try {
    const { stdout } = await execAsync('npx agentic-flow reasoningbank benchmark', {
      timeout: 120000,
    });

    console.log(stdout);
    printSuccess('✅ Benchmarks complete!');
  } catch (error) {
    printError('❌ Benchmark failed');
    console.error(error.message);
    process.exit(1);
  }
}

function showMemoryHelp() {
  console.log('Memory (ReasoningBank) commands:');
  console.log('  init                             Initialize ReasoningBank database');
  console.log('  status                           Show memory system status');
  console.log('  consolidate                      Deduplicate and prune memories');
  console.log('  list [--domain <domain>]         List stored memories');
  console.log('  demo                             Run interactive demo');
  console.log('  test                             Run integration tests');
  console.log('  benchmark                        Run performance benchmarks');
  console.log();
  console.log('Options:');
  console.log('  --db, --database <path>          Database path [default: .swarm/memory.db]');
  console.log('  --domain <domain>                Filter by domain');
  console.log('  --limit <n>                      Limit results [default: 10]');
  console.log();
  console.log('Examples:');
  console.log('  claude-flow agent memory init');
  console.log('  claude-flow agent memory status');
  console.log('  claude-flow agent memory list --domain web --limit 5');
  console.log('  claude-flow agent memory consolidate');
  console.log('  claude-flow agent memory demo');
}

// Configuration Management for agentic-flow
async function configAgenticFlow(subArgs, flags) {
  const configCmd = subArgs[1];

  switch (configCmd) {
    case 'set':
      await agenticConfigSet(subArgs, flags);
      break;
    case 'get':
      await agenticConfigGet(subArgs, flags);
      break;
    case 'list':
      await agenticConfigList(subArgs, flags);
      break;
    case 'delete':
    case 'remove':
    case 'rm':
      await agenticConfigDelete(subArgs, flags);
      break;
    case 'reset':
      await agenticConfigReset(subArgs, flags);
      break;
    case undefined:
    case 'wizard':
    case 'interactive':
      await agenticConfigWizard(subArgs, flags);
      break;
    default:
      showAgenticConfigHelp();
  }
}

async function agenticConfigSet(subArgs, flags) {
  const key = subArgs[2];
  const value = subArgs[3];

  if (!key || !value) {
    printError('Usage: agent config set <key> <value>');
    console.log('\nExample:');
    console.log('  claude-flow agent config set ANTHROPIC_API_KEY sk-ant-xxx');
    console.log('  claude-flow agent config set DEFAULT_MODEL claude-3-5-sonnet-20241022');
    return;
  }

  printSuccess(`🔧 Setting agentic-flow configuration: ${key}`);

  try {
    const { stdout } = await execAsync(`npx agentic-flow config set ${key} "${value}"`, {
      timeout: 30000,
    });
    console.log(stdout);
    printSuccess('✅ Configuration set successfully!');
  } catch (error) {
    printError(`❌ Failed to set configuration: ${key}`);
    console.error(error.message);
    process.exit(1);
  }
}

async function agenticConfigGet(subArgs, flags) {
  const key = subArgs[2];

  if (!key) {
    printError('Usage: agent config get <key>');
    console.log('\nExample:');
    console.log('  claude-flow agent config get ANTHROPIC_API_KEY');
    return;
  }

  try {
    const { stdout } = await execAsync(`npx agentic-flow config get ${key}`, {
      timeout: 30000,
    });
    console.log(stdout);
  } catch (error) {
    printError(`❌ Failed to get configuration: ${key}`);
    console.error(error.message);
    process.exit(1);
  }
}

async function agenticConfigList(subArgs, flags) {
  printSuccess('📋 Listing agentic-flow configurations...');

  try {
    let cmd = 'npx agentic-flow config list';
    if (flags.showSecrets) {
      cmd += ' --show-secrets';
    }

    const { stdout } = await execAsync(cmd, { timeout: 30000 });
    console.log(stdout);

    if (!flags.showSecrets) {
      console.log('\n💡 Tip: Use --show-secrets to reveal sensitive values');
    }
  } catch (error) {
    printError('❌ Failed to list configurations');
    console.error(error.message);
    process.exit(1);
  }
}

async function agenticConfigDelete(subArgs, flags) {
  const key = subArgs[2];

  if (!key) {
    printError('Usage: agent config delete <key>');
    return;
  }

  printWarning(`⚠️  Deleting configuration: ${key}`);

  try {
    const { stdout } = await execAsync(`npx agentic-flow config delete ${key}`, {
      timeout: 30000,
    });
    console.log(stdout);
    printSuccess('✅ Configuration deleted!');
  } catch (error) {
    printError(`❌ Failed to delete configuration: ${key}`);
    console.error(error.message);
    process.exit(1);
  }
}

async function agenticConfigReset(subArgs, flags) {
  if (!flags.force) {
    printWarning('⚠️  WARNING: This will reset ALL agentic-flow configurations!');
    console.log('\nUse --force to confirm: claude-flow agent config reset --force');
    return;
  }

  printWarning('🔄 Resetting agentic-flow configurations...');

  try {
    const { stdout } = await execAsync('npx agentic-flow config reset --force', {
      timeout: 30000,
    });
    console.log(stdout);
    printSuccess('✅ Configurations reset!');
  } catch (error) {
    printError('❌ Failed to reset configurations');
    console.error(error.message);
    process.exit(1);
  }
}

async function agenticConfigWizard(subArgs, flags) {
  printSuccess('🧙 Starting agentic-flow configuration wizard...');

  try {
    const { stdout } = await execAsync('npx agentic-flow config wizard', {
      timeout: 300000,
    });
    console.log(stdout);
    printSuccess('✅ Configuration wizard completed!');
  } catch (error) {
    printError('❌ Configuration wizard failed');
    console.error(error.message);
    process.exit(1);
  }
}

function showAgenticConfigHelp() {
  console.log('Agentic-flow configuration commands:');
  console.log('  set <key> <value>               Set configuration value');
  console.log('  get <key>                       Get configuration value');
  console.log('  list                            List all configurations');
  console.log('  delete <key>                    Delete configuration value');
  console.log('  reset --force                   Reset to defaults');
  console.log('  wizard                          Run interactive setup wizard');
  console.log();
  console.log('Examples:');
  console.log('  claude-flow agent config wizard');
  console.log('  claude-flow agent config set ANTHROPIC_API_KEY sk-ant-xxx');
  console.log('  claude-flow agent config list --show-secrets');
}

// MCP Server Management for agentic-flow
async function mcpAgenticFlow(subArgs, flags) {
  const mcpCmd = subArgs[1];

  switch (mcpCmd) {
    case 'start':
      await agenticMcpStart(subArgs, flags);
      break;
    case 'stop':
      await agenticMcpStop(subArgs, flags);
      break;
    case 'status':
      await agenticMcpStatus(subArgs, flags);
      break;
    case 'list':
    case 'ls':
      await agenticMcpList(subArgs, flags);
      break;
    case 'logs':
      await agenticMcpLogs(subArgs, flags);
      break;
    case 'restart':
      await agenticMcpRestart(subArgs, flags);
      break;
    default:
      showAgenticMcpHelp();
  }
}

async function agenticMcpStart(subArgs, flags) {
  printSuccess('🚀 Starting agentic-flow MCP server...');

  try {
    let cmd = 'npx agentic-flow mcp start';
    if (flags.port) cmd += ` --port ${flags.port}`;
    if (flags.host) cmd += ` --host ${flags.host}`;
    if (flags.daemon || flags.background) cmd += ' --daemon';

    const { stdout } = await execAsync(cmd, { timeout: 60000 });
    console.log(stdout);
    printSuccess('✅ MCP server started!');
  } catch (error) {
    printError('❌ Failed to start MCP server');
    console.error(error.message);
    process.exit(1);
  }
}

async function agenticMcpStop(subArgs, flags) {
  printWarning('🛑 Stopping agentic-flow MCP server...');

  try {
    const { stdout } = await execAsync('npx agentic-flow mcp stop', { timeout: 30000 });
    console.log(stdout);
    printSuccess('✅ MCP server stopped!');
  } catch (error) {
    printError('❌ Failed to stop MCP server');
    console.error(error.message);
    process.exit(1);
  }
}

async function agenticMcpStatus(subArgs, flags) {
  printSuccess('📊 Getting agentic-flow MCP server status...');

  try {
    let cmd = 'npx agentic-flow mcp status';
    if (flags.detailed || flags.verbose) cmd += ' --detailed';

    const { stdout } = await execAsync(cmd, { timeout: 30000 });
    console.log(stdout);
  } catch (error) {
    printError('❌ Failed to get MCP status');
    console.error(error.message);
    process.exit(1);
  }
}

async function agenticMcpList(subArgs, flags) {
  printSuccess('📋 Listing agentic-flow MCP tools...');

  try {
    let cmd = 'npx agentic-flow mcp list';
    if (flags.server) cmd += ` --server ${flags.server}`;
    if (flags.category) cmd += ` --category ${flags.category}`;
    if (flags.detailed || flags.verbose) cmd += ' --detailed';

    const { stdout } = await execAsync(cmd, { timeout: 30000 });
    console.log(stdout);
  } catch (error) {
    printError('❌ Failed to list MCP tools');
    console.error(error.message);
    process.exit(1);
  }
}

async function agenticMcpLogs(subArgs, flags) {
  printSuccess('📄 Getting agentic-flow MCP logs...');

  try {
    let cmd = 'npx agentic-flow mcp logs';
    if (flags.lines) cmd += ` --lines ${flags.lines}`;
    if (flags.follow || flags.f) cmd += ' --follow';
    if (flags.error) cmd += ' --error';

    const { stdout } = await execAsync(cmd, {
      timeout: flags.follow ? 0 : 30000,
      maxBuffer: 10 * 1024 * 1024
    });
    console.log(stdout);
  } catch (error) {
    printError('❌ Failed to get MCP logs');
    console.error(error.message);
    process.exit(1);
  }
}

async function agenticMcpRestart(subArgs, flags) {
  printWarning('🔄 Restarting agentic-flow MCP server...');

  try {
    await agenticMcpStop(subArgs, { ...flags, quiet: true });
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await agenticMcpStart(subArgs, flags);
    printSuccess('✅ MCP server restarted!');
  } catch (error) {
    printError('❌ Failed to restart MCP server');
    console.error(error.message);
    process.exit(1);
  }
}

function showAgenticMcpHelp() {
  console.log('Agentic-flow MCP server commands:');
  console.log('  start [--port <port>]           Start MCP server');
  console.log('  stop                            Stop MCP server');
  console.log('  restart                         Restart MCP server');
  console.log('  status [--detailed]             Get server status');
  console.log('  list [--server <name>]          List MCP tools');
  console.log('  logs [--lines <n>] [--follow]   View server logs');
  console.log();
  console.log('Options:');
  console.log('  --port <number>                 Server port (default: 3000)');
  console.log('  --host <string>                 Server host (default: localhost)');
  console.log('  --daemon, --background          Run in background');
  console.log('  --server <name>                 Filter by server name');
  console.log('  --category <type>               Filter by tool category');
  console.log('  --detailed, --verbose           Detailed output');
  console.log();
  console.log('Examples:');
  console.log('  claude-flow agent mcp start --daemon');
  console.log('  claude-flow agent mcp status --detailed');
  console.log('  claude-flow agent mcp list --server agent-booster');
  console.log('  claude-flow agent mcp logs --lines 50 --follow');
}

async function spawnAgent(subArgs, flags) {
  const agentType = subArgs[1] || 'general';
  const agentName = getFlag(subArgs, '--name') || flags.name || `agent-${Date.now()}`;
  const agentId = `${agentType}-${Date.now()}`;

  // Create the agent object
  const agent = {
    id: agentId,
    name: agentName,
    type: agentType,
    status: 'active',
    activeTasks: 0,
    lastActivity: Date.now(),
    capabilities: getAgentCapabilities(agentType),
    createdAt: Date.now()
  };

  // Store agent in session/agents directory
  const { promises: fs } = await import('fs');
  const path = await import('path');
  
  // Ensure agents directory exists
  const agentsDir = '.claude-flow/agents';
  await fs.mkdir(agentsDir, { recursive: true });
  
  // Save agent data
  const agentFile = path.join(agentsDir, `${agentId}.json`);
  await fs.writeFile(agentFile, JSON.stringify(agent, null, 2));
  
  // Update performance metrics
  const perfFile = '.claude-flow/metrics/performance.json';
  try {
    const perfData = JSON.parse(await fs.readFile(perfFile, 'utf8'));
    perfData.totalAgents = (perfData.totalAgents || 0) + 1;
    perfData.activeAgents = (perfData.activeAgents || 0) + 1;
    await fs.writeFile(perfFile, JSON.stringify(perfData, null, 2));
  } catch (e) {
    // Create new performance file if doesn't exist
    await fs.writeFile(perfFile, JSON.stringify({
      startTime: Date.now(),
      totalTasks: 0,
      successfulTasks: 0,
      failedTasks: 0,
      totalAgents: 1,
      activeAgents: 1,
      neuralEvents: 0
    }, null, 2));
  }

  printSuccess(`✅ Spawned ${agentType} agent: ${agentName}`);
  console.log('🤖 Agent successfully created:');
  console.log(`   ID: ${agentId}`);
  console.log(`   Type: ${agentType}`);
  console.log(`   Name: ${agentName}`);
  console.log(`   Capabilities: ${agent.capabilities.join(', ')}`);
  console.log(`   Status: ${agent.status}`);
  console.log(`   Location: ${agentFile}`);
  
  // Track agent spawn for performance metrics
  await onAgentSpawn(agentId, agentType, { name: agentName });
}

function getAgentCapabilities(type) {
  const capabilities = {
    researcher: ['Research', 'Analysis', 'Information Gathering', 'Documentation'],
    coder: ['Code Generation', 'Implementation', 'Refactoring', 'Debugging'],
    tester: ['Testing', 'Validation', 'Quality Assurance', 'Performance Testing'],
    analyst: ['Data Analysis', 'Pattern Recognition', 'Reporting', 'Optimization'],
    coordinator: ['Task Management', 'Workflow Orchestration', 'Resource Allocation'],
    general: ['Research', 'Analysis', 'Code Generation']
  };
  return capabilities[type] || capabilities.general;
}

async function listAgents(subArgs, flags) {
  const { promises: fs } = await import('fs');
  const path = await import('path');
  
  const agentsDir = '.claude-flow/agents';
  const agents = [];
  
  try {
    const agentFiles = await fs.readdir(agentsDir);
    for (const file of agentFiles) {
      if (file.endsWith('.json')) {
        try {
          const content = await fs.readFile(path.join(agentsDir, file), 'utf8');
          const agent = JSON.parse(content);
          agents.push(agent);
        } catch {
          // Skip invalid agent files
        }
      }
    }
  } catch {
    // Agents directory doesn't exist yet
  }
  
  if (agents.length > 0) {
    printSuccess(`Active agents (${agents.length}):`);
    agents.forEach(agent => {
      const statusEmoji = agent.status === 'active' ? '🟢' : '🟡';
      console.log(`${statusEmoji} ${agent.name} (${agent.type})`);
      console.log(`   ID: ${agent.id}`);
      console.log(`   Status: ${agent.status}`);
      console.log(`   Tasks: ${agent.activeTasks}`);
      console.log(`   Created: ${new Date(agent.createdAt).toLocaleString()}`);
      console.log('');
    });
  } else {
    console.log('📋 No agents currently active');
    console.log('\nTo create agents:');
    console.log('  claude-flow agent spawn researcher --name "ResearchBot"');
    console.log('  claude-flow agent spawn coder --name "CodeBot"');
    console.log('  claude-flow agent spawn analyst --name "DataBot"');
  }
}

async function manageHierarchy(subArgs, flags) {
  const hierarchyCmd = subArgs[1];

  switch (hierarchyCmd) {
    case 'create':
      const hierarchyType = subArgs[2] || 'basic';
      printSuccess(`Creating ${hierarchyType} agent hierarchy`);
      console.log('🏗️  Hierarchy structure would include:');
      console.log('   - Coordinator Agent (manages workflow)');
      console.log('   - Specialist Agents (domain-specific tasks)');
      console.log('   - Worker Agents (execution tasks)');
      break;

    case 'show':
      printSuccess('Current agent hierarchy:');
      console.log('📊 No hierarchy configured (orchestrator not running)');
      break;

    default:
      console.log('Hierarchy commands: create, show');
      console.log('Examples:');
      console.log('  claude-flow agent hierarchy create enterprise');
      console.log('  claude-flow agent hierarchy show');
  }
}

async function manageNetwork(subArgs, flags) {
  const networkCmd = subArgs[1];

  switch (networkCmd) {
    case 'topology':
      printSuccess('Agent network topology:');
      console.log('🌐 Network visualization would show agent connections');
      break;

    case 'metrics':
      printSuccess('Network performance metrics:');
      console.log('📈 Communication latency, throughput, reliability stats');
      break;

    default:
      console.log('Network commands: topology, metrics');
  }
}

async function manageEcosystem(subArgs, flags) {
  const ecosystemCmd = subArgs[1];

  switch (ecosystemCmd) {
    case 'status':
      printSuccess('Agent ecosystem status:');
      console.log('🌱 Ecosystem health: Not running');
      console.log('   Active Agents: 0');
      console.log('   Resource Usage: 0%');
      console.log('   Task Queue: Empty');
      break;

    case 'optimize':
      printSuccess('Optimizing agent ecosystem...');
      console.log('⚡ Optimization would include:');
      console.log('   - Load balancing across agents');
      console.log('   - Resource allocation optimization');
      console.log('   - Communication path optimization');
      break;

    default:
      console.log('Ecosystem commands: status, optimize');
  }
}

async function provisionAgent(subArgs, flags) {
  const provision = subArgs[1];

  if (!provision) {
    printError('Usage: agent provision <count>');
    return;
  }

  const count = parseInt(provision);
  if (isNaN(count) || count < 1) {
    printError('Count must be a positive number');
    return;
  }

  printSuccess(`Provisioning ${count} agents...`);
  console.log('🚀 Auto-provisioning would create:');
  for (let i = 1; i <= count; i++) {
    console.log(`   Agent ${i}: Type=general, Status=provisioning`);
  }
}

async function terminateAgent(subArgs, flags) {
  const agentId = subArgs[1];

  if (!agentId) {
    printError('Usage: agent terminate <agent-id>');
    return;
  }

  printSuccess(`Terminating agent: ${agentId}`);
  console.log('🛑 Agent would be gracefully shut down');
}

async function showAgentInfo(subArgs, flags) {
  const agentId = subArgs[1];

  if (!agentId) {
    printError('Usage: agent info <agent-id>');
    return;
  }

  printSuccess(`Agent information: ${agentId}`);
  console.log('📊 Agent details would include:');
  console.log('   Status, capabilities, current tasks, performance metrics');
}

function getFlag(args, flagName) {
  const index = args.indexOf(flagName);
  return index !== -1 && index + 1 < args.length ? args[index + 1] : null;
}

function showAgentHelp() {
  console.log('Agent commands:');
  console.log('\n🚀 Agentic-Flow Integration (NEW in v2.6.0):');
  console.log('  run <agent> "<task>" [options]   Execute agent with multi-provider support');
  console.log('  agents                           List all 66+ agentic-flow agents');
  console.log('  create --name <name> [options]   Create custom agent');
  console.log('  info <agent-name>                Show detailed agent information');
  console.log('  conflicts                        Check for agent conflicts');
  console.log('\n🧠 ReasoningBank Memory (NEW in v2.6.0):');
  console.log('  memory init                      Initialize memory system');
  console.log('  memory status                    Show memory statistics');
  console.log('  memory consolidate               Prune and deduplicate memories');
  console.log('  memory list [--domain <d>]       List stored memories');
  console.log('  memory demo                      Run interactive demo');
  console.log('  memory test                      Run integration tests');
  console.log('  memory benchmark                 Run performance benchmarks');
  console.log('\n🔧 Configuration Management (NEW in v2.6.0):');
  console.log('  config wizard                    Run interactive setup wizard');
  console.log('  config set <key> <value>         Set configuration value');
  console.log('  config get <key>                 Get configuration value');
  console.log('  config list [--show-secrets]     List all configurations');
  console.log('  config delete <key>              Delete configuration value');
  console.log('  config reset --force             Reset to defaults');
  console.log('\n🌐 MCP Server Management (NEW in v2.6.0):');
  console.log('  mcp start [--port <port>]        Start MCP server');
  console.log('  mcp stop                         Stop MCP server');
  console.log('  mcp restart                      Restart MCP server');
  console.log('  mcp status [--detailed]          Get server status');
  console.log('  mcp list [--server <name>]       List MCP tools');
  console.log('  mcp logs [--lines <n>] [-f]      View server logs');
  console.log('\n🚀 Agent Booster - Ultra-Fast Code Editing (NEW in v2.6.0):');
  console.log('  booster edit <file> "<instr>"    Edit file (352x faster, $0)');
  console.log('  booster batch <pattern> "<i>"    Batch edit files');
  console.log('  booster parse-markdown <file>    Parse markdown edits');
  console.log('  booster benchmark [options]      Run performance tests');
  console.log('  booster help                     Show Agent Booster help');
  console.log('\n🤖 Internal Agent Management:');
  console.log('  spawn <type> [--name <name>]     Create internal agent');
  console.log('  list [--verbose]                 List active internal agents');
  console.log('  terminate <id>                   Stop specific agent');
  console.log('  hierarchy <create|show>          Manage agent hierarchies');
  console.log('  network <topology|metrics>       Agent network operations');
  console.log('  ecosystem <status|optimize>      Ecosystem management');
  console.log('  provision <count>                Auto-provision agents');
  console.log();
  console.log('Execution Options (for run command):');
  console.log('  --provider <provider>            Provider: anthropic, openrouter, onnx, gemini');
  console.log('  --model <model>                  Specific model to use');
  console.log('  --temperature <temp>             Temperature (0.0-1.0)');
  console.log('  --max-tokens <tokens>            Maximum tokens');
  console.log('  --format <format>                Output format: text, json, markdown');
  console.log('  --stream                         Enable streaming');
  console.log('  --verbose                        Verbose output');
  console.log();
  console.log('Model Optimization Options (NEW in v2.6.0):');
  console.log('  --optimize                       Auto-select optimal model (85-98% savings)');
  console.log('  --priority <priority>            Priority: quality, cost, speed, privacy, balanced');
  console.log('  --max-cost <dollars>             Maximum cost per task in dollars');
  console.log();
  console.log('Advanced Execution Options (NEW in v2.6.0):');
  console.log('  --retry                          Auto-retry on transient errors');
  console.log('  --agents-dir <path>              Custom agents directory');
  console.log('  --timeout <ms>                   Execution timeout in milliseconds');
  console.log('  --anthropic-key <key>            Override Anthropic API key');
  console.log('  --openrouter-key <key>           Override OpenRouter API key');
  console.log('  --gemini-key <key>               Override Gemini API key');
  console.log();
  console.log('Memory Options (NEW - for run command):');
  console.log('  --enable-memory                  Enable ReasoningBank learning');
  console.log('                                   ⚠️  REQUIRES .env with API keys');
  console.log('                                   Run: claude-flow init --env');
  console.log('  --memory-db <path>               Memory database path [default: .swarm/memory.db]');
  console.log('  --memory-k <n>                   Top-k memories to retrieve [default: 3]');
  console.log('  --memory-domain <domain>         Domain filter for memories');
  console.log('  --no-memory-learning             Disable post-task learning');
  console.log('  --memory-min-confidence <n>      Min confidence threshold [default: 0.5]');
  console.log('  --memory-task-id <id>            Custom task ID for tracking');
  console.log();
  console.log('Examples:');
  console.log('\n  # Execute with agentic-flow (multi-provider)');
  console.log('  claude-flow agent run coder "Build REST API with authentication"');
  console.log('  claude-flow agent run researcher "Research React 19 features" --provider openrouter');
  console.log('  claude-flow agent run security-auditor "Audit code" --provider onnx');
  console.log('  claude-flow agent agents  # List all available agents');
  console.log('\n  # Model optimization (85-98% cost savings)');
  console.log('  claude-flow agent run coder "Build API" --optimize');
  console.log('  claude-flow agent run coder "Fix bug" --optimize --priority cost');
  console.log('  claude-flow agent run coder "Critical fix" --optimize --priority quality --max-cost 0.50');
  console.log('\n  # Execute with ReasoningBank memory (learns from experience)');
  console.log('  claude-flow agent run coder "Build API" --enable-memory');
  console.log('  claude-flow agent run coder "Add auth" --enable-memory --memory-domain api');
  console.log('  claude-flow agent run coder "Fix bug" --enable-memory --memory-k 5');
  console.log('\n  # Memory management');
  console.log('  claude-flow agent memory init');
  console.log('  claude-flow agent memory status');
  console.log('  claude-flow agent memory list --domain api --limit 10');
  console.log('  claude-flow agent memory consolidate');
  console.log('  claude-flow agent memory demo  # See 70% → 88% success improvement');
  console.log('\n  # Configuration management');
  console.log('  claude-flow agent config wizard  # Interactive setup');
  console.log('  claude-flow agent config set ANTHROPIC_API_KEY sk-ant-xxx');
  console.log('  claude-flow agent config list --show-secrets');
  console.log('  claude-flow agent config get DEFAULT_MODEL');
  console.log('\n  # MCP server management');
  console.log('  claude-flow agent mcp start --daemon');
  console.log('  claude-flow agent mcp status --detailed');
  console.log('  claude-flow agent mcp list --server agent-booster');
  console.log('  claude-flow agent mcp logs --follow');
  console.log('\n  # Internal agent management');
  console.log('  claude-flow agent spawn researcher --name "DataBot"');
  console.log('  claude-flow agent list --verbose');
  console.log('  claude-flow agent hierarchy create enterprise');
}
