/**
 * #4159: `embeddings_hyperbolic distance` returned `{success:true, distance:null}`
 * for points on or outside the Poincaré ball (acosh of a NaN/negative argument,
 * which JSON.stringify turns into null), and `convert` was presented as if it
 * encoded hierarchy although it gives every unit-norm input the same radius.
 *
 * Numbers below were computed by hand, not copied from the implementation:
 *   d((0,0),(0.5,0)) = 2*atanh(0.5) = ln 3 = 1.0986122887
 *   convert(any unit vector), c=1 -> tanh(0.5) = 0.4621171572
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { embeddingsTools } from '../src/mcp-tools/embeddings-tools.js';

const tool = embeddingsTools.find((t) => t.name === 'embeddings_hyperbolic')!;
let prev: string;
let dir: string;

beforeEach(() => {
  prev = process.cwd();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hyp4159-'));
  fs.mkdirSync(path.join(dir, '.claude-flow'));
  fs.writeFileSync(
    path.join(dir, '.claude-flow', 'embeddings.json'),
    JSON.stringify({
      model: 'all-MiniLM-L6-v2', modelPath: '', dimension: 2, cacheSize: 1,
      hyperbolic: { enabled: true, curvature: -1, epsilon: 1e-5, maxNorm: 0.99 },
      neural: { enabled: false, driftThreshold: 0.3, decayRate: 0.01 },
      initialized: new Date().toISOString(),
    }),
  );
  process.chdir(dir);
});
afterEach(() => {
  process.chdir(prev);
  fs.rmSync(dir, { recursive: true, force: true });
});

const run = async (input: Record<string, unknown>) =>
  (await tool.handler(input)) as Record<string, any>;

describe('#4159 embeddings_hyperbolic', () => {
  it('computes the true Poincaré distance for points inside the ball', async () => {
    const r = await run({ action: 'distance', embedding1: [0, 0], embedding2: [0.5, 0] });
    expect(r.success).toBe(true);
    expect(r.distance).toBeCloseTo(Math.log(3), 9);
  });

  it('refuses unit-norm (on-ball) points instead of returning a huge or null distance', async () => {
    const r = await run({ action: 'distance', embedding1: [1, 0], embedding2: [0, 1] });
    expect(r.success).toBe(false);
    expect(String(r.error)).toMatch(/inside the (unit )?ball|convert/i);
  });

  it('refuses points outside the ball (norm > 1), the case that produced null', async () => {
    const r = await run({ action: 'distance', embedding1: [1.0000001, 0], embedding2: [0, 0.3] });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r)).not.toMatch(/"distance":null/);
  });

  it('never reports success with a non-finite distance', async () => {
    for (const pair of [[[0.999999999, 0], [0, 0.999999999]], [[0, 0], [0, 0]]]) {
      const r = await run({ action: 'distance', embedding1: pair[0], embedding2: pair[1] });
      if (r.success) expect(Number.isFinite(r.distance)).toBe(true);
    }
  });

  it('convert gives every unit-norm input the same radius, and says so', async () => {
    const a = await run({ action: 'convert', embedding: [1, 0] });
    const b = await run({ action: 'convert', embedding: [0.6, 0.8] });
    expect(a.poincareNorm).toBeCloseTo(Math.tanh(0.5), 9);
    expect(b.poincareNorm).toBeCloseTo(a.poincareNorm, 9);
    expect(String(a.note ?? '')).toMatch(/same radius|does not encode|hierarchy/i);
  });

  it('status no longer claims the projection preserves tree structure', async () => {
    const r = await run({ action: 'status' });
    expect(JSON.stringify(r)).not.toMatch(/Preserves tree-like structures/);
  });
});
