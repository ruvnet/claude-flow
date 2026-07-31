/**
 * V3 CLI AGNTCY/SLIM Runtime Presence Check — ADR-380 §1.
 *
 * ADR-380 introduces three new `ruflo` CLI verbs (`transport use slim`,
 * `agent publish`, `swarm join <namespace>`) that talk to Cisco Outshift's
 * AGNTCY ecosystem (SLIM transport, Directory publish, group membership).
 *
 * As of this scaffold (2026-07-30), NO `@claude-flow/agntcy` package (or
 * any SLIM SDK under any other guessed npm/crates.io name) exists — a
 * repo-wide check and a registry check both came back clean/404. This
 * module therefore NEVER performs a real network call to AGNTCY
 * infrastructure. It only answers one question, deterministically and
 * without throwing: "has the operator pointed ruflo at a SLIM endpoint,
 * and if so, is the optional runtime package actually installed?"
 *
 * Per ADR-150's precedent (which ADR-380 §1 explicitly follows, not
 * ADR-321's hard-dependency exception):
 *   - removable:            deleting this whole directory changes nothing
 *                            about the rest of the CLI working.
 *   - optional-only:        `@claude-flow/agntcy` MUST live in
 *                            optionalDependencies once it is published,
 *                            never `dependencies`.
 *   - graceful degradation: every caller of `detectAgntcyRuntime()` falls
 *                            back to the local transport / existing
 *                            authorization model on `configured: false`.
 *   - CI-gated:              a "works without AGNTCY installed" smoke test
 *                            is exercised by __tests__/agntcy-commands.test.ts.
 */

/** Env var an operator sets to point ruflo at a SLIM endpoint. */
export const AGNTCY_ENDPOINT_ENV = 'RUFLO_AGNTCY_SLIM_ENDPOINT';

/**
 * Guessed package name for the future optional runtime. Verified 404 on
 * npm as of this scaffold — see the ADR-380 companion research. Kept as a
 * named constant (not a string literal scattered through the module) so a
 * single edit repoints every dynamic-import call site once the real
 * package ships.
 */
export const AGNTCY_PACKAGE_NAME = '@claude-flow/agntcy';

/** Pointer to the ADR every "not configured" message should send users to. */
export const AGNTCY_ADR_PATH = 'v3/docs/adr/ADR-380-agntcy-outshift-runtime-integration.md';

export const AGNTCY_NOT_CONFIGURED_MESSAGE =
  `AGNTCY/SLIM transport is not configured — see ADR-380 (${AGNTCY_ADR_PATH}) for setup. ` +
  'Falling back to local transport.';

export interface AgntcyRuntimeStatus {
  /** True only when an endpoint is set AND the optional runtime package resolves. */
  configured: boolean;
  /** Human-readable reason for the current status — always safe to print. */
  reason: string;
  /** The configured endpoint, if any (present even when configured is false, e.g. package missing). */
  endpoint?: string;
}

/**
 * Detect whether the optional AGNTCY/SLIM runtime is available.
 *
 * This function never throws and never makes a network call. It performs,
 * in order:
 *   1. An env var presence check for {@link AGNTCY_ENDPOINT_ENV}. Absent →
 *      not configured, no further work.
 *   2. A dynamic `import()` of {@link AGNTCY_PACKAGE_NAME}, wrapped in
 *      try/catch. Today this import always fails with a module-resolution
 *      error (the package doesn't exist yet) — that failure is treated as
 *      the expected "not installed" signal, not a bug.
 *
 * @param env Injectable for tests; defaults to `process.env`.
 */
export async function detectAgntcyRuntime(
  env: NodeJS.ProcessEnv = process.env,
): Promise<AgntcyRuntimeStatus> {
  const endpoint = env[AGNTCY_ENDPOINT_ENV];
  if (!endpoint) {
    return { configured: false, reason: `${AGNTCY_ENDPOINT_ENV} is not set` };
  }

  try {
    // Dynamic import of an optional dependency, exactly the pattern this
    // repo already uses for other optional runtimes (see status.ts's
    // `await import('pg')`). Never a static `import` — a static import
    // would make @claude-flow/cli fail to build/run when the package is
    // absent, which is the one thing ADR-150/ADR-380 forbid.
    await import(AGNTCY_PACKAGE_NAME);
    return { configured: true, reason: `${AGNTCY_PACKAGE_NAME} resolved`, endpoint };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND') {
      return {
        configured: false,
        reason: `${AGNTCY_ENDPOINT_ENV} is set but the optional "${AGNTCY_PACKAGE_NAME}" runtime package is not installed`,
        endpoint,
      };
    }
    // Any other error importing the module (syntax error in a real
    // install, permission issue, etc.) — still degrade gracefully rather
    // than propagate, but keep the real reason for diagnostics.
    return {
      configured: false,
      reason: `error probing "${AGNTCY_PACKAGE_NAME}": ${error instanceof Error ? error.message : String(error)}`,
      endpoint,
    };
  }
}
