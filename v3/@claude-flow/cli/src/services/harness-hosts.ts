/**
 * Host registry + hierarchical layers (ADR-176 phase 7).
 *
 * "All available hosts": a small registry (claude-code, codex, extensible) that
 * the optimize+verify+canary pass fans out across, so a champion is proven
 * per-host rather than via an unvalidated `--host` passthrough.
 *
 * Hierarchical evolution: repository-specific optima emerge, so evolution is
 * layered — global → language → framework → repo — each layer inheriting upward
 * but independently benchmarked. An install adopts the most-specific champion
 * whose layer is an ancestor-or-equal of its own. Zero deps, $0.
 */
import { execFileSync } from 'child_process';

// ── Host registry ───────────────────────────────────────────────────────────

export interface HostAdapter {
  id: string;    // 'claude-code' | 'codex'
  label: string;
  /** True when this host is usable in the current environment. */
  detect: () => boolean;
}

export class HostRegistry {
  private hosts = new Map<string, HostAdapter>();
  register(a: HostAdapter): this { this.hosts.set(a.id, a); return this; }
  get(id: string): HostAdapter | undefined { return this.hosts.get(id); }
  all(): HostAdapter[] { return [...this.hosts.values()]; }
  /** Hosts present in this environment (detect() true, swallowing errors). */
  available(): HostAdapter[] {
    return this.all().filter(h => { try { return h.detect(); } catch { return false; } });
  }
}

/** True if `bin --version` runs. Used by the built-in adapters' detect(). */
export function commandExists(bin: string): boolean {
  try { execFileSync(bin, ['--version'], { stdio: 'ignore', timeout: 3000 }); return true; }
  catch { return false; }
}

/** The built-in hosts. Detection is injectable per-adapter for tests. */
export function defaultHostRegistry(): HostRegistry {
  return new HostRegistry()
    .register({ id: 'claude-code', label: 'Claude Code', detect: () => commandExists('claude') })
    .register({ id: 'codex', label: 'OpenAI Codex', detect: () => commandExists('codex') });
}

/** Run `fn` for each host (sequentially, isolated), collecting per-host results. */
export async function fanOutHosts<T>(
  hosts: HostAdapter[],
  fn: (h: HostAdapter) => Promise<T> | T,
): Promise<Array<{ host: string; result: T | null; error?: string }>> {
  const out: Array<{ host: string; result: T | null; error?: string }> = [];
  for (const h of hosts) {
    try { out.push({ host: h.id, result: await fn(h) }); }
    catch (e) { out.push({ host: h.id, result: null, error: (e as Error)?.message ?? String(e) }); }
  }
  return out;
}

// ── Hierarchical layers ─────────────────────────────────────────────────────

export const LAYER_LEVELS = ['global', 'language', 'framework', 'repo'] as const;

/** All ancestor prefixes of a layer path, shallowest first. */
export function ancestorsOf(layer: string): string[] {
  const parts = layer.split('/').filter(Boolean);
  const out: string[] = [];
  for (let i = 1; i <= parts.length; i++) out.push(parts.slice(0, i).join('/'));
  return out;
}

/** True if `a` is an ancestor of (or equal to) `b` at a path boundary. */
export function isAncestorOrEqual(a: string, b: string): boolean {
  return a === b || b.startsWith(a + '/');
}

export function layerDepth(layer: string): number {
  return layer.split('/').filter(Boolean).length;
}

/**
 * Pick the most-specific champion applicable to an install's layer: the deepest
 * manifest whose layer is an ancestor-or-equal of `installLayer`. Layers the
 * install can't clear fall back to the parent (return the next-deepest). Null if
 * none applies.
 */
export function selectChampionForLayer<M extends { layer?: string }>(
  manifests: M[],
  installLayer: string,
): M | null {
  const applicable = manifests.filter(m => !!m.layer && isAncestorOrEqual(m.layer, installLayer));
  if (applicable.length === 0) return null;
  applicable.sort((x, y) => layerDepth(y.layer as string) - layerDepth(x.layer as string));
  return applicable[0];
}
