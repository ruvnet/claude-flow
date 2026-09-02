/**
 * Hive Mind Initialization Module for Claude Flow v2.0.0
 * Provides comprehensive hive-mind system setup for the init process
 */

import { promises as fs } from 'fs';
import { existsSync } from 'fs';
import path from 'path';
import { printSuccess, printError, printWarning } from '../../utils.js';

/**
 * Default hive-mind configuration
 */
export const DEFAULT_HIVE_CONFIG = {
  version: '2.0.0',
  initialized: new Date().toISOString(),
  system: {
    enabled: true,
    autoStart: false,
    maxRetries: 3,
    healthCheckInterval: 30000,
  },
  queen: {
    type: 'strategic',
    name: 'Queen-Genesis',
    capabilities: [
      'task-decomposition',
      'consensus-building',
      'resource-allocation',
      'quality-assessment',
      'conflict-resolution'
    ],
    decisionThreshold: 0.75,
    adaptiveLearning: true,
  },
  workers: {
    maxWorkers: 8,
    defaultCapabilities: [
      'code-analysis',
      'implementation',
      'testing',
      'documentation'
    ],
    autoScale: true,
    scaleThreshold: 0.8,
    specializedRoles: [
      'architect',
      'researcher',
      'implementer',
      'tester',
      'reviewer'
    ],
  },
  consensus: {
    algorithm: 'weighted-majority',
    minimumParticipants: 3,
    timeoutMs: 30000,
    requiredConsensus: 0.67,
    votingMethods: ['majority', 'weighted', 'unanimous', 'quorum'],
  },
  memory: {
    enabled: true,
    size: 100,
    persistenceMode: 'database',
    sharedMemoryNamespace: 'hive-collective',
    retentionDays: 30,
    compressionEnabled: true,
    encryptionEnabled: false,
  },
  communication: {
    protocol: 'secure-messaging',
    encryption: false,
    messageQueue: {
      maxSize: 1000,
      priorityLevels: 5,
      batchProcessing: true,
    },
    channels: [
      'task-coordination',
      'knowledge-sharing',
      'consensus-voting',
      'error-reporting',
      'performance-metrics'
    ],
  },
  integration: {
    mcpTools: {
      enabled: true,
      parallel: true,
      timeout: 60000,
      fallbackMode: 'sequential',
    },
    claudeCode: {
      enabled: true,
      autoSpawn: true,
      coordination: true,
      sharedContext: true,
    },
    github: {
      enabled: false,
      autoCommit: false,
      branchStrategy: 'feature',
    },
  },
  monitoring: {
    enabled: true,
    metricsCollection: true,
    performanceTracking: true,
    healthChecks: true,
    alerting: {
      enabled: false,
      thresholds: {
        errorRate: 0.1,
        responseTime: 5000,
        consensusFailures: 3,
      },
    },
  },
};

/**
 * Database schema for hive-mind system
 */
export const HIVE_DB_SCHEMA = {
  swarms: `
    CREATE TABLE IF NOT EXISTS swarms (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      objective TEXT,
      status TEXT DEFAULT 'active',
      queen_type TEXT DEFAULT 'strategic',
      topology TEXT DEFAULT 'hierarchical',
      max_agents INTEGER DEFAULT 8,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      metadata TEXT DEFAULT '{}'
    );
  `,
  agents: `
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      swarm_id TEXT,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      role TEXT,
      capabilities TEXT DEFAULT '[]',
      status TEXT DEFAULT 'active',
      performance_score REAL DEFAULT 0.5,
      task_count INTEGER DEFAULT 0,
      success_rate REAL DEFAULT 1.0,
      last_active DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      metadata TEXT DEFAULT '{}',
      FOREIGN KEY (swarm_id) REFERENCES swarms (id)
    );
  `,
  tasks: `
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      swarm_id TEXT,
      agent_id TEXT,
      name TEXT NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'pending',
      priority INTEGER DEFAULT 3,
      complexity REAL DEFAULT 0.5,
      estimated_time INTEGER,
      actual_time INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      started_at DATETIME,
      completed_at DATETIME,
      metadata TEXT DEFAULT '{}',
      FOREIGN KEY (swarm_id) REFERENCES swarms (id),
      FOREIGN KEY (agent_id) REFERENCES agents (id)
    );
  `,
  messages: `
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      swarm_id TEXT,
      sender_id TEXT,
      recipient_id TEXT,
      channel TEXT DEFAULT 'general',
      type TEXT DEFAULT 'info',
      content TEXT NOT NULL,
      priority INTEGER DEFAULT 3,
      consensus_vote REAL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      processed BOOLEAN DEFAULT 0,
      metadata TEXT DEFAULT '{}',
      FOREIGN KEY (swarm_id) REFERENCES swarms (id),
      FOREIGN KEY (sender_id) REFERENCES agents (id),
      FOREIGN KEY (recipient_id) REFERENCES agents (id)
    );
  `,
  consensus_votes: `
    CREATE TABLE IF NOT EXISTS consensus_votes (
      id TEXT PRIMARY KEY,
      swarm_id TEXT,
      proposal_id TEXT NOT NULL,
      agent_id TEXT,
      vote REAL NOT NULL,
      weight REAL DEFAULT 1.0,
      justification TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (swarm_id) REFERENCES swarms (id),
      FOREIGN KEY (agent_id) REFERENCES agents (id)
    );
  `,
  knowledge_base: `
    CREATE TABLE IF NOT EXISTS knowledge_base (
      id TEXT PRIMARY KEY,
      swarm_id TEXT,
      category TEXT DEFAULT 'general',
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      tags TEXT DEFAULT '[]',
      confidence REAL DEFAULT 0.5,
      source_agent_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      access_count INTEGER DEFAULT 0,
      FOREIGN KEY (swarm_id) REFERENCES swarms (id),
      FOREIGN KEY (source_agent_id) REFERENCES agents (id)
    );
  `,
  performance_metrics: `
    CREATE TABLE IF NOT EXISTS performance_metrics (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      metric_name TEXT NOT NULL,
      metric_value REAL NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      metadata TEXT DEFAULT '{}'
    );
  `,
  sessions: `
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      swarm_id TEXT NOT NULL,
      swarm_name TEXT NOT NULL,
      objective TEXT,
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      paused_at DATETIME,
      resumed_at DATETIME,
      completion_percentage REAL DEFAULT 0,
      checkpoint_data TEXT,
      metadata TEXT,
      parent_pid INTEGER,
      child_pids TEXT,
      FOREIGN KEY (swarm_id) REFERENCES swarms (id)
    );
  `,
};

/**
 * Create hive-mind directory structure
 */
export async function createHiveMindDirectories(workingDir, dryRun = false) {
  const directories = [
    '.hive-mind',
    '.hive-mind/sessions',
    '.hive-mind/memory',
    '.hive-mind/logs',
    '.hive-mind/backups',
    '.hive-mind/config',
    '.hive-mind/templates',
    '.hive-mind/exports',
  ];

  console.log('  📁 Creating hive-mind directory structure...');

  for (const dir of directories) {
    const fullPath = path.join(workingDir, dir);
    if (!dryRun) {
      await fs.mkdir(fullPath, { recursive: true });
    } else {
      console.log(`    [DRY RUN] Would create: ${dir}`);
    }
  }

  if (!dryRun) {
    console.log('  ✅ Hive-mind directories created');
  }
}

/**
 * Initialize collective memory database
 */
export async function initializeCollectiveMemoryDatabase(workingDir, dryRun = false) {
  console.log('  🧠 Initializing collective memory database...');

  if (dryRun) {
    console.log('    [DRY RUN] Would initialize hive.db with full schema');
    console.log('    [DRY RUN] Would create indexes for performance optimization');
    console.log('    [DRY RUN] Would insert default data and configurations');
    return;
  }

  try {
    // Dynamic import for better-sqlite3 with proper error handling
    let Database;
    try {
      Database = (await import('better-sqlite3')).default;
      // Test if the native binding is available by trying to create a test instance
      const testPath = path.join(workingDir, '.hive-mind', 'test-binding.db');
      const testDb = new Database(testPath);
      testDb.close();
      // Clean up test file
      try { await fs.unlink(testPath); } catch { /* ignore */ }
    } catch (err) {
      console.log('    ⚠️  better-sqlite3 not available, using fallback memory database');
      return await createFallbackMemoryDatabase(workingDir);
    }

    const hivePath = path.join(workingDir, '.hive-mind', 'hive.db');
    const hiveDb = new Database(hivePath);
    
    // Enable WAL mode for better concurrency
    hiveDb.pragma('journal_mode = WAL');
    hiveDb.pragma('synchronous = NORMAL');
    hiveDb.pragma('cache_size = 1000');
    hiveDb.pragma('temp_store = MEMORY');

    // Create all tables
    console.log('    📋 Creating database schema...');
    for (const [tableName, schema] of Object.entries(HIVE_DB_SCHEMA)) {
      hiveDb.exec(schema);
    }

    // Create indexes for performance
    console.log('    🔍 Creating performance indexes...');
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_agents_swarm_id ON agents(swarm_id);',
      'CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);',
      'CREATE INDEX IF NOT EXISTS idx_tasks_swarm_id ON tasks(swarm_id);',
      'CREATE INDEX IF NOT EXISTS idx_tasks_agent_id ON tasks(agent_id);',
      'CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);',
      'CREATE INDEX IF NOT EXISTS idx_messages_swarm_id ON messages(swarm_id);',
      'CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);',
      'CREATE INDEX IF NOT EXISTS idx_consensus_votes_swarm_id ON consensus_votes(swarm_id);',
      'CREATE INDEX IF NOT EXISTS idx_knowledge_base_swarm_id ON knowledge_base(swarm_id);',
      'CREATE INDEX IF NOT EXISTS idx_knowledge_base_category ON knowledge_base(category);',
      'CREATE INDEX IF NOT EXISTS idx_performance_metrics_entity ON performance_metrics(entity_type, entity_id);',
      'CREATE INDEX IF NOT EXISTS idx_sessions_swarm_id ON sessions(swarm_id);',
    ];

    for (const index of indexes) {
      hiveDb.exec(index);
    }

    // Insert initial metadata
    const insertInitialData = hiveDb.prepare(`
      INSERT OR IGNORE INTO knowledge_base (id, category, title, content, confidence)
      VALUES (?, ?, ?, ?, ?)
    `);

    const initialKnowledge = [
      ['init-1', 'system', 'Hive Mind System Initialization', 'Hive mind system successfully initialized with full database schema and configuration.', 1.0],
      ['init-2', 'capabilities', 'Default Agent Capabilities', JSON.stringify(DEFAULT_HIVE_CONFIG.workers.defaultCapabilities), 0.9],
      ['init-3', 'consensus', 'Consensus Algorithms', JSON.stringify(DEFAULT_HIVE_CONFIG.consensus), 1.0],
      ['init-4', 'queen', 'Queen Configuration', JSON.stringify(DEFAULT_HIVE_CONFIG.queen), 1.0],
    ];

    for (const knowledge of initialKnowledge) {
      insertInitialData.run(...knowledge);
    }

    hiveDb.close();
    console.log('  ✅ Collective memory database initialized with full schema');

  } catch (err) {
    console.log(`    ⚠️  Could not initialize hive database: ${err.message}`);
    return await createFallbackMemoryDatabase(workingDir);
  }
}

/**
 * Create fallback memory database when SQLite is not available
 */
async function createFallbackMemoryDatabase(workingDir) {
  console.log('    📄 Creating fallback JSON memory database...');
  
  const fallbackDb = {
    metadata: {
      type: 'fallback',
      initialized: new Date().toISOString(),
      warning: 'Using JSON fallback - install better-sqlite3 for full database features'
    },
    swarms: [],
    agents: [],
    tasks: [],
    messages: [],
    consensus_votes: [],
    knowledge_base: [
      {
        id: 'init-1',
        category: 'system',
        title: 'Fallback Memory System',
        content: 'Using JSON-based fallback memory system. Install better-sqlite3 for full database features.',
        confidence: 1.0,
        created_at: new Date().toISOString()
      }
    ],
    performance_metrics: [],
    sessions: []
  };

  const fallbackPath = path.join(workingDir, '.hive-mind', 'memory.json');
  await fs.writeFile(fallbackPath, JSON.stringify(fallbackDb, null, 2), 'utf8');
  
  console.log('  ✅ Fallback memory database created');
  return true;
}

/**
 * Create default queen and worker configurations
 */
export async function createDefaultConfigurations(workingDir, dryRun = false) {
  console.log('  👑 Creating default queen and worker configurations...');

  if (dryRun) {
    console.log('    [DRY RUN] Would create queen configurations');
    console.log('    [DRY RUN] Would create worker configurations');
    console.log('    [DRY RUN] Would create role templates');
    return;
  }

  const configDir = path.join(workingDir, '.hive-mind', 'config');

  // Queen configurations
  const queenConfigs = {
    strategic: {
      name: 'Strategic Queen',
      description: 'Focuses on long-term planning and high-level coordination',
      capabilities: [
        'strategic-planning',
        'resource-optimization',
        'risk-assessment',
        'quality-oversight',
        'team-coordination'
      ],
      decisionStyle: 'analytical',
      planningHorizon: 'long-term',
      adaptability: 0.7,
      specialties: ['architecture', 'planning', 'coordination']
    },
    tactical: {
      name: 'Tactical Queen',
      description: 'Focuses on execution efficiency and immediate problem-solving',
      capabilities: [
        'task-optimization',
        'rapid-response',
        'resource-allocation',
        'performance-monitoring',
        'conflict-resolution'
      ],
      decisionStyle: 'pragmatic',
      planningHorizon: 'short-term',
      adaptability: 0.9,
      specialties: ['execution', 'optimization', 'troubleshooting']
    },
    adaptive: {
      name: 'Adaptive Queen',
      description: 'Dynamically adjusts approach based on context and feedback',
      capabilities: [
        'pattern-recognition',
        'adaptive-learning',
        'context-switching',
        'feedback-integration',
        'dynamic-planning'
      ],
      decisionStyle: 'flexible',
      planningHorizon: 'adaptive',
      adaptability: 1.0,
      specialties: ['learning', 'adaptation', 'context-awareness']
    }
  };

  // Worker role templates
  const workerTemplates = {
    architect: {
      name: 'System Architect',
      description: 'Designs system architecture and technical specifications',
      capabilities: [
        'system-design',
        'architecture-patterns',
        'scalability-planning',
        'technology-selection',
        'documentation'
      ],
      complexity: 0.9,
      autonomy: 0.8,
      collaboration: 0.7
    },
    researcher: {
      name: 'Research Specialist',
      description: 'Conducts research and gathers information for informed decisions',
      capabilities: [
        'information-gathering',
        'analysis',
        'trend-identification',
        'competitive-research',
        'reporting'
      ],
      complexity: 0.7,
      autonomy: 0.9,
      collaboration: 0.6
    },
    implementer: {
      name: 'Implementation Specialist',
      description: 'Translates designs into working code and solutions',
      capabilities: [
        'coding',
        'debugging',
        'integration',
        'optimization',
        'deployment'
      ],
      complexity: 0.8,
      autonomy: 0.7,
      collaboration: 0.8
    },
    tester: {
      name: 'Quality Assurance Specialist',
      description: 'Ensures quality through testing and validation',
      capabilities: [
        'testing',
        'validation',
        'quality-assurance',
        'automation',
        'reporting'
      ],
      complexity: 0.6,
      autonomy: 0.8,
      collaboration: 0.7
    },
    reviewer: {
      name: 'Code Review Specialist',
      description: 'Reviews code quality and provides improvement suggestions',
      capabilities: [
        'code-review',
        'quality-assessment',
        'best-practices',
        'mentoring',
        'documentation-review'
      ],
      complexity: 0.8,
      autonomy: 0.8,
      collaboration: 0.9
    }
  };

  // Save configurations
  await fs.writeFile(
    path.join(configDir, 'queens.json'),
    JSON.stringify(queenConfigs, null, 2),
    'utf8'
  );

  await fs.writeFile(
    path.join(configDir, 'workers.json'),
    JSON.stringify(workerTemplates, null, 2),
    'utf8'
  );

  console.log('  ✅ Default configurations created');
}

/**
 * Create hive-mind config file with sensible defaults
 */
export async function createHiveMindConfig(workingDir, customConfig = {}, dryRun = false) {
  console.log('  ⚙️ Creating hive-mind configuration file...');

  if (dryRun) {
    console.log('    [DRY RUN] Would create config.json with merged settings');
    return;
  }

  // Merge custom config with defaults
  const config = mergeDeep(DEFAULT_HIVE_CONFIG, customConfig);
  
  const configPath = path.join(workingDir, '.hive-mind', 'config.json');
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
  
  console.log('  ✅ Hive-mind configuration created');
  return config;
}

/**
 * Create initial README and documentation files
 */
export async function createHiveMindDocumentation(workingDir, dryRun = false) {
  console.log('  📚 Creating hive-mind documentation...');

  if (dryRun) {
    console.log('    [DRY RUN] Would create README.md and documentation files');
    return;
  }

  const readmeContent = `# Hive Mind System

This directory contains the Claude Flow Hive Mind system configuration and data.

## Directory Structure

- **config/**: Configuration files for queens, workers, and system settings
- **sessions/**: Active and historical session data
- **memory/**: Collective memory and knowledge base
- **logs/**: System and debug logs
- **backups/**: Automated backups of system state
- **templates/**: Templates for agents and workflows
- **exports/**: Exported data and reports

## Database Files

- **hive.db**: Main SQLite database (or memory.json as fallback)
- **config.json**: Primary system configuration

## Getting Started

1. Initialize: \`npx claude-flow@alpha hive-mind init\`
2. Spawn swarm: \`npx claude-flow@alpha hive-mind spawn "your objective"\`
3. Check status: \`npx claude-flow@alpha hive-mind status\`

## Features

- **Collective Intelligence**: Multiple AI agents working together
- **Consensus Building**: Democratic decision-making process
- **Adaptive Learning**: System improves over time
- **Fault Tolerance**: Self-healing and recovery capabilities
- **Performance Monitoring**: Real-time metrics and optimization

## Configuration

Edit \`.hive-mind/config.json\` to customize:
- Queen type and capabilities
- Worker specializations
- Consensus algorithms
- Memory settings
- Integration options

For more information, see the [Hive Mind Documentation](https://github.com/ruvnet/claude-flow/docs/hive-mind.md).
`;

  await fs.writeFile(
    path.join(workingDir, '.hive-mind', 'README.md'),
    readmeContent,
    'utf8'
  );

  console.log('  ✅ Hive-mind documentation created');
}

/**
 * Complete hive-mind initialization
 */
export async function initializeHiveMind(workingDir, options = {}, dryRun = false) {
  console.log('🧠 Initializing Hive Mind System...');

  try {
    // Create directory structure
    await createHiveMindDirectories(workingDir, dryRun);

    // Initialize collective memory database
    await initializeCollectiveMemoryDatabase(workingDir, dryRun);

    // Create default configurations
    await createDefaultConfigurations(workingDir, dryRun);

    // Create main config file
    await createHiveMindConfig(workingDir, options.config || {}, dryRun);

    // Create documentation
    await createHiveMindDocumentation(workingDir, dryRun);

    if (!dryRun) {
      printSuccess('🧠 Hive Mind System initialized successfully');
    } else {
      console.log('[DRY RUN] Hive Mind System would be fully initialized');
    }

    return {
      success: true,
      features: [
        'Collective memory database',
        'Queen and worker configurations',
        'Consensus mechanisms',
        'Performance monitoring',
        'Session management',
        'Knowledge base'
      ]
    };

  } catch (error) {
    printError(`Failed to initialize Hive Mind System: ${error.message}`);
    return {
      success: false,
      error: error.message,
      rollbackRequired: true
    };
  }
}

/**
 * Get hive-mind initialization status for init summary
 */
export function getHiveMindStatus(workingDir) {
  const configPath = path.join(workingDir, '.hive-mind', 'config.json');
  const dbPath = path.join(workingDir, '.hive-mind', 'hive.db');
  const fallbackPath = path.join(workingDir, '.hive-mind', 'memory.json');

  const status = {
    configured: existsSync(configPath),
    database: existsSync(dbPath) ? 'sqlite' : existsSync(fallbackPath) ? 'fallback' : 'none',
    directories: existsSync(path.join(workingDir, '.hive-mind')),
  };

  return status;
}

/**
 * Rollback hive-mind initialization (cleanup on failure)
 */
export async function rollbackHiveMindInit(workingDir) {
  console.log('🔄 Rolling back hive-mind initialization...');
  
  try {
    const hiveMindDir = path.join(workingDir, '.hive-mind');
    if (existsSync(hiveMindDir)) {
      await fs.rmdir(hiveMindDir, { recursive: true });
      console.log('  ✅ Hive-mind directory removed');
    }
    return { success: true };
  } catch (error) {
    printError(`Failed to rollback hive-mind initialization: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Deep merge utility for configuration objects
 */
function mergeDeep(target, source) {
  const output = Object.assign({}, target);
  if (isObject(target) && isObject(source)) {
    Object.keys(source).forEach(key => {
      if (isObject(source[key])) {
        if (!(key in target))
          Object.assign(output, { [key]: source[key] });
        else
          output[key] = mergeDeep(target[key], source[key]);
      } else {
        Object.assign(output, { [key]: source[key] });
      }
    });
  }
  return output;
}

function isObject(item) {
  return (item && typeof item === 'object' && !Array.isArray(item));
}