/**
 * Where the CLI may load executable plugin code from: its OWN install only.
 *
 * Several callers walk up from their own module location to find a bundled
 * plugin directory (`plugins/ruflo-*`) whose scripts they then import or spawn.
 * A project-local install lives at `<project>/node_modules/@claude-flow/cli/...`,
 * so an unbounded walk-up leaves the package, crosses `node_modules`, and lands in
 * `<project>` itself, where `<project>/plugins/ruflo-*` is whatever the opened
 * repository ships. The walk must therefore stop at the `node_modules` boundary:
 * everything above it belongs to whoever installed the package (a project, a
 * global prefix, an npx cache), not to the package.
 */
import { basename, dirname, join, resolve } from 'node:path';

/**
 * Directories from `startDir` upward that still belong to the package's own
 * install: `startDir` and its ancestors, up to but excluding the first
 * `node_modules` directory. In a source checkout (no `node_modules` between the
 * module and the repo root) this reaches the repo root, as monorepo dev needs.
 */
export function ownInstallAncestors(startDir: string, maxDepth = 8): string[] {
  const dirs: string[] = [];
  let p = resolve(startDir);
  for (let i = 0; i < maxDepth; i++) {
    if (basename(p) === 'node_modules') break;
    dirs.push(p);
    const parent = dirname(p);
    if (parent === p) break;
    p = parent;
  }
  return dirs;
}

/**
 * Candidate `<ancestor>/plugins/<plugin>/<...sub>` directories inside the
 * package's own install (see {@link ownInstallAncestors}). The `<ancestor>/../plugins`
 * form (the sibling of a package root) is only produced when that sibling is itself
 * still inside the own-install boundary.
 */
export function ownPluginDirs(startDir: string, plugin: string, ...sub: string[]): string[] {
  const ancestors = ownInstallAncestors(startDir);
  const inside = new Set(ancestors);
  const out: string[] = [];
  for (const p of ancestors) {
    out.push(join(p, 'plugins', plugin, ...sub));
    if (inside.has(dirname(p))) out.push(join(p, '..', 'plugins', plugin, ...sub));
  }
  return out;
}
