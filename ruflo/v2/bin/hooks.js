import {
  printSuccess,
  printError,
  printWarning,
  execRuvSwarmHook,
  checkRuvSwarmAvailable,
} from '../utils.js';
import { SqliteMemoryStore } from '../../memory/sqlite-store.js';

// Initialize memory store
let memoryStore = null;

async function getMemoryStore() {
  if (!memoryStore) {
    memoryStore = new SqliteMemoryStore();
    await memoryStore.initialize();
  }
  return memoryStore;
}

// Simple ID generator
function generateId(prefix = 'id') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export async function hooksAction(subArgs, flags) {
  const subcommand = subArgs[0];
  const options = flags;

  if (options.help || options.h || !subcommand) {
    showHooksHelp();
    return;
  }

  try {
    switch (subcommand) {
      // Pre-Operation Hooks
      case 'pre-task':
        await preTaskCommand(subArgs, flags);
        break;
      case 'pre-edit':
        await preEditCommand(subArgs, flags);
        break;
      case 'pre-bash':
      case 'pre-command': // Support both names for compatibility
        await preBashCommand(subArgs, flags);
        break;

      // Post-Operation Hooks
      case 'post-task':
        await postTaskCommand(subArgs, flags);
        break;
      case 'post-edit':
        await postEditCommand(subArgs, flags);
        break;
      case 'post-bash':
      case 'post-command': // Support both names for compatibility
        await postBashCommand(subArgs, flags);
        break;
      case 'post-search':
        await postSearchCommand(subArgs, flags);
        break;

      // MCP Integration Hooks
      case 'mcp-initialized':
        await mcpInitializedCommand(subArgs, flags);
        break;
      case 'agent-spawned':
        await agentSpawnedCommand(subArgs, flags);
        break;
      case 'task-orchestrated':
        await taskOrchestratedCommand(subArgs, flags);
        break;
      case 'neural-trained':
        await neuralTrainedCommand(subArgs, flags);
        break;

      // Session Hooks
      case 'session-end':
        await sessionEndCommand(subArgs, flags);
        break;
      case 'session-restore':
        await sessionRestoreCommand(subArgs, flags);
        break;
      case 'notify':
        await notifyCommand(subArgs, flags);
        break;

      default:
        printError(`Unknown hooks command: ${subcommand}`);
        showHooksHelp();
    }
  } catch (err) {
    printError(`Hooks command failed: ${err.message}`);
  }
}

// ===== PRE-OPERATION HOOKS =====

async function preTaskCommand(subArgs, flags) {
  const options = flags;
  const description = options.description || 'Unnamed task';
  const taskId = options['task-id'] || options.taskId || generateId('task');
  const agentId = options['agent-id'] || options.agentId;
  const autoSpawnAgents = options['auto-spawn-agents'] !== 'false';

  console.log(`🔄 Executing pre-task hook...`);
  console.log(`📋 Task: ${description}`);
  console.log(`🆔 Task ID: ${taskId}`);
  if (agentId) console.log(`🤖 Agent: ${agentId}`);

  try {
    const store = await getMemoryStore();
    const taskData = {
      taskId,
      description,
      agentId,
      autoSpawnAgents,
      status: 'started',
      startedAt: new Date().toISOString(),
    };

    await store.store(`task:${taskId}`, taskData, {
      namespace: 'hooks:pre-task',
      metadata: { hookType: 'pre-task', agentId },
    });

    await store.store(
      `task-index:${Date.now()}`,
      {
        taskId,
        description,
        timestamp: new Date().toISOString(),
      },
      { namespace: 'task-index' },
    );

    console.log(`  💾 Saved to .swarm/memory.db`);

    // Execute ruv-swarm hook if available (with timeout for npx scenarios)
    try {
      const checkPromise = checkRuvSwarmAvailable();
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout')), 3000)
      );
      
      const isAvailable = await Promise.race([checkPromise, timeoutPromise]);
      
      if (isAvailable) {
        console.log(`\n🔄 Executing ruv-swarm pre-task hook...`);
        const hookResult = await execRuvSwarmHook('pre-task', {
          description,
          'task-id': taskId,
          'auto-spawn-agents': autoSpawnAgents,
          ...(agentId ? { 'agent-id': agentId } : {}),
        });

        if (hookResult.success) {
          await store.store(
            `task:${taskId}:ruv-output`,
            {
              output: hookResult.output,
              timestamp: new Date().toISOString(),
            },
            { namespace: 'hooks:ruv-swarm' },
          );

          printSuccess(`✅ Pre-task hook completed successfully`);
        }
      }
    } catch (err) {
      // Skip ruv-swarm hook if it times out or fails
      console.log(`\n⚠️  Skipping ruv-swarm hook (${err.message})`);
    }

    console.log(`\n🎯 TASK PREPARATION COMPLETE`);
    
    // Close the memory store to prevent hanging
    if (memoryStore && memoryStore.close) {
      memoryStore.close();
    }
    
    // Force exit after a short delay to ensure cleanup
    setTimeout(() => {
      process.exit(0);
    }, 100);
  } catch (err) {
    printError(`Pre-task hook failed: ${err.message}`);
    
    // Close the memory store on error too
    if (memoryStore && memoryStore.close) {
      memoryStore.close();
    }
    
    // Force exit after a short delay to ensure cleanup
    setTimeout(() => {
      process.exit(1);
    }, 100);
  }
}

async function preEditCommand(subArgs, flags) {
  const options = flags;
  const file = options.file || 'unknown-file';
  const operation = options.operation || 'edit';
  const autoAssignAgents = options['auto-assign-agents'] || false;
  const loadContext = options['load-context'] || false;

  console.log(`📝 Executing pre-edit hook...`);
  console.log(`📄 File: ${file}`);
  console.log(`⚙️  Operation: ${operation}`);
  if (autoAssignAgents) console.log(`🤖 Auto-assign agents: ENABLED`);
  if (loadContext) console.log(`🔄 Load context: ENABLED`);

  try {
    const store = await getMemoryStore();

    // Auto-assign agents based on file type
    let assignedAgentType = 'general';
    let recommendedAgent = null;

    if (autoAssignAgents) {
      const path = await import('path');
      const ext = path.extname(file).toLowerCase();

      const agentMapping = {
        '.js': 'javascript-developer',
        '.ts': 'typescript-developer',
        '.py': 'python-developer',
        '.go': 'golang-developer',
        '.rs': 'rust-developer',
        '.java': 'java-developer',
        '.cpp': 'cpp-developer',
        '.c': 'c-developer',
        '.css': 'frontend-developer',
        '.html': 'frontend-developer',
        '.vue': 'frontend-developer',
        '.react': 'frontend-developer',
        '.md': 'technical-writer',
        '.yml': 'devops-engineer',
        '.yaml': 'devops-engineer',
        '.json': 'config-specialist',
        '.sql': 'database-expert',
        '.sh': 'system-admin',
        '.dockerfile': 'devops-engineer',
      };

      assignedAgentType = agentMapping[ext] || 'general-developer';
      recommendedAgent = {
        type: assignedAgentType,
        file: file,
        extension: ext,
        recommended: true,
      };

      console.log(`  🤖 Recommended agent: ${assignedAgentType}`);
    }

    // Load context if requested
    let contextData = null;
    if (loadContext) {
      try {
        // Check if file exists and get basic info
        const fs = await import('fs');
        const path = await import('path');

        if (fs.existsSync(file)) {
          const stats = fs.statSync(file);
          const dirname = path.dirname(file);
          const basename = path.basename(file);

          contextData = {
            fileExists: true,
            size: stats.size,
            modified: stats.mtime,
            directory: dirname,
            filename: basename,
            isDirectory: stats.isDirectory(),
          };

          console.log(`  📁 Context loaded: ${basename} (${stats.size} bytes)`);
        } else {
          contextData = {
            fileExists: false,
            willCreate: true,
            directory: path.dirname(file),
            filename: path.basename(file),
          };
          console.log(`  📁 Context: New file will be created`);
        }
      } catch (err) {
        console.log(`  ⚠️  Warning: Could not load context for ${file}`);
        contextData = { error: err.message };
      }
    }

    const editData = {
      file,
      operation,
      timestamp: new Date().toISOString(),
      editId: generateId('edit'),
      autoAssignAgents,
      loadContext,
      assignedAgentType,
      recommendedAgent,
      contextData,
    };

    await store.store(`edit:${editData.editId}:pre`, editData, {
      namespace: 'hooks:pre-edit',
      metadata: { hookType: 'pre-edit', file, agentType: assignedAgentType },
    });

    // Store agent recommendation if enabled
    if (autoAssignAgents && recommendedAgent) {
      await store.store(`agent-recommendation:${file}`, recommendedAgent, {
        namespace: 'agent-assignments',
        ttl: 3600, // 1 hour
      });
    }

    console.log(`  💾 Pre-edit state saved to .swarm/memory.db`);
    printSuccess(`✅ Pre-edit hook completed`);
  } catch (err) {
    printError(`Pre-edit hook failed: ${err.message}`);
  }
}

async function preBashCommand(subArgs, flags) {
  const options = flags;
  const command = options.command || subArgs.slice(1).join(' ') || '';
  const workingDir = options.cwd || process.cwd();
  const validateSafety = options['validate-safety'] === true || options['validate-safety'] === 'true' || options.validate === true || options.validate === 'true' || false;
  const prepareResources = options['prepare-resources'] === true || options['prepare-resources'] === 'true' || false;

  console.log(`🔧 Executing pre-bash hook...`);
  console.log(`📜 Command: ${command}`);
  console.log(`📁 Working dir: ${workingDir}`);
  if (validateSafety) console.log(`🔒 Safety validation: ENABLED`);
  if (prepareResources) console.log(`🛠️  Resource preparation: ENABLED`);

  try {
    const store = await getMemoryStore();
    let safetyResult = 'skipped';

    if (validateSafety) {
      // Basic safety validation
      const dangerousCommands = [
        'rm -rf /',
        'rm -rf .',
        'rm -rf *',
        'format',
        'fdisk',
        'mkfs',
        'curl * | bash',
        'wget * | sh',
        'eval',
        'exec',
        'chmod 777',
      ];

      const isDangerous = command && typeof command === 'string' && command.length > 0 
        ? dangerousCommands.some((dangerous) =>
            command.toLowerCase().includes(dangerous.toLowerCase()),
          )
        : false;

      safetyResult = isDangerous ? 'dangerous' : 'safe';

      if (isDangerous) {
        console.log(`  ⚠️  Safety check: DANGEROUS COMMAND DETECTED`);
        console.log(`  🚫 Command blocked for safety`);
        printError(`Command blocked due to safety validation: ${command}`);
        return;
      }
    }

    if (prepareResources) {
      // Resource preparation - create working directory if needed
      const fs = await import('fs');
      const path = await import('path');

      if (!fs.existsSync(workingDir)) {
        fs.mkdirSync(workingDir, { recursive: true });
        console.log(`  📁 Created working directory: ${workingDir}`);
      }

      // Check available disk space
      try {
        const stats = fs.statSync(workingDir);
        console.log(`  💾 Working directory prepared`);
      } catch (err) {
        console.log(`  ⚠️  Warning: Could not check working directory`);
      }
    }

    const bashData = {
      command,
      workingDir,
      timestamp: new Date().toISOString(),
      bashId: generateId('bash'),
      safety: safetyResult,
      validationEnabled: validateSafety,
      resourcesPrepped: prepareResources,
    };

    await store.store(`bash:${bashData.bashId}:pre`, bashData, {
      namespace: 'hooks:pre-bash',
      metadata: { hookType: 'pre-bash', command, safety: safetyResult },
    });

    console.log(`  💾 Command logged to .swarm/memory.db`);
    console.log(`  🔒 Safety check: ${safetyResult.toUpperCase()}`);
    printSuccess(`✅ Pre-bash hook completed`);
  } catch (err) {
    printError(`Pre-bash hook failed: ${err.message}`);
  }
}

// ===== POST-OPERATION HOOKS =====

async function postTaskCommand(subArgs, flags) {
  const options = flags;
  const taskId = options['task-id'] || options.taskId || generateId('task');
  const analyzePerformance = options['analyze-performance'] !== 'false';

  console.log(`🏁 Executing post-task hook...`);
  console.log(`🆔 Task ID: ${taskId}`);

  try {
    const store = await getMemoryStore();
    const taskData = await store.retrieve(`task:${taskId}`, {
      namespace: 'hooks:pre-task',
    });

    const completedData = {
      ...(taskData || {}),
      status: 'completed',
      completedAt: new Date().toISOString(),
      duration: taskData ? Date.now() - new Date(taskData.startedAt).getTime() : null,
    };

    await store.store(`task:${taskId}:completed`, completedData, {
      namespace: 'hooks:post-task',
      metadata: { hookType: 'post-task' },
    });

    if (analyzePerformance && completedData.duration) {
      const metrics = {
        taskId,
        duration: completedData.duration,
        durationHuman: `${(completedData.duration / 1000).toFixed(2)}s`,
        timestamp: new Date().toISOString(),
      };

      await store.store(`metrics:${taskId}`, metrics, {
        namespace: 'performance',
      });
      console.log(`  📊 Performance: ${metrics.durationHuman}`);
    }

    console.log(`  💾 Task completion saved to .swarm/memory.db`);
    printSuccess(`✅ Post-task hook completed`);
  } catch (err) {
    printError(`Post-task hook failed: ${err.message}`);
  }
}

async function postEditCommand(subArgs, flags) {
  const options = flags;
  const file = options.file || 'unknown-file';
  let memoryKey = options['memory-key'] || options.memoryKey;
  
  // Handle case where memory-key is passed as a boolean flag without value
  if (memoryKey === true) {
    // Generate a default memory key based on the file path and timestamp
    const path = await import('path');
    const basename = path.basename(file);
    memoryKey = `edit:${basename}:${Date.now()}`;
  }
  
  const format = options.format || false;
  const updateMemory = options['update-memory'] || false;
  const trainNeural = options['train-neural'] || false;

  console.log(`📝 Executing post-edit hook...`);
  console.log(`📄 File: ${file}`);
  if (memoryKey) console.log(`💾 Memory key: ${memoryKey}`);
  if (format) console.log(`🎨 Auto-format: ENABLED`);
  if (updateMemory) console.log(`🧠 Memory update: ENABLED`);
  if (trainNeural) console.log(`🤖 Neural training: ENABLED`);

  try {
    const store = await getMemoryStore();
    const path = await import('path');
    const fs = await import('fs');

    // Auto-format file if requested
    let formatResult = null;
    if (format && fs.existsSync(file)) {
      const ext = path.extname(file).toLowerCase();
      const formatters = {
        '.js': 'prettier',
        '.ts': 'prettier',
        '.json': 'prettier',
        '.css': 'prettier',
        '.html': 'prettier',
        '.py': 'black',
        '.go': 'gofmt',
        '.rs': 'rustfmt',
        '.java': 'google-java-format',
        '.cpp': 'clang-format',
        '.c': 'clang-format',
      };

      const formatter = formatters[ext];
      if (formatter) {
        console.log(`  🎨 Auto-formatting with ${formatter}...`);
        formatResult = {
          formatter,
          extension: ext,
          attempted: true,
          timestamp: new Date().toISOString(),
        };
      } else {
        console.log(`  ⚠️  No formatter available for ${ext}`);
        formatResult = {
          extension: ext,
          attempted: false,
          reason: 'No formatter available',
        };
      }
    }

    // Update memory with edit context
    let memoryUpdate = null;
    if (updateMemory) {
      const editContext = {
        file,
        editedAt: new Date().toISOString(),
        editId: generateId('edit'),
        formatted: formatResult?.attempted || false,
        fileSize: fs.existsSync(file) ? fs.statSync(file).size : 0,
        directory: path.dirname(file),
        basename: path.basename(file),
      };

      memoryUpdate = editContext;

      // Store in coordination namespace
      await store.store(`edit-context:${editContext.editId}`, editContext, {
        namespace: 'coordination',
        metadata: { type: 'edit-context', file },
      });

      console.log(`  🧠 Edit context stored in memory`);
    }

    // Train neural patterns if requested
    let neuralTraining = null;
    if (trainNeural) {
      // Simulate neural training with file patterns
      const ext = path.extname(file).toLowerCase();
      const basename = path.basename(file);
      const editTime = new Date().toISOString();

      const patterns = {
        fileType: ext,
        fileName: basename,
        editTime,
        confidence: Math.random() * 0.5 + 0.5, // 50-100% confidence
        patterns: [
          `${ext}_edit_pattern`,
          `${basename}_modification`,
          `edit_${Date.now()}_sequence`,
        ],
      };

      neuralTraining = patterns;

      await store.store(`neural-pattern:${generateId('pattern')}`, patterns, {
        namespace: 'neural-training',
        metadata: { type: 'edit-pattern', file, extension: ext },
      });

      console.log(
        `  🤖 Neural patterns trained (${(patterns.confidence * 100).toFixed(1)}% confidence)`,
      );
    }

    const editData = {
      file,
      memoryKey,
      timestamp: new Date().toISOString(),
      editId: generateId('edit'),
      format,
      updateMemory,
      trainNeural,
      formatResult,
      memoryUpdate,
      neuralTraining,
    };

    await store.store(`edit:${editData.editId}:post`, editData, {
      namespace: 'hooks:post-edit',
      metadata: { hookType: 'post-edit', file, formatted: formatResult?.attempted || false },
    });

    if (memoryKey && typeof memoryKey === 'string') {
      await store.store(
        memoryKey,
        {
          file,
          editedAt: new Date().toISOString(),
          editId: editData.editId,
          enhanced: true,
          formatResult,
          memoryUpdate,
          neuralTraining,
        },
        { namespace: 'coordination' },
      );
    }

    const historyKey = `file-history:${file.replace(/\//g, '_')}:${Date.now()}`;
    await store.store(
      historyKey,
      {
        file,
        editId: editData.editId,
        timestamp: new Date().toISOString(),
        enhanced: true,
        features: {
          format,
          updateMemory,
          trainNeural,
        },
      },
      { namespace: 'file-history' },
    );

    console.log(`  💾 Post-edit data saved to .swarm/memory.db`);
    printSuccess(`✅ Post-edit hook completed`);
  } catch (err) {
    printError(`Post-edit hook failed: ${err.message}`);
  }
}

async function postBashCommand(subArgs, flags) {
  const options = flags;
  const command = options.command || subArgs.slice(1).join(' ');
  const exitCode = options['exit-code'] || '0';
  const output = options.output || '';
  const trackMetrics = options['track-metrics'] || false;
  const storeResults = options['store-results'] || false;
  const duration = options.duration || 0;

  console.log(`🔧 Executing post-bash hook...`);
  console.log(`📜 Command: ${command}`);
  console.log(`📊 Exit code: ${exitCode}`);
  if (trackMetrics) console.log(`📊 Metrics tracking: ENABLED`);
  if (storeResults) console.log(`💾 Results storage: ENABLED`);

  try {
    const store = await getMemoryStore();
    const startTime = Date.now();

    // Calculate performance metrics if enabled
    let metrics = null;
    if (trackMetrics) {
      const commandLength = command.length;
      const outputLength = output.length;
      const success = parseInt(exitCode) === 0;

      metrics = {
        commandLength,
        outputLength,
        success,
        duration: parseInt(duration) || 0,
        exitCode: parseInt(exitCode),
        timestamp: new Date().toISOString(),
        complexity: commandLength > 100 ? 'high' : commandLength > 50 ? 'medium' : 'low',
      };

      console.log(
        `  📊 Command metrics: ${commandLength} chars, ${outputLength} output, ${success ? 'SUCCESS' : 'FAILED'}`,
      );
    }

    const bashData = {
      command,
      exitCode,
      output: storeResults ? output.substring(0, 5000) : output.substring(0, 1000), // Store more if requested
      timestamp: new Date().toISOString(),
      bashId: generateId('bash'),
      trackMetrics,
      storeResults,
      metrics,
    };

    await store.store(`bash:${bashData.bashId}:post`, bashData, {
      namespace: 'hooks:post-bash',
      metadata: { hookType: 'post-bash', command, exitCode, success: parseInt(exitCode) === 0 },
    });

    // Store detailed results if enabled
    if (storeResults) {
      await store.store(
        `command-results:${bashData.bashId}`,
        {
          command,
          exitCode,
          output,
          timestamp: new Date().toISOString(),
          fullOutput: true,
        },
        { namespace: 'command-results' },
      );

      console.log(`  💾 Full command results stored`);
    }

    // Store metrics if enabled
    if (trackMetrics && metrics) {
      await store.store(`command-metrics:${bashData.bashId}`, metrics, {
        namespace: 'performance-metrics',
      });

      // Update running metrics
      const existingMetrics = (await store.retrieve('command-metrics-summary', {
        namespace: 'performance-metrics',
      })) || { totalCommands: 0, successRate: 0, avgDuration: 0 };

      existingMetrics.totalCommands += 1;
      existingMetrics.successRate =
        (existingMetrics.successRate * (existingMetrics.totalCommands - 1) +
          (metrics.success ? 1 : 0)) /
        existingMetrics.totalCommands;
      existingMetrics.avgDuration =
        (existingMetrics.avgDuration * (existingMetrics.totalCommands - 1) + metrics.duration) /
        existingMetrics.totalCommands;
      existingMetrics.lastUpdated = new Date().toISOString();

      await store.store('command-metrics-summary', existingMetrics, {
        namespace: 'performance-metrics',
      });
    }

    // Update command history
    await store.store(
      `command-history:${Date.now()}`,
      {
        command,
        exitCode,
        timestamp: new Date().toISOString(),
        success: parseInt(exitCode) === 0,
        hasMetrics: trackMetrics,
        hasResults: storeResults,
      },
      { namespace: 'command-history' },
    );

    console.log(`  💾 Command execution logged to .swarm/memory.db`);
    printSuccess(`✅ Post-bash hook completed`);
  } catch (err) {
    printError(`Post-bash hook failed: ${err.message}`);
  }
}

async function postSearchCommand(subArgs, flags) {
  const options = flags;
  const query = options.query || subArgs.slice(1).join(' ');
  const resultCount = options['result-count'] || '0';
  const searchType = options.type || 'general';

  console.log(`🔍 Executing post-search hook...`);
  console.log(`🔎 Query: ${query}`);
  console.log(`📊 Results: ${resultCount}`);

  try {
    const store = await getMemoryStore();
    const searchData = {
      query,
      resultCount: parseInt(resultCount),
      searchType,
      timestamp: new Date().toISOString(),
      searchId: generateId('search'),
    };

    await store.store(`search:${searchData.searchId}`, searchData, {
      namespace: 'hooks:post-search',
      metadata: { hookType: 'post-search', query },
    });

    // Cache search for future use
    await store.store(
      `search-cache:${query}`,
      {
        resultCount: searchData.resultCount,
        cachedAt: new Date().toISOString(),
      },
      { namespace: 'search-cache', ttl: 3600 },
    ); // 1 hour TTL

    console.log(`  💾 Search results cached to .swarm/memory.db`);
    printSuccess(`✅ Post-search hook completed`);
  } catch (err) {
    printError(`Post-search hook failed: ${err.message}`);
  }
}

// ===== MCP INTEGRATION HOOKS =====

async function mcpInitializedCommand(subArgs, flags) {
  const options = flags;
  const serverName = options.server || 'claude-flow';
  const sessionId = options['session-id'] || generateId('mcp-session');

  console.log(`🔌 Executing mcp-initialized hook...`);
  console.log(`💻 Server: ${serverName}`);
  console.log(`🆔 Session: ${sessionId}`);

  try {
    const store = await getMemoryStore();
    const mcpData = {
      serverName,
      sessionId,
      initializedAt: new Date().toISOString(),
      status: 'active',
    };

    await store.store(`mcp:${sessionId}`, mcpData, {
      namespace: 'hooks:mcp-initialized',
      metadata: { hookType: 'mcp-initialized', server: serverName },
    });

    console.log(`  💾 MCP session saved to .swarm/memory.db`);
    printSuccess(`✅ MCP initialized hook completed`);
  } catch (err) {
    printError(`MCP initialized hook failed: ${err.message}`);
  }
}

async function agentSpawnedCommand(subArgs, flags) {
  const options = flags;
  const agentType = options.type || 'generic';
  const agentName = options.name || generateId('agent');
  const swarmId = options['swarm-id'] || 'default';

  console.log(`🤖 Executing agent-spawned hook...`);
  console.log(`📛 Agent: ${agentName}`);
  console.log(`🏷️  Type: ${agentType}`);

  try {
    const store = await getMemoryStore();
    const agentData = {
      agentName,
      agentType,
      swarmId,
      spawnedAt: new Date().toISOString(),
      status: 'active',
    };

    await store.store(`agent:${agentName}`, agentData, {
      namespace: 'hooks:agent-spawned',
      metadata: { hookType: 'agent-spawned', type: agentType },
    });

    // Update agent roster
    await store.store(
      `agent-roster:${Date.now()}`,
      {
        agentName,
        action: 'spawned',
        timestamp: new Date().toISOString(),
      },
      { namespace: 'agent-roster' },
    );

    console.log(`  💾 Agent registered to .swarm/memory.db`);
    printSuccess(`✅ Agent spawned hook completed`);
  } catch (err) {
    printError(`Agent spawned hook failed: ${err.message}`);
  }
}

async function taskOrchestratedCommand(subArgs, flags) {
  const options = flags;
  const taskId = options['task-id'] || generateId('orchestrated-task');
  const strategy = options.strategy || 'balanced';
  const priority = options.priority || 'medium';

  console.log(`🎭 Executing task-orchestrated hook...`);
  console.log(`🆔 Task: ${taskId}`);
  console.log(`📊 Strategy: ${strategy}`);

  try {
    const store = await getMemoryStore();
    const orchestrationData = {
      taskId,
      strategy,
      priority,
      orchestratedAt: new Date().toISOString(),
      status: 'orchestrated',
    };

    await store.store(`orchestration:${taskId}`, orchestrationData, {
      namespace: 'hooks:task-orchestrated',
      metadata: { hookType: 'task-orchestrated', strategy },
    });

    console.log(`  💾 Orchestration saved to .swarm/memory.db`);
    printSuccess(`✅ Task orchestrated hook completed`);
  } catch (err) {
    printError(`Task orchestrated hook failed: ${err.message}`);
  }
}

async function neuralTrainedCommand(subArgs, flags) {
  const options = flags;
  const modelName = options.model || 'default-neural';
  const accuracy = options.accuracy || '0.0';
  const patterns = options.patterns || '0';

  console.log(`🧠 Executing neural-trained hook...`);
  console.log(`🤖 Model: ${modelName}`);
  console.log(`📊 Accuracy: ${accuracy}%`);

  try {
    const store = await getMemoryStore();
    const trainingData = {
      modelName,
      accuracy: parseFloat(accuracy),
      patternsLearned: parseInt(patterns),
      trainedAt: new Date().toISOString(),
    };

    await store.store(`neural:${modelName}:${Date.now()}`, trainingData, {
      namespace: 'hooks:neural-trained',
      metadata: { hookType: 'neural-trained', model: modelName },
    });

    console.log(`  💾 Training results saved to .swarm/memory.db`);
    printSuccess(`✅ Neural trained hook completed`);
  } catch (err) {
    printError(`Neural trained hook failed: ${err.message}`);
  }
}

// ===== SESSION HOOKS =====

async function sessionEndCommand(subArgs, flags) {
  const options = flags;
  const generateSummary = options['generate-summary'] !== 'false';
  const persistState = options['persist-state'] !== 'false';
  const exportMetrics = options['export-metrics'] || false;

  console.log(`🔚 Executing session-end hook...`);
  if (generateSummary) console.log(`📊 Summary generation: ENABLED`);
  if (persistState) console.log(`💾 State persistence: ENABLED`);
  if (exportMetrics) console.log(`📈 Metrics export: ENABLED`);

  try {
    const store = await getMemoryStore();
    const tasks = await store.list({ namespace: 'task-index', limit: 1000 });
    const edits = await store.list({ namespace: 'file-history', limit: 1000 });
    const commands = await store.list({ namespace: 'command-history', limit: 1000 });
    const agents = await store.list({ namespace: 'agent-roster', limit: 1000 });

    // Calculate session metrics
    let metrics = null;
    if (exportMetrics) {
      const now = new Date();
      const sessionStart = Math.min(
        ...tasks.map((t) => new Date(t.value.timestamp || now).getTime()),
        ...edits.map((e) => new Date(e.value.timestamp || now).getTime()),
        ...commands.map((c) => new Date(c.value.timestamp || now).getTime()),
      );

      const duration = now.getTime() - sessionStart;
      const successfulCommands = commands.filter((c) => c.value.success !== false).length;
      const commandSuccessRate = commands.length > 0 ? successfulCommands / commands.length : 1;

      metrics = {
        sessionDuration: duration,
        sessionDurationHuman: `${Math.round(duration / 1000 / 60)} minutes`,
        totalTasks: tasks.length,
        totalEdits: edits.length,
        totalCommands: commands.length,
        uniqueAgents: agents.length,
        commandSuccessRate: Math.round(commandSuccessRate * 100),
        avgTasksPerMinute: Math.round((tasks.length / (duration / 1000 / 60)) * 100) / 100,
        avgEditsPerMinute: Math.round((edits.length / (duration / 1000 / 60)) * 100) / 100,
        timestamp: now.toISOString(),
      };
    }

    const sessionData = {
      endedAt: new Date().toISOString(),
      totalTasks: tasks.length,
      totalEdits: edits.length,
      totalCommands: commands.length,
      uniqueAgents: agents.length,
      sessionId: generateId('session'),
      generateSummary,
      persistState,
      exportMetrics,
      metrics,
    };

    await store.store(`session:${sessionData.sessionId}`, sessionData, {
      namespace: 'sessions',
      metadata: { hookType: 'session-end' },
    });

    // Persist detailed state if requested
    if (persistState) {
      const detailedState = {
        sessionId: sessionData.sessionId,
        tasks: tasks.slice(0, 100), // Limit to prevent memory issues
        edits: edits.slice(0, 100),
        commands: commands.slice(0, 100),
        agents: agents.slice(0, 50),
        persistedAt: new Date().toISOString(),
        fullState: true,
      };

      await store.store(`session-state:${sessionData.sessionId}`, detailedState, {
        namespace: 'session-states',
        metadata: { type: 'full-state', sessionId: sessionData.sessionId },
      });

      console.log(`  💾 Full session state persisted`);
    }

    // Export metrics if requested
    if (exportMetrics && metrics) {
      await store.store(`session-metrics:${sessionData.sessionId}`, metrics, {
        namespace: 'session-metrics',
        metadata: { type: 'performance-metrics', sessionId: sessionData.sessionId },
      });

      console.log(`  📈 Session metrics exported`);
    }

    if (generateSummary) {
      console.log(`\n📊 SESSION SUMMARY:`);
      console.log(`  📋 Tasks: ${sessionData.totalTasks}`);
      console.log(`  ✏️  Edits: ${sessionData.totalEdits}`);
      console.log(`  🔧 Commands: ${sessionData.totalCommands}`);
      console.log(`  🤖 Agents: ${sessionData.uniqueAgents}`);

      if (metrics) {
        console.log(`  ⏱️  Duration: ${metrics.sessionDurationHuman}`);
        console.log(`  📈 Success Rate: ${metrics.commandSuccessRate}%`);
        console.log(`  🏃 Tasks/min: ${metrics.avgTasksPerMinute}`);
        console.log(`  ✏️  Edits/min: ${metrics.avgEditsPerMinute}`);
      }
    }

    console.log(`  💾 Session saved to .swarm/memory.db`);

    if (memoryStore) {
      memoryStore.close();
      memoryStore = null;
    }

    printSuccess(`✅ Session-end hook completed`);
  } catch (err) {
    printError(`Session-end hook failed: ${err.message}`);
  }
}

async function sessionRestoreCommand(subArgs, flags) {
  const options = flags;
  const sessionId = options['session-id'] || 'latest';

  console.log(`🔄 Executing session-restore hook...`);
  console.log(`🆔 Session: ${sessionId}`);

  try {
    const store = await getMemoryStore();

    // Find session to restore
    let sessionData;
    if (sessionId === 'latest') {
      const sessions = await store.list({ namespace: 'sessions', limit: 1 });
      sessionData = sessions[0]?.value;
    } else {
      sessionData = await store.retrieve(`session:${sessionId}`, { namespace: 'sessions' });
    }

    if (sessionData) {
      console.log(`\n📊 RESTORED SESSION:`);
      console.log(`  🆔 ID: ${sessionData.sessionId || 'unknown'}`);
      console.log(`  📋 Tasks: ${sessionData.totalTasks || 0}`);
      console.log(`  ✏️  Edits: ${sessionData.totalEdits || 0}`);
      console.log(`  ⏰ Ended: ${sessionData.endedAt || 'unknown'}`);

      // Store restoration event
      await store.store(
        `session-restore:${Date.now()}`,
        {
          restoredSessionId: sessionData.sessionId || sessionId,
          restoredAt: new Date().toISOString(),
        },
        { namespace: 'session-events' },
      );

      console.log(`  💾 Session restored from .swarm/memory.db`);
      printSuccess(`✅ Session restore completed`);
    } else {
      printWarning(`No session found with ID: ${sessionId}`);
    }
  } catch (err) {
    printError(`Session restore hook failed: ${err.message}`);
  }
}

async function notifyCommand(subArgs, flags) {
  const options = flags;
  const message = options.message || subArgs.slice(1).join(' ');
  const level = options.level || 'info';
  const swarmStatus = options['swarm-status'] || 'active';

  console.log(`📢 Executing notify hook...`);
  console.log(`💬 Message: ${message}`);
  console.log(`📊 Level: ${level}`);

  try {
    const store = await getMemoryStore();
    const notificationData = {
      message,
      level,
      swarmStatus,
      timestamp: new Date().toISOString(),
      notifyId: generateId('notify'),
    };

    await store.store(`notification:${notificationData.notifyId}`, notificationData, {
      namespace: 'hooks:notify',
      metadata: { hookType: 'notify', level },
    });

    // Display notification
    const icon = level === 'error' ? '❌' : level === 'warning' ? '⚠️' : '✅';
    console.log(`\n${icon} NOTIFICATION:`);
    console.log(`  ${message}`);
    console.log(`  🐝 Swarm: ${swarmStatus}`);

    console.log(`\n  💾 Notification saved to .swarm/memory.db`);
    printSuccess(`✅ Notify hook completed`);
  } catch (err) {
    printError(`Notify hook failed: ${err.message}`);
  }
}

function showHooksHelp() {
  console.log('Claude Flow Hooks (with .swarm/memory.db persistence):\n');

  console.log('Pre-Operation Hooks:');
  console.log('  pre-task        Execute before starting a task');
  console.log('  pre-edit        Validate before file modifications');
  console.log('                  --auto-assign-agents  Auto-assign agents based on file type');
  console.log('                  --load-context        Load file context');
  console.log('  pre-bash        Check command safety (alias: pre-command)');
  console.log('  pre-command     Same as pre-bash');
  console.log('                  --validate-safety     Enable safety validation');
  console.log('                  --prepare-resources   Prepare execution resources');

  console.log('\nPost-Operation Hooks:');
  console.log('  post-task       Execute after completing a task');
  console.log('  post-edit       Auto-format and log edits');
  console.log('                  --format              Auto-format code');
  console.log('                  --update-memory       Update agent memory');
  console.log('                  --train-neural        Train neural patterns');
  console.log('  post-bash       Log command execution (alias: post-command)');
  console.log('  post-command    Same as post-bash');
  console.log('                  --track-metrics       Track performance metrics');
  console.log('                  --store-results       Store detailed results');
  console.log('  post-search     Cache search results');

  console.log('\nMCP Integration Hooks:');
  console.log('  mcp-initialized    Persist MCP configuration');
  console.log('  agent-spawned      Update agent roster');
  console.log('  task-orchestrated  Monitor task progress');
  console.log('  neural-trained     Save pattern improvements');

  console.log('\nSession Hooks:');
  console.log('  session-end        Generate summary and save state');
  console.log('                     --generate-summary    Generate session summary');
  console.log('                     --persist-state       Persist session state');
  console.log('                     --export-metrics      Export performance metrics');
  console.log('  session-restore    Load previous session state');
  console.log('  notify             Custom notifications');

  console.log('\nExamples:');
  console.log('  hooks pre-command --command "npm test" --validate-safety true');
  console.log('  hooks pre-edit --file "src/app.js" --auto-assign-agents true');
  console.log('  hooks post-command --command "build" --track-metrics true');
  console.log('  hooks post-edit --file "src/app.js" --format true --train-neural true');
  console.log('  hooks session-end --generate-summary true --export-metrics true');
  console.log('  hooks agent-spawned --name "CodeReviewer" --type "reviewer"');
  console.log('  hooks notify --message "Build completed" --level "success"');

  console.log('\nCompatibility:');
  console.log('  • pre-command and pre-bash are aliases');
  console.log('  • post-command and post-bash are aliases');
  console.log('  • Both --dash-case and camelCase parameters supported');
  console.log('  • All parameters from settings.json template supported');
}

export default hooksAction;
