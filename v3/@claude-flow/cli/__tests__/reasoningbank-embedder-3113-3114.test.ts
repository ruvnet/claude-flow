/**
 * Regressions for #3113 and #3114: the agentic-flow ReasoningBank embedder
 * loaded but was never used.
 *
 * #3113: the loader registered it as `{ embed: computeEmbedding }`, but
 * generateLocalEmbedding() only calls the model when it is a function, so
 * every store took the hash fallback (`model: 'hash-fallback'`). It also
 * advertised 768 dimensions for a 384-dim model.
 *
 * #3114: computeEmbedding() resolves to a Float32Array, which has no `.data`
 * and fails Array.isArray(), so even a callable model's output was discarded.
 * A DataView is also an ArrayBuffer view but has no iterator (Array.from is
 * []), so it must keep falling back instead of returning an empty vector.
 *
 * The vitest config externalizes `agentic-flow*`, so vi.mock cannot replace
 * it; like agentic-flow-root-import.test.ts, the source runs in a child
 * process under tsx with the agentic-flow-root-probe loader hooks, which make
 * every embedder ahead of ReasoningBank unavailable.
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const CLI = resolve(__dirname, '..');
const PROBE = join(__dirname, 'fixtures', 'agentic-flow-root-probe', 'register.mjs');
const INIT = JSON.stringify(pathToFileURL(join(CLI, 'src', 'memory', 'memory-initializer.ts')).href);

function runProbe(mode: 'float32' | 'dataview') {
  const script = `
    const init = await import(${INIT});
    const loaded = await init.loadEmbeddingModel();
    const out = await init.generateLocalEmbedding('hello world');
    console.log('RESULT=' + JSON.stringify({ loaded, model: out.model, backend: out.backend, dimensions: out.dimensions, head: out.embedding.slice(0, 3), length: out.embedding.length }));
  `;
  const child = spawnSync(process.execPath, ['--import', 'tsx', '--import', pathToFileURL(PROBE).href, '--input-type=module', '-e', script], {
    cwd: CLI,
    env: { ...process.env, CLAUDE_FLOW_DISABLE_BRIDGE: '1', RUFLO_REQUIRE_REAL_EMBEDDINGS: '', PROBE_REASONINGBANK: mode },
    encoding: 'utf8',
    timeout: 120_000,
  });
  const line = child.stdout.split('\n').find((l) => l.startsWith('RESULT='));
  return { result: line ? JSON.parse(line.slice('RESULT='.length)) : null, stderr: child.stderr };
}

// Same deterministic vector the fixture returns.
function expectedHead(text: string): number[] {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return [0, 1, 2].map((i) => Math.fround(Math.sin(h + i * 7) + 1.5));
}

describe('ReasoningBank embedder is used by generateLocalEmbedding (#3113, #3114)', () => {
  it('uses the Float32Array embedding as a real 384-d vector instead of the hash fallback', () => {
    const { result, stderr } = runProbe('float32');
    expect(result).not.toBeNull();
    // #3113: the model is registered with its real dimensions.
    expect(result.loaded).toMatchObject({ success: true, modelName: 'agentic-flow/reasoningbank', dimensions: 384 });
    // Pre-fix: computeEmbedding was never called and the result was model 'hash-fallback'.
    expect(stderr).toContain('REASONINGBANK_EMBED hello world');
    expect(result).toMatchObject({ model: 'onnx', backend: 'onnx', dimensions: 384, length: 384 });
    expect(result.head).toEqual(expectedHead('hello world'));
  }, 150_000);

  it('still falls back to the hash embedding for a DataView result (no empty "real" vector)', () => {
    const { result } = runProbe('dataview');
    expect(result).not.toBeNull();
    expect(result).toMatchObject({ model: 'hash-fallback', backend: 'mock' });
    expect(result.length).toBeGreaterThan(0);
  }, 150_000);
});
