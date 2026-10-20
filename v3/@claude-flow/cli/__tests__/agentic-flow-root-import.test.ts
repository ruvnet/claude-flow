/**
 * Never import the agentic-flow root entry.
 *
 * agentic-flow 3.0.0-alpha.1/.2 call their CLI `main()` at the bottom of
 * dist/index.js, so `import('agentic-flow')` parses *our* process.argv and,
 * with no agentic-flow flag in it, runs its demo agents (with whatever model
 * credentials the environment has) and starts a health server on :8080. Only
 * library subpaths (`agentic-flow/reasoningbank`, `/router`, ...) are safe.
 *
 * The vitest config externalizes `agentic-flow*`, so vi.mock cannot observe
 * these imports; the source runs in a child process under tsx with loader
 * hooks that swap in a fake root entry which only reports its evaluation.
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const CLI = resolve(__dirname, '..');
const PROBE = join(__dirname, 'fixtures', 'agentic-flow-root-probe', 'register.mjs');
const ROOT_EVALUATED = 'AGENTIC_FLOW_ROOT_EVALUATED';

function runProbe(script: string, env: Record<string, string> = {}) {
  const child = spawnSync(process.execPath, ['--import', 'tsx', '--import', pathToFileURL(PROBE).href, '--input-type=module', '-e', script], {
    cwd: CLI,
    env: { ...process.env, ...env, CLAUDE_FLOW_DISABLE_BRIDGE: '1' },
    encoding: 'utf8',
    timeout: 120_000,
  });
  return { status: child.status, stdout: child.stdout, stderr: child.stderr };
}

const srcUrl = (path: string): string => pathToFileURL(join(CLI, 'src', path)).href;

describe('agentic-flow root entry is never imported', () => {
  it('local embedding chain reaches the hash fallback without it', () => {
    const run = runProbe(`
      const { generateLocalEmbedding } = await import(${JSON.stringify(srcUrl('memory/memory-initializer.ts'))});
      const result = await generateLocalEmbedding('probe');
      console.log('MODEL=' + result.model);
    `);

    expect(run.stdout).toContain('MODEL=hash-fallback');
    expect(run.stderr).not.toContain(ROOT_EVALUATED);
  }, 150_000);

  it('hooks token-optimize does not fall back to it when reasoningbank is missing', () => {
    const run = runProbe(`
      const { hooksCommand } = await import(${JSON.stringify(srcUrl('commands/hooks.ts'))});
      const command = hooksCommand.subcommands.find((c) => c.name === 'token-optimize');
      const result = await command.action({ args: [], flags: { agents: '6' } });
      console.log('AVAILABLE=' + result.data.stats.agenticFlowAvailable);
      process.exit(0);
    `, { PROBE_REASONINGBANK: 'throw' });

    expect(run.stdout).toContain('AVAILABLE=false');
    expect(run.stderr).not.toContain(ROOT_EVALUATED);
  }, 150_000);

  it('no v3 source file imports the root entry', () => {
    const v3 = resolve(CLI, '../..');
    const rootImport = /(?:import\s*\(|require\s*\(|from\s+|safeImport<[^>]*>\s*\()\s*['"`]agentic-flow['"`]/;
    // A specifier held in a variable (`const p = 'agentic-flow'; import(p)`) evades the pattern above.
    const rootSpecifierVar = /(?:const|let|var)\s+\w+\s*=\s*['"`]agentic-flow['"`]/;
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name === 'dist' || name === '__tests__' || name.startsWith('.')) continue;
        const path = join(dir, name);
        if (statSync(path).isDirectory()) { walk(path); continue; }
        if (!/\.(ts|mts|cts|js|mjs|cjs)$/.test(name) || /\.test\.|\.spec\./.test(name)) continue;
        readFileSync(path, 'utf8').split('\n').forEach((line, i) => {
          const code = line.replace(/\/\/.*$/, '');
          if (rootImport.test(code) || rootSpecifierVar.test(code)) offenders.push(`${relative(v3, path)}:${i + 1}`);
        });
      }
    };
    walk(v3);

    expect(offenders).toEqual([]);
  });
});
