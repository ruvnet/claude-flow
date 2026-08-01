/**
 * settings-generator.ts wires PreToolUse (Write|Edit|MultiEdit) to invoke
 * `hook-handler.cjs pre-edit`, with the stated intent "validate commands and
 * edits before execution". But the generated hook-handler.cjs (helpers-generator.ts)
 * never defined a `pre-edit` case in its handlers table.
 *
 * Effect on every fresh `ruflo init`: the dispatcher's fallback for a present-but-
 * unrecognized command is `console.log('[OK] Hook: ' + command)`, then it force-exits 0.
 * So every Write/Edit/MultiEdit tool call fired a hook that logged success and validated
 * nothing -- a silent no-op masquerading as a passing check, for every agent-driven file
 * edit under a default install.
 *
 * This test pins the general invariant so it can't regress silently again: every
 * hook-handler.cjs subcommand that settings-generator.ts wires into settings.json must
 * have a matching case in the handlers table generateHookHandler() actually emits.
 */

import { describe, it, expect } from 'vitest';
import { generateSettings } from '../src/init/settings-generator.js';
import { generateHookHandler } from '../src/init/helpers-generator.js';
import { DEFAULT_INIT_OPTIONS } from '../src/init/types.js';

type HookEntry = { type: string; command: string; timeout?: number };
type Matcher = { matcher?: string; hooks: HookEntry[] };
type Settings = { hooks?: Record<string, Matcher[]> };

function extractHookHandlerSubcommands(settings: Settings): string[] {
  const found: string[] = [];
  for (const matchers of Object.values(settings.hooks ?? {})) {
    for (const matcher of matchers) {
      for (const hook of matcher.hooks) {
        if (!hook.command.includes('hook-handler.cjs')) continue;
        // Both the POSIX and cmd.exe branches of hookCmd() append the
        // subcommand as the final space-separated token before the
        // trailing quote/paren that closes the command string.
        const match = hook.command.match(/hook-handler\.cjs\S*\s+([a-z-]+)["')]*\s*$/i);
        if (match) found.push(match[1]);
      }
    }
  }
  return [...new Set(found)];
}

describe('hook-handler.cjs subcommand parity (pre-edit no-op regression)', () => {
  it('every hook-handler.cjs subcommand referenced by generateSettings() has a matching handler in generateHookHandler()', () => {
    const settings = generateSettings(DEFAULT_INIT_OPTIONS) as Settings;
    const referenced = extractHookHandlerSubcommands(settings);

    // Sanity check the extraction itself actually found the wiring we're testing --
    // if this ever comes back empty, the regex or the generator shape changed and the
    // test below would pass vacuously.
    expect(referenced).toEqual(expect.arrayContaining(['pre-bash', 'pre-edit', 'post-edit']));

    const generatedSource = generateHookHandler();
    for (const subcommand of referenced) {
      expect(generatedSource, `missing handler case for '${subcommand}' referenced by settings.json hooks`).toContain(
        `'${subcommand}':`
      );
    }
  });

  it("generateHookHandler()'s 'pre-edit' handler does not silently fall through to the unrecognized-command branch", () => {
    const source = generateHookHandler();
    expect(source).toContain("'pre-edit':");
    // The old bug: 'pre-edit' had no case, so `handlers['pre-edit']` was undefined and
    // execution fell into the `else if (command)` branch that just logs '[OK] Hook: ' + command.
    // Assert the handler table itself defines the case, not just that the string appears
    // somewhere incidentally (e.g. in a comment or the usage string).
    const handlersTableMatch = source.match(/const handlers = \{([\s\S]*?)\n\};/);
    expect(handlersTableMatch).not.toBeNull();
    expect(handlersTableMatch![1]).toContain("'pre-edit':");
  });
});
