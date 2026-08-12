/**
 * ADR-382 Part B follow-up (#2985) — `ruflo migrate fix --agents`: actually
 * restore the agents ADR-128 Phase 2 removed from the init template, instead
 * of only pointing at them.
 *
 * Content resolution order (first hit wins):
 *   1. The Claude Code marketplace clone, when present —
 *      ~/.claude/plugins/marketplaces/ruflo/plugins/<plugin>/agents/<basename>
 *   2. A repo checkout at the project root (dogfood / development) —
 *      <cwd>/plugins/<plugin>/agents/<basename>
 *   3. GitHub raw, pinned to this CLI's own version tag (v<version>), falling
 *      back to `main` when the tag predates the file. Requires network; the
 *      failure message says so explicitly.
 *
 * npm-track consideration: plugin agent bodies reference the
 * `mcp__plugin_ruflo-core_ruflo__*` tool namespace, which only resolves when
 * ruflo-core is installed as a Claude Code marketplace plugin. A user
 * reaching for this command is on the npm track (otherwise the owning plugin
 * would cover the gap and no restore would be offered), so restored copies
 * are rewritten to the canonical `claude-flow` server key (#2206). The
 * rewrite is annotated in a provenance comment inside the restored file.
 *
 * Kept in a sibling module (not migrate.ts) for the same reason as
 * migrate-agent-detection.ts — migrate.ts is over the 500-line budget.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'node:url';
import type { RemovedAgentGap } from './migrate-agent-detection.js';

// Same local-reader pattern as mcp-tools/system-tools.ts — avoids importing
// from ../index.js (cycle risk) just for a version string.
function getPackageVersion(): string | undefined {
  try {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    for (const depth of ['../..', '../../..']) {
      const pkgPath = path.join(dir, depth, 'package.json');
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        if (pkg.name?.includes('claude-flow') || pkg.name === 'ruflo') {
          return pkg.version;
        }
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/** Marketplace plugin namespace prefix — resolves only under a marketplace install. */
const PLUGIN_NAMESPACE_PREFIX = 'mcp__plugin_ruflo-core_ruflo__';
/** Canonical npm-track namespace for the same server (key `claude-flow`, #2206). */
const CANONICAL_NAMESPACE_PREFIX = 'mcp__claude-flow__';

/**
 * Where each removed agent lived in the init template before ADR-128 Phase 2
 * deleted it (see the ADR's Gap 2 table). Restoring to the original category
 * keeps category-based tooling (e.g. `--agents=<cat>` style filters) working.
 */
const RESTORE_CATEGORY: Record<string, string> = {
  'coder.md': 'core',
  'researcher.md': 'core',
  'reviewer.md': 'core',
  'tester.md': 'core',
  'memory-specialist.md': 'v3',
  'security-auditor.md': 'v3',
  'sparc-orchestrator.md': 'v3',
  'adr-architect.md': 'v3',
  'goal-planner.md': 'goal',
};

const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/ruvnet/ruflo';

export type RestoreSource = 'marketplace-clone' | 'repo-checkout' | 'github-tag' | 'github-main';

export interface RestoreResult {
  agent: string;
  plugin: string;
  status: 'restored' | 'skipped' | 'failed';
  /** Where the content came from (set when status === 'restored'). */
  source?: RestoreSource;
  /** Project-relative path written (set when status === 'restored' | 'skipped'). */
  path?: string;
  /** Human-readable failure reason (set when status === 'failed'). */
  error?: string;
}

export interface RestoreRemovedAgentsOptions {
  /** Test injection: overrides os.homedir() for the marketplace-clone probe. */
  homeDir?: string;
  /** Test injection: overrides global fetch for the GitHub fallback. */
  fetchImpl?: typeof fetch;
  /** CLI version used to pin the GitHub tag (e.g. "3.38.1" -> tag v3.38.1). */
  version?: string;
  /** Report what would be written without writing. */
  dryRun?: boolean;
}

function findFileRecursive(dir: string, basename: string, depth: number): string | null {
  if (depth > 4) return null;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const hit = findFileRecursive(full, basename, depth + 1);
      if (hit) return hit;
    } else if (entry.isFile() && entry.name === basename) {
      return full;
    }
  }
  return null;
}

function readLocalCandidate(root: string, plugin: string, basename: string): string | null {
  const agentsDir = path.join(root, 'plugins', plugin, 'agents');
  const hit = findFileRecursive(agentsDir, basename, 0);
  if (!hit) return null;
  try {
    return fs.readFileSync(hit, 'utf-8');
  } catch {
    return null;
  }
}

async function fetchGithubCandidate(
  fetchImpl: typeof fetch,
  ref: string,
  plugin: string,
  basename: string
): Promise<string | null> {
  const url = `${GITHUB_RAW_BASE}/${ref}/plugins/${plugin}/agents/${basename}`;
  try {
    const res = await fetchImpl(url);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/**
 * Rewrite the marketplace-plugin tool namespace to the canonical npm-track
 * one and record provenance right after the frontmatter block, so a reader
 * (or a future dedup pass) can tell a restored copy from a hand-authored
 * agent. Inserting after the closing `---` keeps frontmatter parseable.
 */
function adaptForNpmTrack(content: string, plugin: string, source: RestoreSource): string {
  const rewritten = content.split(PLUGIN_NAMESPACE_PREFIX).join(CANONICAL_NAMESPACE_PREFIX);
  const provenance =
    `<!-- restored by \`ruflo migrate fix --agents\` from plugins/${plugin} ` +
    `(canonical per ADR-128; source: ${source}); MCP namespace rewritten to the ` +
    `canonical claude-flow server key (#2206, #2985) -->`;
  const fmClose = rewritten.indexOf('\n---', rewritten.startsWith('---') ? 3 : 0);
  if (rewritten.startsWith('---') && fmClose !== -1) {
    const insertAt = rewritten.indexOf('\n', fmClose + 1);
    if (insertAt !== -1) {
      return rewritten.slice(0, insertAt + 1) + provenance + '\n' + rewritten.slice(insertAt + 1);
    }
  }
  return provenance + '\n' + rewritten;
}

async function resolveContent(
  cwd: string,
  homeDir: string,
  fetchImpl: typeof fetch,
  version: string | undefined,
  plugin: string,
  basename: string
): Promise<{ content: string; source: RestoreSource } | null> {
  const marketplaceRoot = path.join(homeDir, '.claude', 'plugins', 'marketplaces', 'ruflo');
  const fromMarketplace = readLocalCandidate(marketplaceRoot, plugin, basename);
  if (fromMarketplace !== null) return { content: fromMarketplace, source: 'marketplace-clone' };

  const fromCheckout = readLocalCandidate(cwd, plugin, basename);
  if (fromCheckout !== null) return { content: fromCheckout, source: 'repo-checkout' };

  if (version) {
    const fromTag = await fetchGithubCandidate(fetchImpl, `v${version}`, plugin, basename);
    if (fromTag !== null) return { content: fromTag, source: 'github-tag' };
  }
  const fromMain = await fetchGithubCandidate(fetchImpl, 'main', plugin, basename);
  if (fromMain !== null) return { content: fromMain, source: 'github-main' };

  return null;
}

/**
 * Restore each gap's agent file into <cwd>/.claude/agents/<category>/.
 * Never overwrites an existing file (detection already excludes present
 * basenames anywhere under .claude/agents/, but re-check defensively).
 */
export async function restoreRemovedAgents(
  cwd: string,
  gaps: RemovedAgentGap[],
  options: RestoreRemovedAgentsOptions = {}
): Promise<RestoreResult[]> {
  const homeDir = options.homeDir ?? os.homedir();
  const fetchImpl = options.fetchImpl ?? fetch;
  const version = options.version ?? getPackageVersion();
  const results: RestoreResult[] = [];

  for (const gap of gaps) {
    const category = RESTORE_CATEGORY[gap.agent] ?? 'core';
    const relPath = path.join('.claude', 'agents', category, gap.agent);
    const destPath = path.join(cwd, relPath);

    if (fs.existsSync(destPath)) {
      results.push({ agent: gap.agent, plugin: gap.plugin, status: 'skipped', path: relPath });
      continue;
    }

    const resolved = await resolveContent(cwd, homeDir, fetchImpl, version, gap.plugin, gap.agent);
    if (!resolved) {
      results.push({
        agent: gap.agent,
        plugin: gap.plugin,
        status: 'failed',
        error:
          'no local marketplace clone or repo checkout, and GitHub fetch failed ' +
          '(offline?) — install the owning plugin instead: ' +
          `/plugin install ${gap.plugin}@ruflo`,
      });
      continue;
    }

    const adapted = adaptForNpmTrack(resolved.content, gap.plugin, resolved.source);
    if (!options.dryRun) {
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.writeFileSync(destPath, adapted, 'utf-8');
    }
    results.push({
      agent: gap.agent,
      plugin: gap.plugin,
      status: 'restored',
      source: resolved.source,
      path: relPath,
    });
  }

  return results;
}
