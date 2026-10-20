/** Uncached memory-directory authority for an explicit project directory. */
import * as fs from 'fs';
import * as path from 'path';

export function resolveMemoryRoot(cwd: string): string {
  const envPath = process.env.CLAUDE_FLOW_MEMORY_PATH;
  if (envPath && envPath.trim().length > 0) return path.resolve(cwd, envPath);

  const configCandidates = [
    path.resolve(cwd, 'claude-flow.config.json'),
    path.resolve(cwd, '.claude-flow', 'config.json'),
  ];
  for (const configPath of configCandidates) {
    if (!fs.existsSync(configPath)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      const fromConfig: unknown = raw?.memory?.persistPath ?? raw?.memory?.path;
      if (typeof fromConfig === 'string' && fromConfig.trim().length > 0) {
        return path.resolve(cwd, fromConfig);
      }
    } catch {
      /* malformed config — fall through to default */
    }
  }
  return path.resolve(cwd, '.swarm');
}
