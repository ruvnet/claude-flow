/** Collectors for the sections built from local plugin files and the run history. A connector started without the service (tests) reports empty sections. */
import type { Collector } from '../collect-core.js';

export const P1_PLUGIN_COLLECTORS: Record<'plugins' | 'capabilities' | 'capability_runs', Collector> = {
  plugins: async c => c.caps?.pluginsBody() ?? { plugins: [] },
  capabilities: async c => c.caps?.capabilitiesBody() ?? { v: 1, generated: { treeSha: '', plugins: 0 }, plugins: [], refused: { total: 0, byCode: {} } },
  capability_runs: async c => c.caps?.runsBody() ?? { active: null, history: [] },
};
