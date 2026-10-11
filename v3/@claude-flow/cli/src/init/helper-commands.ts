/**
 * Hook and statusline commands that launch the `.claude/helpers` scripts.
 *
 * A project-level settings.json (`<project>/.claude/settings.json`) keeps the
 * #1943 probe: run the project's helper, fall back to `$HOME/.claude/helpers`.
 * The project controls that settings file anyway, so preferring its helpers
 * grants it nothing new.
 *
 * A user-level settings.json (`~/.claude/settings.json`) applies to every
 * project the user opens. There the probe would let any opened project supply
 * the helper that runs, so user-level commands are pinned to the user's own
 * `$HOME/.claude/helpers` with no project lookup.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export type HelperScope = 'project' | 'user';

const IS_WINDOWS = process.platform === 'win32';
const STATUSLINE_SCRIPT = '.claude/helpers/statusline.cjs';

function canonical(dir: string): string {
  try {
    return fs.realpathSync(dir);
  } catch {
    return path.resolve(dir);
  }
}

/** Settings written into the user's home directory are user-level settings. */
export function helperScopeFor(targetDir: string | undefined): HelperScope {
  if (!targetDir) return 'project';
  return canonical(targetDir) === canonical(os.homedir()) ? 'user' : 'project';
}

/** Command that runs `node <script> <subcommand>` for a hook. */
export function helperHookCommand(script: string, subcommand: string, scope: HelperScope, windows = IS_WINDOWS): string {
  const winScript = script.replace(/\//g, '\\');
  const arg = subcommand ? ` ${subcommand}` : '';
  if (scope === 'user') {
    return windows
      ? `cmd /c "node "%USERPROFILE%\\${winScript}"${arg}"`
      : `sh -c 'exec node "\${HOME}/${script}"${arg}'`;
  }
  if (windows) {
    // cmd.exe equivalent of the sh probe below. `IF EXIST` checks the
    // project-local path; falls back to %USERPROFILE% if missing.
    return `cmd /c "IF EXIST \"%CLAUDE_PROJECT_DIR%\\${winScript}\" (node \"%CLAUDE_PROJECT_DIR%\\${winScript}\"${arg}) ELSE (node \"%USERPROFILE%\\${winScript}\"${arg})"`;
  }
  // POSIX sh: prefer project-local helpers, fall back to $HOME/.claude/.
  // eslint-disable-next-line no-template-curly-in-string
  const projVar = '${CLAUDE_PROJECT_DIR:-.}';
  // eslint-disable-next-line no-template-curly-in-string
  const homeVar = '${HOME}';
  return `sh -c 'D="${projVar}"; [ -f "$D/${script}" ] || D="${homeVar}"; exec node "$D/${script}"${arg}'`;
}

/** Command for the statusLine entry. */
export function helperStatusLineCommand(scope: HelperScope, windows = IS_WINDOWS): string {
  if (windows) {
    // The Node CLI's `-e` flag avoids all shell-quoting pitfalls (#1948,
    // #1973): never `cmd /c` for statusline, it blocks stdin forwarding.
    const home = "p.join(process.env.USERPROFILE||process.env.HOME||'.', '" + STATUSLINE_SCRIPT + "')";
    const js = scope === 'user'
      ? `const p=require('path');require(${home});`
      : "const fs=require('fs'),p=require('path');" +
        `const d=process.env.CLAUDE_PROJECT_DIR||'.';` +
        `const f=p.join(d,'${STATUSLINE_SCRIPT}');` +
        `const h=${home};` +
        'require(fs.existsSync(f)?f:h);';
    return `node -e "${js}"`;
  }
  if (scope === 'user') return `sh -c 'exec node "\${HOME}/${STATUSLINE_SCRIPT}"'`;
  // eslint-disable-next-line no-template-curly-in-string
  const projVar = '${CLAUDE_PROJECT_DIR:-.}';
  // eslint-disable-next-line no-template-curly-in-string
  const homeVar = '${HOME}';
  return `sh -c 'D="${projVar}"; [ -f "$D/${STATUSLINE_SCRIPT}" ] || D="${homeVar}"; exec node "$D/${STATUSLINE_SCRIPT}"'`;
}

// Helpers ruflo installs under .claude/helpers that settings can launch.
const RUFLO_HELPERS = [
  'hook-handler.cjs', 'auto-memory-hook.mjs', 'statusline.cjs', 'ruflo-hook.cjs', 'router.cjs',
  'session.cjs', 'memory.cjs', 'intelligence.cjs', 'learning-service.mjs', 'metrics-db.mjs',
  'context-persistence-hook.mjs',
];
const HELPER_REF = new RegExp(`\\.claude[\\\\/]helpers[\\\\/](${RUFLO_HELPERS.map((h) => h.replace('.', '\\.')).join('|')})`, 'g');
// How a ruflo-generated command reached the project's copy of a helper:
// CLAUDE_PROJECT_DIR (sh, cmd or node -e), `git rev-parse --show-toplevel`,
// or a path relative to the cwd.
const PROJECT_REACH = /CLAUDE_PROJECT_DIR|git rev-parse --show-toplevel/;
const RELATIVE_REF = /(?:^|[\s"'])(?:\.[\\/])?\.claude[\\/]helpers[\\/]/;
const SHELL_CHAINING = /&&|\|\||[;|<>`]/;
const ARGS = /^(?: [\w:.=-]+)*$/;
// The fixed shell scaffolding of the #1943 probes, which itself contains `;`
// and `||`; removed before checking the rest for chaining.
const PROBE_PREAMBLE = /D="\$\{CLAUDE_PROJECT_DIR:-\.\}"; \[ -f "\$D\/\.claude\/helpers\/[\w.-]+" \] \|\| D="\$\{HOME\}"; /;
const IF_EXIST_PREAMBLE = /"IF EXIST "%CLAUDE_PROJECT_DIR%\\\.claude\\helpers\\[\w.-]+" \(node "%CLAUDE_PROJECT_DIR%\\\.claude\\helpers\\[\w.-]+"(?: [\w:.=-]+)*\) ELSE \(/;

/**
 * Rewrite a command that runs one of ruflo's helpers from the opened project
 * into the pinned user-level form, keeping its subcommand. Covers every form
 * ruflo has shipped: the #1943 sh/cmd probes, the earlier
 * `${CLAUDE_PROJECT_DIR:-.}` / `%CLAUDE_PROJECT_DIR%` forms, the ADR-059
 * `git rev-parse` node -e forms (CJS and ESM, with or without argv.splice),
 * and plain relative paths. Returns null for anything else, so user-authored
 * commands (other scripts, redirects, chains) are left alone.
 */
export function pinToUserHelpers(command: string, windows = IS_WINDOWS): string | null {
  const refs = [...command.matchAll(HELPER_REF)];
  if (refs.length === 0) return null;
  const helper = refs[refs.length - 1][1];
  if (refs.some((m) => m[1] !== helper)) return null;
  if (!PROJECT_REACH.test(command) && !RELATIVE_REF.test(command)) return null;

  let args: string;
  const nodeEval = /^node -e "(.*)"((?: [\w:.=-]+)*)$/.exec(command);
  if (nodeEval) {
    if (!/git rev-parse --show-toplevel|CLAUDE_PROJECT_DIR/.test(nodeEval[1])) return null;
    args = nodeEval[2];
  } else {
    if (!/^(?:sh -c '|cmd \/c |node )/.test(command)) return null;
    // Drop the shell wrapper's closing quote / paren, then split around the
    // last helper reference: the head launches it, the tail is its argv.
    const body = command.replace(/'$/, '').replace(/\)"$/, '');
    const last = refs[refs.length - 1];
    const head = body.slice(0, last.index ?? 0).replace(PROBE_PREAMBLE, '').replace(IF_EXIST_PREAMBLE, '');
    let tail = body.slice((last.index ?? 0) + last[0].length);
    if (tail.startsWith('"')) tail = tail.slice(1);
    if (SHELL_CHAINING.test(head) || SHELL_CHAINING.test(tail)) return null;
    args = tail.trimEnd();
  }
  if (!ARGS.test(args)) return null;
  const script = `.claude/helpers/${helper}`;
  if (helper === 'statusline.cjs' && args === '') return helperStatusLineCommand('user', windows);
  return helperHookCommand(script, args.trim(), 'user', windows);
}
