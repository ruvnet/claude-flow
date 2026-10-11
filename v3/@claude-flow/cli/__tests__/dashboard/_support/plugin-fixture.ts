/** A fake `~/.claude` with installed plugins, laid out the way Claude Code does (cache/<marketplace>/<plugin>/<version>). */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface FixturePlugin { name: string; marketplace?: string; version?: string; files?: Record<string, string>; userConfig?: Record<string, unknown>; enabled?: boolean }
export function writeFile(root: string, rel: string, text: string, mode = 0o600): void { const p = join(root, rel); mkdirSync(dirname(p), { recursive: true, mode: 0o700 }); writeFileSync(p, text, { mode }); }

/** Returns the install dir of each plugin by id. */
export function makeClaudeHome(home: string, plugins: FixturePlugin[]): Record<string, string> {
  const installed: Record<string, unknown[]> = {}; const enabled: Record<string, boolean> = {}; const dirs: Record<string, string> = {};
  for (const p of plugins) {
    const mk = p.marketplace ?? 'ruflo'; const version = p.version ?? '1.0.0'; const id = `${p.name}@${mk}`;
    const dir = join(home, '.claude/plugins/cache', mk, p.name, version); dirs[id] = dir;
    writeFile(dir, '.claude-plugin/plugin.json', JSON.stringify({ name: p.name, version, ...(p.userConfig ? { userConfig: p.userConfig } : {}) }));
    for (const [rel, text] of Object.entries(p.files ?? {})) writeFile(dir, rel, text);
    installed[id] = [{ scope: 'user', installPath: dir, version }];
    enabled[id] = p.enabled !== false;
  }
  writeFile(home, '.claude/plugins/installed_plugins.json', JSON.stringify({ version: 2, plugins: installed }));
  writeFile(home, '.claude/settings.json', JSON.stringify({ enabledPlugins: enabled }));
  return dirs;
}
