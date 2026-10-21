/**
 * V3 CLI Session Command
 * Session management for Claude Flow
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { confirm, input, select } from '../prompt.js';
import { callMCPTool, MCPClientError } from '../mcp-client.js';
import * as fs from 'fs';
import * as path from 'path';
import { stringify as stringifyYaml } from 'yaml';
import { gzipSync, gunzipSync } from 'node:zlib';

// Format date for display
function formatDate(dateStr: string): string {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '-';
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  // Less than 24 hours - show relative time
  if (diff < 24 * 60 * 60 * 1000) {
    const hours = Math.floor(diff / (60 * 60 * 1000));
    const minutes = Math.floor((diff % (60 * 60 * 1000)) / (60 * 1000));

    if (hours > 0) {
      return `${hours}h ${minutes}m ago`;
    }
    return `${minutes}m ago`;
  }

  // Otherwise show date
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
}

/**
 * #3575: the session MCP tools report failure as `{ error }` (or
 * `success: false`) rather than throwing, so every call site must check before
 * printing a success line or reading result fields.
 */
function toolError(result: unknown): string | null {
  if (!result || typeof result !== 'object') return 'the tool returned no result';
  const r = result as { error?: unknown; success?: unknown };
  if (typeof r.error === 'string' && r.error.length > 0) return r.error;
  if (r.success === false) return 'the operation failed';
  return null;
}

interface MemoryCaptureSummary {
  requested: boolean;
  status: 'not-requested' | 'captured' | 'no-store' | 'error';
  entries: number;
  error?: string;
}

/** #3573: say what happened to memory instead of printing an invented 0. */
function memoryCaptureLabel(capture: MemoryCaptureSummary | undefined, fallback: number | undefined): string | number {
  if (!capture) return fallback ?? 'unknown';
  if (!capture.requested) return 'not included';
  if (capture.status === 'error') return `not captured (${capture.error || 'error'})`;
  if (capture.status === 'no-store') return '0 (no memory store found)';
  return capture.entries;
}

// Format session status
function formatStatus(status: string): string {
  switch (status) {
    case 'active':
      return output.success(status);
    case 'saved':
      return output.info(status);
    case 'archived':
      return output.dim(status);
    default:
      return status;
  }
}

// List subcommand
const listCommand: Command = {
  name: 'list',
  aliases: ['ls'],
  description: 'List all sessions',
  options: [
    {
      name: 'active',
      short: 'a',
      description: 'Show only active sessions',
      type: 'boolean',
      default: false
    },
    {
      name: 'all',
      description: 'Include archived sessions',
      type: 'boolean',
      default: false
    },
    {
      name: 'limit',
      short: 'l',
      description: 'Maximum sessions to show',
      type: 'number',
      default: 20
    }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const activeOnly = ctx.flags.active as boolean;
    const includeArchived = ctx.flags.all as boolean;
    const limit = ctx.flags.limit as number;

    try {
      const result = await callMCPTool<{
        sessions: Array<{
          sessionId?: string;
          id?: string;
          name?: string;
          description?: string;
          status?: 'active' | 'saved' | 'archived';
          savedAt?: string;
          createdAt?: string;
          updatedAt?: string;
          agentCount?: number;
          taskCount?: number;
          memorySize?: number;
          stats?: { agents?: number; tasks?: number; memoryEntries?: number; totalSize?: number };
        }>;
        total: number;
      }>('session_list', {
        status: activeOnly ? 'active' : includeArchived ? 'all' : 'active,saved',
        limit
      });

      if (ctx.flags.format === 'json') {
        output.printJson(result);
        return { success: true, data: result };
      }

      output.writeln();
      output.writeln(output.bold('Sessions'));
      output.writeln();

      if (result.sessions.length === 0) {
        output.printInfo('No sessions found');
        output.printInfo('Run "claude-flow session save" to create a session');
        return { success: true, data: result };
      }

      output.printTable({
        columns: [
          { key: 'id', header: 'ID', width: 20 },
          { key: 'name', header: 'Name', width: 20 },
          { key: 'status', header: 'Status', width: 10 },
          { key: 'agents', header: 'Agents', width: 8, align: 'right' },
          { key: 'tasks', header: 'Tasks', width: 8, align: 'right' },
          { key: 'updated', header: 'Last Updated', width: 18 }
        ],
        data: result.sessions.map(s => ({
          id: s.sessionId || s.id || '-',
          name: s.name || '-',
          status: formatStatus(s.status || 'saved'),
          agents: s.agentCount ?? s.stats?.agents ?? 0,
          tasks: s.taskCount ?? s.stats?.tasks ?? 0,
          updated: formatDate(s.updatedAt || s.savedAt || s.createdAt || '')
        }))
      });

      output.writeln();
      output.printInfo(`Showing ${result.sessions.length} of ${result.total} sessions`);

      return { success: true, data: result };
    } catch (error) {
      if (error instanceof MCPClientError) {
        output.printError(`Failed to list sessions: ${error.message}`);
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  }
};

// Save subcommand
const saveCommand: Command = {
  name: 'save',
  aliases: ['create', 'checkpoint'],
  description: 'Save current session state',
  options: [
    {
      name: 'name',
      short: 'n',
      description: 'Session name',
      type: 'string'
    },
    {
      name: 'description',
      short: 'd',
      description: 'Session description',
      type: 'string'
    },
    {
      name: 'include-memory',
      description: 'Include memory state in session',
      type: 'boolean',
      default: true
    },
    {
      name: 'include-agents',
      description: 'Include agent state in session',
      type: 'boolean',
      default: true
    },
    {
      name: 'include-tasks',
      description: 'Include task state in session',
      type: 'boolean',
      default: true
    }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    let sessionName = ctx.flags.name as string;
    let description = ctx.flags.description as string;

    // Interactive mode
    if (!sessionName && ctx.interactive) {
      sessionName = await input({
        message: 'Session name:',
        default: `session-${Date.now().toString(36)}`,
        validate: (v) => v.length > 0 || 'Name is required'
      });
    }

    if (!description && ctx.interactive) {
      description = await input({
        message: 'Session description (optional):',
        default: ''
      });
    }

    const spinner = output.createSpinner({ text: 'Saving session...' });
    spinner.start();

    try {
      const result = await callMCPTool<{
        sessionId: string;
        name: string;
        description?: string;
        savedAt: string;
        includes?: {
          memory: boolean;
          agents: boolean;
          tasks: boolean;
        };
        stats?: {
          agents?: number;
          agentCount?: number;
          tasks?: number;
          taskCount?: number;
          memoryEntries?: number;
          totalSize?: number;
        };
        memoryCapture?: MemoryCaptureSummary;
      }>('session_save', {
        name: sessionName,
        description,
        includeMemory: ctx.flags['include-memory'] !== false,
        includeAgents: ctx.flags['include-agents'] !== false,
        includeTasks: ctx.flags['include-tasks'] !== false
      });

      const failure = toolError(result);
      if (failure) {
        spinner.fail('Failed to save session');
        output.printError(failure);
        return { success: false, exitCode: 1 };
      }

      spinner.succeed('Session saved');
      output.writeln();

      const stats = result.stats || {};
      output.printTable({
        columns: [
          { key: 'property', header: 'Property', width: 18 },
          { key: 'value', header: 'Value', width: 35 }
        ],
        data: [
          { property: 'Session ID', value: result.sessionId },
          { property: 'Name', value: result.name },
          { property: 'Description', value: result.description || '-' },
          { property: 'Saved At', value: new Date(result.savedAt).toLocaleString() },
          { property: 'Agents', value: stats.agentCount ?? stats.agents ?? 0 },
          { property: 'Tasks', value: stats.taskCount ?? stats.tasks ?? 0 },
          { property: 'Memory Entries', value: memoryCaptureLabel(result.memoryCapture, stats.memoryEntries) },
          { property: 'Total Size', value: formatSize(stats.totalSize ?? 0) }
        ]
      });

      if (result.memoryCapture?.status === 'error') {
        output.printWarning(`Memory was requested but could not be captured: ${result.memoryCapture.error}`);
      }

      output.writeln();
      output.printSuccess(`Session saved: ${result.sessionId}`);
      output.printInfo(`Restore with: claude-flow session restore ${result.sessionId}`);

      if (ctx.flags.format === 'json') {
        output.printJson(result);
      }

      return { success: true, data: result };
    } catch (error) {
      spinner.fail('Failed to save session');
      if (error instanceof MCPClientError) {
        output.printError(`Error: ${error.message}`);
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  }
};

// Restore subcommand
const restoreCommand: Command = {
  name: 'restore',
  aliases: ['load'],
  description: 'Restore a saved session',
  options: [
    {
      name: 'force',
      short: 'f',
      description: 'Overwrite current state without confirmation',
      type: 'boolean',
      default: false
    },
    {
      name: 'memory-only',
      description: 'Only restore memory state',
      type: 'boolean',
      default: false
    },
    {
      name: 'agents-only',
      description: 'Only restore agent state',
      type: 'boolean',
      default: false
    },
    {
      name: 'tasks-only',
      description: 'Only restore task state',
      type: 'boolean',
      default: false
    }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    let sessionId = ctx.args[0];
    const force = ctx.flags.force as boolean;

    if (!sessionId && ctx.interactive) {
      // Show list to select from
      try {
        const sessions = await callMCPTool<{
          sessions: Array<{ id: string; name?: string; status: string; updatedAt: string }>;
        }>('session_list', { status: 'saved', limit: 20 });

        if (sessions.sessions.length === 0) {
          output.printWarning('No saved sessions found');
          return { success: false, exitCode: 1 };
        }

        sessionId = await select({
          message: 'Select session to restore:',
          options: sessions.sessions.map(s => ({
            value: s.id,
            label: s.name || s.id,
            hint: formatDate(s.updatedAt)
          }))
        });
      } catch (error) {
        if (error instanceof Error && error.message === 'User cancelled') {
          output.printInfo('Operation cancelled');
          return { success: true };
        }
        throw error;
      }
    }

    if (!sessionId) {
      output.printError('Session ID is required');
      return { success: false, exitCode: 1 };
    }

    // Confirm unless forced
    if (!force && ctx.interactive) {
      const confirmed = await confirm({
        message: 'This will overwrite current state. Continue?',
        default: false
      });

      if (!confirmed) {
        output.printInfo('Operation cancelled');
        return { success: true };
      }
    }

    const spinner = output.createSpinner({ text: 'Restoring session...' });
    spinner.start();

    try {
      // Determine what to restore
      const restoreMemory = !ctx.flags['agents-only'] && !ctx.flags['tasks-only'];
      const restoreAgents = !ctx.flags['memory-only'] && !ctx.flags['tasks-only'];
      const restoreTasks = !ctx.flags['memory-only'] && !ctx.flags['agents-only'];

      const result = await callMCPTool<{
        sessionId: string;
        restoredAt: string;
        restored: boolean;
        restoredComponents: {
          memory: boolean;
          agents: boolean;
          tasks: boolean;
        };
        stats: {
          agents: number;
          tasks: number;
          memoryEntries: number;
          memoryEntriesRestored?: number;
        };
        memoryRestore?: { restored: number; failed: number; errors: string[] };
      }>('session_restore', {
        sessionId,
        restoreMemory,
        restoreAgents,
        restoreTasks
      });

      const failure = toolError(result) ?? (result.restored === false ? 'Session not found' : null);
      if (failure) {
        spinner.fail('Failed to restore session');
        output.printError(failure);
        return { success: false, exitCode: 1 };
      }

      const memoryRestore = result.memoryRestore;
      const memoryPartial = !!memoryRestore && memoryRestore.failed > 0;
      if (memoryPartial) {
        spinner.fail('Session restored with memory errors');
      } else {
        spinner.succeed('Session restored');
      }
      output.writeln();

      // #3573: distinguish "not requested" from "the session holds no memory".
      const memoryStatus = result.restoredComponents.memory
        ? (memoryPartial ? output.error('Partial') : output.success('Restored'))
        : restoreMemory ? output.dim('Not in session') : output.dim('Skipped');

      output.printTable({
        columns: [
          { key: 'component', header: 'Component', width: 20 },
          { key: 'status', header: 'Status', width: 15 },
          { key: 'count', header: 'Items', width: 10, align: 'right' }
        ],
        data: [
          {
            component: 'Memory',
            status: memoryStatus,
            count: result.restoredComponents.memory
              ? (result.stats.memoryEntriesRestored ?? result.stats.memoryEntries)
              : 0
          },
          {
            component: 'Agents',
            status: result.restoredComponents.agents ? output.success('Restored') : output.dim('Skipped'),
            count: result.restoredComponents.agents ? result.stats.agents : 0
          },
          {
            component: 'Tasks',
            status: result.restoredComponents.tasks ? output.success('Restored') : output.dim('Skipped'),
            count: result.restoredComponents.tasks ? result.stats.tasks : 0
          }
        ]
      });

      output.writeln();
      if (memoryPartial) {
        output.printWarning(
          `${memoryRestore!.failed} memory entries could not be restored` +
          (memoryRestore!.errors.length ? `: ${memoryRestore!.errors.join('; ')}` : ''),
        );
      } else {
        output.printSuccess(`Session ${sessionId} restored successfully`);
      }

      if (ctx.flags.format === 'json') {
        output.printJson(result);
      }

      return memoryPartial
        ? { success: false, exitCode: 1, data: result }
        : { success: true, data: result };
    } catch (error) {
      spinner.fail('Failed to restore session');
      if (error instanceof MCPClientError) {
        output.printError(`Error: ${error.message}`);
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  }
};

// Delete subcommand
const deleteCommand: Command = {
  name: 'delete',
  aliases: ['rm', 'remove'],
  description: 'Delete a saved session',
  options: [
    {
      name: 'force',
      short: 'f',
      description: 'Delete without confirmation',
      type: 'boolean',
      default: false
    }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const sessionId = ctx.args[0];
    const force = ctx.flags.force as boolean;

    if (!sessionId) {
      output.printError('Session ID is required');
      return { success: false, exitCode: 1 };
    }

    if (!force && ctx.interactive) {
      const confirmed = await confirm({
        message: `Delete session ${sessionId}? This cannot be undone.`,
        default: false
      });

      if (!confirmed) {
        output.printInfo('Operation cancelled');
        return { success: true };
      }
    }

    try {
      const result = await callMCPTool<{
        sessionId: string;
        deleted: boolean;
        deletedAt: string;
      }>('session_delete', { sessionId });

      const failure = toolError(result) ?? (result.deleted === false ? 'Session not found' : null);
      if (failure) {
        output.printError(`Failed to delete session: ${failure}`);
        return { success: false, exitCode: 1 };
      }

      output.writeln();
      output.printSuccess(`Session ${sessionId} deleted`);

      if (ctx.flags.format === 'json') {
        output.printJson(result);
      }

      return { success: true, data: result };
    } catch (error) {
      if (error instanceof MCPClientError) {
        output.printError(`Failed to delete session: ${error.message}`);
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  }
};

// Export subcommand
const exportCommand: Command = {
  name: 'export',
  description: 'Export a saved session to a file. Usage: session export <session-id> [-o file] (or --latest)',
  options: [
    {
      name: 'output',
      short: 'o',
      description: 'Output file path',
      type: 'string'
    },
    {
      name: 'latest',
      description: 'Export the most recently saved session when no session id is given',
      type: 'boolean',
      default: false
    },
    {
      name: 'format',
      short: 'f',
      description: 'Export format (json, yaml)',
      type: 'string',
      choices: ['json', 'yaml'],
      default: 'json'
    },
    {
      name: 'include-memory',
      description: 'Include memory data',
      type: 'boolean',
      default: true
    },
    {
      name: 'compress',
      description: 'Compress output',
      type: 'boolean',
      default: false
    }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    let sessionId = ctx.args[0];
    let outputPath = ctx.flags.output as string;
    const exportFormat = ctx.flags.format as string;
    const compress = ctx.flags.compress as boolean;

    // #3575: like `session delete`, refuse to guess which session to act on.
    // Exporting the most recent one is available, but only when asked for.
    if (!sessionId) {
      if (!ctx.flags.latest) {
        output.printError('Session ID is required. Pass a session id, or --latest to export the most recently saved session.');
        return { success: false, exitCode: 1 };
      }
      try {
        const current = await callMCPTool<{ sessionId: string; error?: string }>('session_current', {});
        if (toolError(current) || !current.sessionId) {
          output.printError('No saved sessions to export.');
          return { success: false, exitCode: 1 };
        }
        sessionId = current.sessionId;
      } catch {
        output.printError('No saved sessions to export.');
        return { success: false, exitCode: 1 };
      }
    }

    // Generate output path if not provided
    if (!outputPath) {
      const ext = compress ? '.gz' : '';
      outputPath = `session-${sessionId}.${exportFormat}${ext}`;
    }

    const spinner = output.createSpinner({ text: 'Exporting session...' });
    spinner.start();

    try {
      const result = await callMCPTool<{
        sessionId: string;
        data: unknown;
        stats?: {
          agents?: number;
          agentCount?: number;
          tasks?: number;
          taskCount?: number;
          memoryEntries?: number;
        };
      }>('session_export', {
        sessionId,
        includeMemory: ctx.flags['include-memory'] !== false
      });

      const failure = toolError(result);
      if (failure || result.data === undefined) {
        spinner.fail('Failed to export session');
        output.printError(failure || 'The export returned no session data');
        return { success: false, exitCode: 1 };
      }

      // Format output
      let content: string;
      if (exportFormat === 'yaml') {
        content = stringifyYaml(result.data);
      } else {
        content = JSON.stringify(result.data, null, 2);
      }

      // Write to file
      const absolutePath = path.isAbsolute(outputPath)
        ? outputPath
        : path.join(ctx.cwd, outputPath);

      const bytes = compress ? gzipSync(content) : Buffer.from(content, 'utf-8');
      fs.writeFileSync(absolutePath, bytes);

      spinner.succeed('Session exported');
      output.writeln();

      // session_export returns the whole record under `data`; its stats live there.
      const exportStats = result.stats || (result.data as { stats?: typeof result.stats })?.stats || {};
      output.printTable({
        columns: [
          { key: 'property', header: 'Property', width: 18 },
          { key: 'value', header: 'Value', width: 40 }
        ],
        data: [
          { property: 'Session ID', value: sessionId },
          { property: 'Output File', value: absolutePath },
          { property: 'Format', value: exportFormat.toUpperCase() },
          { property: 'Agents', value: exportStats.agentCount ?? exportStats.agents ?? 0 },
          { property: 'Tasks', value: exportStats.taskCount ?? exportStats.tasks ?? 0 },
          { property: 'Memory Entries', value: exportStats.memoryEntries ?? 0 },
          { property: 'File Size', value: formatSize(bytes.length) }
        ]
      });

      output.writeln();
      output.printSuccess(`Session exported to ${outputPath}`);

      return {
        success: true,
        data: { sessionId, outputPath, format: exportFormat, size: bytes.length }
      };
    } catch (error) {
      spinner.fail('Failed to export session');
      if (error instanceof MCPClientError) {
        output.printError(`Error: ${error.message}`);
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  }
};

// Import subcommand
const importCommand: Command = {
  name: 'import',
  description: 'Import a session from a file written by session export. Usage: session import <file> [--name n] [--activate]',
  options: [
    {
      name: 'name',
      short: 'n',
      description: 'Session name for imported session',
      type: 'string'
    },
    {
      name: 'activate',
      description: 'Activate session after import',
      type: 'boolean',
      default: false
    }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const filePath = ctx.args[0];
    const sessionName = ctx.flags.name as string;
    const activate = ctx.flags.activate as boolean;

    if (!filePath) {
      output.printError('File path is required');
      return { success: false, exitCode: 1 };
    }

    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.join(ctx.cwd, filePath);

    if (!fs.existsSync(absolutePath)) {
      output.printError(`File not found: ${absolutePath}`);
      return { success: false, exitCode: 1 };
    }

    const spinner = output.createSpinner({ text: 'Importing session...' });
    spinner.start();

    try {
      // The YAML written by `session export --format yaml` is display-only;
      // there is no YAML parser here, so say so instead of failing obscurely.
      if (/\.ya?ml(?:\.gz)?$/i.test(absolutePath)) {
        try {
          const bytes = fs.readFileSync(absolutePath);
          const content = bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes;
          JSON.parse(content.toString('utf-8'));
        } catch {
          spinner.fail('Failed to import session');
          output.printError('YAML session import is not supported. Export with --format json and import that file.');
          return { success: false, exitCode: 1 };
        }
      }

      // #3575: session_import reads the file itself from `inputPath`. Passing a
      // parsed `data` object used to hit its required-argument check, and the
      // CLI then printed "Session imported" before crashing on the error result.
      const result = await callMCPTool<{
        sessionId: string;
        name: string;
        importedAt: string;
        stats: {
          agentsImported: number;
          tasksImported: number;
          memoryEntriesImported: number;
        };
        activated: boolean;
        error?: string;
      }>('session_import', {
        inputPath: absolutePath,
        name: sessionName,
        activate
      });

      const failure = toolError(result);
      if (failure) {
        spinner.fail('Failed to import session');
        output.printError(failure);
        return { success: false, exitCode: 1 };
      }

      spinner.succeed('Session imported');
      output.writeln();

      output.printTable({
        columns: [
          { key: 'property', header: 'Property', width: 20 },
          { key: 'value', header: 'Value', width: 35 }
        ],
        data: [
          { property: 'Session ID', value: result.sessionId },
          { property: 'Name', value: result.name },
          { property: 'Source File', value: path.basename(absolutePath) },
          { property: 'Agents Imported', value: result.stats.agentsImported },
          { property: 'Tasks Imported', value: result.stats.tasksImported },
          { property: 'Memory Entries', value: result.stats.memoryEntriesImported },
          { property: 'Activated', value: result.activated ? 'Yes' : 'No' }
        ]
      });

      output.writeln();
      output.printSuccess(`Session imported: ${result.sessionId}`);

      if (!result.activated) {
        output.printInfo(`Restore with: claude-flow session restore ${result.sessionId}`);
      }

      if (ctx.flags.format === 'json') {
        output.printJson(result);
      }

      return { success: true, data: result };
    } catch (error) {
      spinner.fail('Failed to import session');
      if (error instanceof MCPClientError) {
        output.printError(`Error: ${error.message}`);
      } else if (error instanceof SyntaxError) {
        output.printError('Invalid file format. Expected JSON or YAML.');
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  }
};

// Current subcommand
const currentCommand: Command = {
  name: 'current',
  description: 'Show current active session',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    try {
      const result = await callMCPTool<{
        sessionId: string;
        name?: string;
        status: string;
        startedAt: string;
        stats?: {
          agents?: number;
          agentCount?: number;
          tasks?: number;
          taskCount?: number;
          memoryEntries?: number;
          duration?: number;
        };
      }>('session_current', { includeStats: true });

      if (toolError(result)) {
        output.printWarning('No active session');
        output.printInfo('Save one with "claude-flow session save"');
        return { success: true, data: { active: false } };
      }

      if (ctx.flags.format === 'json') {
        output.printJson(result);
        return { success: true, data: result };
      }

      output.writeln();
      output.writeln(output.bold('Current Session'));
      output.writeln();

      const curStats = result.stats || {};
      output.printTable({
        columns: [
          { key: 'property', header: 'Property', width: 18 },
          { key: 'value', header: 'Value', width: 35 }
        ],
        data: [
          { property: 'Session ID', value: result.sessionId },
          { property: 'Name', value: result.name || '-' },
          { property: 'Status', value: formatStatus(result.status) },
          { property: 'Started', value: new Date(result.startedAt).toLocaleString() },
          { property: 'Duration', value: formatDuration(curStats.duration ?? 0) },
          { property: 'Agents', value: curStats.agentCount ?? curStats.agents ?? 0 },
          { property: 'Tasks', value: curStats.taskCount ?? curStats.tasks ?? 0 },
          { property: 'Memory Entries', value: curStats.memoryEntries ?? 0 }
        ]
      });

      return { success: true, data: result };
    } catch (error) {
      if (error instanceof MCPClientError) {
        output.printWarning('No active session');
        output.printInfo('Start a session with "claude-flow start"');
        return { success: true, data: { active: false } };
      }
      output.printError(`Unexpected error: ${String(error)}`);
      return { success: false, exitCode: 1 };
    }
  }
};

// Helper functions
function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

// Main session command
export const sessionCommand: Command = {
  name: 'session',
  description: 'Session management commands',
  subcommands: [
    listCommand,
    saveCommand,
    restoreCommand,
    deleteCommand,
    exportCommand,
    importCommand,
    currentCommand
  ],
  options: [],
  examples: [
    { command: 'claude-flow session list', description: 'List all sessions' },
    { command: 'claude-flow session save -n "checkpoint-1"', description: 'Save current session' },
    { command: 'claude-flow session restore session-123', description: 'Restore a session' },
    { command: 'claude-flow session delete session-123', description: 'Delete a session' },
    { command: 'claude-flow session export session-123 -o backup.json', description: 'Export a session to file' },
    { command: 'claude-flow session export --latest -o backup.json', description: 'Export the most recently saved session' },
    { command: 'claude-flow session import backup.json', description: 'Import session from file' },
    { command: 'claude-flow session current', description: 'Show current session' }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    // Show help if no subcommand
    output.writeln();
    output.writeln(output.bold('Session Management Commands'));
    output.writeln();
    output.writeln('Usage: claude-flow session <subcommand> [options]');
    output.writeln();
    output.writeln('Subcommands:');
    output.printList([
      `${output.highlight('list')}    - List all sessions`,
      `${output.highlight('save')}    - Save current session state`,
      `${output.highlight('restore')} - Restore a saved session`,
      `${output.highlight('delete')}  - Delete a saved session`,
      `${output.highlight('export')}  - Export session to file`,
      `${output.highlight('import')}  - Import session from file`,
      `${output.highlight('current')} - Show current active session`
    ]);
    output.writeln();
    output.writeln('Run "claude-flow session <subcommand> --help" for subcommand help');

    return { success: true };
  }
};

export default sessionCommand;
