# ADR-319: Ruflo announcements via Claude Code `companyAnnouncements` settings

- **Status**: Proposed
- **Date**: 2026-07-14
- **Deciders**: ruv
- **Related**: [ADR-317](ADR-317-developer-revenue-share.md), [ADR-318](ADR-318-spinner-verbs-surface.md) (sibling surface — same architectural pattern, different Claude Code settings key)

## Context

Claude Code exposes a `companyAnnouncements` key in `~/.claude/settings.json` — a string array shown at Claude Code startup, cycled at random if multiple entries exist:

```json
{
  "companyAnnouncements": [
    "Welcome to Acme Corp! Review our code guidelines at docs.acme.com"
  ]
}
```

This is higher-attention than the spinner row (shown once per session, prominently) and lower-frequency (once per Claude Code launch vs. every processing pause). Different volume, different placement, different economics — but the same architectural pattern as ADR-318's spinner-verbs surface.

The request that motivated this ADR was "can we include tip text also?" — asking about the "Tip: Double-tap esc…" hint text. That specific hint isn't documented as customizable, but `companyAnnouncements` is the closest documented surface and covers the same "give ruflo a place to speak" intent.

## Decision

Add a `ruflo announcements enable/disable/list/reset` subcommand that appends ruflo's curated pool to `~/.claude/settings.json`'s `companyAnnouncements` array. Ships in the same PR as ADR-318 (per product decision) with the identical guarantees.

### Guarantees (inherited from ADR-318, adapted for a plain string[])

1. **Append only.** Ruflo entries are appended to any existing array; existing user-authored announcements are preserved verbatim.
2. **Backup before write.** Same `.bak-YYYYMMDD-HHMMSS` pattern as ADR-318.
3. **ZWJ-marker tagged.** Every announcement ruflo appends carries the same invisible marker suffix so `disable` strips only ruflo entries.
4. **Validation at ingest**:
   - ≤ 140 characters after strip (a hard cap that fits comfortably on one terminal line)
   - No control chars, ANSI, bidi overrides, URLs (the surface has no click semantics — a URL would just render as text and confuse)
   - Not identical to a Claude Code default or user-authored announcement
5. **Full mix from day one** (same product decision as ADR-318): the enable confirmation prompt IS the disclosure — the pool is printed in full before consent is recorded.

### v0 pool (baked, ~12 entries)

Neutral (product tips, ~85%):
- "🧠 Ruflo intelligence is learning from your work — `ruflo intelligence stats` to see progress."
- "📊 Statusline promo row is on — `ruflo funnel status` to manage."
- "🔧 12 background workers help maintain your codebase — `ruflo daemon start` to enable."
- "🔍 Semantic memory search across projects — try `ruflo memory search --query \"...\"`"
- "🩺 Run `ruflo doctor --fix` if something feels off."
- "✨ 37 spinner verbs added — `ruflo spinner list` to see the pool."
- "🛡 Security scanner is available — `ruflo security scan --depth full`."
- "💾 Nightly memory backups keep your intelligence safe — `ruflo daemon status`."
- "🎯 3-tier model routing keeps your spend down — `ruflo cost report` for details."

Cognitum-tagged (~15%):
- "📣 Ruflo is sponsored by Cognitum — visit cognitum.one to learn more."
- "💳 Check Cognitum credits: `ruflo proxy status`."
- "⚡ Cognitum handles overflow routing when your model hits limits."

v1 (deferred): serve from `funnel.ruv.io/v1/messages?class=announcement` — same infra as ADR-311. Cache TTL 24h.

### CLI surface (`src/commands/announcements.ts`)

Mirror of `commands/spinner.ts`:

- `ruflo announcements list [--json]` — pool + installed + user-authored
- `ruflo announcements enable [--yes]` — preview + write (requires `--yes` to actually write)
- `ruflo announcements disable` — strip ruflo entries only
- `ruflo announcements reset --yes` — restore most recent settings.json backup

New consent domain `company-announcements` — separate from `spinner-verbs` because they're different surfaces the user might reasonably want independently.

## Consequences

**Positive**
- Answers "give ruflo a place to say something on startup." Higher-attention than spinner verbs (once per session, prominently rendered).
- Same architecture as ADR-318; almost all logic is a copy-paste from `commands/spinner.ts`. Ships with confidence.

**Negative**
- Duplication with `commands/spinner.ts` — both files handle backup + append + marker-based removal identically. Worth refactoring to a shared `funnel/settings-append.ts` helper after both are stable.
- Startup announcements are more intrusive than spinner verbs (users see them at session start, one prominent line vs. a per-spin flash). If users start disabling in bulk, we should measure and cut back.
- No per-announcement telemetry (Claude Code doesn't tell hooks which announcement was picked), so we can't measure engagement per entry.

**Neutral**
- Same "full mix from day one" tradeoff as ADR-318 — the enable prompt is the disclosure moment.

## Out of scope

- Fetching pool from remote (deferred to v1)
- Tip text near the spinner ("Tip: Double-tap esc...") — that specific surface is not documented as customizable
- Per-announcement engagement telemetry
- Migration off ZWJ marker if Claude Code adds per-entry metadata later
