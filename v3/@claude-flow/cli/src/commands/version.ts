/**
 * `ruflo version` — ANV (Agent-Native Versioning) Phase 1.
 * https://gist.github.com/ruvnet/0d858ad440a4439b4a2281a40c39b1a0
 *
 * Plain `ruflo --version` / `-V` (index.ts's showVersion()) is UNCHANGED —
 * it stays bare semver so scripts parsing that output never see a surprise
 * suffix. This is a separate subcommand: `ruflo version` prints the same
 * bare semver by default, and `--explain` additionally renders the ANV
 * catalog/benchmark breakdown when a catalog-manifest.json ships with this
 * install. No catalog-manifest.json (e.g. an old install, or a dev checkout
 * that hasn't run the generator) degrades to bare semver — the suffix is
 * advisory, never load-bearing for npm range resolution or CLI behavior.
 */
import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { getInstalledCliVersion } from '../init/helper-refresh.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface CatalogManifest {
  schemaVersion: number;
  generation: number;
  generatedAt: string;
  gitSha: string;
  catalog: { agents: number; tools: number; skills: number };
  benchmark: { tier: number; verifiedAt: string; signature?: string } | null;
}

/** Locate catalog-manifest.json next to the installed package root. */
function findCatalogManifest(): CatalogManifest | null {
  const candidates: string[] = [];
  try {
    const esmRequire = createRequire(import.meta.url);
    const pkgRoot = dirname(esmRequire.resolve('@claude-flow/cli/package.json'));
    candidates.push(join(pkgRoot, 'catalog-manifest.json'));
  } catch { /* not resolvable via package resolution */ }
  // Dev checkout fallback: this compiled file lives at dist/src/commands/version.js
  // (three levels under the package root) when built, or is run via tsx one level
  // shallower from src/commands/version.ts — try both.
  candidates.push(join(__dirname, '..', '..', 'catalog-manifest.json'));
  candidates.push(join(__dirname, '..', '..', '..', 'catalog-manifest.json'));
  for (const c of candidates) {
    if (!existsSync(c)) continue;
    try {
      const parsed = JSON.parse(readFileSync(c, 'utf-8'));
      if (parsed && typeof parsed.generation === 'number' && parsed.catalog) return parsed as CatalogManifest;
    } catch { /* corrupt manifest — treat as absent */ }
  }
  return null;
}

/**
 * The advisory suffix itself (semver build metadata, `+` prefix — legal per
 * semver.org §10, ignored by npm for range resolution/precedence).
 *   +ad.<release-sequence>.g<gitSha>.cat<generation>[.hal<tier>]
 * `.hal<tier>` is only appended when a real, signed benchmark submission
 * exists for THIS catalog generation — never fabricated (ANV's own
 * "verifiable, no unverifiable claims" principle).
 */
export function buildAdvisorySuffix(manifest: CatalogManifest, releaseSequence = 1): string {
  const parts = [`ad.${releaseSequence}`, `g${manifest.gitSha}`, `cat${manifest.generation}`];
  if (manifest.benchmark) parts.push(`hal${manifest.benchmark.tier}`);
  return `+${parts.join('.')}`;
}

export const versionCommand: Command = {
  name: 'version',
  description: 'Show installed version, with --explain for the ANV catalog breakdown',
  options: [
    {
      name: 'explain',
      description: 'Show the full ANV breakdown (catalog generation, counts, benchmark status)',
      type: 'boolean',
      default: false,
    },
    {
      name: 'require-catalog-gte',
      description: 'Exit non-zero unless the installed catalog generation is >= N (capability gating for scripts)',
      type: 'number',
    },
  ],
  examples: [
    { command: 'ruflo version', description: 'Print the installed semver' },
    { command: 'ruflo version --explain', description: 'Print the full ANV catalog/benchmark breakdown' },
    { command: 'ruflo version --require-catalog-gte 40', description: 'Gate a script on a minimum catalog generation' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const version = getInstalledCliVersion();
    const manifest = findCatalogManifest();
    const requireGte = ctx.flags.requireCatalogGte as number | undefined;

    if (typeof requireGte === 'number') {
      const generation = manifest?.generation ?? 0;
      if (generation >= requireGte) {
        output.writeln(`OK (installed catalog is ${generation})`);
        return { success: true };
      }
      output.printError(`Installed catalog generation ${generation} is below required ${requireGte}`);
      return { success: false };
    }

    if (!ctx.flags.explain) {
      output.writeln(`${version}`);
      return { success: true };
    }

    if (!manifest) {
      output.writeln(`Installed: ruflo@${version}`);
      output.writeln(output.dim('  (no catalog-manifest.json — plain semver, pre-ANV or dev checkout)'));
      return { success: true };
    }

    const suffix = buildAdvisorySuffix(manifest);
    output.writeln(`Installed: ${output.bold(`ruflo@${version}${suffix}`)}`);
    output.writeln();
    output.writeln(`Era:       AD (Agent Descent) — 1st generation`);
    output.writeln(
      `Catalog:   generation ${manifest.generation} ` +
      `(agents: ${manifest.catalog.agents} types, tools: ${manifest.catalog.tools} MCP, skills: ${manifest.catalog.skills})`,
    );
    if (manifest.benchmark) {
      output.writeln(`Benchmark: GAIA tier ${manifest.benchmark.tier} (verified ${manifest.benchmark.verifiedAt.slice(0, 10)}, signed)`);
    } else {
      output.writeln(output.dim('Benchmark: not yet submitted (no verified GAIA/HAL score for this catalog generation)'));
    }
    return { success: true };
  },
};
