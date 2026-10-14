import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { getLearningLoadError, tryLoadLearning } from '../src/autopilot-state.js';

const require_ = createRequire(import.meta.url);
const hasAgenticFlow = (() => { try { require_.resolve('agentic-flow'); return true; } catch (e) { return (e as NodeJS.ErrnoException).code !== 'MODULE_NOT_FOUND'; } })();

describe('autopilot learning loads past the agentic-flow exports map (#4146)', () => {
  it('the bare subpath really is blocked (the bug precondition)', () => {
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', "import('agentic-flow/dist/coordination/autopilot-learning.js').catch(e => console.log(e.code))"], { cwd: process.cwd(), encoding: 'utf8' });
    // The subpath is blocked by the exports map (ERR_PACKAGE_PATH_NOT_EXPORTED) where agentic-flow ships the
    // file, and simply absent (ERR_MODULE_NOT_FOUND) in an install that does not: either way the bare import fails.
    expect(['ERR_PACKAGE_PATH_NOT_EXPORTED', 'ERR_MODULE_NOT_FOUND']).toContain(r.stdout.trim());
  });

  it('tryLoadLearning no longer fails with ERR_PACKAGE_PATH_NOT_EXPORTED', async () => {
    const learning = await tryLoadLearning();
    const err = getLearningLoadError();
    expect(err ?? '').not.toMatch(/ERR_PACKAGE_PATH_NOT_EXPORTED|not defined by "exports"/);
    // Either it loaded, or it failed for the real reason (AgentDB init) and says so.
    if (!learning) expect(err).toMatch(/AgentDB|initialize|autopilot/i);
    else expect(getLearningLoadError()).toBeNull();
  });

  // agentic-flow is an optional install; where it is absent there is no exported entry to check.
  it.skipIf(!hasAgenticFlow)('agentic-flow resolves through its exported entry (what the loader relies on)', () => {
    expect(() => require_.resolve('agentic-flow')).not.toThrow();
  });
});
