/**
 * #3513 review MINOR 1: `recordTrust` wrote `~/.claude-flow/trusted-team-hosts.json`
 * (read-modify-write, temp file + rename) with no lock at all. Reproduced: 12
 * parallel `trust-host` calls left only 9-11 records where 12 were expected,
 * and a concurrent `--revoke` "came back to life" (clobbered by a racing
 * write) in 2 of 3 runs.
 *
 * A single Node process cannot reproduce this — `recordTrust` is fully
 * synchronous, so calls made from one process via `Promise.all` execute one
 * after another with no interleaving possible, regardless of locking. This
 * test spawns real, separate `node` processes against the BUILT dist (same
 * pattern as `adr-390-router-embedder.test.ts`) so the writes are genuinely
 * concurrent at the OS level, and skips when dist has not been built yet.
 */
import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const distTrust = join(dirname(fileURLToPath(import.meta.url)), '../dist/src/mcp-tools/team-hosts/trust.js');

interface TrustEntry {
  projectRoot: string;
  label: string;
  sha256: string;
  allowUnsafeCommand: boolean;
  trustedAt: string;
}

function cfgFor(label: string) {
  return { kind: 'exec', command: `agentcmd-${label}`, args: ['{prompt}'], promptVia: 'arg', passEnv: [], isolation: 'none' };
}

/** Runs one `recordTrust` (or revoke) call in a fresh `node` process against the built dist. */
function runRecordTrust(cwd: string, trustFile: string, label: string, opts: { revoke?: boolean } = {}): Promise<void> {
  const script = `
    import(${JSON.stringify(pathToFileURL(distTrust).href)}).then((m) => {
      m.recordTrust(${JSON.stringify(cwd)}, ${JSON.stringify(label)}, ${JSON.stringify(cfgFor(label))}, ${JSON.stringify(opts)});
      process.exit(0);
    }).catch((err) => { console.error(err); process.exit(1); });
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...process.env, RUFLO_TEAM_TRUST_FILE: trustFile },
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`recordTrust child for "${label}" exited ${code}`))));
  });
}

describe.skipIf(!existsSync(distTrust))('trust-file concurrent writes are lock-serialized (#3513 MINOR 1)', () => {
  it('12 parallel trust-host processes each leave their own record, and a racing revoke is not clobbered', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ruflo-trust-lock-'));
    const trustFile = join(cwd, 'trust.json');
    try {
      // Seed one pre-existing trusted label that a concurrent process will revoke.
      await runRecordTrust(cwd, trustFile, 'victim');
      expect((JSON.parse(readFileSync(trustFile, 'utf-8')).entries as TrustEntry[]).map((e) => e.label)).toEqual(['victim']);

      // 11 concurrent new trusts + 1 concurrent revoke of "victim" — 12 real
      // OS processes racing on the same file, same shape as the review's repro.
      const labels = Array.from({ length: 11 }, (_, i) => `agent${i}`);
      await Promise.all([
        ...labels.map((l) => runRecordTrust(cwd, trustFile, l)),
        runRecordTrust(cwd, trustFile, 'victim', { revoke: true }),
      ]);

      const doc = JSON.parse(readFileSync(trustFile, 'utf-8')) as { entries: TrustEntry[] };
      const seenLabels = doc.entries.map((e) => e.label).sort();
      // Every concurrent trust survived (no records lost to a racing write) …
      expect(seenLabels).toEqual([...labels].sort());
      // … and the concurrent revoke was not clobbered back into existence.
      expect(seenLabels).not.toContain('victim');
      expect(doc.entries).toHaveLength(11);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 30_000);
});
