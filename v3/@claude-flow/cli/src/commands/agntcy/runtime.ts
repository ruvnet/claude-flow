/**
 * V3 CLI AGNTCY/SLIM Runtime Presence Check — ADR-380 §1.
 *
 * ADR-380 introduces three new `ruflo` CLI verbs (`transport use slim`,
 * `agent publish`, `swarm join <namespace>`) that talk to Cisco Outshift's
 * AGNTCY ecosystem (SLIM transport, Directory publish, group membership).
 *
 * CORRECTED (2026-07-31): the original scaffold guessed at a package name
 * (`@claude-flow/agntcy`) and concluded no real SLIM SDK existed anywhere.
 * That check only tried guessed names — the real package is
 * `@agntcy/slim-bindings` (npm, real, published, documented for plain
 * Node.js use).
 *
 * `@agntcy/slim-bindings@1.4.1` (npm `latest`) fails to load in plain Node —
 * a transitive dependency (`uniffi-bindgen-react-native`) ships raw,
 * uncompiled TypeScript as its package.json `main`, which only works inside
 * a bundler (Metro, for its React Native use case). Filed upstream:
 * agntcy/slim#1916 and jhugman/uniffi-bindgen-react-native#422 (root cause).
 *
 * UPDATE (2026-07-31, later): the SLIM maintainers confirmed they've moved
 * off `uniffi-bindgen-react-native` onto `@ubjs/core`/`@ubjs/node` (compiled
 * output, not raw TS) in the `alpha` dist-tag (`2.0.0-alpha.4+`), not yet
 * promoted to `latest`. Verified live: a real server-bring-up + client-
 * connect + graceful-shutdown smoke test against `@agntcy/slim-bindings@
 * 2.0.0-alpha.5` succeeds under plain Node with zero errors. `package.json`
 * now pins that exact alpha version (not a caret range — this is a
 * pre-release channel, pin deliberately rather than floating) until the fix
 * is promoted to `latest`, tracked by the same issue.
 *
 * This module's existing graceful-degradation design already handled this
 * correctly without any change to its logic: `detectAgntcyRuntime()`'s
 * catch-all branch (anything other than MODULE_NOT_FOUND) reports the real
 * underlying error and falls back to local transport when the import fails.
 * Now that the pinned version actually loads, the happy path
 * (`configured: true`) is real and verified, not aspirational — no change
 * to this function was needed either way.
 *
 * Per ADR-150's precedent (which ADR-380 §1 explicitly follows, not
 * ADR-321's hard-dependency exception):
 *   - removable:            deleting this whole directory changes nothing
 *                            about the rest of the CLI working.
 *   - optional-only:        `@agntcy/slim-bindings` MUST live in
 *                            optionalDependencies, never `dependencies`.
 *   - graceful degradation: every caller of `detectAgntcyRuntime()` falls
 *                            back to the local transport / existing
 *                            authorization model on `configured: false`.
 *   - CI-gated:              a "works without AGNTCY installed" smoke test
 *                            is exercised by __tests__/agntcy-commands.test.ts.
 */

/** Env var an operator sets to point ruflo at a SLIM endpoint. */
export const AGNTCY_ENDPOINT_ENV = 'RUFLO_AGNTCY_SLIM_ENDPOINT';

/**
 * The real SLIM Node.js bindings package (npm, published, real). Kept as a
 * named constant (not a string literal scattered through the module) so a
 * single edit repoints every dynamic-import call site if that ever changes.
 * Currently fails to load due to an upstream packaging bug — see this
 * file's header comment — which `detectAgntcyRuntime()`'s catch-all branch
 * already handles gracefully.
 */
export const AGNTCY_PACKAGE_NAME = '@agntcy/slim-bindings';

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
 *   2. A dynamic `import()` of {@link AGNTCY_PACKAGE_NAME} (or `packageName`
 *      if overridden), wrapped in try/catch. Verified live: the pinned
 *      `2.0.0-alpha.5` resolves cleanly — `configured: true` is a real,
 *      exercised path today, not just a theoretical one.
 *
 * @param env Injectable for tests; defaults to `process.env`.
 * @param packageName Injectable for tests (to simulate "package not
 *   installed" without needing to actually uninstall the real optional
 *   dependency); defaults to {@link AGNTCY_PACKAGE_NAME}.
 */
export async function detectAgntcyRuntime(
  env: NodeJS.ProcessEnv = process.env,
  packageName: string = AGNTCY_PACKAGE_NAME,
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
    await import(packageName);
    return { configured: true, reason: `${packageName} resolved`, endpoint };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND') {
      return {
        configured: false,
        reason: `${AGNTCY_ENDPOINT_ENV} is set but the optional "${packageName}" runtime package is not installed`,
        endpoint,
      };
    }
    // Any other error importing the module (syntax error in a real
    // install, permission issue, etc.) — still degrade gracefully rather
    // than propagate, but keep the real reason for diagnostics.
    return {
      configured: false,
      reason: `error probing "${packageName}": ${error instanceof Error ? error.message : String(error)}`,
      endpoint,
    };
  }
}
