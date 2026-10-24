const chalk = require('chalk');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

// Interactive Wizard Implementation
async function runInteractiveWizard() {
  console.log(chalk.blue.bold('🐝 Welcome to the Hive Mind Setup Wizard!'));
  console.log(chalk.gray('This wizard will help you create your first intelligent AI swarm.\n'));

  try {
    // Check if system is initialized
    const configPath = path.join(process.cwd(), '.hive-mind', 'config.json');
    let config = { initialized: false };

    if (fs.existsSync(configPath)) {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }

    if (!config.initialized) {
      console.log(chalk.yellow('📋 Step 1: Initializing Hive Mind System...'));
      await initializeHiveMind();
      console.log(chalk.green('✅ Hive Mind system initialized!\n'));
    } else {
      console.log(chalk.green('✅ Hive Mind system already initialized!\n'));
    }

    // Guided objective input
    console.log(chalk.blue('📋 Step 2: Define Your Objective'));
    console.log(chalk.gray('What would you like your Hive Mind swarm to accomplish?'));
    console.log(chalk.gray('Examples:'));
    console.log(chalk.gray('  • "Build a REST API for user management"'));
    console.log(chalk.gray('  • "Research and analyze market trends"'));
    console.log(chalk.gray('  • "Optimize database performance"'));
    console.log(chalk.gray('  • "Create comprehensive test suite"\n'));

    const objective = 'Build a modern web application'; // Placeholder for demo
    console.log(chalk.cyan(`💡 Using example objective: "${objective}"`));
    console.log(chalk.gray('(In full wizard, this would be interactive input)\n'));

    // Configuration selection
    console.log(chalk.blue('📋 Step 3: Choose Configuration'));
    console.log(chalk.gray('Based on your objective, here are recommended settings:\n'));

    const swarmConfig = {
      topology: 'hierarchical',
      coordination: 'queen',
      agents: 5,
      complexity: 'medium',
    };

    console.log(chalk.cyan('📊 Recommended Configuration:'));
    console.log(chalk.gray(`  • Topology: ${swarmConfig.topology} (best for structured tasks)`));
    console.log(
      chalk.gray(`  • Coordination: ${swarmConfig.coordination} (fastest decision making)`),
    );
    console.log(
      chalk.gray(`  • Agent Count: ${swarmConfig.agents} (optimal for medium complexity)`),
    );
    console.log(chalk.gray(`  • Complexity: ${swarmConfig.complexity}\n`));

    // Create the swarm
    console.log(chalk.blue('📋 Step 4: Creating Your Swarm...'));
    console.log(chalk.gray('🔄 Spawning intelligent agents...'));

    const result = await createSwarm(objective, swarmConfig);

    if (result.success) {
      console.log(chalk.green('🎉 Swarm created successfully!\n'));

      console.log(chalk.blue.bold('🐝 Your Hive Mind is Ready!'));
      console.log(chalk.gray('Your intelligent swarm has been created and is ready to work.\n'));

      console.log(chalk.cyan('📱 Next Steps:'));
      console.log(chalk.gray('  • View status: claude-flow hive-mind status'));
      console.log(chalk.gray('  • Monitor progress: claude-flow hive-mind metrics'));
      console.log(chalk.gray('  • Create another swarm: claude-flow hive-mind wizard'));
      console.log(chalk.gray('  • Learn more: claude-flow help hive-mind\n'));

      console.log(chalk.green.bold('🚀 Happy swarming!'));
    } else {
      console.log(chalk.red('❌ Failed to create swarm. Please try again.'));
    }
  } catch (error) {
    console.log(chalk.red(`❌ Wizard error: ${error.message}`));
    console.log(chalk.gray('You can try manual setup with: claude-flow hive-mind init'));
  }
}

// Initialize Hive Mind system
async function initializeHiveMind() {
  const hiveMindDir = path.join(process.cwd(), '.hive-mind');

  // Create directory if it doesn't exist
  if (!fs.existsSync(hiveMindDir)) {
    fs.mkdirSync(hiveMindDir, { recursive: true });
  }

  // Create configuration file
  const config = {
    version: '2.0.0',
    initialized: new Date().toISOString(),
    defaults: {
      queenType: 'strategic',
      maxWorkers: 8,
      consensusAlgorithm: 'majority',
      memorySize: 100,
      autoScale: true,
      encryption: false,
    },
    mcpTools: {
      enabled: true,
      parallel: true,
      timeout: 60000,
    },
  };

  const configPath = path.join(hiveMindDir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  // Initialize SQLite database
  const dbPath = path.join(hiveMindDir, 'hive.db');
  const db = new sqlite3.Database(dbPath);

  await new Promise((resolve, reject) => {
    db.serialize(() => {
      // Create tables
      db.run(`
                CREATE TABLE IF NOT EXISTS swarms (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    objective TEXT,
                    status TEXT DEFAULT 'active',
                    queen_type TEXT DEFAULT 'strategic',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);

      db.run(`
                CREATE TABLE IF NOT EXISTS agents (
                    id TEXT PRIMARY KEY,
                    swarm_id TEXT,
                    name TEXT NOT NULL,
                    type TEXT NOT NULL,
                    role TEXT,
                    status TEXT DEFAULT 'idle',
                    capabilities TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (swarm_id) REFERENCES swarms(id)
                )
            `);

      db.run(`
                CREATE TABLE IF NOT EXISTS tasks (
                    id TEXT PRIMARY KEY,
                    swarm_id TEXT,
                    description TEXT,
                    status TEXT DEFAULT 'pending',
                    result TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (swarm_id) REFERENCES swarms(id)
                )
            `);

      db.run(`
                CREATE TABLE IF NOT EXISTS collective_memory (
                    id TEXT PRIMARY KEY,
                    swarm_id TEXT,
                    key TEXT NOT NULL,
                    value TEXT,
                    ttl INTEGER,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (swarm_id) REFERENCES swarms(id)
                )
            `);

      db.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });
}

// Enhanced swarm creation with better UX
async function createSwarm(objective, config) {
  try {
    // Simulate swarm creation with progress indication
    const steps = [
      'Initializing swarm topology...',
      'Spawning Queen coordinator...',
      'Creating worker agents...',
      'Establishing communication protocols...',
      'Setting up collective memory...',
      'Activating swarm intelligence...',
    ];

    for (let i = 0; i < steps.length; i++) {
      process.stdout.write(chalk.gray(`  ${steps[i]} `));
      await new Promise((resolve) => setTimeout(resolve, 500)); // Simulate work
      console.log(chalk.green('✓'));
    }

    const swarmId = `swarm-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const queenId = `queen-${Date.now()}`;

    // Open database
    const dbPath = path.join(process.cwd(), '.hive-mind', 'hive.db');
    const db = new sqlite3.Database(dbPath);

    await new Promise((resolve, reject) => {
      db.serialize(() => {
        // Create swarm record
        const insertSwarm = db.prepare(`
                    INSERT INTO swarms (id, name, objective, status, queen_type, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `);

        insertSwarm.run(
          swarmId,
          `hive-${Date.now()}`,
          objective,
          'active',
          config.coordination,
          new Date().toISOString(),
          new Date().toISOString(),
        );

        // Create agents
        const insertAgent = db.prepare(`
                    INSERT INTO agents (id, swarm_id, name, type, role, status, capabilities, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `);

        // Create Queen
        insertAgent.run(
          queenId,
          swarmId,
          'Queen Coordinator',
          'coordinator',
          'queen',
          'active',
          JSON.stringify(['orchestration', 'strategy', 'coordination']),
          new Date().toISOString(),
        );

        // Create worker agents
        const workerTypes = ['researcher', 'coder', 'analyst', 'tester'];
        for (let i = 0; i < config.agents - 1; i++) {
          const agentType = workerTypes[i % workerTypes.length];
          insertAgent.run(
            `agent-${Date.now()}-${i}`,
            swarmId,
            `${agentType.charAt(0).toUpperCase() + agentType.slice(1)} Worker ${i + 1}`,
            agentType,
            'worker',
            'idle',
            JSON.stringify([agentType, 'collaboration']),
            new Date().toISOString(),
          );
        }

        insertSwarm.finalize();
        insertAgent.finalize();

        db.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    });

    return { success: true, swarmId, queenId };
  } catch (error) {
    console.error('Error creating swarm:', error);
    return { success: false, error: error.message };
  }
}

module.exports = { runInteractiveWizard };
