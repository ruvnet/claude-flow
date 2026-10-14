/**
 * #4156: neural_train without data stored nothing yet reported status "ready", and
 * neural_predict returned confidence 1 for a single stored pattern whatever the match.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dir: string;
let prevCwd: string;
beforeEach(() => {
  prevCwd = process.cwd();
  dir = mkdtempSync(join(tmpdir(), 'ruflo-4156-'));
  process.chdir(dir);
});
afterEach(() => {
  process.chdir(prevCwd);
  rmSync(dir, { recursive: true, force: true });
});

async function tool(name: string) {
  const { neuralTools } = await import('../src/mcp-tools/neural-tools.js');
  const found = neuralTools.find((t) => t.name === name);
  if (!found) throw new Error(`no tool ${name}`);
  return found.handler as (input: Record<string, unknown>) => Promise<Record<string, any>>;
}

describe('neural_train with nothing to learn from (#4156)', () => {
  it('does not report success or "ready" when no data is passed', async () => {
    const train = await tool('neural_train');
    const result = await train({ modelType: 'moe', epochs: 10 });
    expect(result.success).toBe(false);
    expect(result.status).toBe('empty');
    expect(result.patternsStored).toBe(0);
    expect(String(result.error)).toMatch(/data/i);
    expect(String(result.error)).toMatch(/hooks_intelligence|separate/i);
  });

  it('does not report success for an empty data array either', async () => {
    const train = await tool('neural_train');
    const result = await train({ modelType: 'classifier', data: [] });
    expect(result.success).toBe(false);
    expect(result.status).toBe('empty');
  });

  it('still trains when data is given', async () => {
    const train = await tool('neural_train');
    const result = await train({ modelType: 'classifier', data: [{ text: 'route payment webhook retries', label: 'payments' }] });
    expect(result.success).toBe(true);
    expect(result.status).toBe('ready');
    expect(result.patternsStored).toBe(1);
  });
});

describe('neural_predict similarity floor (#4156)', () => {
  it('does not return a confident prediction for an unrelated input against a single stored pattern', async () => {
    const train = await tool('neural_train');
    const predict = await tool('neural_predict');
    await train({ modelType: 'classifier', data: [{ text: 'route payment webhook retries', label: 'payments' }] });
    const result = await predict({ input: 'qzx wvut gardening compost schedule for spring tomatoes' });
    expect(result.success).toBe(true);
    expect(result.predictions).toEqual([]);
    expect(result.topPrediction).toBeNull();
    expect(typeof result.bestSimilarity).toBe('number');
    expect(String(result._note)).toMatch(/similarity/i);
  });

  it('still returns the match when the input is the stored text', async () => {
    const train = await tool('neural_train');
    const predict = await tool('neural_predict');
    await train({ modelType: 'classifier', data: [{ text: 'route payment webhook retries', label: 'payments' }] });
    const result = await predict({ input: 'route payment webhook retries' });
    expect(result.predictions.length).toBe(1);
    expect(result.topSimilarity).toBeGreaterThan(0.9);
  });

  it('lets a caller lower the floor explicitly', async () => {
    const train = await tool('neural_train');
    const predict = await tool('neural_predict');
    await train({ modelType: 'classifier', data: [{ text: 'route payment webhook retries', label: 'payments' }] });
    const result = await predict({ input: 'qzx wvut gardening compost schedule for spring tomatoes', minSimilarity: -1 });
    expect(result.predictions.length).toBe(1);
  });
});
