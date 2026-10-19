/**
 * V3 CLI Workflow Command
 * Workflow execution, validation, and template management
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { select, confirm, input } from '../prompt.js';
import { callMCPTool, MCPClientError } from '../mcp-client.js';

// Workflow templates
const WORKFLOW_TEMPLATES = [
  { value: 'development', label: 'Development', hint: 'Standard development workflow' },
  { value: 'research', label: 'Research', hint: 'Research and analysis workflow' },
  { value: 'testing', label: 'Testing', hint: 'Comprehensive testing workflow' },
  { value: 'security-audit', label: 'Security Audit', hint: 'Security review workflow' },
  { value: 'code-review', label: 'Code Review', hint: 'Multi-agent code review' },
  { value: 'refactoring', label: 'Refactoring', hint: 'Code refactoring workflow' },
  { value: 'sparc', label: 'SPARC', hint: 'SPARC methodology workflow' },
  { value: 'custom', label: 'Custom', hint: 'Define custom workflow' }
];

// Run subcommand
const runCommand: Command = {
  name: 'run',
  description: 'Execute a workflow',
  options: [
    {
      name: 'template',
      short: 't',
      description: 'Workflow template',
      type: 'string',
      choices: WORKFLOW_TEMPLATES.map(t => t.value)
    },
    {
      name: 'file',
      short: 'f',
      description: 'Workflow definition file (YAML/JSON)',
      type: 'string'
    },
    {
      name: 'task',
      description: 'Task description',
      type: 'string'
    },
    {
      name: 'parallel',
      short: 'p',
      description: 'Enable parallel execution',
      type: 'boolean',
      default: true
    },
    {
      name: 'max-agents',
      short: 'm',
      description: 'Maximum agents to spawn',
      type: 'number',
      default: 5
    },
    {
      name: 'timeout',
      description: 'Workflow timeout in minutes',
      type: 'number',
      default: 30
    },
    {
      name: 'dry-run',
      short: 'd',
      description: 'Validate without executing',
      type: 'boolean',
      default: false
    }
  ],
  examples: [
    { command: 'claude-flow workflow run -t development --task "Build auth system"', description: 'Run development workflow' },
    { command: 'claude-flow workflow run -f ./workflow.yaml', description: 'Run from file' },
    { command: 'claude-flow workflow run -t sparc --dry-run', description: 'Validate SPARC workflow' }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    let template = ctx.flags.template as string;
    const file = ctx.flags.file as string;
    const task = ctx.flags.task as string || ctx.args[0];
    const parallel = ctx.flags.parallel as boolean;
    const maxAgents = ctx.flags.maxAgents as number;
    const timeout = ctx.flags.timeout as number;
    const dryRun = ctx.flags.dryRun as boolean;

    if (!template && !file && ctx.interactive) {
      template = await select({
        message: 'Select workflow template:',
        options: WORKFLOW_TEMPLATES
      });
    }

    if (!template && !file) {
      output.printError('Workflow template or file is required. Use --template or --file');
      return { success: false, exitCode: 1 };
    }

    output.writeln();
    if (dryRun) {
      output.writeln(output.warning('DRY RUN MODE - No changes will be made'));
    }
    output.writeln(output.bold(`Workflow: ${template || file}`));
    output.writeln();

    const spinner = output.createSpinner({ text: 'Initializing workflow...', spinner: 'dots' });

    try {
      spinner.start();

      // Call MCP tool to run workflow
      const result = await callMCPTool<{
        workflowId: string;
        template: string;
        status: 'running' | 'completed' | 'failed' | 'validated';
        stages: Array<{
          name: string;
          status: string;
          agents: string[];
          duration?: number;
        }>;
        metrics: {
          totalStages: number;
          completedStages: number;
          agentsSpawned: number;
          estimatedDuration: string;
        };
      }>('workflow_run', {
        template: template || undefined,
        file: file || undefined,
        task,
        options: {
          parallel,
          maxAgents,
          timeout,
          dryRun,
        },
      });

      const runError = toolError(result);
      if (runError || !result.metrics) {
        spinner.fail('Workflow failed');
        output.printError(`Workflow error: ${runError ?? 'workflow_run returned no workflow summary'}`);
        return { success: false, exitCode: 1 };
      }

      if (dryRun) {
        spinner.succeed('Workflow validated successfully');
      } else {
        spinner.succeed('Workflow started');
      }

      if (ctx.flags.format === 'json') {
        output.printJson(result);
        return { success: true, data: result };
      }

      output.writeln();
      output.printBox(
        [
          `ID: ${result.workflowId}`,
          `Template: ${result.template}`,
          `Status: ${result.status}`,
          `Stages: ${result.metrics.totalStages}`,
          `Agents: ${result.metrics.agentsSpawned}`,
          `Est. Duration: ${result.metrics.estimatedDuration}`
        ].join('\n'),
        'Workflow Details'
      );

      output.writeln();
      output.writeln(output.bold('Stages'));
      output.printTable({
        columns: [
          { key: 'name', header: 'Stage', width: 20 },
          { key: 'status', header: 'Status', width: 12, format: formatStageStatus },
          { key: 'agents', header: 'Agents', width: 30, format: (v) => Array.isArray(v) ? v.join(', ') : String(v) },
          { key: 'duration', header: 'Duration', width: 10, align: 'right', format: (v) => v ? `${v}ms` : '-' }
        ],
        data: result.stages
      });

      if (!dryRun) {
        output.writeln();
        output.printInfo(`Track progress: claude-flow workflow status ${result.workflowId}`);
      }

      return { success: true, data: result };
    } catch (error) {
      spinner.fail('Workflow failed');
      if (error instanceof MCPClientError) {
        output.printError(`Workflow error: ${error.message}`);
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  }
};

// Validate subcommand
const validateCommand: Command = {
  name: 'validate',
  description: 'Validate a workflow definition',
  options: [
    {
      name: 'file',
      short: 'f',
      description: 'Workflow definition file',
      type: 'string',
      required: true
    },
    {
      name: 'strict',
      short: 's',
      description: 'Strict validation mode',
      type: 'boolean',
      default: false
    }
  ],
  examples: [
    { command: 'claude-flow workflow validate -f ./workflow.yaml', description: 'Validate workflow file' },
    { command: 'claude-flow workflow validate -f ./workflow.json --strict', description: 'Strict validation' }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const file = ctx.flags.file as string || ctx.args[0];
    const strict = ctx.flags.strict as boolean;

    if (!file) {
      output.printError('Workflow file is required. Use --file or -f');
      return { success: false, exitCode: 1 };
    }

    output.printInfo(`Validating: ${file}`);

    try {
      const result = await callMCPTool<{
        valid: boolean;
        file: string;
        errors: Array<{ line: number; message: string; severity: string }>;
        warnings: Array<{ line: number; message: string }>;
        stats: {
          stages: number;
          agents: number;
          estimatedDuration: string;
        };
      }>('workflow_validate', {
        file,
        strict,
      });

      if (ctx.flags.format === 'json') {
        output.printJson(result);
        return { success: result.valid, data: result };
      }

      output.writeln();

      if (result.valid) {
        output.printSuccess('Workflow is valid');
      } else {
        output.printError('Workflow validation failed');
      }

      if (result.errors.length > 0) {
        output.writeln();
        output.writeln(output.bold(output.error('Errors')));
        output.printTable({
          columns: [
            { key: 'line', header: 'Line', width: 8, align: 'right' },
            { key: 'severity', header: 'Severity', width: 10 },
            { key: 'message', header: 'Message', width: 50 }
          ],
          data: result.errors
        });
      }

      if (result.warnings.length > 0) {
        output.writeln();
        output.writeln(output.bold(output.warning('Warnings')));
        result.warnings.forEach(w => {
          output.writeln(output.warning(`  Line ${w.line}: ${w.message}`));
        });
      }

      if (result.valid) {
        output.writeln();
        output.writeln(output.bold('Workflow Stats'));
        output.printList([
          `Stages: ${result.stats.stages}`,
          `Agents Required: ${result.stats.agents}`,
          `Est. Duration: ${result.stats.estimatedDuration}`
        ]);
      }

      return { success: result.valid, data: result };
    } catch (error) {
      if (error instanceof MCPClientError) {
        output.printError(`Validation error: ${error.message}`);
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  }
};

// List subcommand
const listCommand: Command = {
  name: 'list',
  aliases: ['ls'],
  description: 'List workflows',
  options: [
    {
      name: 'status',
      short: 's',
      description: 'Filter by status',
      type: 'string',
      choices: ['running', 'completed', 'failed', 'all']
    },
    {
      name: 'limit',
      short: 'l',
      description: 'Maximum results',
      type: 'number',
      default: 10
    }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const status = ctx.flags.status as string;
    const limit = ctx.flags.limit as number;

    try {
      const result = await callMCPTool<{
        workflows: Array<{
          workflowId: string;
          name: string;
          status: string;
          stepCount: number;
          createdAt: string;
          completedAt?: string;
        }>;
        total: number;
        error?: string;
      }>('workflow_list', {
        status: status || 'all',
        limit,
      });

      const listError = toolError(result);
      if (listError || !Array.isArray(result.workflows)) {
        output.printError(`Failed to list workflows: ${listError ?? 'workflow_list returned no workflows'}`);
        return { success: false, exitCode: 1 };
      }

      if (ctx.flags.format === 'json') {
        output.printJson(result);
        return { success: true, data: result };
      }

      output.writeln();
      output.writeln(output.bold('Workflows'));
      output.writeln();

      if (result.workflows.length === 0) {
        output.printInfo('No workflows found');
        return { success: true, data: result };
      }

      output.printTable({
        columns: [
          { key: 'id', header: 'ID', width: 30 },
          { key: 'name', header: 'Name', width: 24 },
          { key: 'status', header: 'Status', width: 12, format: formatStageStatus },
          { key: 'steps', header: 'Steps', width: 6, align: 'right' },
          { key: 'createdAt', header: 'Created', width: 20, format: (v) => new Date(String(v)).toLocaleString() }
        ],
        data: result.workflows.map(w => ({
          id: w.workflowId,
          name: w.name,
          status: w.status,
          steps: w.stepCount,
          createdAt: w.createdAt,
        }))
      });

      output.writeln();
      output.printInfo(`Total: ${result.total} workflows`);

      return { success: true, data: result };
    } catch (error) {
      if (error instanceof MCPClientError) {
        output.printError(`Failed to list workflows: ${error.message}`);
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  }
};

// Status subcommand
const statusCommand: Command = {
  name: 'status',
  description: 'Show workflow status',
  options: [
    {
      name: 'watch',
      short: 'w',
      description: 'Watch for changes',
      type: 'boolean',
      default: false
    }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const workflowId = ctx.args[0];

    if (!workflowId) {
      output.printError('Workflow ID is required');
      return { success: false, exitCode: 1 };
    }

    try {
      const result = await callMCPTool<{
        workflowId: string;
        name: string;
        status: string;
        progress: number;
        currentStep: number;
        totalSteps: number;
        completedSteps: number;
        startedAt?: string;
        completedAt?: string;
        steps?: Array<{ stepId: string; name: string; type: string; status: string }>;
        error?: string;
      }>('workflow_status', {
        workflowId,
        verbose: true,
      });

      const statusError = toolError(result);
      if (statusError) {
        output.printError(`Failed to get status: ${statusError}`);
        return { success: false, exitCode: 1 };
      }

      if (ctx.flags.format === 'json') {
        output.printJson(result);
        return { success: true, data: result };
      }

      const started = result.startedAt ? Date.parse(result.startedAt) : NaN;
      const ended = result.completedAt ? Date.parse(result.completedAt) : Date.now();

      output.writeln();
      output.printBox(
        [
          `ID: ${result.workflowId}`,
          `Name: ${result.name}`,
          `Status: ${formatStageStatus(result.status)}`,
          `Progress: ${Math.round(result.progress)}% (${result.completedSteps}/${result.totalSteps} steps)`,
          ...(Number.isNaN(started) ? [] : [`Duration: ${((ended - started) / 1000).toFixed(1)}s`]),
          ...(result.error ? [`Error: ${result.error}`] : []),
        ].join('\n'),
        'Workflow Status'
      );

      output.writeln();
      output.writeln(output.bold('Step Progress'));
      output.printTable({
        columns: [
          { key: 'name', header: 'Step', width: 24 },
          { key: 'type', header: 'Type', width: 10 },
          { key: 'status', header: 'Status', width: 12, format: formatStageStatus },
        ],
        data: result.steps ?? []
      });

      return { success: true, data: result };
    } catch (error) {
      if (error instanceof MCPClientError) {
        output.printError(`Failed to get status: ${error.message}`);
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  }
};

// Stop subcommand
const stopCommand: Command = {
  name: 'stop',
  description: 'Stop a running workflow',
  options: [
    {
      name: 'force',
      short: 'f',
      description: 'Force stop without graceful shutdown',
      type: 'boolean',
      default: false
    }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const workflowId = ctx.args[0];
    const force = ctx.flags.force as boolean;

    if (!workflowId) {
      output.printError('Workflow ID is required');
      return { success: false, exitCode: 1 };
    }

    if (!force && ctx.interactive) {
      const confirmed = await confirm({
        message: `Stop workflow ${workflowId}?`,
        default: false
      });

      if (!confirmed) {
        output.printInfo('Operation cancelled');
        return { success: true };
      }
    }

    try {
      const result = await callMCPTool<{
        workflowId: string;
        stopped: boolean;
        stoppedAt: string;
        error?: string;
      }>('workflow_stop', {
        workflowId,
        graceful: !force,
      });

      const stopError = toolError(result);
      if (stopError || result.stopped !== true) {
        output.printError(`Failed to stop workflow: ${stopError ?? 'the workflow was not stopped'}`);
        return { success: false, exitCode: 1 };
      }

      output.printSuccess(`Workflow ${workflowId} stopped`);

      return { success: true, data: result };
    } catch (error) {
      if (error instanceof MCPClientError) {
        output.printError(`Failed to stop workflow: ${error.message}`);
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  }
};

// Template subcommand
const templateCommand: Command = {
  name: 'template',
  description: 'Manage workflow templates',
  subcommands: [
    {
      name: 'list',
      description: 'List available templates',
      action: async (ctx: CommandContext): Promise<CommandResult> => {
        if (ctx.flags.format === 'json') {
          output.printJson(WORKFLOW_TEMPLATES);
          return { success: true, data: WORKFLOW_TEMPLATES };
        }

        output.writeln();
        output.writeln(output.bold('Available Workflow Templates'));
        output.writeln();

        output.printTable({
          columns: [
            { key: 'value', header: 'Template', width: 20 },
            { key: 'label', header: 'Name', width: 20 },
            { key: 'hint', header: 'Description', width: 35 }
          ],
          data: WORKFLOW_TEMPLATES
        });

        return { success: true, data: WORKFLOW_TEMPLATES };
      }
    },
    {
      name: 'show',
      description: 'Show template details',
      action: async (ctx: CommandContext): Promise<CommandResult> => {
        const templateName = ctx.args[0];

        if (!templateName) {
          output.printError('Template name is required');
          return { success: false, exitCode: 1 };
        }

        const template = WORKFLOW_TEMPLATES.find(t => t.value === templateName);
        if (!template) {
          output.printError(`Template "${templateName}" not found`);
          return { success: false, exitCode: 1 };
        }

        // Show template details
        const details = {
          name: template.value,
          description: template.hint,
          stages: getTemplateStages(template.value),
          agents: getTemplateAgents(template.value),
          estimatedDuration: getTemplateDuration(template.value)
        };

        if (ctx.flags.format === 'json') {
          output.printJson(details);
          return { success: true, data: details };
        }

        output.writeln();
        output.printBox(
          [
            `Name: ${details.name}`,
            `Description: ${details.description}`,
            `Stages: ${details.stages.length}`,
            `Agents: ${details.agents.join(', ')}`,
            `Est. Duration: ${details.estimatedDuration}`
          ].join('\n'),
          'Template Details'
        );

        output.writeln();
        output.writeln(output.bold('Stages'));
        output.printList(details.stages.map((s, i) => `${i + 1}. ${s}`));

        return { success: true, data: details };
      }
    },
    {
      name: 'create',
      description: 'Create a new template from workflow',
      options: [
        { name: 'name', short: 'n', description: 'Template name', type: 'string', required: true },
        { name: 'workflow', short: 'w', description: 'Workflow ID to save as template', type: 'string' },
        { name: 'file', short: 'f', description: 'Workflow file to save as template', type: 'string' }
      ],
      action: async (ctx: CommandContext): Promise<CommandResult> => {
        const name = ctx.flags.name as string;

        if (!name) {
          output.printError('Template name is required');
          return { success: false, exitCode: 1 };
        }

        output.printSuccess(`Template "${name}" created`);
        output.writeln(output.dim('  Use with: claude-flow workflow run -t ' + name));

        return { success: true, data: { name, created: true } };
      }
    }
  ],
  action: async (): Promise<CommandResult> => {
    output.writeln();
    output.writeln(output.bold('Template Management'));
    output.writeln();
    output.writeln('Usage: claude-flow workflow template <subcommand>');
    output.writeln();
    output.writeln('Subcommands:');
    output.printList([
      `${output.highlight('list')}   - List available templates`,
      `${output.highlight('show')}   - Show template details`,
      `${output.highlight('create')} - Create new template`
    ]);

    return { success: true };
  }
};

// Main workflow command
export const workflowCommand: Command = {
  name: 'workflow',
  description: 'Workflow execution and management',
  subcommands: [runCommand, validateCommand, listCommand, statusCommand, stopCommand, templateCommand],
  options: [],
  examples: [
    { command: 'claude-flow workflow run -t development --task "Build feature"', description: 'Run workflow' },
    { command: 'claude-flow workflow validate -f ./workflow.yaml', description: 'Validate workflow' },
    { command: 'claude-flow workflow list', description: 'List workflows' }
  ],
  action: async (): Promise<CommandResult> => {
    output.writeln();
    output.writeln(output.bold('Workflow Commands'));
    output.writeln();
    output.writeln('Usage: claude-flow workflow <subcommand> [options]');
    output.writeln();
    output.writeln('Subcommands:');
    output.printList([
      `${output.highlight('run')}       - Execute a workflow`,
      `${output.highlight('validate')}  - Validate workflow definition`,
      `${output.highlight('list')}      - List workflows`,
      `${output.highlight('status')}    - Show workflow status`,
      `${output.highlight('stop')}      - Stop running workflow`,
      `${output.highlight('template')}  - Manage templates`
    ]);
    output.writeln();
    output.writeln('Run "claude-flow workflow <subcommand> --help" for more info');

    return { success: true };
  }
};

// Helper functions
/**
 * The workflow MCP tools report failure as `{ error }` (or `{ success: false, error }`)
 * instead of throwing, so a command that reads the result without checking it prints
 * a false success or crashes on a field the error result does not have.
 */
function toolError(result: unknown): string | undefined {
  const r = result as { error?: unknown } | undefined | null;
  if (!r) return 'the workflow tool returned no result';
  return typeof r.error === 'string' && r.error.length > 0 ? r.error : undefined;
}

function formatStageStatus(status: unknown): string {
  const statusStr = String(status);
  switch (statusStr) {
    case 'completed':
    case 'success':
      return output.success(statusStr);
    case 'running':
    case 'in_progress':
      return output.highlight(statusStr);
    case 'pending':
    case 'waiting':
      return output.dim(statusStr);
    case 'failed':
    case 'error':
      return output.error(statusStr);
    case 'validated':
      return output.success(statusStr);
    default:
      return statusStr;
  }
}

function getTemplateStages(template: string): string[] {
  const stages: Record<string, string[]> = {
    development: ['Planning', 'Implementation', 'Testing', 'Review', 'Integration'],
    research: ['Discovery', 'Analysis', 'Synthesis', 'Documentation'],
    testing: ['Unit Tests', 'Integration Tests', 'E2E Tests', 'Performance Tests'],
    'security-audit': ['Threat Model', 'Static Analysis', 'Dynamic Analysis', 'Report'],
    'code-review': ['Initial Review', 'Security Check', 'Quality Analysis', 'Feedback'],
    refactoring: ['Analysis', 'Planning', 'Refactor', 'Validation'],
    sparc: ['Specification', 'Pseudocode', 'Architecture', 'Refinement', 'Completion']
  };
  return stages[template] || ['Initialize', 'Execute', 'Complete'];
}

function getTemplateAgents(template: string): string[] {
  const agents: Record<string, string[]> = {
    development: ['coder', 'tester', 'reviewer'],
    research: ['researcher', 'analyst'],
    testing: ['tester', 'coder'],
    'security-audit': ['security-architect', 'security-auditor'],
    'code-review': ['reviewer', 'security-auditor', 'analyst'],
    refactoring: ['architect', 'coder', 'reviewer'],
    sparc: ['architect', 'coder', 'tester', 'reviewer']
  };
  return agents[template] || ['coder'];
}

function getTemplateDuration(template: string): string {
  const durations: Record<string, string> = {
    development: '15-30 min',
    research: '10-20 min',
    testing: '5-15 min',
    'security-audit': '20-40 min',
    'code-review': '10-25 min',
    refactoring: '15-35 min',
    sparc: '25-45 min'
  };
  return durations[template] || '10-20 min';
}

export default workflowCommand;
