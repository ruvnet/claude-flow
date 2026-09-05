/**
 * V3 CLI AGNTCY/Outshift Runtime Integration — ADR-380 §2.
 *
 * Scaffolds the three new `ruflo` CLI verbs ADR-380 §2 specifies:
 *
 *   ruflo transport use slim
 *   ruflo agent publish
 *   ruflo swarm join <namespace>
 *
 * ============================================================================
 * INTEGRATION STATUS: NOT WIRED IN. This module is intentionally
 * self-contained and is NOT imported by, or registered with, the CLI's
 * central command registry/index. A later, separate pass must:
 *
 *   1. Add `transportCommand` as a new top-level command (alongside
 *      `agent`, `swarm`, etc. in whatever file enumerates top-level
 *      commands today).
 *   2. Merge `agentPublishCommand` into the existing `agentCommand`'s
 *      `subcommands` array in `../agent.ts`.
 *   3. Merge `swarmJoinCommand` into the existing `swarmCommand`'s
 *      `subcommands` array in `../swarm.ts`.
 *   4. Decide (per ADR-380's own "Open Questions") whether `transport use`
 *      is a per-swarm or global-session setting before wiring state
 *      persistence for the selected transport.
 *
 * No file outside `v3/@claude-flow/cli/src/commands/agntcy/` is touched by
 * this scaffold.
 * ============================================================================
 *
 * ARCHITECTURAL CONSTRAINT (mirrors ADR-150 §"architectural constraint",
 * which ADR-380 §1 explicitly follows):
 *   - No `@claude-flow/agntcy` (or any other AGNTCY/SLIM/Outshift) package
 *     exists on npm or crates.io yet — verified 404 on every plausible
 *     name. Nothing in this directory statically imports one.
 *   - Every runtime touchpoint goes through `detectAgntcyRuntime()` in
 *     `runtime.ts`, which only ever does a guarded dynamic `import()`
 *     wrapped in try/catch, and only after an explicit
 *     `RUFLO_AGNTCY_SLIM_ENDPOINT` env var opt-in.
 *   - Every command in this directory exits 0 (not an error) when AGNTCY/
 *     SLIM is not configured — this is optional, removable augmentation,
 *     not a required dependency. The CLI, and these commands' own local
 *     fallback behavior, work identically whether or not this directory
 *     exists at all.
 *
 * Created with care by ruv.io
 */

import type { Command } from '../../types.js';

export { transportCommand, useCommand } from './transport.js';
export { agentPublishCommand } from './publish.js';
export { swarmJoinCommand } from './swarm-join.js';

export {
  detectAgntcyRuntime,
  AGNTCY_ENDPOINT_ENV,
  AGNTCY_PACKAGE_NAME,
  AGNTCY_ADR_PATH,
  AGNTCY_NOT_CONFIGURED_MESSAGE,
} from './runtime.js';
export type { AgntcyRuntimeStatus } from './runtime.js';

export {
  validateOasfRecordShape,
} from './publish.js';
export type { OasfAgentRecordShape, OasfValidationResult } from './publish.js';

export { validateNamespace } from './swarm-join.js';

import { transportCommand } from './transport.js';
import { agentPublishCommand } from './publish.js';
import { swarmJoinCommand } from './swarm-join.js';

/**
 * Convenience bundle for the later integration pass — NOT a registered
 * command tree itself (there is no top-level `agntcy` verb per ADR-380;
 * each of these attaches to an existing or new top-level command per the
 * mapping documented above).
 */
export const agntcyCommands: readonly Command[] = [transportCommand, agentPublishCommand, swarmJoinCommand];

export default agntcyCommands;
