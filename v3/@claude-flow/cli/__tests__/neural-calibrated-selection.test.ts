import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { __resetNeuralRouterForTests, tryCostOptimalRoute, tryCostOptimalRouteBatch } from '../src/ruvector/neural-router.js';
import { ModelRouter } from '../src/ruvector/model-router.js';
const fixture = vi.hoisted(() => ({ cheapQuality: 0.2, expensiveQuality: 0.8, cheapId: '', expensiveId: '' }));
// The optional inference dependency is absent in this checkout. Supply controlled
// raw predictions at that boundary; exercise the real bundled artifact loading,
// calibrator, selector and public ModelRouter without provider requests.
vi.mock('@metaharness/router', () => ({ TrainedRouter: { fromJSON: (json: {candidates: Array<{id: string; costPerMTok: number}>}) => {
  const candidates = [...json.candidates].sort((a, b) => a.costPerMTok - b.costPerMTok);
  fixture.cheapId = candidates[0].id; fixture.expensiveId = candidates[1].id;
  const predict = (id: string) => id === fixture.cheapId ? fixture.cheapQuality : fixture.expensiveQuality;
  return { predict, route: () => {
    const pick = candidates.find(c => predict(c.id) >= 0.5) ?? candidates[0];
    return {...pick, predictedQuality: predict(pick.id), metBar: predict(pick.id) >= 0.5};
  }};
}} }));

describe('calibrated quality drives model selection', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ruflo-calibrated-selection-'));
    for (const key of Object.keys(process.env).filter(k => k.startsWith('CLAUDE_FLOW_ROUTER_'))) vi.stubEnv(key, '');
    vi.stubEnv('CLAUDE_FLOW_ROUTER_NEURAL', '1');
    vi.stubEnv('CLAUDE_FLOW_ROUTER_QUALITY_BAR', '0.5');
    vi.stubEnv('CLAUDE_FLOW_SWARM_DIR', dir);
    fixture.cheapQuality = 0.2; fixture.expensiveQuality = 0.8;
    __resetNeuralRouterForTests();
  });
  afterEach(() => { vi.unstubAllEnvs(); __resetNeuralRouterForTests(); rmSync(dir, {recursive:true, force:true}); });
  function calibrator(low: number, high: number) {
    const path = join(dir, 'calibrator.json');
    writeFileSync(path, JSON.stringify({v:1, buckets:[
      {predMin:0.6,predMax:0.6,calibrated:low,count:1}, {predMin:0.8,predMax:0.8,calibrated:high,count:1},
    ]}));
    vi.stubEnv('CLAUDE_FLOW_ROUTER_CALIBRATOR_PATH', path);
    fixture.cheapQuality = 0.6;
    __resetNeuralRouterForTests();
  }

  it('chooses the cheap model when bundled calibration raises it above the bar', async () => {
    const result = await tryCostOptimalRoute([1, 0]);
    expect(result?.alternatives.find(a => a.modelId === fixture.cheapId)?.predictedQuality).toBeGreaterThan(0.5);
    expect(result?.modelId).toBe(fixture.cheapId);
    expect(result?.metBar).toBe(true);
  });
  it('retains raw selection when calibration is explicitly disabled', async () => {
    vi.stubEnv('CLAUDE_FLOW_ROUTER_CALIBRATE', '0');
    expect((await tryCostOptimalRoute([1, 0]))?.modelId).toBe(fixture.expensiveId);
  });
  it('escalates when calibration lowers the cheap model below the bar', async () => {
    calibrator(0.4, 0.9);
    expect((await tryCostOptimalRoute([1, 0]))?.modelId).toBe(fixture.expensiveId);
  });
  it('reports an unmet bar when every calibrated prediction falls below it', async () => {
    calibrator(0.3, 0.4);
    const result = await tryCostOptimalRoute([1, 0]);
    expect(result?.modelId).toBe(fixture.expensiveId);
    expect(result?.metBar).toBe(false);
  });
  it('uses the same calibrated selection for batch routing', async () => {
    calibrator(0.4, 0.9);
    const [result] = await tryCostOptimalRouteBatch([[1, 0]]);
    expect(result?.modelId).toBe(fixture.expensiveId);
  });
  it('propagates the calibrated concrete model through the public ModelRouter', async () => {
    calibrator(0.4, 0.9);
    const result = await new ModelRouter({statePath: relative(process.cwd(), join(dir, 'state.json'))}).route('Write a greeting', [1, 0]);
    expect(result.modelId).toBe(fixture.expensiveId);
  });
});
