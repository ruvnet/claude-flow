/**
 * `@claude-flow/codex/dual-mode`, loaded at run time.
 *
 * codex lists the cli as a peer, so the two form a workspace cycle and
 * `pnpm -r build` may compile the cli before codex's dist exists. A module id
 * held in a variable keeps tsc from resolving it at build time, the same way
 * `resolveCodexInitializer` in commands/init.ts loads the Codex initializer.
 * The types below are the parts of the codex API the team runner uses.
 */

export interface HeadlessProcessOptions {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdinText?: string;
  timeoutMs: number;
  maxOutputBytes: number;
  signal?: AbortSignal;
}

export interface HeadlessProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  aborted?: boolean;
  truncated?: boolean;
  ms: number;
}

export interface CodexDualMode {
  isProtectedEnvName(name: string): boolean;
  buildWorkerEnvironment(
    base: NodeJS.ProcessEnv,
    opts: { principalId: string; passEnv?: string[] },
  ): NodeJS.ProcessEnv;
  runHeadlessProcess(opts: HeadlessProcessOptions): Promise<HeadlessProcessResult>;
}

const CODEX_DUAL_MODE = '@claude-flow/codex/dual-mode';

/** The codex dual-mode module, or undefined when it cannot be loaded. */
export async function loadCodexDualMode(): Promise<Partial<CodexDualMode> | undefined> {
  try {
    return (await import(CODEX_DUAL_MODE)) as Partial<CodexDualMode>;
  } catch {
    return undefined;
  }
}
