/**
 * Where the Grok host templates live (ADR-402).
 *
 * Kept apart from grok-generator.ts so the team_* MCP tools can find the team
 * bus scripts without loading the TOML parser on every MCP client import.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Root of the installed @claude-flow/cli package (the one holding templates/grok). */
export function grokPackageRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, '../../..'), // dist/src/init → package root
    path.resolve(here, '../..'), // src/init → package root
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'templates', 'grok', 'config.toml'))) {
      return c;
    }
  }
  return candidates[0];
}

/** templates/grok inside the installed @claude-flow/cli package. */
export function grokTemplatesRoot(): string {
  return path.join(grokPackageRoot(), 'templates', 'grok');
}
