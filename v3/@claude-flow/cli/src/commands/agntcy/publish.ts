/**
 * V3 CLI `ruflo agent publish` — ADR-380 §2.
 *
 * Emits the AGNTCY-identified, OASF-described agent record (produced
 * build-time by the companion metaharness ADR-240 §2.1/2.2) to the
 * configured AGNTCY Directory (https://github.com/agntcy/dir).
 *
 * This scaffold does NOT implement the Directory publish protocol — no
 * SLIM/Directory SDK is installable yet (verified 404 on every plausible
 * npm/crates.io name). It implements the one thing that IS real without
 * an external SDK: reading a local OASF-shaped manifest off disk (the
 * artifact metaharness ADR-240 is responsible for producing) and
 * validating its shape before attempting a publish, so the eventual
 * network call has a real payload to send rather than being invented at
 * publish time.
 *
 * NOT WIRED INTO THE MAIN CLI ROUTER YET. This file is exported for a
 * later integration pass to attach as a new subcommand of the existing
 * `agent` command (`v3/@claude-flow/cli/src/commands/agent.ts`).
 */

import type { Command, CommandContext, CommandResult } from '../../types.js';
import { output } from '../../output.js';
import { readFile } from 'fs/promises';
import {
  AGNTCY_NOT_CONFIGURED_MESSAGE,
  AGNTCY_PACKAGE_NAME,
  detectAgntcyRuntime,
} from './runtime.js';

/** Minimal shape check for the OASF agent record metaharness ADR-240 §2.1/2.2 produces. */
export interface OasfAgentRecordShape {
  name: unknown;
  version: unknown;
  identity?: unknown;
  capabilities?: unknown;
  [key: string]: unknown;
}

export interface OasfValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate that a parsed JSON value looks like an OASF agent record —
 * deterministic shape check, no network, no LLM. Kept exported so the
 * test file can exercise it directly without spawning the whole command.
 */
export function validateOasfRecordShape(record: unknown): OasfValidationResult {
  const errors: string[] = [];

  if (typeof record !== 'object' || record === null || Array.isArray(record)) {
    return { valid: false, errors: ['record is not a JSON object'] };
  }

  const rec = record as Record<string, unknown>;

  if (typeof rec.name !== 'string' || rec.name.trim().length === 0) {
    errors.push('missing or empty required field "name"');
  }
  if (typeof rec.version !== 'string' || rec.version.trim().length === 0) {
    errors.push('missing or empty required field "version"');
  }

  return { valid: errors.length === 0, errors };
}

interface AgntcyDirectoryModule {
  publishAgentRecord?: (opts: { endpoint: string; record: OasfAgentRecordShape }) => Promise<{ uri?: string }>;
}

const DEFAULT_MANIFEST_PATH = '.agntcy/agent.oasf.json';

const publishCommand: Command = {
  name: 'publish',
  description: 'Publish the AGNTCY-identified, OASF-described agent record to the configured Directory (ADR-380 §2)',
  options: [
    {
      name: 'manifest',
      short: 'm',
      description: 'Path to the OASF agent record produced by metaharness (ADR-240)',
      type: 'string',
      default: DEFAULT_MANIFEST_PATH,
    },
  ],
  examples: [
    { command: 'ruflo agent publish', description: 'Publish the local OASF agent record to the AGNTCY Directory' },
    { command: 'ruflo agent publish --manifest ./out/agent.oasf.json', description: 'Publish a specific manifest' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const manifestPath = (ctx.flags.manifest as string) || DEFAULT_MANIFEST_PATH;

    // Step 1 (real, no SDK needed): locate + shape-validate the manifest.
    let raw: string;
    try {
      raw = await readFile(manifestPath, 'utf-8');
    } catch {
      output.printError(
        `No OASF agent record found at "${manifestPath}". Run the metaharness ADR-240 build step first, ` +
          'or pass --manifest <path>.',
      );
      return { success: false, exitCode: 1 };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      output.printError(
        `"${manifestPath}" is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { success: false, exitCode: 1 };
    }

    const validation = validateOasfRecordShape(parsed);
    if (!validation.valid) {
      output.printError(`"${manifestPath}" is not a valid OASF agent record:`);
      for (const err of validation.errors) {
        output.writeln(`  - ${err}`);
      }
      return { success: false, exitCode: 1 };
    }

    // Step 2 (stub, requires the not-yet-published runtime): the actual
    // Directory publish call.
    const status = await detectAgntcyRuntime();

    if (!status.configured) {
      output.printInfo(AGNTCY_NOT_CONFIGURED_MESSAGE);
      output.printInfo(
        `Validated OASF record at "${manifestPath}" locally (name=${(parsed as OasfAgentRecordShape).name}, ` +
          `version=${(parsed as OasfAgentRecordShape).version}); publish to the Directory was skipped.`,
      );
      return {
        success: true,
        data: { published: false, manifestPath, configured: false, reason: status.reason },
      };
    }

    try {
      const mod = (await import(AGNTCY_PACKAGE_NAME)) as AgntcyDirectoryModule;
      if (typeof mod.publishAgentRecord !== 'function') {
        throw new Error(`"${AGNTCY_PACKAGE_NAME}" is installed but does not export publishAgentRecord()`);
      }
      const result = await mod.publishAgentRecord({
        endpoint: status.endpoint as string,
        record: parsed as OasfAgentRecordShape,
      });
      output.printSuccess(`Published agent record${result?.uri ? ` to ${result.uri}` : ''}.`);
      return { success: true, data: { published: true, manifestPath, uri: result?.uri } };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      output.printError(`Directory publish failed: ${message}`);
      return { success: true, data: { published: false, manifestPath, error: message } };
    }
  },
};

export { publishCommand as agentPublishCommand };
export default publishCommand;
