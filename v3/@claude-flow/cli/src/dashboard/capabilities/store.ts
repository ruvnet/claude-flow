/**
 * ruflo reads `claude-flow.config.json` from the project and a path in it can move its store (memory.db, session and workflow data) to ANY directory the user can
 * write. Collection only reads through that store; a write-class capability would change a store the project chose. Both are therefore told: the meta section carries
 * a note, and write-class runs are refused. The project must be trusted (docs/threat-model.md).
 */
import { isAbsolute, resolve, sep } from 'node:path';
import { realpathSync } from 'node:fs';
import { readRegular } from '../read.js';

const PATHISH = /path|dir|db|file|store|location|root/i;
/** Config values that point at a place outside `projectDir`, as "key.path" strings (never the values). */
export function projectStoreRedirects(projectDir: string): string[] {
  const f = readRegular(projectDir, 'claude-flow.config.json', 64 * 1024);
  if (!f) return [];
  let root: unknown; try { root = JSON.parse(f.text); } catch { return []; }
  let proj: string; try { proj = realpathSync(projectDir); } catch { proj = resolve(projectDir); }
  const out: string[] = [];
  const walk = (v: unknown, path: string, depth: number): void => {
    if (out.length >= 5 || depth > 5 || !v || typeof v !== 'object' || Array.isArray(v)) return;
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (typeof x === 'string' && PATHISH.test(k) && x.length > 0 && x.length < 1024 && /[\\/]|^\.\.?$/.test(x) || (typeof x === 'string' && PATHISH.test(k) && isAbsolute(x))) {
        const abs = resolve(proj, x as string);
        if (abs !== proj && !abs.startsWith(proj + sep)) out.push(`${path}${k}`.slice(0, 80));
      } else walk(x, `${path}${k}.`, depth + 1);
    }
  };
  walk(root, '', 0);
  return out;
}
