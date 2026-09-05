#!/usr/bin/env node
/**
 * Standalone CLI shim for @claude-flow/plugin-agent-federation.
 * Maps `ruflo-federation <subcommand> [args]` -> CLICommandDefinition handlers.
 *
 * Auth/config via .env (loaded from CWD or any parent):
 *   FEDERATION_NODE_NAME      - this node's identity (default: hostname)
 *   FEDERATION_BIND_HOST      - bind address (default: 127.0.0.1, ADR-166 Phase 3d)
 *   FEDERATION_BIND_PORT      - bind port (default: 8443)
 *   FEDERATION_TRUST_LEVEL    - default trust tier (default: untrusted)
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { hostname } from 'node:os';
import { AgentFederationPlugin } from './plugin.js';
import type { PluginContext } from '@claude-flow/shared/src/plugin-interface.js';

function loadDotenv(): { loaded: string | null; count: number } {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const candidate = resolve(dir, '.env');
    if (existsSync(candidate)) {
      const text = readFileSync(candidate, 'utf8');
      let count = 0;
      for (const rawLine of text.split('\n')) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const eq = line.indexOf('=');
        if (eq < 1) continue;
        const key = line.slice(0, eq).trim();
        let val = line.slice(eq + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (process.env[key] === undefined) {
          process.env[key] = val;
          count++;
        }
      }
      return { loaded: candidate, count };
    }
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  return { loaded: null, count: 0 };
}

loadDotenv();

interface ParsedArgs {
  _: string[];
  [k: string]: unknown;
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > -1) {
        out[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const key = a.slice(2);
        const next = argv[i + 1];
        if (next === undefined || next.startsWith('-')) {
          out[key] = true;
        } else {
          out[key] = next;
          i++;
        }
      }
    } else if (a.startsWith('-') && a.length > 1) {
      const key = a.slice(1);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('-')) {
        out[key] = true;
      } else {
        out[key] = next;
        i++;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

function aliasShortToLong(args: ParsedArgs): ParsedArgs {
  const aliases: Record<string, string> = {
    n: 'name',
    h: 'host',
    p: 'port',
    t: 'token',
    u: 'url',
    f: 'format',
  };
  for (const [s, l] of Object.entries(aliases)) {
    if (s in args && !(l in args)) {
      args[l] = args[s];
    }
  }
  return args;
}

/**
 * Resolve federation subcommand. Supports multi-word like
 * `federation peers add`, `federation peers remove`.
 */
function resolveCommand(
  argv: string[],
  commandNames: string[],
): { name: string; rest: string[] } | null {
  const tokens = argv.slice();
  for (const len of [3, 2, 1]) {
    if (tokens.length < len) continue;
    const probe = 'federation ' + tokens.slice(0, len).join(' ');
    if (commandNames.includes(probe)) {
      return { name: probe, rest: tokens.slice(len) };
    }
  }
  return null;
}

function makeContext(): PluginContext {
  const noop = () => undefined;
  return {
    config: {
      nodeName: process.env.FEDERATION_NODE_NAME ?? hostname(),
      bindHost: process.env.FEDERATION_BIND_HOST ?? '127.0.0.1',
      bindPort: Number(process.env.FEDERATION_BIND_PORT ?? 8443),
      defaultTrustLevel: process.env.FEDERATION_TRUST_LEVEL ?? 'untrusted',
    },
    eventBus: { emit: noop, on: noop, off: noop, once: noop } as unknown as PluginContext['eventBus'],
    logger: {
      info: () => {},
      warn: (...a: unknown[]) => console.warn('[warn]', ...a),
      error: (...a: unknown[]) => console.error('[error]', ...a),
      debug: (...a: unknown[]) => process.env.DEBUG && console.error('[debug]', ...a),
    } as unknown as PluginContext['logger'],
    services: { get: () => undefined, register: noop, has: () => false } as unknown as PluginContext['services'],
  };
}

function printHelp(commandNames: string[]): void {
  console.log('ruflo-federation — Cross-installation agent federation CLI');
  console.log('');
  console.log('Usage: ruflo-federation <subcommand> [options]');
  console.log('');
  console.log('Config (via .env or env vars):');
  console.log('  FEDERATION_NODE_NAME, FEDERATION_BIND_HOST, FEDERATION_BIND_PORT, FEDERATION_TRUST_LEVEL');
  console.log('');
  console.log('Subcommands:');
  for (const n of commandNames) {
    console.log('  ' + n.replace(/^federation /, ''));
  }
  console.log('');
  console.log('Run "ruflo-federation <subcommand> --help" for command-specific options.');
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  const plugin = new AgentFederationPlugin();
  const context = makeContext();
  await plugin.initialize(context);

  const commands = plugin.registerCLICommands();
  const commandNames = commands.map((c) => c.name);

  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    printHelp(commandNames);
    return;
  }

  const resolved = resolveCommand(argv, commandNames);
  if (!resolved) {
    console.error('Unknown subcommand: ' + argv.join(' '));
    console.error('Run "ruflo-federation --help" to list available subcommands.');
    process.exitCode = 1;
    return;
  }

  const cmd = commands.find((c) => c.name === resolved.name)!;
  const args = aliasShortToLong(parseArgs(resolved.rest));

  try {
    await cmd.handler(args as never);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Error: ' + msg);
    process.exitCode = 1;
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error('Fatal: ' + (err instanceof Error ? err.message : String(err)));
    process.exit(1);
  });
