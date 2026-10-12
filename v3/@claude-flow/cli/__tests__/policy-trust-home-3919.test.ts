import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, userInfo } from 'node:os';
import { createHash } from 'node:crypto';
import { evaluatePolicyRequest } from '../src/services/policy-runtime.js';
import { anchorPosture } from '../src/services/policy-ledger-anchor.js';

// #3919: the anchor mirror and trust key were resolved with userInfo().homedir,
// which ignores a throwaway HOME, so tests (and sandboxed runs) wrote into the
// developer's real ~/.config/ruflo/policy-trust and later failed closed there.

const saved = { HOME: process.env.HOME, XDG: process.env.XDG_CONFIG_HOME };
const dirs: string[] = [];
const scratch = (prefix: string) => {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
};
const projectId = (root: string) => createHash('sha256').update(realpathSync(root)).digest('hex');
const decide = (root: string) => evaluatePolicyRequest({
  identity: { id: 'agent:1', type: 'agent' },
  action: { type: 'code.read', resource: 'f' },
}, root);

beforeEach(() => { delete process.env.XDG_CONFIG_HOME; });
afterEach(() => {
  if (saved.HOME === undefined) delete process.env.HOME; else process.env.HOME = saved.HOME;
  if (saved.XDG === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = saved.XDG;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('policy trust files honour a throwaway HOME (#3919)', () => {
  it('writes the mirror and key under $HOME, never the account home', async () => {
    const home = scratch('ruflo-3919-home-');
    const root = scratch('ruflo-3919-proj-');
    mkdirSync(join(root, '.claude-flow'), { recursive: true });
    process.env.HOME = home;
    const real = join(userInfo().homedir, '.config', 'ruflo', 'policy-trust', projectId(root));
    try {
      await decide(root);
      expect(existsSync(join(home, '.config', 'ruflo', 'policy-trust', projectId(root), 'ledger-anchor-head.json'))).toBe(true);
      expect(anchorPosture(root).mirror).toBe(true);
      if (userInfo().homedir !== home) expect(existsSync(real)).toBe(false);
    } finally {
      rmSync(real, { recursive: true, force: true });
    }
  });

  it('honours XDG_CONFIG_HOME ahead of $HOME/.config', async () => {
    const home = scratch('ruflo-3919-home-');
    const xdg = scratch('ruflo-3919-xdg-');
    const root = scratch('ruflo-3919-proj-');
    mkdirSync(join(root, '.claude-flow'), { recursive: true });
    process.env.HOME = home;
    process.env.XDG_CONFIG_HOME = xdg;
    await decide(root);
    expect(existsSync(join(xdg, 'ruflo', 'policy-trust', projectId(root), 'ledger-anchor-head.json'))).toBe(true);
    expect(existsSync(join(home, '.config', 'ruflo', 'policy-trust'))).toBe(false);
  });

  it('keeps using the legacy ~/.config location for an XDG user who already has trust state there', async () => {
    const home = scratch('ruflo-3919-home-');
    const xdg = scratch('ruflo-3919-xdg-');
    const root = scratch('ruflo-3919-proj-');
    mkdirSync(join(root, '.claude-flow'), { recursive: true });
    mkdirSync(join(home, '.config', 'ruflo', 'policy-trust'), { recursive: true });
    process.env.HOME = home;
    process.env.XDG_CONFIG_HOME = xdg;
    await decide(root);
    expect(existsSync(join(home, '.config', 'ruflo', 'policy-trust', projectId(root), 'ledger-anchor-head.json'))).toBe(true);
    expect(existsSync(join(xdg, 'ruflo'))).toBe(false);
  });
});
