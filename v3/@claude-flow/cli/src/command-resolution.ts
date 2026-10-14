/**
 * Resolve which (sub)command an invocation targets.
 *
 * The parser reports the matched command path (for example
 * ['hooks', 'transfer', 'store', 'search']) and the remaining positional arguments.
 * Resolution walks the whole path through each command's `subcommands`, so a command
 * can sit at any depth. #4157: it used to stop two levels below the top-level command,
 * so `hooks transfer store search` ran the `store` help instead of `search`.
 */
import type { Command } from './types.js';

const matches = (sc: Command, name: string): boolean => sc.name === name || !!sc.aliases?.includes(name);

export function resolveTargetCommand(
  command: Command,
  commandPath: string[],
  positional: string[],
): { target: Command; args: string[] } {
  let target = command;

  if (commandPath.length > 1 && command.subcommands) {
    // The parser already removed the path from `positional`.
    for (const name of commandPath.slice(1)) {
      const next = target.subcommands?.find((sc) => matches(sc, name));
      if (!next) break;
      target = next;
    }
    return { target, args: positional };
  }

  // Positional form: the path only named the top-level command.
  let args = positional;
  while (args.length > 0 && target.subcommands) {
    const next = target.subcommands.find((sc) => matches(sc, args[0]));
    if (!next) break;
    target = next;
    args = args.slice(1);
  }
  return { target, args };
}
