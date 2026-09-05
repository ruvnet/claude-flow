/**
 * gaia-tools barrel — ADR-133-PR2
 *
 * Exports all tool implementations + shared types so that gaia-agent.ts
 * (PR-3) and future tools (PR-4: python_exec, PR-5: web_browse) can import
 * from a single entry point.
 *
 * iter-47 fix: re-added grounded_query which was absent from the integration
 * branch because feat/adr-135-grounded-query-gemini was never cherry-picked
 * during Track A/B/D/E/Q integration (iter-42 measured −36pp / 13.2%).
 *
 * Refs: ADR-133, ADR-135, #2156
 */

export * from './types.js';
export * from './web_search.js';
export * from './file_read.js';
export * from './grounded_query.js';

import { createWebSearchTool } from './web_search.js';
import { createFileReadTool } from './file_read.js';
import { createGroundedQueryTool } from './grounded_query.js';
import type { GaiaToolCatalogue } from './types.js';

/**
 * Returns the default tool catalogue for a GAIA Level-1 run.
 *
 * PR-2 catalogue: web_search + file_read
 * iter-33 adds:   grounded_query (Gemini 2.5 Flash grounding — pre-synthesised answer + citations)
 * PR-4 will add:  python_exec (E2B sandbox)
 * PR-5 will add:  web_browse, image_describe
 *
 * Both web_search and grounded_query are registered so the agent can choose:
 *   - grounded_query: for factoid questions needing a clean answer with citations (1 call)
 *   - web_search: for questions needing raw snippets or source page reading (multi-backend)
 */
export function createDefaultToolCatalogue(): GaiaToolCatalogue {
  return [createWebSearchTool(), createFileReadTool(), createGroundedQueryTool()];
}
