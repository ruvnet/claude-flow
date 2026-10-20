import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { createRequire } from 'node:module';

// CI provisions pinned YAML into its isolated tool prefix. CommonJS resolution
// honors the step-scoped NODE_PATH without installing into the source checkout.
const { parse } = createRequire(import.meta.url)('yaml');

const workflow = parse(readFileSync(new URL('../.github/workflows/all-plugins-smoke.yml', import.meta.url), 'utf8'));
const ownRunnerFiles = readFileSync(new URL('../scripts/ci-test-excluded.txt', import.meta.url), 'utf8')
  .split(/\r?\n/).filter(line => line && !line.startsWith('#'));
const job = workflow.jobs['smoke-all'];
const producers = job.steps.filter(step => step.run?.includes('node scripts/smoke-all-plugins.mjs'));

test('node:test regression is registered with its explicit CI runner', () => {
  assert.equal(ownRunnerFiles.filter(file => file === 'tests/all-plugins-smoke-workflow.test.mjs').length, 1);
  assert.equal(job.steps.filter(step => step.run?.includes('node --test tests/check-guard-tool-names.test.mjs tests/all-plugins-smoke-workflow.test.mjs')).length, 1);
});

test('smoke workflow runs one suite within the current deadline and always uploads its result', () => {
  const provision = job.steps.find(step => step.run?.includes('npm install --prefix'));
  assert.match(provision.run, /yaml@2\.8\.0\b/);
  const regression = job.steps.find(step => step.run?.includes('node --test tests/check-guard-tool-names.test.mjs'));
  assert.equal(regression.env.NODE_PATH, '${{ runner.temp }}/esbuild/node_modules');
  // 10 -> 15 in #3950: the job also checks out and smokes the first external (git-subdir) marketplace entry,
  // agentic-qe-fleet, which doesn't fit the original budget alongside every local plugin's smoke.sh.
  assert.equal(job['timeout-minutes'], 15);
  assert.equal(producers.length, 1);
  assert.equal(producers[0].shell, 'bash');
  assert.match(producers[0].run, /--timeout 300\b/);
  assert.match(producers[0].run, /--format json\b/);
  const upload = job.steps.find(step => step.uses?.startsWith('actions/upload-artifact@'));
  assert.equal(upload.if, 'always()');
  assert.equal(upload.with.path, '/tmp/smoke-all-plugins.json');
  assert.match(producers[0].run, /\| tee \/tmp\/smoke-all-plugins\.json$/);
});

for (const exitCode of [0, 1]) {
  test(`smoke pipeline preserves exit ${exitCode} and records the same single execution`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'smoke-workflow-'));
    try {
      mkdirSync(join(dir, 'scripts'));
      writeFileSync(join(dir, 'scripts/smoke-all-plugins.mjs'), `
        import { appendFileSync } from 'node:fs';
        appendFileSync('calls.txt', 'run\\n');
        console.log(JSON.stringify({ plugins: [], summary: { pluginsFailed: ${exitCode} } }));
        process.exit(${exitCode});
      `);
      const report = join(dir, 'report.json');
      // Exercise the workflow's actual command with only its absolute artifact
      // destination relocated. GitHub's explicit bash shell uses these flags.
      const command = producers[0].run.replace('/tmp/smoke-all-plugins.json', report);
      const result = spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', command], { cwd: dir, encoding: 'utf8' });
      assert.equal(result.status, exitCode, result.stderr);
      assert.equal(readFileSync(join(dir, 'calls.txt'), 'utf8'), 'run\n');
      assert.equal(JSON.parse(readFileSync(report, 'utf8')).summary.pluginsFailed, exitCode);
      assert.equal(result.stdout, readFileSync(report, 'utf8'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
