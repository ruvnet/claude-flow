# ADR-302 — Post-Initialization Capability Enrollment

- **Status:** Proposed
- **Date:** 2026-07-10
- **Deciders:** ruflo core
- **Related:** [ADR-301](ADR-301-promotional-status-surface.md) (promo status surface), [ADR-303](ADR-303-credit-exhaustion-experience.md) (credit exhaustion), [ADR-304](ADR-304-local-meta-llm-proxy.md) (local Meta LLM proxy), [ADR-305](ADR-305-customer-lifecycle-funnel.md) (funnel overview)

## Context

Immediately after installation represents the highest-intent moment in the user lifecycle: the user has just chosen ruflo, is looking at the terminal, and has not yet formed workflow habits.

Today, initialization (`npx ruflo init`, `v3/@claude-flow/cli/src/commands/init.ts` → `src/init/executor.ts`) ends with a success summary and no presentation of additional capabilities.

## Decision

Introduce an optional, one-time enrollment experience after successful initialization.

### Flow

```
✓ Ruflo installed
────────────────────────────
Unlock additional capabilities?

  ✓ Local Meta LLM Proxy
  ✓ Multi-model routing
  ✓ Hosted memory
  ✓ Enterprise rate limits
  ✓ Premium agents
  ✓ Cloud synchronization

Free account.

Press Enter to continue
or visit: https://cognitum.one
```

**If accepted**, the CLI hands off to:

```
ruflo auth login
```

or

```
ruflo proxy install
```

depending on platform (see ADR-304 for the proxy).

**If skipped:**

```
You can enable later:
  ruflo auth login
```

No repeated prompting after dismissal — the dismissal is recorded in user-level state (`~/.ruflo/enrollment.json`), not project-level, so re-running `init` in another project does not re-prompt.

## Requirements

- **One-time only** — dismissal or completion is terminal; the prompt never reappears.
- **Non-blocking** — the prompt has a default (skip) and never gates init success; init exit code is unaffected by the enrollment outcome.
- **Skippable explicitly** — `--no-signup` flag on `init`.
- **Skipped in automation** — non-TTY stdin/stdout skips silently.
- **Skipped in CI** — `CI` and equivalents skip silently.
- **No credentials handled inline** — enrollment only launches the existing `ruflo auth login` flow; the init path itself never touches tokens (input validation and secret handling remain in `@claude-flow/security` per existing boundaries).

## Consequences

- Init wizard (`init --wizard`) gains one final screen; non-wizard init gains one prompt with an Enter-to-skip default.
- The enrollment screen is the top of the lifecycle funnel described in ADR-305; conversion from this screen is a North Star metric there.
- Telemetry: acceptance/dismissal counted only as anonymous aggregates, only when telemetry is enabled (same policy as ADR-301).
