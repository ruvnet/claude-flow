/**
 * `ruflo catalog` — ADR-406 P0/P1 command inventory and canonical catalog.
 *
 * Interim home: ADR-406 §14 places these under `ruflo mods catalog`, but
 * `commands/mods.ts` belongs to the install-fix lane (PR #3612) until it
 * merges. This file moves there as a follow-up; the operations stay the same.
 *
 *   catalog generate [--check]   inventory + engine probe + deterministic catalog
 *   catalog verify [--file]      schema, duplicate ids/names, digest parity
 *   catalog engine               engine capability report only
 *
 * Reads command files; writes only the catalog and engine report under
 * src/mods/command-registry/. Never touches a command file.
 */

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import {
  CATALOG_RELATIVE_PATH,
  ENGINE_REPORT_RELATIVE_PATH,
  generate,
  serializeCatalog,
  summarize,
  verifyCatalog,
  writeCatalog,
} from '../mods/command-registry/index.js';
import { canonicalJson, sha256Hex } from '../mods/command-registry/index.js';
import { writeFileSync } from 'node:fs';

function engineFrom(flags: Record<string, unknown>): string | null {
  const explicit = typeof flags.engine === 'string' ? flags.engine : undefined;
  const candidate = explicit ?? join(homedir(), '.local', 'bin', 'claude');
  return existsSync(candidate) ? candidate : null;
}

function finish(data: unknown, ok: boolean, json: boolean, text: string): CommandResult {
  if (json) output.writeln(JSON.stringify(data, null, 2));
  else output.writeln(text);
  return { success: ok, exitCode: ok ? 0 : 1, data };
}

export const catalogCommand: Command = {
  name: 'catalog',
  description: 'ADR-406 command inventory and canonical command catalog (generate, verify, engine report)',
  options: [
    { name: 'repo-root', type: 'string', description: 'Repository root (default: cwd)' },
    { name: 'engine', type: 'string', description: 'Claude Code executable to probe (default ~/.local/bin/claude)' },
    { name: 'check', type: 'boolean', description: 'generate: compare with the committed catalog instead of writing' },
    { name: 'file', type: 'string', description: 'verify: catalog file to verify' },
    { name: 'json', type: 'boolean', description: 'Machine-readable output' },
  ],
  examples: [
    { command: 'ruflo catalog generate', description: 'Regenerate the catalog and engine report' },
    { command: 'ruflo catalog generate --check', description: 'Fail if the committed catalog is stale' },
    { command: 'ruflo catalog verify --file catalog.generated.json', description: 'Verify a copied catalog (parity)' },
  ],
  async action(ctx: CommandContext): Promise<CommandResult> {
    const flags = ctx.flags as Record<string, unknown>;
    const op = ctx.args[0] ?? 'generate';
    const json = flags.json === true;
    const root = resolve(String(flags.repoRoot ?? ctx.cwd ?? process.cwd()));
    try {
      if (op === 'verify') {
        const file = resolve(String(flags.file ?? join(root, CATALOG_RELATIVE_PATH)));
        const result = verifyCatalog(JSON.parse(readFileSync(file, 'utf8')));
        return finish({ file, ...result }, result.valid, json,
          result.valid ? `catalog valid: ${file}` : `catalog INVALID:\n${result.errors.join('\n')}`);
      }
      if (op !== 'generate' && op !== 'engine') {
        return finish({ error: `unknown operation ${op}` }, false, json, `unknown operation: ${op} (generate | verify | engine)`);
      }
      const result = generate({ repoRoot: root, engineExecutable: engineFrom(flags) });
      if (op === 'engine') return finish(result.engine, true, json, JSON.stringify(result.engine, null, 2));
      const catalogPath = join(root, CATALOG_RELATIVE_PATH);
      const summary = summarize(result);
      if (flags.check === true) {
        const committed = existsSync(catalogPath) ? readFileSync(catalogPath, 'utf8') : '';
        const fresh = serializeCatalog(result.catalog);
        const same = committed === fresh;
        return finish({ catalogPath, upToDate: same, summary }, same, json,
          same ? 'catalog up to date' : `catalog is stale: run \`ruflo catalog generate\` (${catalogPath})`);
      }
      const previous = existsSync(catalogPath) ? sha256Hex(readFileSync(catalogPath)) : null;
      const write = writeCatalog(catalogPath, result.catalog, previous);
      // The engine report is host evidence (engine build, binary digest), kept
      // beside the catalog but outside its digest, which must stay host-free.
      writeFileSync(join(root, ENGINE_REPORT_RELATIVE_PATH), `${JSON.stringify(JSON.parse(canonicalJson(result.engine)), null, 2)}\n`);
      return finish({ catalogPath, written: write.written, sha256: write.sha256, summary }, true, json,
        `${write.written ? 'wrote' : 'unchanged'} ${catalogPath}\n${JSON.stringify(summary, null, 2)}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      output.printError(message);
      return { success: false, exitCode: 1, message };
    }
  },
};

export default catalogCommand;
