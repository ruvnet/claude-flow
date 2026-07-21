---
id: ADR-0001
title: Adopt a session-as-skill architecture for ruflo-browser, backed by RVF, ruvector trajectories, and AgentDB
status: Proposed
date: 2026-05-04
authors:
  - planner (Claude Code)
tags: [plugin, browser, playwright, rvf, ruvector, agentdb, aidefence, mcp, skills]
---

## Context

### Today's `ruflo-browser`

The current plugin (v0.1.0) is a thin wrapper around 23 Playwright-backed MCP tools (`mcp__plugin_ruflo-core_ruflo__browser_*`). Surface inventory:

- `.claude-plugin/plugin.json` — name, description, keywords (`browser`, `playwright`, `testing`, `automation`, `scraping`)
- `agents/browser-agent.md` — single Sonnet agent that wires the 23 MCP tools together; suggests storing selectors in a `browser-patterns` AgentDB namespace; calls `hooks post-task --train-neural`
- `commands/ruflo-browser.md` — one slash command that lists/screenshots/closes sessions via `browser_session-list`
- `skills/browser-test/SKILL.md` — six-step Playwright UI testing recipe
- `skills/browser-scrape/SKILL.md` — seven-step extraction recipe (snapshot → get-text → eval → paginate → close)
- `README.md` — feature list (testing, screenshots, scraping, sessions)

Real and useful, but flat: every browser session is ephemeral, every selector that "worked" lives only in a free-form memory string, every interaction is invisible after the run ends, and every credential leak risk is implicit. There is no first-class **session artifact**, no replay surface, no learning loop, and no cross-session reuse beyond `memory store`.

### Browserbase's `skills/skill` repo (the reference)

Browserbase ships a marketplace (`.claude-plugin/marketplace.json` declares 4 plugins) plus a directory of 10 skills under `skills/`. The architectural moves worth borrowing — verified against the live repo at `https://github.com/browserbase/skills/tree/main` on 2026-05-04 — are:

1. **A single CLI primitive (`browse`) under every skill.** Per `skills/browser/REFERENCE.md`, `browse open|snapshot|click|fill|eval|stop` is the entire interactive surface. Higher-level skills (`ui-test`, `company-research`, `cookie-sync`) compose the primitive rather than re-inventing it. The skill registers `Bash` as its only `allowed-tools` and shells out.
2. **Sessions are named, not anonymous.** The `BROWSE_SESSION=<name>` environment variable (`skills/ui-test/SKILL.md`) plus `--session <name>` flag (`skills/browser/REFERENCE.md`) make sessions addressable across CLI invocations and across parallel agents.
3. **Persistent contexts as a separate, addressable artifact.** `--context-id <id>` + `--persist` flags (REFERENCE.md) decouple "which browser instance" from "which auth/cookie state". `cookie-sync/SKILL.md` then defines a deliberate sync protocol from local Chrome → persistent context.
4. **Trace-as-firehose with per-page bisection.** `browser-trace/SKILL.md` defines `.o11y/<run-id>/` containing `manifest.json`, `cdp/raw.ndjson`, `cdp/summary.json`, `cdp/pages/*/`, `screenshots/`, `dom/`. Critically: **the tracer attaches as a second, read-only CDP client** so any session being driven by automation can be observed in parallel.
5. **A self-improving outer/inner loop.** `autobrowse/SKILL.md` codifies the pattern: an inner agent (`scripts/evaluate.mjs`) executes browse commands and produces a trace under `traces/<task>/run-NNN/`; an outer agent reads the trace, edits `strategy.md` with one concrete improvement, and re-runs. A task graduates when it passes 2-of-last-3 runs, and the graduated artifact is a self-contained `SKILL.md` installed to `~/.claude/skills/`.
6. **Domain skills compose the primitive.** `company-research/SKILL.md` wraps `browse` with `extract_page.mjs`, `list_urls.mjs`, `compile_report.mjs`, then enforces a Plan→Research→Synthesize methodology with subagent isolation. The lesson: **domain logic does not extend `browse`, it sits on top of it.**
7. **Marketplace declares plugins, plugins reference local skills.** `.claude-plugin/marketplace.json` ships 4 plugins (`browse`, `functions`, `browserbase-cli`, `browser-trace`), each with `"skills": "./skills/<name>"`. Plugin and skill are different units of distribution.

What Browserbase does *not* offer that we need: persistent semantic memory of selectors and page structures, PII/prompt-injection scanning of scraped content, federated session sharing, or learning-from-trajectory beyond the file-based `strategy.md` loop. Those are exactly the gaps Ruflo's existing subsystems already fill.

### Why act now

`ruflo-browser` is the most-used surface for any agent that needs the open web, and it is the weakest at translating a one-off run into reusable knowledge. Adopting the Browserbase architectural shape — primitive + named sessions + traces + outer/inner loop — while wiring each artifact into Ruflo's own substrates (RVF, ruvector trajectories, AgentDB, AIDefence) gives us replayability, learning, and safety without leaving Playwright behind and without depending on Browserbase's hosted backend.

## Decision

We propose to refactor `ruflo-browser` around a **session-as-skill** architecture. Each browser session is a first-class, replayable, auditable RVF container with a recorded ruvector trajectory; skills are thin compositions over a stable Playwright primitive; the marketplace shape mirrors Browserbase's so the plugin can be split later if the surface grows.

### 1. Session model — RVF as the session container

Every browser session opened by ruflo-browser is allocated an RVF container at session start (`rvf create --dimension 384 <session-name>.rvf`) and committed at session end (`rvf compact && rvf export`). The container holds:

| Slot | Producer | Notes |
|------|----------|-------|
| `manifest.yaml` | session-start hook | URL, viewport, profile, runner (local Playwright vs remote), parent-session lineage |
| `trajectory.ndjson` | ruvector `hooks trajectory-step` per action | One line per click/nav/extract, with selector, ref, screenshot path, ms-since-start |
| `screenshots/` | `browser_screenshot` post-action | Filenames follow `<step-id>.png` convention from Browserbase's `ui-test` |
| `snapshots/` | `browser_snapshot` post-nav | Accessibility trees indexed by navigation boundary |
| `dom/` | optional, post-nav | HTML dumps when `--with-dom` is passed |
| `cookies.json` | session-end | Sanitized via AIDefence (PII scan) before being written |
| `findings.md` | reviewer skill | Markdown summary of test failures, scrape results, or trajectory verdicts |

Borrowed pattern: Browserbase's `.o11y/<run-id>/` layout (`browser-trace/SKILL.md`). Difference: their layout is a sidecar dropped on disk. **We make it the session itself**, addressable by RVF id and queryable via `rvf query <id>`.

A session reference is therefore an RVF id, not a Playwright handle. This is the keystone change: it lets a session be re-opened (`rvf ingest`), forked (`rvf derive`), shared via federation, or archived without losing trajectory or auth state.

### 2. Trajectory recording — ruvector hooks as the action log

We bind every browser MCP tool call to ruvector trajectory hooks via the existing `pre-task`/`post-task` and a new `browser_*` interceptor:

```
session-start
  → ruvector hooks trajectory-begin --session-id <rvf-id> --task <human-task>
each action (click, fill, eval, snapshot, screenshot, navigate)
  → ruvector hooks trajectory-step --session-id <rvf-id> \
       --action <tool> --args <json> --selector <sel> --result <ok|fail>
session-end
  → ruvector hooks trajectory-end --session-id <rvf-id> --verdict <pass|fail|partial>
```

This gives us, for free:

- HNSW search across past trajectories ("how have we logged into Stripe before?")
- SONA pattern distillation (the "graduated SKILL.md" from `autobrowse` becomes a SONA-distilled pattern in `browser-patterns` namespace)
- Replay via `trajectory-step` enumeration → re-play through Playwright

Borrowed pattern: `autobrowse/SKILL.md`'s outer/inner loop. Mapping: their `traces/<task>/run-NNN/trace.json` becomes our `trajectory.ndjson` inside the RVF container; their `strategy.md` becomes a SONA-stored pattern keyed by hostname; their "2-of-last-3" graduation rule becomes a verdict aggregator over the trajectory verdicts.

### 3. Memory layer — AgentDB namespaces

Four AgentDB namespaces, all controller-managed (memory, sessions, patterns):

| Namespace | Key | Value | Purpose |
|-----------|-----|-------|---------|
| `browser-sessions` | `<rvf-id>` | manifest summary + verdict + tags | session index for `/ruflo-browser ls --query "logged into stripe"` |
| `browser-selectors` | `<host>:<intent>` | `{selector, ref, snapshot-hash, last-success}` | survives DOM drift via embedding similarity |
| `browser-templates` | `<template-name>` | scrape recipe with selector chain + post-process | replaces ad-hoc memory strings in today's agent |
| `browser-cookies` | `<host>` | claims-gated cookie blob (vault-style retrieval) + expiry + AIDefence verdict | cookie reuse without re-auth |

Borrowed pattern: Browserbase's `--context-id` persistent contexts (`cookie-sync/SKILL.md`). Difference: their context lives on Browserbase's server. **Ours lives in AgentDB**, gated by claims, and shareable via federation. Encryption-at-rest is **not** assumed at the AgentDB layer; sensitive blobs (raw cookies, tokens) MUST be wrapped by the application before insert and unwrapped on retrieval. The `browser-cookies` namespace defines this wrapping; raw values never enter AgentDB.

### 4. PII / auth / safety — AIDefence at every boundary

Three explicit gates, all mandatory:

- **Pre-storage scan** — every scraped string passes `aidefence_has_pii` before AgentDB store. Hits get redacted with placeholders + a sidecar entry in the session manifest (`pii_redactions: [{path, kind, count}]`).
- **Cookie sanitization** — before `cookies.json` lands in the RVF container, run `aidefence_scan` to flag tokens that look like raw secrets (long high-entropy strings without an expiry); offer to vault them in `browser-cookies` with claims-gated retrieval rather than embed in the session.
- **Prompt-injection check** — any extracted text that flows back into an LLM prompt (e.g., `browser-extract` → agent reasoning) passes `aidefence_is_safe` first. Page content that triggers a prompt-injection verdict gets quarantined to `findings.md` and never reaches the model unredacted.

Borrowed pattern: the *idea* of a deliberate sync boundary from `cookie-sync/SKILL.md`. Browserbase has no PII/injection layer; this is a Ruflo-native addition.

### 5. Skill catalog — six new skills, two retained

| Skill | Replaces | Borrows from | Description |
|-------|----------|--------------|-------------|
| `browser-record` | (new) | `browser/SKILL.md` + `browser-trace/SKILL.md` | Primitive: open a named, traced session into an RVF container. Argument: URL or task description. Emits an RVF id. |
| `browser-replay` | (new) | `autobrowse` (lacking native replay) | Replay a trajectory from an RVF id, optionally on a different URL or with mutated inputs. Used for regression and for diff-based testing. |
| `browser-extract` | `browser-scrape` (subsumed) | `browser/REFERENCE.md` `snapshot`/`get`/`eval` | Run a stored `browser-templates` recipe or a one-shot extraction; PII-scanned output; persists template on success. |
| `browser-login` | (new) | `cookie-sync/SKILL.md` | Drive an auth flow once, sanitize+vault cookies into `browser-cookies`, return a context handle for reuse. |
| `browser-form-fill` | (subset of `browser-test`) | `browser/REFERENCE.md` `fill`/`type`/`select` | Form interaction with field-name → value mapping; integrates `browser-templates` for known forms. |
| `browser-screenshot-diff` | (new) | `browser-trace`'s screenshot ground-truth pattern | Pixel and DOM diff between two session screenshots (same step-id, two RVF ids); used for visual regression. |
| `browser-auth-flow` | (new) | `ui-test`'s adversarial mindset + `cookie-sync` | Probe an auth flow for redirect leaks, missing CSRF, weak session cookies; output goes to `findings.md`. |
| `browser-test` (kept) | unchanged shape | composes `browser-record` + `browser-replay` | Existing recipe, now backed by a session container instead of an ephemeral run. |

Each new skill follows the existing convention: kebab-case directory under `skills/`, a `SKILL.md` with frontmatter (`name`, `description`, `argument-hint`, `allowed-tools`), and an `EXAMPLES.md` for non-obvious flows. Allowed tools must be enumerated explicitly per skill (no skill gets all 23 MCP browser tools — the Browserbase principle of `Bash`-only with a CLI primitive is too austere for our MCP-first world, but the same restraint applies).

### 6. Commands — `/ruflo-browser` as a verb dispatcher

The single `commands/ruflo-browser.md` is rewritten to dispatch by subcommand:

```
/ruflo-browser ls                      # list sessions (RVF-indexed) with filters
/ruflo-browser show <session-id>       # show manifest + trajectory + verdict
/ruflo-browser replay <session-id>     # invoke browser-replay
/ruflo-browser export <session-id>     # rvf export → tar.zst, optionally federated
/ruflo-browser fork <session-id>       # rvf derive → new session with shared lineage
/ruflo-browser purge <session-id>      # destroy session, keep redacted manifest
/ruflo-browser doctor                  # check Playwright, MCP, AgentDB, AIDefence wiring
```

Borrowed pattern: Browserbase's `bb sessions`/`bb contexts` resource verbs (`browserbase-cli/SKILL.md`). The lesson is that resource lifecycle deserves its own command surface, distinct from "do an interactive browse step".

### 7. MCP surface — what to expose vs. keep internal

The 23 existing `browser_*` tools stay as the underlying primitive (no churn for downstream consumers). On top, register a small set of session-aware tools:

| New MCP tool | Purpose |
|--------------|---------|
| `browser_session_record` | Wrap `browser_open` with RVF allocation + trajectory-begin |
| `browser_session_end` | Compact, AIDefence scan, AgentDB index |
| `browser_session_replay` | Re-drive a stored trajectory |
| `browser_template_apply` | Run a `browser-templates` recipe |
| `browser_cookie_use` | Mount a `browser-cookies` entry into an active session |

Internal-only (not MCP-exposed): the AIDefence gates, the AgentDB writes, the trajectory hook calls. Agents should not be able to skip these by selecting a different tool — they live below the MCP surface.

Borrowed pattern: Browserbase's two-tier split (`browse` interactive vs. `bb` lifecycle) — `browserbase-cli/SKILL.md` explicitly says "Prefer the Browser skill for interactive browsing; use `bb browse` only when the user explicitly wants the Browserbase CLI path." Our analog: 23 raw `browser_*` tools for steps, 5 `browser_session_*` tools for lifecycle.

### 8. Migration — what happens to today's surface

- `skills/browser-test/SKILL.md` is rewritten to `browser-record` → `browser-replay` calls. The visible argument-hint stays `<url> [--screenshot]` so existing invocations continue to work.
- `skills/browser-scrape/SKILL.md` becomes a thin shim that calls the new `browser-extract` skill and is deprecated in plugin v0.3.0 (one minor version of overlap).
- `agents/browser-agent.md` is updated to know about RVF session ids and the new MCP tools. The free-form `memory store` lines are replaced with a single line referencing AgentDB namespaces above.
- `commands/ruflo-browser.md` is replaced with the verb dispatcher in §6. Old behavior (list + screenshot + close) maps to `ls` + `show` + `purge`.
- `.claude-plugin/plugin.json` bumps to `0.2.0` with new keywords (`rvf`, `replay`, `trajectory`).
- A `marketplace.json` mirror is **not** introduced yet — ruflo's plugin marketplace is centralized at the repo root. We will revisit only if the plugin grows beyond ~8 skills (Browserbase's split happened at 10).

### 9. Pinning and contract

Following the precedent of ADR-0001 in `ruflo-ruvector`:

- Pin Playwright to a specific minor version in the agent doc and in any helper scripts under `scripts/`.
- Pin the `ruvector` CLI invocations to `ruvector@0.2.25` to match the ruvector plugin's pin (so trajectory hooks behave identically across plugins).
- Add `scripts/smoke.sh` that boots a session against `https://example.com`, runs one click and one extract, verifies an RVF container was produced and indexed in AgentDB, and tears down. Smoke must exit non-zero if any of: RVF allocation fails, AIDefence scan is skipped, trajectory file is empty, AgentDB write 404s.

## Consequences

**Positive:**

- Every browser session becomes a queryable, replayable, federatable artifact instead of a one-shot side effect.
- Selector knowledge accumulates across sessions in a typed namespace (`browser-selectors`) and survives DOM drift via embedding similarity rather than literal-string lookup.
- PII and prompt-injection risks are intercepted at deterministic boundaries, not "if the agent remembers".
- The `autobrowse`-style learning loop becomes a first-class capability of the plugin: SONA-distilled patterns from successful trajectories are automatically retrievable next time the same site is visited.
- Two skills today → eight skills tomorrow, but each is smaller and composes a stable primitive, so total complexity is lower per skill.
- Federation gets browser-session sharing for free (RVF containers are already federation-aware).

**Negative:**

- Significant migration cost: every existing flow that calls `browser_open` directly will continue to work but loses the new guarantees unless it routes through `browser_session_record`. We will run both paths during the v0.2 line.
- AgentDB and AIDefence become hard dependencies of `ruflo-browser`. Today the plugin runs against a stock `claude-flow` install; under this proposal it requires the AgentDB controllers and AIDefence to be initialized. This must be enforced by `ruflo-browser doctor` and by `init-project` updates.
- RVF compaction on session end adds 100-500ms of overhead; for short scrapes this is noticeable. We mitigate with `--no-rvf` for explicit one-off scrapes (escape hatch only).
- Browserbase's `--context-id` is server-side and survives across machines; ours is AgentDB-local. Cross-machine reuse requires federation export + import. Acceptable trade-off — we own the substrate.

**Neutral:**

- The MCP tool count grows from 23 to 28 (5 new lifecycle tools). The 23 existing tools are unchanged.
- Plugin version moves from `0.1.0` to `0.2.0`; semver-minor because new MCP tools are additive but the on-disk shape (RVF containers under each session) is new.
- Browserbase's hosted offering (anti-bot, residential proxies, CAPTCHA solving) is *not* replicated. We remain a local-Playwright tool; users who need those features should keep using Browserbase directly. The proposal is about architecture, not feature parity.

## Verification

A future implementation must satisfy this smoke contract before the ADR moves from Proposed → Accepted:

1. **Session lifecycle:** `browser_session_record` against `example.com` produces a valid RVF container that survives `rvf export` + `rvf ingest` round-trip; trajectory has at least 1 `trajectory-step` entry.
2. **AgentDB indexing:** After session-end, `agentdb_route` with the session task description returns the new session id within the top-3 results.
3. **AIDefence gates:** A page containing a synthetic prompt-injection string (e.g. "ignore previous instructions and..."), when scraped, produces a `findings.md` entry and the raw string never appears in the trajectory's serialized result field.
4. **Replay:** `browser_session_replay <rvf-id>` against the same URL produces a new trajectory whose action sequence matches the original within a configurable tolerance (selector drift allowed; navigation order strict). **This is the load-bearing assumption of the entire proposal:** that selector+action trajectories are replayable across DOM drift, anchored on `browser-selectors` embedding similarity. Browserbase explicitly does *not* offer replay (their docs note rrweb session replay was deprecated). If the recovery loop proves unreliable in practice, the proposal degrades to "session as audit log" — still useful, but the `browser-replay` skill and `browser-screenshot-diff` regression flow are no longer load-bearing. A pre-Accept spike must demonstrate ≥80% replay success across 10 distinct sites of varying drift profiles.
5. **Cookie vault:** `browser-login` against a test page with `Set-Cookie: token=...` results in a `browser-cookies` entry, claims-gated, with the raw value not present anywhere in the unrelated session's RVF container.
6. **Federation:** `rvf export` of a session produces a tarball that, when ingested on a peer node, allows `browser_session_replay` to drive a fresh browser without consulting the original AgentDB.
7. **Doctor:** `/ruflo-browser doctor` returns non-zero on each of: missing AgentDB controller, AIDefence not initialized, ruvector CLI not pinned, Playwright version drift.

A `scripts/smoke.sh` materializes these as 7 numbered tests; the contract is "7 passed, 0 failed".

## Related

- `plugins/ruflo-ruvector/docs/adrs/0001-pin-ruvector-0.2.25.md` — pinning precedent and smoke-test-as-contract pattern.
- `https://github.com/browserbase/skills/tree/main` — reference architecture (verified 2026-05-04).
- `https://github.com/browserbase/skills/blob/main/skills/browser/REFERENCE.md` — `browse` CLI surface.
- `https://github.com/browserbase/skills/blob/main/skills/autobrowse/SKILL.md` — outer/inner agent loop and trace-driven learning.
- `https://github.com/browserbase/skills/blob/main/skills/browser-trace/SKILL.md` — `.o11y/<run-id>/` artifact layout and CDP-as-second-client pattern.
- `https://github.com/browserbase/skills/blob/main/skills/cookie-sync/SKILL.md` — cookie sync to persistent context, which we re-frame as AgentDB-vaulted context.
- `https://github.com/browserbase/skills/blob/main/skills/ui-test/SKILL.md` — adversarial agent coordination and `BROWSE_SESSION` env-named sessions.
- `https://github.com/browserbase/skills/blob/main/skills/company-research/SKILL.md` — domain-skills-on-top-of-primitive composition pattern.
- `https://github.com/browserbase/skills/blob/main/.claude-plugin/marketplace.json` — multi-plugin marketplace shape (deferred for ruflo-browser).
- Playwright (`https://playwright.dev/`) — the underlying runner; pinning precedent applies.
- Ruflo subsystems referenced: AgentDB controllers, RVF (`rvf` CLI), ruvector hooks (`trajectory-*`, `pattern-*`), AIDefence (`aidefence_has_pii`, `aidefence_is_safe`, `aidefence_scan`), Federation (zero-trust cross-installation sharing).
