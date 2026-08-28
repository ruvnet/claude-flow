/**
 * @claude-flow/codex - #2947 regression test
 *
 * DualModeOrchestrator spawned Codex workers with stdio: ['pipe', 'pipe', 'pipe']
 * but never wrote to or closed proc.stdin. The prompt is already passed
 * positionally, so `codex exec` (which blocks in resolve_root_prompt reading
 * stdin to EOF) hung forever until the orchestrator's own timeout killed it.
 *
 * This spawns a real child process standing in for `codex exec`: it does
 * nothing but wait for stdin EOF before exiting. Without the fix the worker
 * never receives EOF and the orchestrator's short configured timeout fires,
 * failing the worker. With the fix (`proc.stdin?.end()`), EOF arrives
 * immediately and the worker completes well under the timeout.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DualModeOrchestrator } from '../src/dual-mode/index.js';
import type { WorkerConfig } from '../src/dual-mode/index.js';

describe('DualModeOrchestrator #2947 — codex worker stdin EOF', () => {
  it('completes a worker that blocks waiting for stdin EOF, within a short timeout', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ruflo-2947-'));
    const fakeCodex = join(dir, 'fake-codex.mjs');
    // Stands in for `codex exec`: waits for stdin EOF, then prints and exits 0.
    // If stdin is never closed, this process hangs until killed.
    writeFileSync(
      fakeCodex,
      "#!/usr/bin/env node\nprocess.stdin.resume();\nprocess.stdin.on('end', () => { process.stdout.write('done'); process.exit(0); });\n",
    );
    chmodSync(fakeCodex, 0o755);

    const orchestrator = new DualModeOrchestrator({
      projectPath: dir,
      codexCommand: fakeCodex,
      timeout: 3000,
    });

    const worker: WorkerConfig = { id: 'w1', platform: 'codex', role: 'coder', prompt: 'irrelevant' };

    const events: string[] = [];
    orchestrator.on('worker:started', () => events.push('started'));
    orchestrator.on('worker:completed', () => events.push('completed'));
    orchestrator.on('worker:failed', () => events.push('failed'));

    const start = Date.now();
    await orchestrator.spawnWorker(worker);
    const elapsed = Date.now() - start;

    expect(events).toEqual(['started', 'completed']);
    // Should resolve almost instantly via EOF, nowhere near the 3s timeout.
    expect(elapsed).toBeLessThan(1500);

    rmSync(dir, { recursive: true, force: true });
  }, 5000);
});
