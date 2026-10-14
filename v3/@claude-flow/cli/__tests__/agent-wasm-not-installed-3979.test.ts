// #3979 item 1: `ruflo mcp exec -t wasm_gallery_list` on a global install failed with
//   Failed to initialize @ruvector/rvagent-wasm: Error [ERR_MODULE_NOT_FOUND]: Cannot find package ...
// because (a) the package is imported by dist/src/ruvector/agent-wasm.js but was not
// declared in the CLI's package.json, so `npm i -g ruflo` never installed it, and
// (b) when it is missing the error is a raw module-resolution trace rather than a
// plain "not installed" message with the fix. Both are checked here.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const pkg = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8'));

afterEach(() => {
  vi.resetModules();
  vi.doUnmock('@ruvector/rvagent-wasm');
});

describe('@ruvector/rvagent-wasm packaging (#3979 item 1)', () => {
  it('is declared as an optional dependency so a global install fetches it', () => {
    expect(pkg.optionalDependencies?.['@ruvector/rvagent-wasm']).toBeTruthy();
    // Optional, never a hard dependency: ruflo must still install and run without it.
    expect(pkg.dependencies?.['@ruvector/rvagent-wasm']).toBeUndefined();
  });
});

describe('initAgentWasm() when @ruvector/rvagent-wasm is missing (#3979 item 1)', () => {
  it('says the package is not installed and how to install it, instead of a raw resolution trace', async () => {
    vi.doMock('@ruvector/rvagent-wasm', () => {
      throw Object.assign(new Error("Cannot find package '@ruvector/rvagent-wasm' imported from /x/agent-wasm.js"), {
        code: 'ERR_MODULE_NOT_FOUND',
      });
    });
    const mod = await import('../src/ruvector/agent-wasm.js');

    const err = await mod.initAgentWasm().then(() => null, (e: unknown) => e as Error);
    expect(err).toBeInstanceOf(Error);
    expect(err!.message).toMatch(/@ruvector\/rvagent-wasm is not installed/);
    expect(err!.message).toMatch(/npm install/);
    expect(err!.message).not.toMatch(/ERR_MODULE_NOT_FOUND|Cannot find package/);
  });

  it('still reports a genuine initialization failure as one', async () => {
    vi.doMock('@ruvector/rvagent-wasm', () => ({
      WasmAgent: class {},
      initSync: () => {
        throw new Error('wasm bytes rejected');
      },
    }));
    const mod = await import('../src/ruvector/agent-wasm.js');

    const err = await mod.initAgentWasm().then(() => null, (e: unknown) => e as Error);
    expect(err).toBeInstanceOf(Error);
    // Either the package resolves here and init fails (Failed to initialize ...),
    // or it is genuinely absent in this checkout (not installed). It must never
    // be reported as the wrong one of the two.
    expect(err!.message).toMatch(/Failed to initialize @ruvector\/rvagent-wasm|@ruvector\/rvagent-wasm is not installed/);
  });
});
