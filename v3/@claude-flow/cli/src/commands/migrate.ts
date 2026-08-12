/**
 * V3 CLI Migrate Command
 * Migration tools for V2 to V3 transition
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import * as fs from 'fs';
import * as path from 'path';
import { detectRemovedAgentGaps, type RemovedAgentMapping } from './migrate-agent-detection.js';
import { restoreRemovedAgents } from './migrate-agent-restore.js';

// Migration targets
const MIGRATION_TARGETS = [
  { value: 'config', label: 'Configuration', hint: 'Migrate configuration files' },
  { value: 'memory', label: 'Memory Data', hint: 'Migrate memory/database content' },
  { value: 'agents', label: 'Agent Configs', hint: 'Migrate agent configurations' },
  { value: 'hooks', label: 'Hooks', hint: 'Migrate hook definitions' },
  { value: 'workflows', label: 'Workflows', hint: 'Migrate workflow definitions' },
  { value: 'embeddings', label: 'Embeddings', hint: 'Migrate to ONNX with hyperbolic support' },
  { value: 'all', label: 'All', hint: 'Full migration' }
];

// ADR-128 Phase 2 deleted these 9 forked agents from the init template,
// making each plugin canonical — but ADR-128's own Consequences section
// promised "`ruflo migrate` should detect removed agents and print install
// suggestions," which never shipped until ADR-382 Part B (issue #2971).
const REMOVED_AGENTS: RemovedAgentMapping[] = [
  { basename: 'coder.md', plugin: 'ruflo-core' },
  { basename: 'researcher.md', plugin: 'ruflo-core' },
  { basename: 'reviewer.md', plugin: 'ruflo-core' },
  { basename: 'tester.md', plugin: 'ruflo-testgen' },
  { basename: 'memory-specialist.md', plugin: 'ruflo-rag-memory' },
  { basename: 'security-auditor.md', plugin: 'ruflo-security-audit' },
  { basename: 'sparc-orchestrator.md', plugin: 'ruflo-sparc' },
  { basename: 'goal-planner.md', plugin: 'ruflo-goals' },
  { basename: 'adr-architect.md', plugin: 'ruflo-adr' },
];

// Status command
const statusCommand: Command = {
  name: 'status',
  description: 'Check migration status',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const cwd = ctx.cwd || process.cwd();

    interface ComponentStatus {
      component: string;
      status: string;
      migrationNeeded: string;
    }

    const components: ComponentStatus[] = [];

    // Check v2 config: claude-flow.config.json with version "2" or missing version
    const v2ConfigPath = path.join(cwd, 'claude-flow.config.json');
    const v3ConfigDir = path.join(cwd, '.claude-flow');
    let hasV2Config = false;
    let hasV3Config = false;

    try {
      if (fs.existsSync(v2ConfigPath)) {
        const raw = fs.readFileSync(v2ConfigPath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed.version === '2' || parsed.version === 2 || !parsed.version) {
          hasV2Config = true;
        }
      }
    } catch { /* ignore parse errors */ }

    try {
      hasV3Config = fs.existsSync(v3ConfigDir) && fs.statSync(v3ConfigDir).isDirectory();
    } catch { /* ignore */ }

    if (hasV2Config && hasV3Config) {
      components.push({ component: 'Config', status: 'v2 + v3', migrationNeeded: 'no' });
    } else if (hasV2Config) {
      components.push({ component: 'Config', status: 'v2', migrationNeeded: 'yes' });
    } else if (hasV3Config) {
      components.push({ component: 'Config', status: 'v3', migrationNeeded: 'no' });
    } else {
      components.push({ component: 'Config', status: 'missing', migrationNeeded: 'no' });
    }

    // Check v2 memory: ./data/memory/*.json or memory.db
    const v2MemoryDir = path.join(cwd, 'data', 'memory');
    let hasV2MemoryJson = false;
    let hasV2MemoryDb = false;

    try {
      if (fs.existsSync(v2MemoryDir)) {
        const files = fs.readdirSync(v2MemoryDir);
        hasV2MemoryJson = files.some(f => f.endsWith('.json'));
        hasV2MemoryDb = files.includes('memory.db');
      }
    } catch { /* ignore */ }

    if (hasV2MemoryJson || hasV2MemoryDb) {
      components.push({ component: 'Memory', status: 'v2', migrationNeeded: 'yes' });
    } else {
      components.push({ component: 'Memory', status: 'missing', migrationNeeded: 'no' });
    }

    // Check v2 sessions: ./data/sessions/
    const v2SessionsDir = path.join(cwd, 'data', 'sessions');
    let hasV2Sessions = false;

    try {
      if (fs.existsSync(v2SessionsDir)) {
        const files = fs.readdirSync(v2SessionsDir);
        hasV2Sessions = files.length > 0;
      }
    } catch { /* ignore */ }

    if (hasV2Sessions) {
      components.push({ component: 'Sessions', status: 'v2', migrationNeeded: 'yes' });
    } else {
      components.push({ component: 'Sessions', status: 'missing', migrationNeeded: 'no' });
    }

    // Check migration state
    const migrationStatePath = path.join(cwd, '.claude-flow', 'migration-state.json');
    let migrationState: string | null = null;
    try {
      if (fs.existsSync(migrationStatePath)) {
        const raw = fs.readFileSync(migrationStatePath, 'utf-8');
        const parsed = JSON.parse(raw);
        migrationState = parsed.status || 'unknown';
      }
    } catch { /* ignore */ }

    if (migrationState) {
      components.push({ component: 'Migration State', status: migrationState, migrationNeeded: 'no' });
    }

    // ADR-382 Part B: agents ADR-128 removed from the init template that are
    // both missing from this project and not covered by an installed plugin.
    const removedAgentGaps = detectRemovedAgentGaps(cwd, REMOVED_AGENTS);

    // Display results
    if (ctx.flags.format === 'json') {
      output.printJson({ components, migrationState, removedAgentGaps });
      return { success: true, data: { components, migrationState, removedAgentGaps } };
    }

    output.writeln();
    output.writeln(output.bold('Migration Status'));
    output.writeln();

    output.printTable({
      columns: [
        { key: 'component', header: 'Component', width: 20 },
        { key: 'status', header: 'Status', width: 15 },
        { key: 'migrationNeeded', header: 'Migration Needed', width: 20 }
      ],
      data: components.map(c => ({
        component: c.component,
        status: formatMigrationStatus(c.status),
        migrationNeeded: c.migrationNeeded === 'yes' ? output.warning('yes') : output.dim('no')
      })),
      border: false
    });

    const needsMigration = components.some(c => c.migrationNeeded === 'yes');
    output.writeln();
    if (needsMigration) {
      output.printInfo('V2 artifacts detected. Run "claude-flow migrate run" to migrate.');
    } else {
      output.printSuccess('No migration needed.');
    }

    if (removedAgentGaps.length > 0) {
      output.writeln();
      output.writeln(output.bold('Removed Agents (ADR-128)'));
      output.printTable({
        columns: [
          { key: 'agent', header: 'Agent', width: 24 },
          { key: 'plugin', header: 'Owning Plugin', width: 20 },
          { key: 'installCommand', header: 'Install', width: 34 }
        ],
        data: removedAgentGaps.map(g => ({
          agent: output.warning(g.agent),
          plugin: g.plugin,
          installCommand: output.dim(g.installCommand)
        })),
        border: false
      });
      output.writeln();
      output.printInfo(
        `${removedAgentGaps.length} agent(s) removed by ADR-128 are missing from .claude/agents/ and not covered by an installed plugin.`
      );
      output.printInfo(
        'Run "ruflo migrate fix --agents" to restore them from their canonical plugin content, or install the owning plugin.'
      );
    }

    return { success: true, data: { components, needsMigration, removedAgentGaps } };
  }
};

// Run migration
const runCommand: Command = {
  name: 'run',
  description: 'Run migration',
  options: [
    {
      name: 'target',
      short: 't',
      description: 'Migration target',
      type: 'string',
      choices: MIGRATION_TARGETS.map(t => t.value)
    },
    {
      name: 'dry-run',
      description: 'Show what would be migrated without making changes',
      type: 'boolean',
      default: false
    },
    {
      name: 'backup',
      description: 'Create backup before migration',
      type: 'boolean',
      default: true
    },
    {
      name: 'force',
      short: 'f',
      description: 'Force migration (overwrite existing)',
      type: 'boolean',
      default: false
    }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const cwd = ctx.cwd || process.cwd();
    const dryRun = ctx.flags['dry-run'] === true;
    const skipBackup = ctx.flags.backup === false;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const v3Dir = path.join(cwd, '.claude-flow');
    const backupDir = path.join(v3Dir, 'backup', `v2-${timestamp}`);
    const migrationStatePath = path.join(v3Dir, 'migration-state.json');

    const migrated: string[] = [];
    const skipped: string[] = [];

    output.writeln();
    output.writeln(output.bold('V2 to V3 Migration'));
    if (dryRun) {
      output.printWarning('Dry run mode — no changes will be made.');
    }
    output.writeln();

    // Ensure .claude-flow directory exists
    if (!dryRun) {
      fs.mkdirSync(v3Dir, { recursive: true });
    }

    // --- Backup ---
    if (!skipBackup && !dryRun) {
      output.writeln(output.dim('Creating backup...'));
      fs.mkdirSync(backupDir, { recursive: true });
    }

    // --- Config migration ---
    const v2ConfigPath = path.join(cwd, 'claude-flow.config.json');
    try {
      if (fs.existsSync(v2ConfigPath)) {
        const raw = fs.readFileSync(v2ConfigPath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed.version === '2' || parsed.version === 2 || !parsed.version) {
          if (dryRun) {
            output.printInfo(`Would migrate config: ${v2ConfigPath}`);
          } else {
            // Backup
            if (!skipBackup) {
              fs.copyFileSync(v2ConfigPath, path.join(backupDir, 'claude-flow.config.json'));
            }
            // Transform to v3 format
            const v3Config: Record<string, unknown> = { ...parsed, version: '3' };
            // Rename swarm.mode -> swarm.topology if present
            if (v3Config.swarm && typeof v3Config.swarm === 'object') {
              const swarm = v3Config.swarm as Record<string, unknown>;
              if ('mode' in swarm && !('topology' in swarm)) {
                swarm.topology = swarm.mode;
                delete swarm.mode;
              }
            }
            // Rename memory.type -> memory.backend if present
            if (v3Config.memory && typeof v3Config.memory === 'object') {
              const mem = v3Config.memory as Record<string, unknown>;
              if ('type' in mem && !('backend' in mem)) {
                mem.backend = mem.type;
                delete mem.type;
              }
            }
            const v3ConfigPath = path.join(v3Dir, 'config.json');
            fs.writeFileSync(v3ConfigPath, JSON.stringify(v3Config, null, 2));
            output.printSuccess(`Config migrated to ${v3ConfigPath}`);
          }
          migrated.push('config');
        } else {
          output.printInfo('Config already at v3 — skipping.');
          skipped.push('config');
        }
      } else {
        output.writeln(output.dim('No v2 config found — skipping config migration.'));
        skipped.push('config');
      }
    } catch (err) {
      output.printError('Config migration failed', String(err));
      skipped.push('config');
    }

    // --- Memory migration ---
    const v2MemoryDir = path.join(cwd, 'data', 'memory');
    try {
      if (fs.existsSync(v2MemoryDir)) {
        const files = fs.readdirSync(v2MemoryDir);
        const jsonFiles = files.filter(f => f.endsWith('.json'));
        const hasDb = files.includes('memory.db');

        if (jsonFiles.length > 0 || hasDb) {
          if (dryRun) {
            output.printInfo(`Would migrate memory: ${jsonFiles.length} JSON files, ${hasDb ? '1 DB' : 'no DB'}`);
          } else {
            // Backup memory files
            if (!skipBackup) {
              const memBackup = path.join(backupDir, 'data', 'memory');
              fs.mkdirSync(memBackup, { recursive: true });
              for (const f of files) {
                const src = path.join(v2MemoryDir, f);
                if (fs.statSync(src).isFile()) {
                  fs.copyFileSync(src, path.join(memBackup, f));
                }
              }
            }
            output.printSuccess(`Memory files backed up (${jsonFiles.length} JSON, ${hasDb ? '1 DB' : '0 DB'}).`);
            output.printInfo('Run "claude-flow memory init --force" to import v2 memory into v3 AgentDB.');
          }
          migrated.push('memory');
        } else {
          output.writeln(output.dim('No v2 memory files found — skipping.'));
          skipped.push('memory');
        }
      } else {
        output.writeln(output.dim('No v2 memory directory found — skipping.'));
        skipped.push('memory');
      }
    } catch (err) {
      output.printError('Memory migration failed', String(err));
      skipped.push('memory');
    }

    // --- Session migration ---
    const v2SessionsDir = path.join(cwd, 'data', 'sessions');
    try {
      if (fs.existsSync(v2SessionsDir)) {
        const files = fs.readdirSync(v2SessionsDir);
        if (files.length > 0) {
          if (dryRun) {
            output.printInfo(`Would migrate sessions: ${files.length} files from ${v2SessionsDir}`);
          } else {
            const v3SessionsDir = path.join(v3Dir, 'sessions');
            fs.mkdirSync(v3SessionsDir, { recursive: true });

            // Backup
            if (!skipBackup) {
              const sessBackup = path.join(backupDir, 'data', 'sessions');
              fs.mkdirSync(sessBackup, { recursive: true });
              for (const f of files) {
                const src = path.join(v2SessionsDir, f);
                if (fs.statSync(src).isFile()) {
                  fs.copyFileSync(src, path.join(sessBackup, f));
                }
              }
            }

            // Copy to v3 location
            for (const f of files) {
              const src = path.join(v2SessionsDir, f);
              if (fs.statSync(src).isFile()) {
                fs.copyFileSync(src, path.join(v3SessionsDir, f));
              }
            }
            output.printSuccess(`Sessions migrated: ${files.length} files to ${v3SessionsDir}`);
          }
          migrated.push('sessions');
        } else {
          output.writeln(output.dim('No v2 session files found — skipping.'));
          skipped.push('sessions');
        }
      } else {
        output.writeln(output.dim('No v2 sessions directory found — skipping.'));
        skipped.push('sessions');
      }
    } catch (err) {
      output.printError('Session migration failed', String(err));
      skipped.push('sessions');
    }

    // --- Save migration state ---
    if (!dryRun && migrated.length > 0) {
      const state = {
        status: 'completed',
        timestamp,
        backupPath: skipBackup ? null : backupDir,
        migrated,
        skipped
      };
      fs.writeFileSync(migrationStatePath, JSON.stringify(state, null, 2));
      output.writeln();
      output.printSuccess(`Migration state saved to ${migrationStatePath}`);
    }

    // Summary
    output.writeln();
    if (dryRun) {
      output.printInfo(`Dry run complete. ${migrated.length} component(s) would be migrated.`);
    } else if (migrated.length > 0) {
      output.printSuccess(`Migration complete. ${migrated.length} component(s) migrated: ${migrated.join(', ')}`);
      output.printInfo('Run "claude-flow migrate verify" to validate the migration.');
    } else {
      output.printInfo('Nothing to migrate.');
    }

    return { success: true, data: { migrated, skipped, dryRun } };
  }
};

// Verify migration
const verifyCommand: Command = {
  name: 'verify',
  description: 'Verify migration integrity',
  options: [
    {
      name: 'fix',
      description: 'Automatically fix issues',
      type: 'boolean',
      default: false
    }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const cwd = ctx.cwd || process.cwd();
    const v3Dir = path.join(cwd, '.claude-flow');
    const migrationStatePath = path.join(v3Dir, 'migration-state.json');

    interface CheckResult {
      check: string;
      result: string;
    }

    const checks: CheckResult[] = [];
    let allPassed = true;

    output.writeln();
    output.writeln(output.bold('Migration Verification'));
    output.writeln();

    // Check 1: Migration state file exists
    let migrationState: Record<string, unknown> | null = null;
    try {
      if (fs.existsSync(migrationStatePath)) {
        const raw = fs.readFileSync(migrationStatePath, 'utf-8');
        migrationState = JSON.parse(raw);
        checks.push({ check: 'Migration state file', result: 'passed' });
      } else {
        checks.push({ check: 'Migration state file', result: 'failed' });
        allPassed = false;
      }
    } catch {
      checks.push({ check: 'Migration state file', result: 'failed' });
      allPassed = false;
    }

    // Check 2: V3 config exists and is valid JSON
    const v3ConfigPath = path.join(v3Dir, 'config.json');
    try {
      if (fs.existsSync(v3ConfigPath)) {
        const raw = fs.readFileSync(v3ConfigPath, 'utf-8');
        JSON.parse(raw); // validate JSON
        checks.push({ check: 'V3 config (valid JSON)', result: 'passed' });
      } else {
        // Config might not have been migrated if there was no v2 config
        const wasMigrated = migrationState &&
          Array.isArray(migrationState.migrated) &&
          (migrationState.migrated as string[]).includes('config');
        if (wasMigrated) {
          checks.push({ check: 'V3 config (valid JSON)', result: 'failed' });
          allPassed = false;
        } else {
          checks.push({ check: 'V3 config (valid JSON)', result: 'skipped' });
        }
      }
    } catch {
      checks.push({ check: 'V3 config (valid JSON)', result: 'failed' });
      allPassed = false;
    }

    // Check 3: Backup exists
    if (migrationState && migrationState.backupPath) {
      const backupPath = migrationState.backupPath as string;
      try {
        if (fs.existsSync(backupPath) && fs.statSync(backupPath).isDirectory()) {
          checks.push({ check: 'Backup directory', result: 'passed' });
        } else {
          checks.push({ check: 'Backup directory', result: 'failed' });
          allPassed = false;
        }
      } catch {
        checks.push({ check: 'Backup directory', result: 'failed' });
        allPassed = false;
      }
    } else if (migrationState && migrationState.backupPath === null) {
      checks.push({ check: 'Backup directory', result: 'skipped (backup was disabled)' });
    } else {
      checks.push({ check: 'Backup directory', result: 'failed' });
      allPassed = false;
    }

    // Check 4: V3 sessions directory if sessions were migrated
    if (migrationState &&
        Array.isArray(migrationState.migrated) &&
        (migrationState.migrated as string[]).includes('sessions')) {
      const v3Sessions = path.join(v3Dir, 'sessions');
      try {
        if (fs.existsSync(v3Sessions) && fs.readdirSync(v3Sessions).length > 0) {
          checks.push({ check: 'V3 sessions directory', result: 'passed' });
        } else {
          checks.push({ check: 'V3 sessions directory', result: 'failed' });
          allPassed = false;
        }
      } catch {
        checks.push({ check: 'V3 sessions directory', result: 'failed' });
        allPassed = false;
      }
    }

    // Display
    if (ctx.flags.format === 'json') {
      output.printJson({ checks, allPassed });
      return { success: allPassed, data: { checks, allPassed } };
    }

    output.printTable({
      columns: [
        { key: 'check', header: 'Check', width: 30 },
        { key: 'result', header: 'Result', width: 35 }
      ],
      data: checks.map(c => ({
        check: c.check,
        result: formatMigrationStatus(c.result)
      })),
      border: false
    });

    output.writeln();
    if (allPassed) {
      output.printSuccess('All verification checks passed.');
    } else {
      output.printError('Some verification checks failed.');
      output.printInfo('Run "claude-flow migrate run" to re-run the migration, or "migrate rollback" to restore from backup.');
    }

    return { success: allPassed, data: { checks, allPassed }, exitCode: allPassed ? 0 : 1 };
  }
};

// Rollback migration
const rollbackCommand: Command = {
  name: 'rollback',
  description: 'Rollback to previous version',
  options: [
    {
      name: 'backup-id',
      description: 'Backup ID to restore',
      type: 'string'
    },
    {
      name: 'force',
      short: 'f',
      description: 'Skip confirmation',
      type: 'boolean',
      default: false
    }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const cwd = ctx.cwd || process.cwd();
    const v3Dir = path.join(cwd, '.claude-flow');
    const migrationStatePath = path.join(v3Dir, 'migration-state.json');

    output.writeln();
    output.writeln(output.bold('Migration Rollback'));
    output.writeln();

    // Read migration state
    let migrationState: Record<string, unknown>;
    try {
      if (!fs.existsSync(migrationStatePath)) {
        output.printError('No migration state found.', 'Run "migrate run" first before attempting rollback.');
        return { success: false, exitCode: 1 };
      }
      const raw = fs.readFileSync(migrationStatePath, 'utf-8');
      migrationState = JSON.parse(raw);
    } catch (err) {
      output.printError('Failed to read migration state', String(err));
      return { success: false, exitCode: 1 };
    }

    const backupPath = migrationState.backupPath as string | null;
    if (!backupPath) {
      output.printError('No backup path in migration state.', 'Migration was run with --no-backup. Cannot rollback.');
      return { success: false, exitCode: 1 };
    }

    if (!fs.existsSync(backupPath)) {
      output.printError('Backup directory not found.', `Expected: ${backupPath}`);
      return { success: false, exitCode: 1 };
    }

    const restored: string[] = [];

    try {
      // Restore config
      const backupConfig = path.join(backupPath, 'claude-flow.config.json');
      if (fs.existsSync(backupConfig)) {
        const destConfig = path.join(cwd, 'claude-flow.config.json');
        fs.copyFileSync(backupConfig, destConfig);
        // Remove v3 config
        const v3Config = path.join(v3Dir, 'config.json');
        if (fs.existsSync(v3Config)) {
          fs.unlinkSync(v3Config);
        }
        output.printSuccess('Restored: config');
        restored.push('config');
      }

      // Restore memory
      const backupMemory = path.join(backupPath, 'data', 'memory');
      if (fs.existsSync(backupMemory)) {
        const destMemory = path.join(cwd, 'data', 'memory');
        fs.mkdirSync(destMemory, { recursive: true });
        const files = fs.readdirSync(backupMemory);
        for (const f of files) {
          fs.copyFileSync(path.join(backupMemory, f), path.join(destMemory, f));
        }
        output.printSuccess(`Restored: memory (${files.length} files)`);
        restored.push('memory');
      }

      // Restore sessions
      const backupSessions = path.join(backupPath, 'data', 'sessions');
      if (fs.existsSync(backupSessions)) {
        const destSessions = path.join(cwd, 'data', 'sessions');
        fs.mkdirSync(destSessions, { recursive: true });
        const files = fs.readdirSync(backupSessions);
        for (const f of files) {
          fs.copyFileSync(path.join(backupSessions, f), path.join(destSessions, f));
        }
        // Remove v3 sessions
        const v3Sessions = path.join(v3Dir, 'sessions');
        if (fs.existsSync(v3Sessions)) {
          const v3Files = fs.readdirSync(v3Sessions);
          for (const f of v3Files) {
            fs.unlinkSync(path.join(v3Sessions, f));
          }
          fs.rmdirSync(v3Sessions);
        }
        output.printSuccess(`Restored: sessions (${files.length} files)`);
        restored.push('sessions');
      }

      // Delete migration state
      fs.unlinkSync(migrationStatePath);
      output.writeln();
      output.printSuccess(`Rollback complete. Restored: ${restored.join(', ') || 'nothing to restore'}`);

      return { success: true, data: { restored } };
    } catch (err) {
      output.printError('Rollback failed', String(err));
      return { success: false, exitCode: 1 };
    }
  }
};

// Breaking changes info
const breakingCommand: Command = {
  name: 'breaking',
  description: 'Show V3 breaking changes',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const changes = [
      {
        category: 'Configuration',
        changes: [
          { change: 'Config file renamed', from: 'claude-flow.json', to: 'claude-flow.config.json' },
          { change: 'Swarm config restructured', from: 'swarm.mode', to: 'swarm.topology' },
          { change: 'Provider config format', from: 'provider: "anthropic"', to: 'providers: [...]' }
        ]
      },
      {
        category: 'Memory',
        changes: [
          { change: 'Backend option changed', from: 'memory: { type }', to: 'memory: { backend }' },
          { change: 'HNSW enabled by default', from: 'Manual opt-in', to: 'Auto-enabled' },
          { change: 'Storage path changed', from: '.claude-flow/memory', to: 'data/memory' }
        ]
      },
      {
        category: 'CLI',
        changes: [
          { change: 'Agent command renamed', from: 'spawn <type>', to: 'agent spawn -t <type>' },
          { change: 'Memory command added', from: 'N/A', to: 'memory <subcommand>' },
          { change: 'Hook command enhanced', from: 'hook <type>', to: 'hooks <subcommand>' }
        ]
      },
      {
        category: 'API',
        changes: [
          { change: 'Removed Deno support', from: 'Deno + Node.js', to: 'Node.js 20+ only' },
          { change: 'Event system changed', from: 'EventEmitter', to: 'Event sourcing' },
          { change: 'Coordination unified', from: 'Multiple coordinators', to: 'SwarmCoordinator' }
        ]
      },
      {
        category: 'Embeddings',
        changes: [
          { change: 'Provider changed', from: 'OpenAI API / TF.js', to: 'ONNX Runtime (local)' },
          { change: 'Geometry support', from: 'Euclidean only', to: 'Hyperbolic (Poincaré ball)' },
          { change: 'Cache system', from: 'Memory-only', to: 'sql.js persistent cache' },
          { change: 'Neural substrate', from: 'None', to: 'RuVector integration' }
        ]
      }
    ];

    if (ctx.flags.format === 'json') {
      output.printJson(changes);
      return { success: true, data: changes };
    }

    output.writeln();
    output.writeln(output.bold('V3 Breaking Changes'));
    output.writeln();

    for (const category of changes) {
      output.writeln(output.highlight(category.category));
      output.printTable({
        columns: [
          { key: 'change', header: 'Change', width: 25 },
          { key: 'from', header: 'V2', width: 25 },
          { key: 'to', header: 'V3', width: 25 }
        ],
        data: category.changes,
        border: false
      });
      output.writeln();
    }

    output.printInfo('Run "claude-flow migrate run" to automatically handle these changes');

    return { success: true, data: changes };
  }
};

// Fix command — apply remediations that `status` can only point at (#2985).
// Logic lives in migrate-agent-restore.ts (migrate.ts is over the 500-line
// budget; same split as migrate-agent-detection.ts).
const fixCommand: Command = {
  name: 'fix',
  description: 'Apply fixes for gaps detected by "migrate status"',
  options: [
    {
      name: 'agents',
      description: 'Restore agents removed by ADR-128 from their canonical plugin content',
      type: 'boolean',
      default: false
    },
    {
      name: 'dry-run',
      short: 'd',
      description: 'Show what would be restored without writing',
      type: 'boolean',
      default: false
    }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const cwd = ctx.cwd || process.cwd();

    if (!ctx.flags.agents) {
      output.printInfo('Nothing selected. Pass --agents to restore ADR-128-removed agents.');
      return { success: true };
    }

    const gaps = detectRemovedAgentGaps(cwd, REMOVED_AGENTS);
    if (gaps.length === 0) {
      output.printSuccess('No removed-agent gaps to fix — every agent is present or covered by an installed plugin.');
      return { success: true, data: { results: [] } };
    }

    const dryRun = Boolean(ctx.flags['dry-run']);
    const results = await restoreRemovedAgents(cwd, gaps, { dryRun });

    if (ctx.flags.format === 'json') {
      output.printJson({ dryRun, results });
      return { success: results.every(r => r.status !== 'failed'), data: { dryRun, results } };
    }

    output.writeln();
    output.writeln(output.bold(dryRun ? 'Restore Plan (dry run)' : 'Restored Agents'));
    output.printTable({
      columns: [
        { key: 'agent', header: 'Agent', width: 24 },
        { key: 'status', header: 'Status', width: 10 },
        { key: 'detail', header: dryRun ? 'Would write' : 'Detail', width: 44 }
      ],
      data: results.map(r => ({
        agent: r.agent,
        status: r.status === 'failed' ? output.warning(r.status) : r.status,
        detail: r.status === 'failed' ? output.dim(r.error ?? '') : output.dim(`${r.path ?? ''}${r.source ? ` (from ${r.source})` : ''}`)
      })),
      border: false
    });

    const failed = results.filter(r => r.status === 'failed');
    output.writeln();
    if (failed.length > 0) {
      output.printWarning(`${failed.length} agent(s) could not be restored — install the owning plugin instead (see table).`);
    } else if (!dryRun) {
      output.printSuccess(`${results.filter(r => r.status === 'restored').length} agent(s) restored. Re-run "ruflo migrate status" to verify.`);
    }

    return { success: failed.length === 0, data: { dryRun, results } };
  }
};

// Main migrate command
export const migrateCommand: Command = {
  name: 'migrate',
  description: 'V2 to V3 migration tools',
  subcommands: [statusCommand, runCommand, verifyCommand, rollbackCommand, breakingCommand, fixCommand],
  options: [],
  examples: [
    { command: 'claude-flow migrate status', description: 'Check migration status' },
    { command: 'claude-flow migrate run --dry-run', description: 'Preview migration' },
    { command: 'claude-flow migrate run -t all', description: 'Run full migration' },
    { command: 'claude-flow migrate fix --agents', description: 'Restore ADR-128-removed agents' }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    output.writeln();
    output.writeln(output.bold('V2 to V3 Migration Tools'));
    output.writeln();
    output.writeln('Usage: claude-flow migrate <subcommand> [options]');
    output.writeln();
    output.writeln('Subcommands:');
    output.printList([
      `${output.highlight('status')}    - Check migration status`,
      `${output.highlight('run')}       - Run migration`,
      `${output.highlight('verify')}    - Verify migration integrity`,
      `${output.highlight('rollback')}  - Rollback to previous version`,
      `${output.highlight('breaking')}  - Show breaking changes`,
      `${output.highlight('fix')}       - Apply fixes for detected gaps (--agents)`
    ]);

    return { success: true };
  }
};

// Helper functions
function formatMigrationStatus(status: string): string {
  if (status === 'migrated' || status === 'passed' || status === 'completed') {
    return output.success(status);
  }
  if (status === 'pending' || status === 'partial') {
    return output.warning(status);
  }
  if (status === 'failed') {
    return output.error(status);
  }
  if (status === 'not-required' || status.startsWith('skipped') || status === 'v3' || status === 'missing') {
    return output.dim(status);
  }
  if (status === 'v2') {
    return output.warning(status);
  }
  if (status === 'v2 + v3') {
    return output.success(status);
  }
  return status;
}

function getMigrationSteps(target: string): Array<{ name: string; description: string; source: string; dest: string }> {
  const allSteps = [
    { name: 'Configuration Files', description: 'Migrate config schema to V3 format', source: './claude-flow.json', dest: './claude-flow.config.json' },
    { name: 'Memory Backend', description: 'Upgrade to hybrid backend with AgentDB', source: './.claude-flow/memory', dest: './data/memory' },
    { name: 'Agent Definitions', description: 'Convert agent configs to V3 format', source: './.claude-flow/agents', dest: './v3/agents' },
    { name: 'Hook Registry', description: 'Migrate hooks to V3 hook system', source: './src/hooks', dest: './v3/hooks' },
    { name: 'Workflow Definitions', description: 'Convert workflows to event-sourced format', source: './.claude-flow/workflows', dest: './data/workflows' },
    { name: 'Embeddings System', description: 'Migrate to ONNX with hyperbolic (Poincaré ball)', source: 'OpenAI/TF.js embeddings', dest: '.claude-flow/embeddings.json' }
  ];

  if (target === 'all') return allSteps;

  return allSteps.filter(s => s.name.toLowerCase().includes(target.toLowerCase()));
}

export default migrateCommand;
