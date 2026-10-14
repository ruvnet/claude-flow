/**
 * #4157: `hooks transfer store search -q routing` printed the `store` help and exited 0.
 * The dispatcher descended only two subcommand levels below a top-level command, so a
 * third level (hooks > transfer > store > search) never ran. Resolution now walks the
 * whole command path.
 */
import { describe, expect, it } from 'vitest';
import { resolveTargetCommand } from '../src/command-resolution.js';
import { CommandParser } from '../src/parser.js';
import type { Command } from '../src/types.js';

const leaf = (name: string, aliases?: string[]): Command => ({ name, description: name, aliases, action: async () => ({ success: true }) });
const group = (name: string, subs: Command[]): Command => ({ name, description: name, subcommands: subs, action: async () => ({ success: true }) });

describe('resolveTargetCommand', () => {
  const search = leaf('search', ['find']);
  const tree = group('hooks', [group('transfer', [group('store', [search, leaf('list')]), leaf('from-project')]), leaf('route')]);

  it('reaches a leaf three levels below the top-level command (parser path form)', () => {
    const { target, args } = resolveTargetCommand(tree, ['hooks', 'transfer', 'store', 'search'], ['routing']);
    expect(target).toBe(search);
    expect(args).toEqual(['routing']);
  });

  it('matches aliases at depth', () => {
    expect(resolveTargetCommand(tree, ['hooks', 'transfer', 'store', 'find'], []).target).toBe(search);
  });

  it('still resolves one and two levels', () => {
    expect(resolveTargetCommand(tree, ['hooks', 'route'], []).target.name).toBe('route');
    expect(resolveTargetCommand(tree, ['hooks', 'transfer', 'store'], []).target.name).toBe('store');
  });

  it('walks the positional form when the path only names the top-level command', () => {
    const { target, args } = resolveTargetCommand(tree, ['hooks'], ['transfer', 'store', 'list', 'extra']);
    expect(target.name).toBe('list');
    expect(args).toEqual(['extra']);
  });

  it('stops at the deepest command that matches and keeps the rest as arguments', () => {
    const { target, args } = resolveTargetCommand(tree, ['hooks'], ['transfer', 'nope', 'x']);
    expect(target.name).toBe('transfer');
    expect(args).toEqual(['nope', 'x']);
  });

  it('leaves a command without subcommands untouched', () => {
    const { target, args } = resolveTargetCommand(leaf('status'), ['status'], ['a', 'b']);
    expect(target.name).toBe('status');
    expect(args).toEqual(['a', 'b']);
  });
});

describe('the real pattern store under hooks > transfer (#4157)', () => {
  it('dispatches `hooks transfer store search -q routing` to the search subcommand', async () => {
    // hooks.ts nests the real storeCommand as hooks > transfer > store; build the same shape
    // without importing hooks.ts (it pulls in the whole CLI).
    const { storeCommand } = await import('../src/commands/transfer-store.js');
    const hooks = group('hooks', [group('transfer', [storeCommand])]);
    const parser = new CommandParser({ allowUnknownFlags: true });
    parser.registerCommand(hooks);
    const parsed = parser.parse(['hooks', 'transfer', 'store', 'search', '-q', 'routing']);
    const { target } = resolveTargetCommand(hooks, parsed.command, parsed.positional);
    expect(target.name).toBe('search');
    expect(target).toBe(storeCommand.subcommands!.find((c) => c.name === 'search'));
  });
});
