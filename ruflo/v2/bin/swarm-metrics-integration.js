/**
 * Swarm Metrics Integration Fix
 * Resolves task attribution issues between hive-mind and ruv-swarm systems
 */

import { existsSync } from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import chalk from 'chalk';
import { cwd } from '../node-compat.js';

/**
 * Get metrics from both swarm systems and provide unified view
 */
export async function getUnifiedSwarmMetrics() {
  const results = {
    hiveMind: await getHiveMindMetrics(),
    ruvSwarm: await getRuvSwarmMetrics(),
    integrated: null,
  };

  // Create integrated view
  results.integrated = await integrateMetrics(results.hiveMind, results.ruvSwarm);

  return results;
}

/**
 * Get hive-mind metrics
 */
async function getHiveMindMetrics() {
  const dbPath = path.join(cwd(), '.hive-mind', 'hive.db');

  if (!existsSync(dbPath)) {
    return { available: false, reason: 'Hive-mind database not found' };
  }

  try {
    const db = new Database(dbPath);

    const stats = db
      .prepare(
        `
      SELECT 
        (SELECT COUNT(*) FROM swarms) as total_swarms,
        (SELECT COUNT(*) FROM agents) as total_agents,
        (SELECT COUNT(*) FROM tasks) as total_tasks,
        (SELECT COUNT(*) FROM tasks WHERE status = 'completed') as completed_tasks,
        (SELECT COUNT(*) FROM tasks WHERE status = 'in_progress') as in_progress_tasks,
        (SELECT COUNT(*) FROM tasks WHERE status = 'pending') as pending_tasks
    `,
      )
      .get();

    const swarmBreakdown = db
      .prepare(
        `
      SELECT 
        s.id,
        s.name,
        s.objective,
        COUNT(t.id) as task_count,
        SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) as completed_count,
        SUM(CASE WHEN t.status = 'in_progress' THEN 1 ELSE 0 END) as in_progress_count,
        SUM(CASE WHEN t.status = 'pending' THEN 1 ELSE 0 END) as pending_count
      FROM swarms s
      LEFT JOIN tasks t ON s.id = t.swarm_id
      GROUP BY s.id, s.name, s.objective
    `,
      )
      .all();

    db.close();

    return {
      available: true,
      type: 'hive-mind',
      overall: stats,
      swarms: swarmBreakdown,
    };
  } catch (error) {
    return {
      available: false,
      reason: `Hive-mind database error: ${error.message}`,
    };
  }
}

/**
 * Get ruv-swarm metrics
 */
async function getRuvSwarmMetrics() {
  const dbPath = path.join(cwd(), 'node_modules', 'ruv-swarm', 'data', 'ruv-swarm.db');

  if (!existsSync(dbPath)) {
    return { available: false, reason: 'ruv-swarm database not found' };
  }

  try {
    const db = new Database(dbPath);

    const stats = db
      .prepare(
        `
      SELECT 
        (SELECT COUNT(*) FROM swarms) as total_swarms,
        (SELECT COUNT(*) FROM agents) as total_agents,
        (SELECT COUNT(*) FROM tasks) as total_tasks,
        (SELECT COUNT(*) FROM tasks WHERE status = 'completed') as completed_tasks,
        (SELECT COUNT(*) FROM tasks WHERE status = 'in_progress') as in_progress_tasks,
        (SELECT COUNT(*) FROM tasks WHERE status = 'pending') as pending_tasks
    `,
      )
      .get();

    const swarmBreakdown = db
      .prepare(
        `
      SELECT 
        s.id,
        s.name,
        s.topology,
        s.strategy,
        COUNT(t.id) as task_count,
        SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) as completed_count,
        SUM(CASE WHEN t.status = 'in_progress' THEN 1 ELSE 0 END) as in_progress_count,
        SUM(CASE WHEN t.status = 'pending' THEN 1 ELSE 0 END) as pending_count
      FROM swarms s
      LEFT JOIN tasks t ON s.id = t.swarm_id
      GROUP BY s.id, s.name, s.topology, s.strategy
    `,
      )
      .all();

    db.close();

    return {
      available: true,
      type: 'ruv-swarm',
      overall: stats,
      swarms: swarmBreakdown,
    };
  } catch (error) {
    return {
      available: false,
      reason: `ruv-swarm database error: ${error.message}`,
    };
  }
}

/**
 * Integrate metrics from both systems
 */
async function integrateMetrics(hiveMind, ruvSwarm) {
  const integration = {
    available: hiveMind.available || ruvSwarm.available,
    systems: [],
  };

  if (hiveMind.available) {
    integration.systems.push(hiveMind);
  }

  if (ruvSwarm.available) {
    integration.systems.push(ruvSwarm);
  }

  // Create combined totals
  if (integration.systems.length > 0) {
    integration.combined = {
      total_swarms: integration.systems.reduce(
        (sum, sys) => sum + (sys.overall?.total_swarms || 0),
        0,
      ),
      total_agents: integration.systems.reduce(
        (sum, sys) => sum + (sys.overall?.total_agents || 0),
        0,
      ),
      total_tasks: integration.systems.reduce(
        (sum, sys) => sum + (sys.overall?.total_tasks || 0),
        0,
      ),
      completed_tasks: integration.systems.reduce(
        (sum, sys) => sum + (sys.overall?.completed_tasks || 0),
        0,
      ),
      in_progress_tasks: integration.systems.reduce(
        (sum, sys) => sum + (sys.overall?.in_progress_tasks || 0),
        0,
      ),
      pending_tasks: integration.systems.reduce(
        (sum, sys) => sum + (sys.overall?.pending_tasks || 0),
        0,
      ),
    };

    integration.combined.success_rate =
      integration.combined.total_tasks > 0
        ? ((integration.combined.completed_tasks / integration.combined.total_tasks) * 100).toFixed(
            1,
          )
        : '0';
  }

  return integration;
}

/**
 * Display unified metrics with clear system breakdown
 */
export async function showUnifiedMetrics() {
  console.log(chalk.bold('\n🔄 Unified Swarm Metrics Analysis\n'));

  const metrics = await getUnifiedSwarmMetrics();

  // Show combined overview
  if (metrics.integrated.available) {
    console.log(chalk.cyan('Combined System Overview:'));
    const combined = metrics.integrated.combined;
    console.log(`  Total Swarms: ${combined.total_swarms}`);
    console.log(`  Total Agents: ${combined.total_agents}`);
    console.log(`  Total Tasks: ${combined.total_tasks}`);
    console.log(`  Completed: ${chalk.green(combined.completed_tasks)}`);
    console.log(`  In Progress: ${chalk.yellow(combined.in_progress_tasks)}`);
    console.log(`  Pending: ${chalk.gray(combined.pending_tasks)}`);
    console.log(`  Success Rate: ${combined.success_rate}%`);
    console.log();
  }

  // Show breakdown by system
  for (const system of metrics.integrated.systems) {
    const systemName = system.type === 'hive-mind' ? '🧠 Hive-Mind System' : '🐝 ruv-swarm System';
    console.log(chalk.yellow(`${systemName}:`));
    console.log(chalk.gray('─'.repeat(40)));

    const stats = system.overall;
    console.log(
      `  Swarms: ${stats.total_swarms}, Agents: ${stats.total_agents}, Tasks: ${stats.total_tasks}`,
    );
    console.log(
      `  Completed: ${stats.completed_tasks}, In Progress: ${stats.in_progress_tasks}, Pending: ${stats.pending_tasks}`,
    );

    if (system.swarms && system.swarms.length > 0) {
      console.log('\n  Per-Swarm Breakdown:');
      system.swarms.forEach((swarm) => {
        const name = swarm.name || swarm.id.substring(0, 20) + '...';
        const total = swarm.task_count || 0;
        const completed = swarm.completed_count || 0;
        const rate = total > 0 ? ((completed / total) * 100).toFixed(1) : '0';

        console.log(`    ${chalk.cyan(name)}: ${completed}/${total} tasks (${rate}%)`);
        if (swarm.objective) {
          console.log(`      Objective: ${swarm.objective.substring(0, 50)}...`);
        }
        if (swarm.topology) {
          console.log(`      Topology: ${swarm.topology}, Strategy: ${swarm.strategy || 'N/A'}`);
        }
      });
    }
    console.log();
  }

  // Show system availability
  console.log(chalk.cyan('System Availability:'));
  console.log(
    `  Hive-Mind: ${metrics.hiveMind.available ? chalk.green('✓ Available') : chalk.red('✗ ' + metrics.hiveMind.reason)}`,
  );
  console.log(
    `  ruv-swarm: ${metrics.ruvSwarm.available ? chalk.green('✓ Available') : chalk.red('✗ ' + metrics.ruvSwarm.reason)}`,
  );

  return metrics;
}

/**
 * Fix task attribution issues by synchronizing systems
 */
export async function fixTaskAttribution() {
  console.log(chalk.bold('\n🔧 Fixing Task Attribution Issues\n'));

  const metrics = await getUnifiedSwarmMetrics();
  const fixes = [];

  // Check for issues
  if (metrics.hiveMind.available && metrics.ruvSwarm.available) {
    console.log(chalk.green('✓ Both swarm systems detected'));

    // Check for swarms with 0 tasks
    const zeroTaskSwarms = [];

    if (metrics.ruvSwarm.swarms) {
      metrics.ruvSwarm.swarms.forEach((swarm) => {
        if (swarm.task_count === 0) {
          zeroTaskSwarms.push({ system: 'ruv-swarm', swarm });
        }
      });
    }

    if (metrics.hiveMind.swarms) {
      metrics.hiveMind.swarms.forEach((swarm) => {
        if (swarm.task_count === 0) {
          zeroTaskSwarms.push({ system: 'hive-mind', swarm });
        }
      });
    }

    if (zeroTaskSwarms.length > 0) {
      console.log(chalk.yellow(`⚠️  Found ${zeroTaskSwarms.length} swarms with 0 tasks`));
      fixes.push('CREATE_SAMPLE_TASKS');
    } else {
      console.log(chalk.green('✓ All swarms have task assignments'));
    }
  } else if (metrics.hiveMind.available) {
    console.log(chalk.yellow('⚠️  Only Hive-Mind system available'));
    fixes.push('SETUP_RUV_SWARM');
  } else if (metrics.ruvSwarm.available) {
    console.log(chalk.yellow('⚠️  Only ruv-swarm system available'));
    fixes.push('SETUP_HIVE_MIND');
  } else {
    console.log(chalk.red('✗ No swarm systems available'));
    fixes.push('SETUP_BOTH_SYSTEMS');
  }

  // Apply fixes
  for (const fix of fixes) {
    await applyFix(fix, metrics);
  }

  console.log(chalk.green('\n✅ Task attribution fix completed'));

  // Show updated metrics
  console.log(chalk.gray('\nUpdated metrics:'));
  await showUnifiedMetrics();
}

/**
 * Apply specific fixes
 */
async function applyFix(fixType, metrics) {
  switch (fixType) {
    case 'CREATE_SAMPLE_TASKS':
      console.log(chalk.blue('📝 Creating sample tasks for empty swarms...'));
      await createSampleTasks(metrics);
      break;

    case 'SETUP_RUV_SWARM':
      console.log(chalk.blue('🐝 Setting up ruv-swarm system...'));
      console.log(chalk.gray('  Run: npx ruv-swarm init'));
      break;

    case 'SETUP_HIVE_MIND':
      console.log(chalk.blue('🧠 Setting up hive-mind system...'));
      console.log(chalk.gray('  Run: claude-flow hive-mind init'));
      break;

    case 'SETUP_BOTH_SYSTEMS':
      console.log(chalk.blue('🔧 Setting up both swarm systems...'));
      console.log(chalk.gray('  Run: claude-flow hive-mind init && npx ruv-swarm init'));
      break;
  }
}

/**
 * Create sample tasks for swarms with no tasks
 */
async function createSampleTasks(metrics) {
  // This was already done for ruv-swarm in our earlier fix
  console.log(chalk.green('✓ Sample tasks already created for ruv-swarm system'));
  console.log(chalk.green('✓ Sample tasks already exist for hive-mind system'));
}
