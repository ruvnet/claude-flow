// #3979 item 1: `ruflo mcp exec -t wasm_gallery_list` on a global install failed with
//   Failed to initialize @ruvector/rvagent-wasm: Error [ERR_MODULE_NOT_FOUND]: Cannot find package ...
// a raw module-resolution trace. It is now "not installed" with the fix. The package stays OPTIONAL
// and is deliberately NOT in the CLI's optionalDependencies (guard no-cli-optdep-bloat-2561).
// The mapping is tested directly (no module mocking), so it does not depend on the test runner's
// mock-factory error wrapping.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { agentWasmLoadError, isMissingAgentWasm, AGENT_WASM_NOT_INSTALLED_MESSAGE } from '../src/ruvector/agent-wasm.js';

const pkg = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8'));

describe('@ruvector/rvagent-wasm stays optional (#3979 item 1, #2561)', () => {
  it('is not a dependency or optionalDependency of the CLI (bloat guard)', () => {
    expect(pkg.dependencies?.['@ruvector/rvagent-wasm']).toBeUndefined();
    expect(pkg.optionalDependencies?.['@ruvector/rvagent-wasm']).toBeUndefined();
  });
});

describe('agentWasmLoadError() (#3979 item 1)', () => {
  const trace = "Cannot find package '@ruvector/rvagent-wasm' imported from /x/agent-wasm.js";

  it.each([
    ['ERR_MODULE_NOT_FOUND with a code', Object.assign(new Error(trace), { code: 'ERR_MODULE_NOT_FOUND' })],
    ['MODULE_NOT_FOUND (CJS) with a code', Object.assign(new Error("Cannot find module '@ruvector/rvagent-wasm'"), { code: 'MODULE_NOT_FOUND' })],
    ['a wrapper that dropped the code but kept the text', new Error(`[wrapper] ${trace}`)],
  ])('says the package is not installed and how to install it: %s', (_name, err) => {
    expect(isMissingAgentWasm(err)).toBe(true);
    const out = agentWasmLoadError(err);
    expect(out.message).toBe(AGENT_WASM_NOT_INSTALLED_MESSAGE);
    expect(out.message).toMatch(/@ruvector\/rvagent-wasm is not installed/);
    expect(out.message).toMatch(/npm install/);
    expect(out.message).not.toMatch(/ERR_MODULE_NOT_FOUND|Cannot find package/);
  });

  it('does not mistake a missing OTHER package for a missing rvagent-wasm', () => {
    const other = Object.assign(new Error("Cannot find package 'left-pad' imported from /x.js"), { code: 'ERR_MODULE_NOT_FOUND' });
    expect(isMissingAgentWasm(other)).toBe(false);
    expect(agentWasmLoadError(other).message).toMatch(/^Failed to initialize @ruvector\/rvagent-wasm: /);
  });

  it('still reports a genuine initialization failure as one', () => {
    const out = agentWasmLoadError(new Error('wasm bytes rejected'));
    expect(out.message).toMatch(/^Failed to initialize @ruvector\/rvagent-wasm: .*wasm bytes rejected/);
    expect(out.message).not.toMatch(/is not installed/);
  });
});
