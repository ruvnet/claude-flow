/**
 * V3 CLI Claims Command
 * Claims-based authorization, permissions, and access control
 *
 * Created with ❤️ by ruv.io
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { homedir } from 'node:os';
import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';

interface ClaimsConfig {
  roles?: Record<string, string[]>;
  users?: Record<string, { role?: string; claims?: string[] }>;
  defaultClaims?: string[];
}

const CLAIMS_CONFIG_PATHS = [
  '.claude-flow/claims.json',
  'claude-flow.claims.json',
];

function getClaimsConfigPaths(): string[] {
  return [
    resolve(CLAIMS_CONFIG_PATHS[0]),
    resolve(CLAIMS_CONFIG_PATHS[1]),
    // os.homedir(), not $HOME: HOME is normally unset on Windows, and the old
    // `process.env.HOME || '~'` fallback resolved to a literal <cwd>/~ folder.
    join(homedir(), '.config', 'claude-flow', 'claims.json'),
  ];
}

function loadClaimsConfig(): { config: ClaimsConfig; path: string } {
  const configPaths = getClaimsConfigPaths();

  for (const configPath of configPaths) {
    if (existsSync(configPath)) {
      const content = readFileSync(configPath, 'utf-8');
      return { config: JSON.parse(content) as ClaimsConfig, path: configPath };
    }
  }

  // Return default config with the first path as the default write location
  const defaultConfig: ClaimsConfig = {
    roles: {
      admin: ['*'],
      developer: ['swarm:*', 'agent:*', 'memory:*', 'task:*', 'session:*'],
      operator: ['swarm:status', 'agent:list', 'memory:read', 'task:list'],
      viewer: ['*:list', '*:status', '*:read'],
    },
    defaultClaims: ['swarm:create', 'swarm:status', 'agent:spawn', 'agent:list', 'memory:read', 'memory:write', 'task:create'],
  };
  return { config: defaultConfig, path: configPaths[0] };
}

function saveClaimsConfig(config: ClaimsConfig, configPath: string): void {
  const dir = dirname(configPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const tmpPath = configPath + '.tmp';
  writeFileSync(tmpPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  renameSync(tmpPath, configPath);
}

// List subcommand
const listCommand: Command = {
  name: 'list',
  description: 'List claims and permissions',
  options: [
    { name: 'user', short: 'u', type: 'string', description: 'Filter by user ID' },
    { name: 'role', short: 'r', type: 'string', description: 'Filter by role' },
    { name: 'resource', type: 'string', description: 'Filter by resource' },
  ],
  examples: [
    { command: 'claude-flow claims list', description: 'List all claims' },
    { command: 'claude-flow claims list -u user123', description: 'List user claims' },
  ],
  action: async (_ctx: CommandContext): Promise<CommandResult> => {
    try {
      const { config, path: configPath } = loadClaimsConfig();

      output.writeln();
      output.writeln(output.bold('Claims Configuration'));
      output.writeln(output.dim('─'.repeat(50)));

      // Roles table
      const roles = config.roles || {};
      const roleEntries = Object.entries(roles);
      if (roleEntries.length > 0) {
        output.writeln();
        output.writeln(output.bold('Roles'));
        output.printTable({
          columns: [
            { key: 'role', header: 'Role' },
            { key: 'count', header: 'Claims' },
            { key: 'preview', header: 'Preview', width: 50 },
          ],
          data: roleEntries.map(([name, claims]) => ({
            role: name,
            count: claims.length,
            preview: claims.slice(0, 4).join(', ') + (claims.length > 4 ? ', ...' : ''),
          })),
          border: true,
          header: true,
        });
      }

      // Users table
      const users = config.users || {};
      const userEntries = Object.entries(users);
      if (userEntries.length > 0) {
        output.writeln();
        output.writeln(output.bold('Users'));
        output.printTable({
          columns: [
            { key: 'user', header: 'User' },
            { key: 'role', header: 'Role' },
            { key: 'extraClaims', header: 'Extra Claims' },
          ],
          data: userEntries.map(([name, info]) => ({
            user: name,
            role: info.role || output.dim('(none)'),
            extraClaims: info.claims ? info.claims.join(', ') : output.dim('(none)'),
          })),
          border: true,
          header: true,
        });
      }

      // Default claims
      const defaults = config.defaultClaims || [];
      if (defaults.length > 0) {
        output.writeln();
        output.writeln(output.bold('Default Claims'));
        output.printList(defaults);
      }

      output.writeln();
      output.writeln(output.dim(`Config: ${configPath}`));

      return { success: true };
    } catch (error) {
      output.printError(`Failed to list claims: ${(error as Error).message}`);
      return { success: false, exitCode: 1 };
    }
  },
};

// Check subcommand
const checkCommand: Command = {
  name: 'check',
  description: 'Check if a specific claim is granted',
  options: [
    { name: 'claim', short: 'c', type: 'string', description: 'Claim to check', required: true },
    { name: 'user', short: 'u', type: 'string', description: 'User ID to check' },
    { name: 'resource', short: 'r', type: 'string', description: 'Resource context' },
  ],
  examples: [
    { command: 'claude-flow claims check -c swarm:create', description: 'Check swarm creation permission' },
    { command: 'claude-flow claims check -c admin:delete -u user123', description: 'Check user permission' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const claim = ctx.flags.claim as string;
    const user = ctx.flags.user as string || 'current';
    const resource = ctx.flags.resource as string;

    if (!claim) {
      output.printError('Claim is required');
      return { success: false, exitCode: 1 };
    }

    output.writeln();
    output.writeln(output.bold('Claim Check'));
    output.writeln(output.dim('─'.repeat(40)));

    const spinner = output.createSpinner({ text: 'Evaluating claim...', spinner: 'dots' });
    spinner.start();

    const fs = await import('fs');

    // Real claims evaluation from config file
    let isGranted = false;
    let reason = 'Claim not found in policy';
    let policySource = 'default';

    try {
      // Check for claims config file
      const claimsConfigPaths = getClaimsConfigPaths();

      let claimsConfig: {
        roles?: Record<string, string[]>;
        users?: Record<string, { role?: string; claims?: string[] }>;
        defaultClaims?: string[];
      } = {
        // Default policy - allows basic operations
        roles: {
          admin: ['*'],
          developer: ['swarm:*', 'agent:*', 'memory:*', 'task:*', 'session:*'],
          operator: ['swarm:status', 'agent:list', 'memory:read', 'task:list'],
          viewer: ['*:list', '*:status', '*:read'],
        },
        defaultClaims: ['swarm:create', 'swarm:status', 'agent:spawn', 'agent:list', 'memory:read', 'memory:write', 'task:create'],
      };

      for (const configPath of claimsConfigPaths) {
        if (fs.existsSync(configPath)) {
          const content = fs.readFileSync(configPath, 'utf-8');
          claimsConfig = { ...claimsConfig, ...JSON.parse(content) };
          policySource = configPath;
          break;
        }
      }

      // Resolve user's claims
      const userConfig = claimsConfig.users?.[user];
      let userClaims: string[] = [...(claimsConfig.defaultClaims || [])];

      if (userConfig) {
        // Add user-specific claims
        if (userConfig.claims) {
          userClaims = [...userClaims, ...userConfig.claims];
        }
        // Add role-based claims
        if (userConfig.role && claimsConfig.roles?.[userConfig.role]) {
          userClaims = [...userClaims, ...claimsConfig.roles[userConfig.role]];
        }
      }

      // Check if claim is granted
      const checkClaim = (claimToCheck: string, grantedClaims: string[]): boolean => {
        for (const granted of grantedClaims) {
          // Exact match
          if (granted === claimToCheck) return true;
          // Wildcard match (e.g., "swarm:*" matches "swarm:create")
          if (granted === '*') return true;
          if (granted.endsWith(':*')) {
            const prefix = granted.slice(0, -1);
            if (claimToCheck.startsWith(prefix)) return true;
          }
          // Pattern match (e.g., "*:list" matches "swarm:list")
          if (granted.startsWith('*:')) {
            const suffix = granted.slice(1);
            if (claimToCheck.endsWith(suffix)) return true;
          }
        }
        return false;
      };

      isGranted = checkClaim(claim, userClaims);
      if (isGranted) {
        reason = userConfig?.role
          ? `Granted via role: ${userConfig.role}`
          : 'Granted via default policy';
      } else {
        reason = 'Not in user claims or role permissions';
      }

      spinner.stop();
    } catch (error) {
      spinner.stop();
      // On error, fall back to permissive default
      isGranted = !claim.startsWith('admin:');
      reason = isGranted ? 'Granted (default permissive policy)' : 'Admin claims require explicit grant';
      policySource = 'fallback';
    }

    if (isGranted) {
      output.writeln(output.success('✓ Claim granted'));
    } else {
      output.writeln(output.error('✗ Claim denied'));
    }

    output.writeln();
    output.printBox([
      `Claim: ${claim}`,
      `User: ${user}`,
      `Resource: ${resource || 'global'}`,
      `Result: ${isGranted ? output.success('GRANTED') : output.error('DENIED')}`,
      ``,
      `Reason: ${reason}`,
      `Policy: ${policySource}`,
    ].join('\n'), 'Result');

    return { success: isGranted };
  },
};

// Grant subcommand
const grantCommand: Command = {
  name: 'grant',
  description: 'Grant a claim to user or role',
  options: [
    { name: 'claim', short: 'c', type: 'string', description: 'Claim to grant', required: true },
    { name: 'user', short: 'u', type: 'string', description: 'User ID' },
    { name: 'role', short: 'r', type: 'string', description: 'Role name' },
    { name: 'scope', short: 's', type: 'string', description: 'Scope: global, namespace, resource', default: 'global' },
    { name: 'expires', short: 'e', type: 'string', description: 'Expiration time (e.g., 24h, 7d)' },
  ],
  examples: [
    { command: 'claude-flow claims grant -c swarm:create -u user123', description: 'Grant to user' },
    { command: 'claude-flow claims grant -c agent:spawn -r developer', description: 'Grant to role' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const claim = ctx.flags.claim as string;
    const user = ctx.flags.user as string;
    const role = ctx.flags.role as string;

    if (!claim) {
      output.printError('Claim is required');
      return { success: false, exitCode: 1 };
    }

    if (!user && !role) {
      output.printError('Either user or role is required');
      return { success: false, exitCode: 1 };
    }

    try {
      const { config, path: configPath } = loadClaimsConfig();

      if (user) {
        if (!config.users) config.users = {};
        if (!config.users[user]) config.users[user] = {};
        if (!config.users[user].claims) config.users[user].claims = [];
        if (!config.users[user].claims!.includes(claim)) {
          config.users[user].claims!.push(claim);
        }
      }

      if (role) {
        if (!config.roles) config.roles = {};
        if (!config.roles[role]) config.roles[role] = [];
        if (!config.roles[role].includes(claim)) {
          config.roles[role].push(claim);
        }
      }

      saveClaimsConfig(config, configPath);

      output.writeln();
      const target = user ? `user "${user}"` : `role "${role}"`;
      output.writeln(output.success(`Granted "${claim}" to ${target}`));
      output.writeln(output.dim(`Saved to: ${configPath}`));
      return { success: true };
    } catch (error) {
      output.printError(`Failed to grant claim: ${(error as Error).message}`);
      return { success: false, exitCode: 1 };
    }
  },
};

// Revoke subcommand
const revokeCommand: Command = {
  name: 'revoke',
  description: 'Revoke a claim from user or role',
  options: [
    { name: 'claim', short: 'c', type: 'string', description: 'Claim to revoke', required: true },
    { name: 'user', short: 'u', type: 'string', description: 'User ID' },
    { name: 'role', short: 'r', type: 'string', description: 'Role name' },
  ],
  examples: [
    { command: 'claude-flow claims revoke -c swarm:delete -u user123', description: 'Revoke from user' },
    { command: 'claude-flow claims revoke -c admin:* -r guest', description: 'Revoke from role' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const claim = ctx.flags.claim as string;
    const user = ctx.flags.user as string;
    const role = ctx.flags.role as string;

    if (!claim) {
      output.printError('Claim is required');
      return { success: false, exitCode: 1 };
    }

    if (!user && !role) {
      output.printError('Either user or role is required');
      return { success: false, exitCode: 1 };
    }

    try {
      const { config, path: configPath } = loadClaimsConfig();
      let removed = false;

      if (user && config.users?.[user]?.claims) {
        const idx = config.users[user].claims!.indexOf(claim);
        if (idx !== -1) {
          config.users[user].claims!.splice(idx, 1);
          removed = true;
        }
      }

      if (role && config.roles?.[role]) {
        const idx = config.roles[role].indexOf(claim);
        if (idx !== -1) {
          config.roles[role].splice(idx, 1);
          removed = true;
        }
      }

      if (!removed) {
        const target = user ? `user "${user}"` : `role "${role}"`;
        output.writeln();
        output.printError(`Claim "${claim}" not found on ${target}`);
        return { success: false, exitCode: 1 };
      }

      saveClaimsConfig(config, configPath);

      output.writeln();
      const target = user ? `user "${user}"` : `role "${role}"`;
      output.writeln(output.success(`Revoked "${claim}" from ${target}`));
      output.writeln(output.dim(`Saved to: ${configPath}`));
      return { success: true };
    } catch (error) {
      output.printError(`Failed to revoke claim: ${(error as Error).message}`);
      return { success: false, exitCode: 1 };
    }
  },
};

// Roles subcommand
const rolesCommand: Command = {
  name: 'roles',
  description: 'Manage roles and their claims',
  options: [
    { name: 'action', short: 'a', type: 'string', description: 'Action: list, create, delete, show', default: 'list' },
    { name: 'name', short: 'n', type: 'string', description: 'Role name' },
  ],
  examples: [
    { command: 'claude-flow claims roles', description: 'List all roles' },
    { command: 'claude-flow claims roles -a show -n admin', description: 'Show role details' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const action = (ctx.flags.action as string) || 'list';
    const name = ctx.flags.name as string;

    try {
      const { config, path: configPath } = loadClaimsConfig();

      if (action === 'list') {
        const roles = config.roles || {};
        const entries = Object.entries(roles);
        if (entries.length === 0) {
          output.writeln();
          output.writeln(output.dim('No roles defined.'));
          return { success: true };
        }
        output.writeln();
        output.writeln(output.bold('Roles'));
        output.printTable({
          columns: [
            { key: 'role', header: 'Role' },
            { key: 'count', header: 'Claims' },
            { key: 'claims', header: 'Claims List', width: 60 },
          ],
          data: entries.map(([roleName, claims]) => ({
            role: roleName,
            count: claims.length,
            claims: claims.join(', '),
          })),
          border: true,
          header: true,
        });
        output.writeln(output.dim(`Config: ${configPath}`));
        return { success: true };
      }

      if (action === 'show') {
        if (!name) {
          output.printError('Role name is required (use -n <name>)');
          return { success: false, exitCode: 1 };
        }
        const claims = config.roles?.[name];
        if (!claims) {
          output.printError(`Role "${name}" not found`);
          return { success: false, exitCode: 1 };
        }
        output.writeln();
        output.writeln(output.bold(`Role: ${name}`));
        output.writeln(output.dim('─'.repeat(40)));
        output.writeln(`Claims (${claims.length}):`);
        output.printList(claims);
        return { success: true };
      }

      if (action === 'create') {
        if (!name) {
          output.printError('Role name is required (use -n <name>)');
          return { success: false, exitCode: 1 };
        }
        if (!config.roles) config.roles = {};
        if (config.roles[name]) {
          output.printError(`Role "${name}" already exists`);
          return { success: false, exitCode: 1 };
        }
        config.roles[name] = [];
        saveClaimsConfig(config, configPath);
        output.writeln();
        output.writeln(output.success(`Created role "${name}"`));
        output.writeln(output.dim('Use "claims grant -c <claim> -r ' + name + '" to add claims.'));
        return { success: true };
      }

      if (action === 'delete') {
        if (!name) {
          output.printError('Role name is required (use -n <name>)');
          return { success: false, exitCode: 1 };
        }
        if (!config.roles?.[name]) {
          output.printError(`Role "${name}" not found`);
          return { success: false, exitCode: 1 };
        }
        delete config.roles[name];
        saveClaimsConfig(config, configPath);
        output.writeln();
        output.writeln(output.success(`Deleted role "${name}"`));
        return { success: true };
      }

      output.printError(`Unknown action "${action}". Use: list, create, delete, show`);
      return { success: false, exitCode: 1 };
    } catch (error) {
      output.printError(`Failed to manage roles: ${(error as Error).message}`);
      return { success: false, exitCode: 1 };
    }
  },
};

// Policies subcommand
const policiesCommand: Command = {
  name: 'policies',
  description: 'Manage claim policies',
  options: [
    { name: 'action', short: 'a', type: 'string', description: 'Action: list, create, delete', default: 'list' },
    { name: 'name', short: 'n', type: 'string', description: 'Policy name' },
  ],
  examples: [
    { command: 'claude-flow claims policies', description: 'List policies' },
    { command: 'claude-flow claims policies -a create -n rate-limit', description: 'Create policy' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const action = (ctx.flags.action as string) || 'list';
    const name = ctx.flags.name as string;

    try {
      const { config, path: configPath } = loadClaimsConfig();

      if (action === 'list') {
        output.writeln();
        output.writeln(output.bold('Policies'));
        output.writeln(output.dim('─'.repeat(50)));

        // Default claims as a policy
        const defaults = config.defaultClaims || [];
        output.writeln();
        output.writeln(output.bold('Default Policy'));
        if (defaults.length > 0) {
          output.printList(defaults);
        } else {
          output.writeln(output.dim('  (no default claims)'));
        }

        // Role-based policies
        const roles = config.roles || {};
        const entries = Object.entries(roles);
        if (entries.length > 0) {
          output.writeln();
          output.writeln(output.bold('Role-Based Policies'));
          output.printTable({
            columns: [
              { key: 'policy', header: 'Policy (Role)' },
              { key: 'count', header: 'Claims' },
              { key: 'preview', header: 'Preview', width: 50 },
            ],
            data: entries.map(([roleName, claims]) => ({
              policy: roleName,
              count: claims.length,
              preview: claims.slice(0, 4).join(', ') + (claims.length > 4 ? ', ...' : ''),
            })),
            border: true,
            header: true,
          });
        }

        output.writeln();
        output.writeln(output.dim(`Config: ${configPath}`));
        return { success: true };
      }

      if (action === 'create') {
        if (!name) {
          output.printError('Policy name is required (use -n <name>)');
          return { success: false, exitCode: 1 };
        }
        if (!config.roles) config.roles = {};
        if (config.roles[name]) {
          output.printError(`Policy "${name}" already exists`);
          return { success: false, exitCode: 1 };
        }
        config.roles[name] = [];
        saveClaimsConfig(config, configPath);
        output.writeln();
        output.writeln(output.success(`Created policy "${name}"`));
        output.writeln(output.dim('Use "claims grant -c <claim> -r ' + name + '" to add claims.'));
        return { success: true };
      }

      if (action === 'delete') {
        if (!name) {
          output.printError('Policy name is required (use -n <name>)');
          return { success: false, exitCode: 1 };
        }
        if (!config.roles?.[name]) {
          output.printError(`Policy "${name}" not found`);
          return { success: false, exitCode: 1 };
        }
        delete config.roles[name];
        saveClaimsConfig(config, configPath);
        output.writeln();
        output.writeln(output.success(`Deleted policy "${name}"`));
        return { success: true };
      }

      output.printError(`Unknown action "${action}". Use: list, create, delete`);
      return { success: false, exitCode: 1 };
    } catch (error) {
      output.printError(`Failed to manage policies: ${(error as Error).message}`);
      return { success: false, exitCode: 1 };
    }
  },
};

// Main claims command
export const claimsCommand: Command = {
  name: 'claims',
  description: 'Claims-based authorization, permissions, and access control',
  subcommands: [listCommand, checkCommand, grantCommand, revokeCommand, rolesCommand, policiesCommand],
  examples: [
    { command: 'claude-flow claims list', description: 'List all claims' },
    { command: 'claude-flow claims check -c swarm:create', description: 'Check permission' },
    { command: 'claude-flow claims grant -c agent:spawn -r developer', description: 'Grant claim' },
  ],
  action: async (): Promise<CommandResult> => {
    output.writeln();
    output.writeln(output.bold('RuFlo Claims System'));
    output.writeln(output.dim('Fine-grained authorization and access control'));
    output.writeln();
    output.writeln('Subcommands:');
    output.printList([
      'list     - List claims and permissions',
      'check    - Check if a claim is granted',
      'grant    - Grant a claim to user or role',
      'revoke   - Revoke a claim',
      'roles    - Manage roles and their claims',
      'policies - Manage claim policies',
    ]);
    output.writeln();
    output.writeln('Claim Types:');
    output.printList([
      'swarm:*   - Swarm operations (create, delete, scale)',
      'agent:*   - Agent operations (spawn, terminate)',
      'memory:*  - Memory operations (read, write, delete)',
      'admin:*   - Administrative operations',
    ]);
    output.writeln();
    output.writeln(output.dim('Created with ❤️ by ruv.io'));
    return { success: true };
  },
};

export default claimsCommand;
