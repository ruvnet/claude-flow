#!/usr/bin/env node
/** Grok is the default host. The check itself is scripts/probe-host-live.mjs. */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const extra = process.argv.slice(2);
if (!extra.includes('--host')) extra.unshift('--host', 'grok');
const r = spawnSync(process.execPath, [join(here, 'probe-host-live.mjs'), ...extra], {
  stdio: 'inherit',
});
process.exit(r.status == null ? 1 : r.status);
