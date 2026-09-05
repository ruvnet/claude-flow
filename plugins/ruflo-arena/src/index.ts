/**
 * ruflo-arena — Competitive ruliology for Ruflo swarms (ADR-147/148).
 *
 * Strategies-as-programs compete under payoff games; tournaments produce Wolfram-style
 * competitive arrays; hill-climb and mutual co-evolution discover winners empirically.
 * The presentation/dashboard layer lives in Ruflo (ADR-150); the data/intelligence layer
 * is RuVector's (ADR-196/197). This plugin is execution + a local data stand-in.
 */

// Domain
export * from './domain/types.js';
export { getGame, makeGame, prisonersDilemma, matchOrNot, GAMES } from './domain/games.js';
export {
  instantiate,
  classicRoster,
  findStrategy,
  randomFSM,
  mutate,
  constant,
  copyOpponent,
  antiCopy,
  alternate,
  grim,
  pavlov,
  random,
} from './domain/strategies.js';

// Engine
export * from './engine/index.js';

// Persistence
export {
  FileRunStore,
  InMemoryRunStore,
  makeRecord,
  newRunId,
  agentdbRecord,
  type RunStore,
} from './persistence/run-store.js';

// Reporting
export {
  competitiveArrayTable,
  heatmap,
  rankingTable,
  sparkline,
  describeFSM,
  evolutionSummary,
} from './report/render.js';

// MCP tools
export { arenaTools, createArenaTools, schemas, type MCPTool } from './mcp-tools/index.js';

import { arenaTools } from './mcp-tools/index.js';
export default { tools: arenaTools };
