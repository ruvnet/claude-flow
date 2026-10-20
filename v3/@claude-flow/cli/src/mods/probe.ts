/**
 * What can be known, from outside a Claude Code session, about whether the
 * ruflo mod will load and what it will own (ADR-404). Every finding names its
 * source; nothing here claims a live load it did not see. The one direct
 * evidence of a load is the heartbeat the mod writes at session start.
 */

import { existsSync, readFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join, resolve } from 'node:path';

import { findClaudeInstalls, judgeInstalls, type ClaudeInstall } from './claude-installs.js';
import { ENABLE_ENV, MARKETPLACE_NAME, MOD_PLUGIN_ID, MOD_PLUGIN_IDS, readRecord, readSettingsFile, settingsFileFor } from './install.js';
import { claudeConfigDir, installedState, resolveFindings, type ReadFs } from './plugin-resolve.js';
import { PROJECTION_RELATIVE } from './policy-projection.js';

export const HANDSHAKE_MARKER = 'RUFLO_MODS_OWNS';
export const HEARTBEAT_RELATIVE = join('.claude-flow', 'mods', 'session.json');
const SEC_DEFAULT_ID = 'cc-plugin-sec-default@builtin';

export type Status = 'pass' | 'warn' | 'fail';
export interface Finding {
  name: string;
  status: Status;
  message: string;
  fix?: string;
}

function readJson(path: string): unknown {
  try {
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined;
  } catch {
    return undefined;
  }
}

function get(obj: unknown, ...keys: string[]): unknown {
  return keys.reduce<unknown>((o, k) => (o !== null && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);
}

/** Managed settings, where an organization sets sec-default's options. */
export function managedSettingsPath(os = platform()): string {
  if (os === 'darwin') return '/Library/Application Support/ClaudeCode/managed-settings.json';
  if (os === 'win32') return 'C:\\ProgramData\\ClaudeCode\\managed-settings.json';
  return '/etc/claude-code/managed-settings.json';
}

export interface ProbeInputs {
  projectRoot: string;
  home?: string;
  env?: NodeJS.ProcessEnv;
  managedPath?: string;
  /** Claude Code binaries on PATH; discovered (each `--version` run) when absent. */
  installs?: ClaudeInstall[];
  /** Claude Code's config directory; CLAUDE_CONFIG_DIR, else ~/.claude, when absent. */
  configDir?: string;
  /** Reads for the plugin-resolution findings; the real filesystem when absent. */
  fs?: ReadFs;
}

const LEGACY_EVENTS = { route: 'UserPromptSubmit', 'post-edit': 'PostToolUse' } as const;

/** Which of route/post-edit the settings run through the CLI's own `hooks` command, in any of the files. */
export function legacyCliHooks(files: readonly string[]): Array<keyof typeof LEGACY_EVENTS> {
  const commands = (event: string) => files.flatMap((f) => {
    let groups: unknown;
    try {
      groups = get(readSettingsFile(f), 'hooks', event);
    } catch {
      return [];
    }
    return Array.isArray(groups)
      ? groups.flatMap((g) => (Array.isArray((g as { hooks?: unknown })?.hooks) ? (g as { hooks: Array<{ command?: unknown }> }).hooks.map((h) => h?.command).filter((c): c is string => typeof c === 'string') : []))
      : [];
  });
  return (Object.keys(LEGACY_EVENTS) as Array<keyof typeof LEGACY_EVENTS>).filter((sub) => {
    const word = new RegExp(`(?:^|[\\s/"'])(?:@claude-flow/cli|claude-flow|ruflo)(?:@[\\w.-]+)?["']?\\s+hooks\\s+${sub}(?![\\w-])`);
    return commands(LEGACY_EVENTS[sub]).some((c) => word.test(c));
  });
}


/** Settings files (in the order given) where `enabledPlugins[id]` is exactly `value`. */
function enabledValues(files: readonly string[], id: string): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const f of files) {
    try {
      const v = get(readSettingsFile(f), 'enabledPlugins', id);
      if (v !== undefined) out.set(f, v);
    } catch {
      // an unparseable file is reported elsewhere; never overwritten
    }
  }
  return out;
}

function partialInstallFindings(root: string, files: readonly string[], _inputs: ProbeInputs): Finding[] {
  const enabled = new Set(MOD_PLUGIN_IDS.filter((id) => [...enabledValues(files, id).values()].includes(true)));
  const out: Finding[] = [];
  const parts: string[] = [];

  if (enabled.size > 0 && enabled.size < MOD_PLUGIN_IDS.length) {
    const missing = MOD_PLUGIN_IDS.filter((id) => !enabled.has(id) && ![...enabledValues(files, id).values()].includes(false));
    if (missing.length) parts.push(`enabled ${[...enabled].join(', ')} but not ${missing.join(', ')}`);
  }
  if (enabled.size > 0) {
    const declared = files.some((f) => {
      try {
        return get(readSettingsFile(f), 'extraKnownMarketplaces', MARKETPLACE_NAME) !== undefined;
      } catch {
        return false;
      }
    });
    if (!declared) parts.push(`no \`${MARKETPLACE_NAME}\` marketplace is declared in settings for Claude Code to load them from`);
  }
  const record = readRecord(root);
  if (record) {
    const lost: string[] = [];
    for (const [file, added] of Object.entries(record.files)) {
      try {
        const now = readSettingsFile(file);
        for (const id of added.plugins) if (get(now, 'enabledPlugins', id) !== true && get(now, 'enabledPlugins', id) !== false) lost.push(id);
        if (added.marketplace && get(now, 'extraKnownMarketplaces', MARKETPLACE_NAME) === undefined) lost.push(`${MARKETPLACE_NAME} marketplace`);
      } catch {
        // unreadable settings: nothing to compare
      }
    }
    if (lost.length) parts.push(`the install record says ruflo added ${[...new Set(lost)].join(', ')}, which the settings no longer have`);
  }

  if (parts.length) out.push({ name: 'partial install', status: 'warn', message: parts.join('; '), fix: 'ruflo mods install' });
  return out;
}

export function probeMods(inputs: ProbeInputs): Finding[] {
  const root = resolve(inputs.projectRoot);
  const home = inputs.home ?? homedir();
  const env = inputs.env ?? process.env;
  const configDir = inputs.configDir ?? claudeConfigDir(env, home);
  const findings: Finding[] = [];

  // 1. Enabled for this project?
  const files = [settingsFileFor(root, 'local'), settingsFileFor(root, 'project'), join(configDir, 'settings.json')];
  const enabledIn = files.find((f) => {
    try {
      return get(readSettingsFile(f), 'enabledPlugins', MOD_PLUGIN_ID) === true;
    } catch {
      return false;
    }
  });
  // A plugin a person set to false is their decision: `ruflo mods install` never flips it, so it is not the repair.
  const disabledIn = enabledIn ? undefined : files.find((f) => {
    try {
      return get(readSettingsFile(f), 'enabledPlugins', MOD_PLUGIN_ID) === false;
    } catch {
      return false;
    }
  });
  const cachedInstall = enabledIn || disabledIn ? { installed: false as const } : installedState(root, configDir, MOD_PLUGIN_ID, inputs.fs);
  const scopeOf = (f: string) => (f === files[0] ? 'local' : f === files[1] ? 'project' : 'user');
  findings.push(enabledIn
    ? { name: 'ruflo-mods plugin', status: 'pass', message: `enabled in settings: ${enabledIn} (whether Claude Code can load it: see below)` }
    : disabledIn
      ? {
        name: 'ruflo-mods plugin',
        status: 'warn',
        message: `disabled in ${disabledIn} (enabledPlugins is false): the mod does not load and classic hooks handle every event; \`ruflo mods install\` leaves a plugin you switched off alone`,
        fix: `claude plugin enable ${MOD_PLUGIN_ID} --scope ${scopeOf(disabledIn)}`,
      }
      : cachedInstall.installed
        ? {
          name: 'ruflo-mods plugin',
          status: 'warn',
          message: `installed (${cachedInstall.scope} scope) but not enabled in this project's settings: the mod does not load`,
          fix: `claude plugin enable ${MOD_PLUGIN_ID} --scope ${cachedInstall.scope === 'user' ? 'user' : 'local'}`,
        }
        : { name: 'ruflo-mods plugin', status: 'warn', message: 'not enabled; classic hooks handle every event', fix: 'ruflo mods install' });

  // 1b. A half-finished install: some of the mod plugins enabled and not the rest, a plugin enabled with no
  // marketplace declared for Claude Code to load it from, or keys the install record says ruflo added that
  // the settings file no longer has. `ruflo mods install` is idempotent and adds exactly what is missing.
  findings.push(...partialInstallFindings(root, files, inputs));

  // 1a. Enabled is a request; Claude Code silently skips a plugin its
  // marketplace clone does not carry (a clone older than the plugin).
  if (enabledIn) {
    const scope = enabledIn === files[0] ? 'local' : enabledIn === files[1] ? 'project' : 'user';
    const enabled = MOD_PLUGIN_IDS.filter((id) => files.some((f) => {
      try {
        return get(readSettingsFile(f), 'enabledPlugins', id) === true;
      } catch {
        return false;
      }
    }));
    // The marketplace the first settings file declaring one names (local wins, as in Claude Code).
    const declared = files.map((f) => {
      try {
        return get(readSettingsFile(f), 'extraKnownMarketplaces', 'ruflo');
      } catch {
        return undefined;
      }
    }).find((d) => d !== undefined);
    findings.push(...resolveFindings(root, scope, configDir, inputs.fs, enabled, declared));
  }

  // 2. Function hooks switched on for installed plugins (early access).
  const envOn = env[ENABLE_ENV] === '1';
  const settingsOn = files.some((f) => {
    try {
      return get(readSettingsFile(f), 'env', ENABLE_ENV) === '1';
    } catch {
      return false;
    }
  });

  // 2a. Which Claude Code runs, and whether a stale install shadows it.
  findings.push({ name: 'claude installs', ...judgeInstalls(inputs.installs ?? findClaudeInstalls(env, home), envOn || settingsOn) });
  // Observed live (ADR-404): 2.1.287 loads mods with ENABLE_ENV unset;
  // 2.1.282 refuses them without it ("not turned on for installed plugins");
  // on either, a server-side rollout switch served off holds them off, the
  // variable notwithstanding. Which binary runs is the 'claude installs' finding.
  const rollout = get(readJson(join(home, '.claude.json')), 'cachedGrowthBookFeatures', 'tengu_plugin_hooks_modules');
  const enableMsg = `${ENABLE_ENV} ${envOn ? 'set in this environment' : settingsOn ? 'set in settings env' : 'not set'}`;
  findings.push(rollout === true
    ? { name: 'function hooks', status: 'pass', message: `Claude Code rollout switch cached on; ${enableMsg}` }
    : rollout === false
      ? { name: 'function hooks', status: 'warn', message: `Claude Code serves function hooks OFF for this account (cached); the mod will not load and classic hooks keep every event; ${enableMsg}` }
      : { name: 'function hooks', status: 'warn', message: `rollout switch not cached (unverified whether the mod can load); ${enableMsg}`, fix: `export ${ENABLE_ENV}=1 and start Claude Code once` });

  // 3. Refused by policy?
  const managed = readJson(inputs.managedPath ?? managedSettingsPath());
  const managedOnly = get(managed, 'pluginConfigs', SEC_DEFAULT_ID, 'options', 'allowManagedModsOnly');
  findings.push(managedOnly !== undefined && managedOnly !== false
    ? { name: 'managed policy', status: 'warn', message: 'allowManagedModsOnly is set: Claude Code refuses user mods; classic hooks stay in charge' }
    : { name: 'managed policy', status: 'pass', message: managed === undefined ? 'no managed settings' : 'user mods allowed (allowManagedModsOnly not set)' });

  // 4a. Settings that still run the CLI's own `hooks route|post-edit` (what init
  // wrote before hook-handler.cjs). That command never reads the handshake, so
  // the mod stands down for those events (plugins/ruflo-mods/hooks/ownership.ts,
  // legacyCliConfigured: keep the two patterns in step).
  const legacy = legacyCliHooks(files);
  if (legacy.length) {
    findings.push({ name: 'legacy CLI hooks', status: 'warn', message: `settings run the CLI's own \`hooks ${legacy.join('` and `hooks ')}\`: the mod stands down for ${legacy.join(' and ')}, which that command keeps`, fix: 'ruflo init upgrade --settings (regenerate the settings hooks)' });
  }

  // 4. Every classic helper a hook could run honours the handshake (the mod's
  // own rule, plugins/ruflo-mods/hooks/session.ts); else the mod stands down.
  const helpers = [...new Set([join(root, '.claude', 'helpers', 'hook-handler.cjs'), join(home, '.claude', 'helpers', 'hook-handler.cjs')])].filter(existsSync);
  const stale = helpers.filter((h) => {
    try {
      return !readFileSync(h, 'utf8').includes(HANDSHAKE_MARKER);
    } catch {
      return true;
    }
  });
  findings.push(helpers.length === 0
    ? { name: 'classic handshake', status: 'pass', message: legacy.length ? 'no hook-handler.cjs (see legacy CLI hooks)' : 'no hook-handler.cjs: the mod owns route and post-edit outright' }
    : stale.length === 0
      ? { name: 'classic handshake', status: 'pass', message: `${helpers.join(', ')} hand route and post-edit to the mod while it runs` }
      : { name: 'classic handshake', status: 'warn', message: `${stale.join(', ')} predate${stale.length === 1 ? 's' : ''} the handshake: the mod stands down and classic hooks keep route/post-edit`, fix: 'ruflo init --upgrade (refresh helpers in the project and in ~/.claude)' });

  // 5. Policy projection.
  const projectionPath = join(root, PROJECTION_RELATIVE);
  const projection = readJson(projectionPath);
  const stateMode = get(readJson(join(root, '.claude-flow', 'policy', 'state.json')), 'mode');
  findings.push(projection !== undefined
    ? { name: 'policy projection', status: 'pass', message: `${get(projection, 'mode')} mode, ${(get(projection, 'rules') as unknown[] | undefined)?.length ?? 0} claude-code rule(s)` }
    : stateMode === 'enforce' || stateMode === 'observe'
      ? { name: 'policy projection', status: 'warn', message: `policy is ${String(stateMode)} but no projection exists (no claude-code.* rules, or state written by an older CLI)`, fix: 'ruflo mods sync-policy' }
      : { name: 'policy projection', status: 'pass', message: 'none (no ruflo policy for Claude Code tools)' });

  // 6. Evidence of a load.
  const beat = readJson(join(root, HEARTBEAT_RELATIVE));
  const startedAt = get(beat, 'startedAt');
  const owned = get(beat, 'owned');
  findings.push(typeof startedAt === 'string'
    ? { name: 'last mod start', status: 'pass', message: `${startedAt}, owning ${Array.isArray(owned) && owned.length ? owned.join(', ') : 'nothing'}` }
    : { name: 'last mod start', status: enabledIn ? 'warn' : 'pass', message: 'the mod has not started in this project' + (enabledIn ? ' (restart Claude Code; check function hooks above)' : ''), ...(enabledIn ? { fix: 'restart Claude Code in this project, then run /ruflo mods' } : {}) });

  if (readRecord(root)) findings.push({ name: 'install record', status: 'pass', message: join(root, '.claude-flow', 'mods', 'install.json') });
  return findings;
}
