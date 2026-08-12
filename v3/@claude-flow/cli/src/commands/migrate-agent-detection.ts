/**
 * ADR-382 Part B — the `ruflo migrate` mitigation ADR-128 promised and never
 * shipped: detect the 9 forked agents ADR-128 Phase 2 deleted from the init
 * template (each plugin is now canonical) and, when a project is missing one
 * AND the owning plugin isn't installed, surface an install suggestion.
 * See v3/docs/adr/ADR-382-init-scaffold-content-drift-remediation.md and
 * https://github.com/ruvnet/ruflo/issues/2971.
 *
 * Kept in a sibling module (not migrate.ts) because migrate.ts is already
 * near/over the 500-line budget — see CLAUDE.md file-size rule.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface RemovedAgentMapping {
  /** Basename as it shipped in the init template, e.g. "coder.md". */
  basename: string;
  /** Marketplace plugin id (name in .claude-plugin/marketplace.json) that now owns it. */
  plugin: string;
}

export interface RemovedAgentGap {
  agent: string;
  plugin: string;
  installCommand: string;
}

export interface DetectRemovedAgentGapsOptions {
  /**
   * Override for the Claude Code plugin-registry home directory. Defaults to
   * os.homedir(). Tests inject an isolated temp dir so results don't depend
   * on whatever is actually installed on the machine running the suite.
   */
  homeDir?: string;
}

interface InstalledPluginEntry {
  scope?: string;
  projectPath?: string;
}

type InstalledPluginsRegistry = Record<string, InstalledPluginEntry[]>;

/**
 * Claude Code records every plugin install (marketplace-scoped, "user" or
 * "project") in a single global file — ~/.claude/plugins/installed_plugins.json,
 * keyed "<plugin>@<marketplace>". This is the only real on-disk signal for
 * "is the owning plugin installed"; there is no per-project marker and no
 * ruflo-side tracking for marketplace plugins (ruflo's own PluginManager
 * manifest at .claude-flow/plugins/installed.json tracks a different,
 * npm-package-based plugin system).
 */
function readInstalledPluginsRegistry(homeDir: string): InstalledPluginsRegistry {
  const registryPath = path.join(homeDir, '.claude', 'plugins', 'installed_plugins.json');
  try {
    if (!fs.existsSync(registryPath)) return {};
    const raw = fs.readFileSync(registryPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.plugins && typeof parsed.plugins === 'object') {
      return parsed.plugins as InstalledPluginsRegistry;
    }
    return {};
  } catch {
    return {};
  }
}

function isPluginInstalled(pluginName: string, cwd: string, registry: InstalledPluginsRegistry): boolean {
  const resolvedCwd = path.resolve(cwd);
  const prefix = `${pluginName}@`;
  for (const [key, entries] of Object.entries(registry)) {
    if (!key.startsWith(prefix)) continue;
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (entry?.scope === 'project') {
        if (entry.projectPath && path.resolve(entry.projectPath) === resolvedCwd) return true;
      } else {
        // "user" scope (or unspecified) applies to every project.
        return true;
      }
    }
  }
  return false;
}

function agentFileExists(cwd: string, basename: string): boolean {
  const agentsDir = path.join(cwd, '.claude', 'agents');
  return findBasename(agentsDir, basename, 0);
}

// .claude/agents/ is a shallow tree (category/[subcategory]/name.md); a small
// depth guard is enough to avoid pathological recursion without needing a
// real glob dependency for a two-or-three-level lookup.
const MAX_AGENT_DIR_DEPTH = 6;

function findBasename(dir: string, basename: string, depth: number): boolean {
  if (depth > MAX_AGENT_DIR_DEPTH) return false;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (findBasename(path.join(dir, entry.name), basename, depth + 1)) return true;
    } else if (entry.isFile() && entry.name === basename) {
      return true;
    }
  }
  return false;
}

/**
 * Returns one gap row per removed agent that is both missing from the
 * project's .claude/agents/ tree and not covered by an installed owning
 * plugin. Pure filesystem checks, no CLI version comparison (ADR-382 Part B
 * scope note: a filesystem check is sufficient and accurate here).
 */
export function detectRemovedAgentGaps(
  cwd: string,
  removedAgents: RemovedAgentMapping[],
  options: DetectRemovedAgentGapsOptions = {}
): RemovedAgentGap[] {
  const homeDir = options.homeDir ?? os.homedir();
  const registry = readInstalledPluginsRegistry(homeDir);
  const gaps: RemovedAgentGap[] = [];

  for (const { basename, plugin } of removedAgents) {
    if (agentFileExists(cwd, basename)) continue;
    if (isPluginInstalled(plugin, cwd, registry)) continue;
    gaps.push({
      agent: basename,
      plugin,
      // #2985: these are Claude Code *marketplace* plugins. `ruflo plugins
      // install` targets a different system (the npm-package PluginManager —
      // see the module header) and cannot install them; the marketplace
      // command below is the one that satisfies the registry check above.
      installCommand: `/plugin install ${plugin}@ruflo`,
    });
  }

  return gaps;
}
