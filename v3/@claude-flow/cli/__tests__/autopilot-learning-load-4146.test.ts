import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { getLearningLoadError, tryLoadLearning } from '../src/autopilot-state.js';

describe('autopilot learning loads past the agentic-flow exports map (#4146)', () => {
  it('the bare subpath really is blocked (the bug precondition)', () => {
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', "import('agentic-flow/dist/coordination/autopilot-learning.js').catch(e => console.log(e.code))"], { cwd: process.cwd(), encoding: 'utf8' });
    expect(r.stdout.trim()).toBe('ERR_PACKAGE_PATH_NOT_EXPORTED');
  });

  it('tryLoadLearning no longer fails with ERR_PACKAGE_PATH_NOT_EXPORTED', async () => {
    const learning = await tryLoadLearning();
    const err = getLearningLoadError();
    expect(err ?? '').not.toMatch(/ERR_PACKAGE_PATH_NOT_EXPORTED|not defined by "exports"/);
    // Either it loaded, or it failed for the real reason (AgentDB init) and says so.
    if (!learning) expect(err).toMatch(/AgentDB|initialize|autopilot/i);
    else expect(getLearningLoadError()).toBeNull();
  });

  it('agentic-flow resolves through its exported entry (what the loader relies on)', () => {
    expect(() => createRequire(import.meta.url).resolve('agentic-flow')).not.toThrow();
  });
});
