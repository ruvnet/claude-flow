import { afterEach, describe, expect, it, vi } from 'vitest';
import { __setMemoryBridgeRegistryForTests, bridgeConsolidate } from '../src/memory/memory-bridge.js';
import { agentdbConsolidate } from '../src/mcp-tools/agentdb-tools.js';

afterEach(() => __setMemoryBridgeRegistryForTests(null));

function controller(result: unknown) {
  const consolidate = vi.fn().mockResolvedValue(result);
  __setMemoryBridgeRegistryForTests({ get: () => ({ consolidate }) });
  return consolidate;
}

describe('agentdb_consolidate (#3444)', () => {
  it('reports an unsupported stub at the top level', async () => {
    controller({ promoted: 0, pruned: 0, source: 'stub', note: 'nothing was consolidated' });
    expect(await bridgeConsolidate({})).toMatchObject({ success: false, status: 'unsupported' });
  });

  it.each([{ minAge: 2 }, { maxEntries: 1 }])('rejects unsupported options %j before invoking the controller', async (params) => {
    const consolidate = controller({ source: 'native', promoted: 1 });
    expect(await bridgeConsolidate(params)).toMatchObject({ success: false, status: 'unsupported' });
    expect(consolidate).not.toHaveBeenCalled();
  });

  it('preserves genuine controller results', async () => {
    const result = { episodicProcessed: 3, semanticCreated: 1 };
    controller(result);
    expect(await bridgeConsolidate({})).toEqual({ success: true, consolidated: result });
  });

  it('does not advertise unavailable tuning options and rejects them for old clients', async () => {
    expect(agentdbConsolidate.inputSchema.properties).toEqual({});
    expect(await agentdbConsolidate.handler({ maxEntries: 1 })).toMatchObject({ success: false, status: 'unsupported' });
  });

  it('does not inject an unsupported default option into an empty tool call', async () => {
    controller({ source: 'stub' });
    expect(await agentdbConsolidate.handler({})).toMatchObject({ success: false, status: 'unsupported', consolidated: { source: 'stub' } });
  });
});
