# ADR 401: Browser MCP Windows Shell Boundary

Status: Accepted

Date: 2026 09 26

Related: #2770 (the fallback this ADR corrects), ADR 399 (Git execution boundary), ADR 127 (github-safe shell-free execution)

## Context

The browser MCP tools (`browser_open`, `browser_fill`, `browser_type`, `browser_press`, `browser_select`, `browser_eval`, and the others that share `execBrowserCommand`) run the `agent-browser` CLI. When `agent-browser` is not installed globally, `execBrowserCommand` fell back to `npx --yes agent-browser ...`.

On Windows `npx` is `npx.cmd`, a batch file that `execFileSync` cannot spawn without `cmd.exe`. The #2770 fix enabled `shell: process.platform === 'win32'` for that fallback and recorded a safety condition in a comment: the arguments were hard-coded flags plus a package name, and "if user-controlled args are ever added, escape them before spawn."

That condition stopped being true. `execBrowserCommand` now receives tool-supplied values: the `fill` value, the `eval` script, selectors, key names, URLs and paths. Their only validation is `validateText`, which checks type, length and NUL bytes. With `shell: true`, Node joins argv with spaces and passes the string to `cmd.exe`, so `&`, `|`, `^`, `%VAR%` and quotes in any of those values are shell syntax. An MCP caller, including a prompt-injected agent, can run commands as the host user on any Windows host where `agent-browser` is missing.

Scope of the exposure:

- Windows only, and only on the fallback path (global `agent-browser` absent).
- POSIX was never affected: `shell` is `false` there.
- Affects every published version that carries the #2770 fallback, including 3.46.0.

The condition was reported through an independent research run against `main` at `88955d9f`. It was verified here by reading the published 3.46.0 artifact: the `shell: process.platform === 'win32'` option and the stale comment are present in `dist/src/mcp-tools/browser-tools.js`.

## Decision

Tool-supplied text never reaches a shell. `execBrowserCommand` no longer sets a `shell` option on any spawn.

Windows launch targets are resolved to the process behind the npm shim, and that process is spawned directly with an argv array:

1. `agent-browser`: `where.exe agent-browser`, then a native `.exe`, or `node <entry>` where `<entry>` is the package's own `bin` file read from `<npm prefix>/node_modules/agent-browser/package.json`.
2. `npx` fallback: `node <npm>/bin/npx-cli.js --yes agent-browser ...`, using the running Node's own npm, or the npm that `where.exe npx` points at.

This is the resolution `runtime/claude-command.ts` already applies to Claude Code and the hook runner applies to `resolveNpmShim`. It lives in `runtime/browser-command.ts` as two small functions with injectable platform, filesystem and lookup so they are testable on any host.

Guards:

- A resolved target ending in `.cmd` or `.bat` is never returned. Spawning one implies `cmd.exe` even with `shell: false`.
- A `bin` entry that resolves outside its package directory is rejected.
- If neither launcher resolves on Windows, the tool fails with the existing install hint. It does not fall back to a shell.
- POSIX behaviour is unchanged: `agent-browser`, then `npx`, both without a shell.

## Enforcement

- `browser-win32-no-shell.test.ts` drives `execBrowserCommand` with hostile values (`" & calc.exe & "`, `%COMSPEC%`, `^|`, `$(id)`, CRLF injection, a script that calls `child_process`) under a stubbed `win32` and `linux` platform. It asserts that every spawn receives the value as one literal argv element and no truthy `shell`. It fails on the previous implementation.
- A static test fails if `browser-tools.ts` ever contains a `shell:` option again.
- `browser-command-resolver.test.ts` covers resolution, `.cmd` and `.bat` refusal, and bin-path traversal.

## Alternatives considered

- **Escape arguments for `cmd.exe`** (`escapeCmdArg`). Rejected. A `shell: true` command line is parsed twice, by `cmd.exe` and then by the target's argv parser, and correct quoting differs between them. The hook runner needed a dedicated two-parser escaper for exactly this. Removing the shell removes the class of bug instead of relying on complete escaping of every future argument.
- **Tighten `validateText`.** Rejected as the primary control. `fill` and `eval` legitimately carry arbitrary text, including quotes and ampersands, so a denylist would either break the tools or miss a metacharacter.
- **Require a global `agent-browser` and drop the `npx` fallback.** Viable, but a behaviour change for users who rely on the fallback. Kept as a possible follow-up.

## Consequences

- The Windows fallback keeps working on standard Node installs. On unusual layouts where `npx-cli.js` cannot be located, the tool now reports the install hint instead of running through `cmd.exe`.
- Users on Windows with a global `agent-browser` now run it without `npx` at all, which is faster than before.
- Other `shell: process.platform === 'win32'` call sites were audited and are not exposed to tool input: `commands/init.ts` passes hard-coded flags and a pre-validated model name, `commands/eject.ts` takes arguments from the local user's own command line, and `mcp-tools/agentbbs-tools.ts` runs a fixed `--version` against a binary chosen by a trusted environment variable. Their stale "no injection risk" comments should be revisited if any of those arguments ever become tool-supplied.

## Disclosure

The fix and the patched release ship together. The advisory text describes the condition and the affected configuration without an exploit string.
