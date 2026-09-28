/**
 * Team host adapter seam (ADR-402).
 *
 * Exec hosts (Codex, or a generic command host) turn one team_spawn
 * request into a plan entry under spawnPlan.host[<label>]. Every host knows
 * how to read its own stop-hook payload.
 */

/** Per-role defaults; the table is ROLE_DEFAULTS in the team bus store (grok-team-bus.mjs). */
export interface RoleDefaults {
  capability_mode: string;
  isolation: string;
  subagent_type: string;
  claudeTaskType?: string;
}

/** A command a runner executes directly (never through a shell). */
export interface ExecSpec {
  command: string;
  /** May contain placeholders such as {prompt}, {cwd}, {resultFile}. */
  args: string[];
  promptVia: 'stdin' | 'arg';
  closeStdin: boolean;
  /** Env names re-added after the runner strips secrets from the child env. */
  passEnv: string[];
}

/** Command host entry from .claude-flow/team-hosts.json, after validation. */
export interface CommandHostConfig {
  kind: 'exec';
  command: string;
  args: string[];
  promptVia: 'stdin' | 'arg';
  passEnv: string[];
  isolation: string;
}

export interface SpawnContext {
  team: { id: string; name: string; host?: string };
  agent: string;
  role: string;
  defaults: RoleDefaults;
  next: string[];
  /** Task body as given to team_spawn. */
  task: string;
  /** Host label this plan entry is built for (e.g. 'codex', 'myagent'). */
  label: string;
  /** Optional model override passed to team_spawn. */
  model?: string;
  /** Resolved config for a command host; undefined for built-ins. */
  hostConfig?: CommandHostConfig;
}

export interface StopIdentity {
  team?: string;
  agent?: string;
  outcome?: 'done' | 'failed';
}

interface HostAdapterBase {
  id: string;
  /** Map a stop-hook payload to a team/agent. */
  stopIdentity(payload: unknown, env?: NodeJS.ProcessEnv): StopIdentity;
}

/**
 * A native-spawn host (Grok, Claude) spawns children itself. Its plan entry
 * is built by the team bus store (templates/grok/scripts/grok-team-bus.mjs);
 * the adapter only reads its stop-hook payload.
 */
export interface NativeHostAdapter extends HostAdapterBase {
  kind: 'native';
}

/** An exec host (Codex, command hosts) runs one headless turn via `ruflo team run`. */
export interface ExecHostAdapter extends HostAdapterBase {
  kind: 'exec';
  /** Host-specific lines added to the shared child protocol. */
  protocolLines(ctx: SpawnContext): string[];
  /** Becomes spawnPlan.host[<label>] (without `prompt`, which the caller adds). */
  plan(ctx: SpawnContext): Record<string, unknown>;
}

export type TeamHostAdapter = NativeHostAdapter | ExecHostAdapter;

/** Placeholders a runner fills in exec args. */
export const EXEC_PLACEHOLDERS = [
  'prompt',
  'team',
  'agent',
  'role',
  'cwd',
  'teamRoot',
  'resultFile',
] as const;
