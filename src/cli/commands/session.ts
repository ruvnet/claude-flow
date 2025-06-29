/**
 * Session management commands for Claude-Flow
 */

import { Command, colors, Table, Confirm, Input } from '../../utils/cli/index.js';
import { formatDuration, formatStatusIndicator } from '../formatter.js';
import { generateId } from '../../utils/helpers.js';
import * as fs from 'node:fs/promises';
import { paths } from '../../utils/paths.js';
import * as crypto from 'node:crypto';
import * as os from 'node:os';

export const sessionCommand = new Command()
  .description('Manage Claude-Flow sessions')
  .action(() => {
    sessionCommand.showHelp();
  })
  .command('list', Command)
    .description('List all saved sessions')
    .option('-a, --active', 'Show only active sessions')
    .option('--format <format:string>', 'Output format (table, json)', { default: 'table' })
    .action(async (options: any) => {
      await listSessions(options);
    })
  .command('save', Command)
    .description('Save current session state')
    .arguments('[name:string]')
    .option('-d, --description <desc:string>', 'Session description')
    .option('-t, --tags <tags:string>', 'Comma-separated tags')
    .option('--auto', 'Auto-generate session name')
    .action(async (options: any, name: string | undefined) => {
      await saveSession(name, options);
    })
  .command('restore', Command)
    .description('Restore a saved session')
    .arguments('<session-id:string>')
    .option('-f, --force', 'Force restore without confirmation')
    .option('--merge', 'Merge with current session instead of replacing')
    .action(async (options: any, sessionId: string) => {
      await restoreSession(sessionId, options);
    })
  .command('delete', Command)
    .description('Delete a saved session')
    .arguments('<session-id:string>')
    .option('-f, --force', 'Skip confirmation prompt')
    .action(async (options: any, sessionId: string) => {
      await deleteSession(sessionId, options);
    })
  .command('export', Command)
    .description('Export session to file')
    .arguments('<session-id:string> <output-file:string>')
    .option('--format <format:string>', 'Export format (json, yaml)', { default: 'json' })
    .option('--include-memory', 'Include agent memory in export')
    .action(async (options: any, sessionId: string, outputFile: string) => {
      await exportSession(sessionId, outputFile, options);
    })
  .command('import', Command)
    .description('Import session from file')
    .arguments('<input-file:string>')
    .option('-n, --name <name:string>', 'Custom session name')
    .option('--overwrite', 'Overwrite existing session with same ID')
    .action(async (options: any, inputFile: string) => {
      await importSession(inputFile, options);
    })
  .command('info', Command)
    .description('Show detailed session information')
    .arguments('<session-id:string>')
    .action(async (options: any, sessionId: string) => {
      await showSessionInfo(sessionId);
    })
  .command('clean', Command)
    .description('Clean up old or orphaned sessions')
    .option('--older-than <days:number>', 'Delete sessions older than N days', { default: 30 })
    .option('--dry-run', 'Show what would be deleted without deleting')
    .option('--orphaned', 'Only clean orphaned sessions')
    .action(async (options: any) => {
      await cleanSessions(options);
    });

interface SessionData {
  id: string;
  name: string;
  description?: string;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
  state: {
    agents: any[];
    tasks: any[];
    memory: any[];
    configuration: any;
  };
  metadata: {
    version: string;
    platform: string;
    checksum: string;
  };
}

const SESSION_DIR = paths.join('.claude-flow', 'sessions');

async function ensureSessionDir(): Promise<void> {
  try {
    await fs.mkdir(SESSION_DIR, { recursive: true });
  } catch (error: any) {
    if (error.code !== 'EEXIST') {
      throw error;
    }
  }
}

async function listSessions(options: any): Promise<void> {
  try {
    await ensureSessionDir();
    const sessions = await loadAllSessions();
    
    let filteredSessions = sessions;
    if (options.active) {
      // In production, this would check if the session is currently active
      filteredSessions = sessions.filter(s => (s.metadata as any).active);
    }

    if (options.format === 'json') {
      console.log(JSON.stringify(filteredSessions, null, 2));
      return;
    }

    if (filteredSessions.length === 0) {
      console.log(colors.gray('No sessions found'));
      return;
    }

    console.log(colors.cyan.bold(`Sessions (${filteredSessions.length})`));
    console.log('─'.repeat(60));

    const table = new Table()
      .header(['ID', 'Name', 'Description', 'Agents', 'Tasks', 'Created'])
      .border(true);

    for (const session of filteredSessions) {
      table.push([
        colors.gray(session.id.substring(0, 8) + '...'),
        colors.white(session.name),
        session.description ? session.description.substring(0, 30) + (session.description.length > 30 ? '...' : '') : '-',
        session.state.agents.length.toString(),
        session.state.tasks.length.toString(),
        session.createdAt.toLocaleDateString()
      ]);
    }

    table.render();
  } catch (error) {
    console.error(colors.red('Failed to list sessions:'), (error as Error).message);
  }
}

async function saveSession(name: string | undefined, options: any): Promise<void> {
  try {
    // Get current session state (mock for now)
    const currentState = await getCurrentSessionState();
    
    if (!name) {
      if (options.auto) {
        name = `session-${new Date().toISOString().split('T')[0]}-${Date.now().toString().slice(-4)}`;
      } else {
        name = await Input.prompt({
          message: 'Enter session name:',
          default: `session-${new Date().toISOString().split('T')[0]}`,
        });
      }
    }

    const session: SessionData = {
      id: generateId('session'),
      name,
      description: options.description,
      tags: options.tags ? options.tags.split(',').map((t: string) => t.trim()) : [],
      createdAt: new Date(),
      updatedAt: new Date(),
      state: currentState,
      metadata: {
        version: '1.0.0',
        platform: os.platform(),
        checksum: await calculateChecksum(currentState)
      }
    };

    await ensureSessionDir();
    const filePath = paths.join(SESSION_DIR, `${session.id}.json`);
    await fs.writeFile(filePath, JSON.stringify(session, null, 2), 'utf8');

    console.log(colors.green('✓ Session saved successfully'));
    console.log(`${colors.white('ID:')} ${session.id}`);
    console.log(`${colors.white('Name:')} ${session.name}`);
    console.log(`${colors.white('File:')} ${filePath}`);
    
    if (session.description) {
      console.log(`${colors.white('Description:')} ${session.description}`);
    }
    
    console.log(`${colors.white('Agents:')} ${session.state.agents.length}`);
    console.log(`${colors.white('Tasks:')} ${session.state.tasks.length}`);
  } catch (error) {
    console.error(colors.red('Failed to save session:'), (error as Error).message);
  }
}

async function restoreSession(sessionId: string, options: any): Promise<void> {
  try {
    const session = await loadSession(sessionId);
    
    if (!session) {
      console.error(colors.red(`Session '${sessionId}' not found`));
      return;
    }

    // Show session info
    console.log(colors.cyan.bold('Session to restore:'));
    console.log(`${colors.white('Name:')} ${session.name}`);
    console.log(`${colors.white('Description:')} ${session.description || 'None'}`);
    console.log(`${colors.white('Agents:')} ${session.state.agents.length}`);
    console.log(`${colors.white('Tasks:')} ${session.state.tasks.length}`);
    console.log(`${colors.white('Created:')} ${session.createdAt.toLocaleString()}`);

    // Confirmation
    if (!options.force) {
      const action = options.merge ? 'merge with current session' : 'replace current session';
      const confirmed = await Confirm.prompt({
        message: `Are you sure you want to ${action}?`,
        default: false,
      });

      if (!confirmed) {
        console.log(colors.gray('Restore cancelled'));
        return;
      }
    }

    // Validate session integrity
    const expectedChecksum = await calculateChecksum(session.state);
    if (session.metadata.checksum !== expectedChecksum) {
      console.log(colors.yellow('⚠ Warning: Session checksum mismatch. Data may be corrupted.'));
      
      if (!options.force) {
        const proceed = await Confirm.prompt({
          message: 'Continue anyway?',
          default: false,
        });
        
        if (!proceed) {
          console.log(colors.gray('Restore cancelled'));
          return;
        }
      }
    }

    // Restore session (mock for now)
    console.log(colors.yellow('Restoring session...'));
    
    if (options.merge) {
      console.log(colors.blue('• Merging agents...'));
      console.log(colors.blue('• Merging tasks...'));
      console.log(colors.blue('• Merging memory...'));
    } else {
      console.log(colors.blue('• Stopping current agents...'));
      console.log(colors.blue('• Clearing current tasks...'));
      console.log(colors.blue('• Restoring agents...'));
      console.log(colors.blue('• Restoring tasks...'));
      console.log(colors.blue('• Restoring memory...'));
    }

    // Update session metadata
    session.updatedAt = new Date();
    const filePath = paths.join(SESSION_DIR, `${session.id}.json`);
    await fs.writeFile(filePath, JSON.stringify(session, null, 2), 'utf8');

    console.log(colors.green('✓ Session restored successfully'));
    console.log(colors.yellow('Note: This is a mock implementation. In production, this would connect to the orchestrator.'));
  } catch (error) {
    console.error(colors.red('Failed to restore session:'), (error as Error).message);
  }
}

async function deleteSession(sessionId: string, options: any): Promise<void> {
  try {
    const session = await loadSession(sessionId);
    
    if (!session) {
      console.error(colors.red(`Session '${sessionId}' not found`));
      return;
    }

    // Confirmation
    if (!options.force) {
      console.log(`${colors.white('Session:')} ${session.name}`);
      console.log(`${colors.white('Created:')} ${session.createdAt.toLocaleString()}`);
      
      const confirmed = await Confirm.prompt({
        message: 'Are you sure you want to delete this session?',
        default: false,
      });

      if (!confirmed) {
        console.log(colors.gray('Delete cancelled'));
        return;
      }
    }

    const filePath = paths.join(SESSION_DIR, `${session.id}.json`);
    await fs.unlink(filePath);

    console.log(colors.green('✓ Session deleted successfully'));
  } catch (error) {
    console.error(colors.red('Failed to delete session:'), (error as Error).message);
  }
}

async function exportSession(sessionId: string, outputFile: string, options: any): Promise<void> {
  try {
    const session = await loadSession(sessionId);
    
    if (!session) {
      console.error(colors.red(`Session '${sessionId}' not found`));
      return;
    }

    let exportData = session;
    
    if (!options.includeMemory) {
      exportData = {
        ...session,
        state: {
          ...session.state,
          memory: [] // Exclude memory data
        }
      };
    }

    let content: string;
    if (options.format === 'yaml') {
      // In production, you'd use a YAML library
      console.log(colors.yellow('YAML export not implemented yet, using JSON'));
      content = JSON.stringify(exportData, null, 2);
    } else {
      content = JSON.stringify(exportData, null, 2);
    }

    await fs.writeFile(outputFile, content, 'utf8');

    console.log(colors.green('✓ Session exported successfully'));
    console.log(`${colors.white('File:')} ${outputFile}`);
    console.log(`${colors.white('Format:')} ${options.format}`);
    console.log(`${colors.white('Size:')} ${new Blob([content]).size} bytes`);
  } catch (error) {
    console.error(colors.red('Failed to export session:'), (error as Error).message);
  }
}

async function importSession(inputFile: string, options: any): Promise<void> {
  try {
    const content = await fs.readFile(inputFile, 'utf8');
    const sessionData = JSON.parse(content) as SessionData;

    // Validate session data structure
    if (!sessionData.id || !sessionData.name || !sessionData.state) {
      throw new Error('Invalid session file format');
    }

    // Generate new ID if not overwriting
    if (!options.overwrite) {
      sessionData.id = generateId('session');
    }

    // Update name if specified
    if (options.name) {
      sessionData.name = options.name;
    }

    // Check if session already exists
    const existingSession = await loadSession(sessionData.id);
    if (existingSession && !options.overwrite) {
      console.error(colors.red('Session with this ID already exists'));
      console.log(colors.gray('Use --overwrite to replace it'));
      return;
    }

    // Update timestamps
    if (options.overwrite && existingSession) {
      sessionData.updatedAt = new Date();
    } else {
      sessionData.createdAt = new Date();
      sessionData.updatedAt = new Date();
    }

    await ensureSessionDir();
    const filePath = paths.join(SESSION_DIR, `${sessionData.id}.json`);
    await fs.writeFile(filePath, JSON.stringify(sessionData, null, 2), 'utf8');

    console.log(colors.green('✓ Session imported successfully'));
    console.log(`${colors.white('ID:')} ${sessionData.id}`);
    console.log(`${colors.white('Name:')} ${sessionData.name}`);
    console.log(`${colors.white('Action:')} ${options.overwrite ? 'Overwritten' : 'Created'}`);
  } catch (error) {
    console.error(colors.red('Failed to import session:'), (error as Error).message);
  }
}

async function showSessionInfo(sessionId: string): Promise<void> {
  try {
    const session = await loadSession(sessionId);
    
    if (!session) {
      console.error(colors.red(`Session '${sessionId}' not found`));
      return;
    }

    console.log(colors.cyan.bold('Session Information'));
    console.log('─'.repeat(40));
    console.log(`${colors.white('ID:')} ${session.id}`);
    console.log(`${colors.white('Name:')} ${session.name}`);
    console.log(`${colors.white('Description:')} ${session.description || 'None'}`);
    console.log(`${colors.white('Tags:')} ${session.tags.join(', ') || 'None'}`);
    console.log(`${colors.white('Created:')} ${session.createdAt.toLocaleString()}`);
    console.log(`${colors.white('Updated:')} ${session.updatedAt.toLocaleString()}`);
    console.log();

    console.log(colors.cyan.bold('State Summary'));
    console.log('─'.repeat(40));
    console.log(`${colors.white('Agents:')} ${session.state.agents.length}`);
    console.log(`${colors.white('Tasks:')} ${session.state.tasks.length}`);
    console.log(`${colors.white('Memory Entries:')} ${session.state.memory.length}`);
    console.log();

    console.log(colors.cyan.bold('Metadata'));
    console.log('─'.repeat(40));
    console.log(`${colors.white('Version:')} ${session.metadata.version}`);
    console.log(`${colors.white('Platform:')} ${session.metadata.platform}`);
    console.log(`${colors.white('Checksum:')} ${session.metadata.checksum}`);
    
    // Verify integrity
    const currentChecksum = await calculateChecksum(session.state);
    const integrity = currentChecksum === session.metadata.checksum;
    const integrityIcon = formatStatusIndicator(integrity ? 'success' : 'error');
    console.log(`${colors.white('Integrity:')} ${integrityIcon} ${integrity ? 'Valid' : 'Corrupted'}`);

    // File info
    const filePath = paths.join(SESSION_DIR, `${session.id}.json`);
    try {
      const fileInfo = await fs.stat(filePath);
      console.log();
      console.log(colors.cyan.bold('File Information'));
      console.log('─'.repeat(40));
      console.log(`${colors.white('Path:')} ${filePath}`);
      console.log(`${colors.white('Size:')} ${fileInfo.size} bytes`);
      console.log(`${colors.white('Modified:')} ${fileInfo.mtime?.toLocaleString() || 'Unknown'}`);
    } catch {
      console.log(colors.red('Warning: Session file not found'));
    }
  } catch (error) {
    console.error(colors.red('Failed to show session info:'), (error as Error).message);
  }
}

async function cleanSessions(options: any): Promise<void> {
  try {
    await ensureSessionDir();
    const sessions = await loadAllSessions();
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - options.olderThan);
    
    let toDelete = sessions.filter(session => session.createdAt < cutoffDate);
    
    if (options.orphaned) {
      // In production, check if sessions have valid references
      toDelete = toDelete.filter(session => (session.metadata as any).orphaned);
    }

    if (toDelete.length === 0) {
      console.log(colors.gray('No sessions to clean'));
      return;
    }

    console.log(colors.cyan.bold(`Sessions to clean (${toDelete.length})`));
    console.log('─'.repeat(50));
    
    for (const session of toDelete) {
      const age = Math.floor((Date.now() - session.createdAt.getTime()) / (1000 * 60 * 60 * 24));
      console.log(`• ${session.name} (${colors.gray(session.id.substring(0, 8) + '...')}) - ${age} days old`);
    }

    if (options.dryRun) {
      console.log('\n' + colors.yellow('Dry run mode - no files were deleted'));
      return;
    }

    console.log();
    const confirmed = await Confirm.prompt({
      message: `Delete ${toDelete.length} sessions?`,
      default: false,
    });

    if (!confirmed) {
      console.log(colors.gray('Clean cancelled'));
      return;
    }

    let deleted = 0;
    for (const session of toDelete) {
      try {
        const filePath = paths.join(SESSION_DIR, `${session.id}.json`);
        await fs.unlink(filePath);
        deleted++;
      } catch (error) {
        console.error(colors.red(`Failed to delete ${session.name}:`), (error as Error).message);
      }
    }

    console.log(colors.green(`✓ Cleaned ${deleted} sessions`));
  } catch (error) {
    console.error(colors.red('Failed to clean sessions:'), (error as Error).message);
  }
}

async function loadAllSessions(): Promise<SessionData[]> {
  const sessions: SessionData[] = [];
  
  try {
    const entries = await fs.readdir(SESSION_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.json')) {
        try {
          const content = await fs.readFile(paths.join(SESSION_DIR, entry.name), 'utf8');
          const session = JSON.parse(content) as SessionData;
          
          // Convert date strings back to Date objects
          session.createdAt = new Date(session.createdAt);
          session.updatedAt = new Date(session.updatedAt);
          
          sessions.push(session);
        } catch (error) {
          console.warn(colors.yellow(`Warning: Failed to load session file ${entry.name}:`), (error as Error).message);
        }
      }
    }
  } catch (error: any) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
  
  return sessions.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}

async function loadSession(sessionId: string): Promise<SessionData | null> {
  const sessions = await loadAllSessions();
  return sessions.find(s => s.id === sessionId || s.id.startsWith(sessionId)) || null;
}

async function getCurrentSessionState(): Promise<any> {
  // Mock current session state - in production, this would connect to the orchestrator
  return {
    agents: [
      { id: 'agent-001', type: 'coordinator', status: 'active' },
      { id: 'agent-002', type: 'researcher', status: 'active' }
    ],
    tasks: [
      { id: 'task-001', type: 'research', status: 'running' },
      { id: 'task-002', type: 'analysis', status: 'pending' }
    ],
    memory: [
      { id: 'memory-001', type: 'conversation', agentId: 'agent-001' },
      { id: 'memory-002', type: 'result', agentId: 'agent-002' }
    ],
    configuration: {
      orchestrator: { maxAgents: 10 },
      memory: { backend: 'hybrid' }
    }
  };
}

async function calculateChecksum(data: any): Promise<string> {
  const content = JSON.stringify(data, null, 0);
  const hash = crypto.createHash('sha256');
  hash.update(content);
  return hash.digest('hex').substring(0, 16);
}