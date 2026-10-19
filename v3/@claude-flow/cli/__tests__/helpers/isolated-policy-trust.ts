import { afterAll, beforeEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const previous = process.env.XDG_CONFIG_HOME;
const config = mkdtempSync(join(tmpdir(), 'ruflo-policy-test-config-'));
// policyTrustRoot preserves an existing legacy root unless the preferred
// XDG root exists. Never fall back to the developer's account home.
mkdirSync(join(config, 'ruflo', 'policy-trust'), { recursive: true });
beforeEach(() => { process.env.XDG_CONFIG_HOME = config; });
afterAll(() => {
  if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = previous;
  rmSync(config, { recursive: true, force: true });
});
