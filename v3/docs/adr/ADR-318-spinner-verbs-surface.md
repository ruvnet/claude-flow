# ADR-318: Ruflo spinner-verbs surface via Claude Code `spinnerVerbs` settings

- **Status**: Proposed
- **Date**: 2026-07-14
- **Deciders**: ruv
- **Related**: [ADR-301](ADR-301-cognitum-customer-lifecycle-funnel.md) (funnel foundation), [ADR-302](ADR-302-post-init-capability-enrollment.md) (consent domain discipline), [ADR-311](ADR-311-funnel-analytics-endpoint-deployment.md) (message pool + attribution), [ADR-316](ADR-316-advisor-copilot-tip-insight-ticker.md) (adjacent per-render placement), [ADR-317](ADR-317-developer-revenue-share.md) (sibling opt-in this PR ships alongside)

## Context

Claude Code exposes a documented `spinnerVerbs` settings key in `~/.claude/settings.json`:

```json
{
  "spinnerVerbs": {
    "mode": "append",
    "verbs": ["Optimizing your prompt", "Auditing for CVEs"]
  }
}
```

Two modes: `"replace"` (overrides Claude Code's defaults entirely) and `"append"` (adds ruflo's verbs to the rotation). The verbs must be present participle (`-ing` form). Only the text is customizable — the animated ASCII/braille character is compiled into Claude Code.

Today, ruflo does not touch this surface. The user's initial ask was to expose ads/guidance in the "✽ Channeling…" area — which turns out to be exactly what `spinnerVerbs` targets. This ADR wires ruflo into it.

## Decision

Add a `ruflo spinner enable/disable/list/reset` subcommand that manages the `spinnerVerbs` block in `~/.claude/settings.json` on the user's behalf. Ships in the same PR as ADR-317 (per product decision) because both are opt-in add-ons to the same funnel spine.

### Guarantees

1. **Append only, never replace.** Ruflo will never write `mode: "replace"` because that clobbers Claude Code's default verbs (which some users have grown attached to). If a user has already set `replace` themselves, `ruflo spinner enable` refuses with a clear message pointing them to `disable` or manual edit.
2. **Backup before write.** Every write copies the current `settings.json` to `~/.claude/settings.json.bak-YYYYMMDD-HHMMSS` before touching it. `ruflo spinner reset` restores the most recent backup and removes the ruflo-managed verbs.
3. **Namespaced verbs.** Ruflo tags each verb it appends with an invisible marker (leading zero-width joiner + specific marker sequence) so `disable` can strip only ruflo verbs without touching user-authored ones. See §Removal invariant.
4. **Validation at ingest.** Every verb from the remote pool is checked:
   - Ends in `ing` (case-insensitive)
   - ≤ 30 characters after strip
   - No control chars, no ANSI, no URLs, no bidi overrides
   - Not identical to a Claude Code default verb (avoid stealing weight from theirs)
5. **Full mix from day one** (per product decision this PR): Cognitum-branded verbs and neutral tips both rotate together. The consent moment IS the disclosure — `ruflo spinner enable` prints a preview of the pool including at least one Cognitum-tagged verb before asking for confirmation.

### Removal invariant

Because the `spinnerVerbs.verbs` array is a plain string list with no per-entry metadata, ruflo tags each managed verb with a zero-width marker suffix:

```
"Consulting Cognitum‍‍‍"
```

The three ZWJs are visually invisible in every terminal that renders them, take zero display cells, and act as a stable "this is ours" tag no user is likely to type by accident. On `disable` / `reset`, ruflo strips only entries containing the marker; user-authored entries are preserved byte-for-byte.

If Claude Code adds real per-entry metadata later, migrate to that immediately. Until then, the ZWJ tag is the least-invasive marker we can use.

### CLI surface (`src/commands/spinner.ts`)

- **`ruflo spinner enable [--yes]`** — one-time disclosure of the pool + confirmation prompt (skippable with `--yes`), then append the current verb set to settings.json, backing up first. Records consent domain `spinner-verbs`.
- **`ruflo spinner disable`** — strip ruflo-tagged verbs from settings.json (leaves user-authored ones intact), revokes consent.
- **`ruflo spinner list`** — print the current ruflo pool + which verbs are actually installed in settings.json + Claude Code's default verbs (fetched from `spinnerVerbs` schema if available; otherwise omitted).
- **`ruflo spinner reset`** — restore the most recent `.bak-*` snapshot of settings.json and revoke consent. Destructive; requires `--yes`.

### Data flow

```
consent + settings.json backup
        │
        ▼
ruflo verb pool (v0: baked, v1: served from funnel.ruv.io/v1/messages
  with class=spinner-verb)
        │
        ▼
Append marked verbs → ~/.claude/settings.json spinnerVerbs.verbs[]
        │
        ▼
Claude Code renders random verb per spin (its own logic — we don't hook the spin)
```

### v0 verb pool (baked into this PR)

Ten verbs, mix of neutral and Cognitum-tagged, all validated:

Neutral:
- "Optimizing your prompt"
- "Consulting the memory graph"
- "Warming the HNSW index"
- "Learning from the trajectory"
- "Auditing for CVEs"
- "Sharpening the plan"

Cognitum-tagged:
- "Consulting Cognitum"
- "Checking Cognitum credits"
- "Routing via Cognitum"
- "Fetching a Cognitum tip"

v1 (deferred to Phase 1): fetch verb pool from `funnel.ruv.io/v1/messages?class=spinner-verb`, use the same message-cache infrastructure as ADR-311. Cache TTL 24h. On failure, keep the last-known-good verb list.

## Consequences

**Positive**
- Directly answers the user request "the spinner isn't updated locally."
- Reuses the funnel consent + remote-pool pattern; no new infrastructure to spin up.
- Append-only + backup + marker discipline means the operation is fully reversible.

**Negative**
- The ZWJ marker is a hack. A malicious verb source that omits the marker would be indistinguishable from user-authored verbs on `disable`. Mitigation: verb pool is server-controlled, and validation refuses anything with unexpected unicode.
- "Full mix from day one" (product decision) technically bypasses ADR-311's "disclosure before promotional content" invariant for this surface. Mitigation: the `enable` confirmation prompt IS a per-user disclosure, and Cognitum-tagged verbs are named in the preview.
- Claude Code may change `spinnerVerbs` schema in a future version, breaking ruflo's writer. Mitigation: `list` inspects live settings and reports drift; if schema changes, `disable` still works (the marker strip is schema-independent).

**Neutral**
- Users can already do this manually. Ruflo just makes it opt-in easy + adds a curated, growing pool.

## Out of scope

- Fetching from the remote pool (deferred to v1)
- Analytics on which verbs are seen (Claude Code doesn't expose per-render telemetry to hooks; we can't tell which verb was picked)
- Per-context verbs (e.g., "Auditing for CVEs" only when a security-related tool is being called) — would require Claude Code to hook into verb selection, which it doesn't
- Rev share on verb impressions (ADR-317 covers link-clicks; spinner verbs have no click surface)
