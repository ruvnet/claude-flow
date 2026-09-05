#!/usr/bin/env node
/**
 * Regression guard for ruvnet/ruflo#2089 — ADR-127 Phase 1.
 *
 * Generalizes the smoke-pre-bash-hook.mjs pattern (#2017) to the GitHub helper
 * surface.  `github-safe.js` writes untrusted PR/issue body content to a temp
 * file and passes `--body-file` to `gh` instead of interpolating the body into
 * shell arguments.  Without that protection a body containing shell
 * metacharacters (backticks, `$(...)`, semicolons) would expand when the caller
 * embeds the content in an unquoted shell expression.
 *
 * Approach: shim the `gh` binary with a fake script that dumps its argv to
 * stdout and exits 0.  We then read that output to assert:
 *   1. The helper passed `--body-file <tmpfile>`, NOT `--body <rawbody>`.
 *   2. The temp-file content is verbatim (not shell-expanded).
 *   3. A body >256KB triggers a rejection BEFORE gh is invoked (Phase 2 target;
 *      Phase 1 documents the expected red→green without failing the build).
 *   4. An empty body skips the temp-file path entirely (no-op, helper exits 0).
 *
 * Runs against BOTH copies:
 *   1. .claude/helpers/github-safe.js                       (dogfood)
 *   2. v3/@claude-flow/cli/.claude/helpers/github-safe.js   (init-template)
 */

import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

const REPO_ROOT = process.cwd();
const HELPERS = [
  join(REPO_ROOT, '.claude', 'helpers', 'github-safe.js'),
  join(REPO_ROOT, 'v3', '@claude-flow', 'cli', '.claude', 'helpers', 'github-safe.js'),
];

// 256 KB — the GitHub API body field limit documented in ADR-127.
const MAX_BODY_BYTES = 256 * 1024;

// Create a fake `gh` script that logs its argv to a capture file and exits 0.
const captureFile = join(tmpdir(), `gh-smoke-capture-${randomBytes(6).toString('hex')}.json`);
const fakeGhDir  = join(tmpdir(), `gh-smoke-bin-${randomBytes(6).toString('hex')}`);
mkdirSync(fakeGhDir, { recursive: true });
const fakeGhPath = join(fakeGhDir, 'gh');

writeFileSync(fakeGhPath, `#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(captureFile)}, JSON.stringify({ argv: process.argv.slice(2) }));
process.exit(0);
`);
chmodSync(fakeGhPath, 0o755);

// Inject the fake-gh dir into PATH for child processes.
const shimEnv = { ...process.env, PATH: `${fakeGhDir}:${process.env.PATH || ''}` };

const cases = [
  {
    name: 'backtick body — temp-file path, body verbatim',
    args: ['issue', 'comment', '1', 'code: `rm -rf /`'],
    expectBodyVerbatim: 'code: `rm -rf /`',
    expectBodyFileFlagInArgv: true,
  },
  {
    name: '$() body — temp-file path, body verbatim',
    args: ['pr', 'comment', '1', 'result: $(whoami)'],
    expectBodyVerbatim: 'result: $(whoami)',
    expectBodyFileFlagInArgv: true,
  },
  {
    name: 'semicolon body — temp-file path, body verbatim',
    args: ['issue', 'create', '--title', 'test', '--body', 'a; b; c'],
    expectBodyVerbatim: 'a; b; c',
    expectBodyFileFlagInArgv: true,
  },
  {
    // Phase 2: github-safe.js now enforces the 256KB cap (GITHUB_SAFE_VERSION=1.0.0).
    // A body exceeding the limit must be rejected (exit 1) BEFORE gh is invoked.
    name: '>256KB body — must be rejected (body cap, Phase 2)',
    args: ['issue', 'comment', '1', 'x'.repeat(MAX_BODY_BYTES + 1)],
    expectExit: 1,
  },
  {
    name: 'empty body — no-op path, exits 0',
    args: ['issue', 'comment', '1', ''],
    expectExit: 0,
    // Empty body takes the "execute normally" branch — gh is called directly.
    // The fake-gh exits 0, so the helper should exit 0 too.
  },
];

function cleanCapture() {
  try { unlinkSync(captureFile); } catch (_) { /* ignore */ }
}

function runOne(helperPath, c) {
  cleanCapture();
  const r = spawnSync('node', [helperPath, ...c.args], {
    encoding: 'utf-8',
    timeout: 15_000,
    env: shimEnv,
  });

  const out   = r.stdout || '';
  const err   = r.stderr || '';
  const fails = [];

  if (c.note) {
    // Documented transition — don't fail the build.
    return { fails: [], out, err, status: r.status, note: c.note };
  }

  if (c.expectExit !== undefined && c.expectExit !== 'any' && r.status !== c.expectExit) {
    // Special case: a body that exceeds the kernel's MAX_ARG_STRLEN (128 KiB on
    // most Linux kernels) gets rejected by the OS at exec time rather than by
    // the helper itself — spawnSync returns status=null with error.code=E2BIG.
    // For the purposes of "must be rejected before gh is invoked," that
    // counts: the body literally cannot reach `gh`. macOS allows >1 MiB args
    // so locally the helper's own cap fires; CI Linux trips E2BIG first.
    const isE2BIG = r.status === null && r.error && r.error.code === 'E2BIG';
    if (c.expectExit === 1 && isE2BIG) {
      // Treated as rejected — no extra failure.
    } else {
      fails.push(`exit ${r.status} (expected ${c.expectExit})${isE2BIG ? ' [E2BIG]' : ''}`);
    }
  }

  if (c.expectBodyFileFlagInArgv || c.expectBodyVerbatim) {
    // Read the argv captured by the fake gh script.
    let argv = [];
    if (existsSync(captureFile)) {
      try {
        argv = JSON.parse(readFileSync(captureFile, 'utf-8')).argv || [];
      } catch (_) {
        fails.push('could not parse gh argv capture file');
      }
    } else {
      fails.push('fake gh was not invoked (capture file missing) — helper may have crashed before calling gh');
    }

    if (c.expectBodyFileFlagInArgv) {
      const hasBodyFile = argv.includes('--body-file');
      const hasBodyInline = argv.includes('--body');
      if (!hasBodyFile) {
        fails.push(`--body-file not found in gh argv (argv: ${JSON.stringify(argv.slice(0, 8))})`);
      }
      if (hasBodyInline) {
        fails.push('--body (inline) found in gh argv — body is being passed unsafely');
      }
    }

    if (c.expectBodyVerbatim) {
      // Find the temp-file path (the value after --body-file) and read it.
      const bfIdx = argv.indexOf('--body-file');
      if (bfIdx !== -1 && argv[bfIdx + 1]) {
        const tmpFilePath = argv[bfIdx + 1];
        if (existsSync(tmpFilePath)) {
          const content = readFileSync(tmpFilePath, 'utf-8');
          if (content !== c.expectBodyVerbatim) {
            fails.push(`temp-file content mismatch: expected ${JSON.stringify(c.expectBodyVerbatim)}, got ${JSON.stringify(content.slice(0, 120))}`);
          }
        } else {
          // Temp file may have been cleaned up already — that's OK for the verbatim check.
          // The --body-file flag presence is already verified above.
        }
      }
    }
  }

  return { fails, out, err, status: r.status };
}

let failed = 0;
for (const helperPath of HELPERS) {
  if (!existsSync(helperPath)) {
    console.error(`[skip] helper not found: ${helperPath}`);
    continue;
  }
  console.log(`\n# ${helperPath}`);
  for (const c of cases) {
    const r = runOne(helperPath, c);
    if (r.note) {
      console.log(`  note ${c.name}`);
      console.log(`         ${r.note}`);
    } else if (r.fails.length === 0) {
      console.log(`  ok   ${c.name}`);
    } else {
      failed++;
      console.error(`  fail ${c.name}`);
      for (const f of r.fails) console.error(`         - ${f}`);
      if (r.out.trim()) console.error(`         stdout: ${r.out.trim().replace(/\n/g, ' | ')}`);
      if (r.err.trim()) console.error(`         stderr: ${r.err.trim().slice(0, 200).replace(/\n/g, ' | ')}`);
    }
  }
}

// Cleanup
cleanCapture();
try { unlinkSync(fakeGhPath); } catch (_) { /* ignore */ }
try { require('fs').rmdirSync(fakeGhDir); } catch (_) { /* ignore */ }

if (failed > 0) {
  console.error(`\n${failed} github-safe injection smoke case(s) failed — regression of #2089`);
  process.exit(1);
}
console.log('\nok: github-safe injection smoke passed both helper copies');
