# ADR-379 — Optional Context/Session/Week Usage Segments and Extra Statusline Lines

- **Status**: Proposed
- **Date**: 2026-07-30
- **Related**: ADR-301 (Promotional Status Surface — the existing rotating Line 3 mechanism this
  ADR builds alongside), ADR-311 (funnel analytics/click-redirect, referenced by the promo row
  this ADR does not modify)
- **Reference artifact**: `/home/ruvultra/projects/ruflo/image.png` — a screenshot of a
  statusline (project `july-genesis`, **not** a ruflo repo) showing a header row with
  `Opus 5 · eff:xhigh · Projects/july-genesis · main ✚19 · 24%/(3M) · session 0% · week 51% ·
  $49.48 · 12:27pm PT/3:27pm ET · /rc`, followed by four rotating tip/quote lines (a `.gitignore`
  tip, a "what should I do next?" prompt, a "staging" definition, and a John Doerr quote).

## Context

### What ruflo's statusline already does

`.claude/helpers/statusline.cjs` renders a deliberately **3-line** layout, per its own doc
comment (lines 802–806):

```
Line 1 — Header (RuFlo version · git · model · timing · context · cost)
Line 2 — Compressed ops (Swarm · Hooks · 🧠 · 💾 · Health)
Line 3 — Promo / disclosure row (funnel surface, ADR-301)
```

That cap is load-bearing, not arbitrary — the comment explains it's sized to "fit Claude Code's
visible statusline area (line 4+ gets replaced by the system guidance / input prompt line)."
Line 3 already rotates through four content kinds (`disclosure`, `promotional`, `educational`,
`insight` — see `getPromoRow()`), server-selected by the CLI's funnel/promo subsystem on a 20s
rotation slot. This is functionally similar to the tip lines in the reference screenshot, but
today it is **one line at a time**, not several simultaneous lines.

The file already has a working precedent for **optional segments**: `CONFIG.hideCost` /
`RUFLO_STATUSLINE_HIDE_COST` lets a user remove the cost segment from Line 1 without touching
code, and `RUFLO_FUNNEL=0` disables Line 3 entirely. Context usage (`ctxInfo.usedPct`), by
contrast, has **no** hide toggle today — it renders unconditionally whenever
`getContextFromStdin()` returns a positive percentage.

### What ruflo's statusline does not have

Two segments visible in the reference screenshot have no equivalent in this file at all:

- **`session 0%` / `week 51%`** — usage against Anthropic's 5-hour and 7-day (weekly) rate
  limits. `getStdinData()` currently reads `model`, `context_window`, and `cost` from the
  Claude Code stdin payload; nothing here reads or expects a session/week usage field.
- **`eff:xhigh`** — the active reasoning-effort level. Also absent from `getStdinData()` and
  from every function in this file.

### Grounding check (per the RuvNet Brain requirement to verify before asserting)

Before proposing a schema, `search_ruvnet` was queried against the decompiled Claude Code
research corpus (`ruvector/docs/research/claude-code-rvsource/07-context-and-session-management.md`,
built from reverse-engineering the actual Claude Code CLI) and against `open-claude-code`'s
ADR-002 fidelity gap-analysis. **Neither documents a session-usage or week-usage stdin field.**
That research doc is detailed on context windows, compaction, session persistence, and prompt
caching, but has no mention of a 5-hour/weekly rate-limit percentage being exposed to
statusline scripts. This does not prove the field doesn't exist in a Claude Code version newer
than that research pass — it means **this ADR cannot assume a concrete field name or shape**,
and implementation must start with a verification spike rather than a schema guess (see
Decision §2 and Implementation Plan Phase 0).

## Decision

Add each of the reference screenshot's extra segments as an **independently optional** piece
of the existing 3-line design, following the `hideCost` precedent exactly (additive `CONFIG`
field + env var, never a required behavior change), rather than redesigning the layout. Where
the underlying data source is unconfirmed (session %, week %, effort), default the segment to
**off** until a spike confirms how to source it — this repo does not ship guessed/placeholder
data in a statusline that people trust for real numbers (cost, security status, etc. are all
sourced from real state elsewhere in this file; a fabricated usage percentage would break that
trust).

### 1. Context % — make it hideable (low-risk, data already exists)

Add `CONFIG.hideContext` / `RUFLO_STATUSLINE_HIDE_CONTEXT`, mirroring `hideCost` exactly:

```js
hideContext: /^(1|true|yes|on)$/i.test(process.env.RUFLO_STATUSLINE_HIDE_CONTEXT || ''),
```

Guard the existing render block (`statusline.cjs:827`) with `if (!CONFIG.hideContext && ctxInfo
&& ctxInfo.usedPct > 0)`. Default **shown** (`false`), so existing behavior is unchanged for
everyone who doesn't set the var — this is a pure opt-out addition.

### 2. Session % and week % — spike first, ship behind a flag, default off

These cannot be implemented today without knowing where the numbers come from. Phase 0
(Implementation Plan) determines which of the following is true, in this preference order:

1. **Claude Code's stdin payload already includes it** under some field this file hasn't been
   updated to read (most likely candidate names to probe: `data.usage`, `data.rate_limits`,
   `data.session_usage` / `data.week_usage` — verify against a live payload dump, don't guess
   in code).
2. **Claude Code exposes it via a separate mechanism** (e.g. a `/usage`-equivalent CLI
   subcommand, or a file under `~/.claude/`) that this script would need to shell out to or
   read, similar to how `getPkgVersion()` already probes multiple candidate paths.
3. **Neither exists yet**, and the numbers in the reference screenshot come from a different,
   non-stock statusline tool — in which case this repo computes its own approximation from
   local session transcripts (`~/.claude/projects/<hash>/*.jsonl`, already known to exist per
   the Session Persistence research cited above) against Anthropic's published 5-hour/weekly
   window semantics. This is the most expensive path and should only be taken if 1 and 2 are
   both dead ends.

Once a real source is confirmed, add `getSessionUsageFromStdin()` / `getWeekUsageFromStdin()`
(or the equivalent for whichever source won the spike) following the exact null-safe pattern
`getContextFromStdin()` already uses — return `null` on any missing/malformed data, never
throw. Render behind two new flags, **defaulting to hidden**:

```js
hideSessionUsage: !/^(1|true|yes|on)$/i.test(process.env.RUFLO_STATUSLINE_SHOW_SESSION_USAGE || ''),
hideWeekUsage:    !/^(1|true|yes|on)$/i.test(process.env.RUFLO_STATUSLINE_SHOW_WEEK_USAGE || ''),
```

Note the inverted polarity versus `hideCost`/`hideContext` — those hide something known-good by
default-on; these are opt-**in** (default-off) because, unlike cost/context, there is no
existing confirmed data path, so shipping "on by default" risks showing a stale/wrong number
until the spike lands and the feature is validated end-to-end for at least one release.

Color threshold convention should match the existing context-percentage bands
(`>=90` red, `>=70` yellow, else green — `statusline.cjs:828`) for visual consistency across
all three usage segments.

### 3. Reasoning effort — same spike-first, default-off treatment as session/week

`eff:xhigh` needs its own verification: does Claude Code's stdin payload carry the active
effort level anywhere under `data.model` or a sibling field? If yes, add
`getEffortFromStdin()` next to `getModelFromStdin()`; render behind
`RUFLO_STATUSLINE_SHOW_EFFORT` (default off, same reasoning as §2). If the effort level is not
in the stdin payload at all, this segment is descoped from this ADR — do not infer it from
environment variables or config files that could drift from the actual runtime effort.

### 4. "Other optional lines" — respect the documented 3-line invariant by default

The reference screenshot shows **four** simultaneous tip/quote lines, which conflicts with this
file's own documented constraint that line 4+ gets silently replaced by Claude Code's system
UI. Do not change the default line count. Instead:

- Keep Line 3 (the existing single rotating promo/tip/insight row) exactly as-is — no change.
- Add an **opt-in, explicit-risk** `RUFLO_STATUSLINE_EXTRA_TIP_LINES` (integer, default `0`,
  clamp to `0–3`) that appends up to N additional lines below Line 3, sourced from a small,
  local, static `TIP_POOL` array shipped in this file (git/workflow tips and quotes, in the
  spirit of the reference screenshot's `.gitignore` / "staging" / John Doerr lines) — **not**
  the funnel/promo server payload, since these are meant to be plain educational/static content,
  not promotional or personalized.
- Document, next to the env var and in this ADR, that setting it above `0` means some or all of
  those lines may be visually overwritten by Claude Code's own input-prompt UI depending on
  terminal height and Claude Code version — this is a known, accepted tradeoff for users who
  explicitly opt in, not a bug to chase.
- Rotate through `TIP_POOL` using the same 20s-slot cadence already established for Line 3
  (`ROTATION_SLOT_MS`, referenced in the existing comment at `statusline.cjs:61-69`) so the
  extra lines feel consistent with the existing rotation rather than introducing a second timing
  system.

### 5. Implementation discipline (applies to every new segment above)

- Every new field is additive to `CONFIG`, env-var gated, and defaults to preserving current
  output for anyone who sets nothing.
- Every new data getter follows `getContextFromStdin()`'s null-safe shape: return `null`/`false`
  on anything missing or malformed, never throw — consistent with `getPromoRow()`'s own
  `try { … } catch { return null; }` wrapper, which exists specifically so "the promo row must
  never break the statusline" (statusline.cjs:1037-1039). The same invariant applies to every
  segment added by this ADR.

## Alternatives Considered

- **Unconditionally add all four screenshot segments, always on.** Rejected — breaks the
  documented "fits Claude Code's visible area" invariant for every user by default, and ships
  session%/week% numbers before their data source is even confirmed to exist.
- **A separate "verbose statusline" mode as a whole alternate script/file.** Rejected — this
  file already has a working single-source-of-truth CONFIG-toggle model (`hideCost`,
  `identityMode`, `RUFLO_FUNNEL`); forking a second file duplicates the git/cost/security
  plumbing this one already does carefully (single execSync call, 2s timeouts, shared cache)
  for no real benefit.
- **Guess a stdin field name for session/week usage now and ship it.** Rejected — the grounding
  check found no confirmed source for this data. Shipping a guessed field name that silently
  returns `null` forever (because the real field, if any, has a different name) would look like
  a shipped feature that quietly never works — worse than not having it, because it's not
  discoverable as broken.

## Consequences

### Positive

- Context-hide toggle is a same-day, zero-risk addition — pure opt-out, data already exists.
- Session/week/effort segments, once their source is confirmed, slot into the exact pattern
  every other optional segment in this file already uses — no new architecture, no new config
  surface shape to learn.
- The extra-tip-lines feature gives users who want the reference screenshot's denser look a way
  to get it, without silently changing the default experience for everyone else.

### Negative / risks

- **The single biggest risk is Decision §2/§3's open question**: if Claude Code does not expose
  session/week usage or effort level to statusline scripts at all, those segments simply cannot
  ship as designed, and the fallback (computing usage windows from local transcripts) is
  materially more work and carries its own accuracy risk (Anthropic's exact 5-hour/weekly
  window boundaries and reset semantics would need to be reverse-engineered, not just read).
- More `CONFIG`/env-var surface area to document and keep consistent (inverted default polarity
  between the "hide a known-good thing" group and the "opt into an unconfirmed thing" group is
  a deliberate but easy-to-forget asymmetry — call it out in the code comment, not just here).
- `RUFLO_STATUSLINE_EXTRA_TIP_LINES` users may see their own terminal visually clip/overwrite
  the extra lines depending on Claude Code version and terminal height — accepted tradeoff, but
  worth a one-line note in `ruflo doctor` output or docs so it isn't reported as a bug.

## Implementation Plan (phased)

- **Phase 0 — Spike (no shipped code change).** Dump a real Claude Code stdin payload
  (`cat` what this script actually receives on stdin during a live session) on a current Claude
  Code version and grep it for anything resembling session/week usage or an effort field.
  Cross-check against Claude Code's own `/usage`-style output if one exists. This phase's output
  is a yes/no answer per segment plus, if yes, the exact field path — not code.
- **Phase 1 — Context hide toggle.** Ship `RUFLO_STATUSLINE_HIDE_CONTEXT` per Decision §1.
  Independent of Phase 0; can ship immediately.
- **Phase 2 — Session/week/effort (conditional on Phase 0).** If Phase 0 found a real field,
  implement the three getters + render blocks behind their default-off flags. If Phase 0 found
  nothing, this phase either takes the local-transcript-computation fallback (Decision §2 item
  3) as a separate, explicitly-scoped follow-up ADR, or is dropped.
- **Phase 3 — Extra tip lines.** Ship `TIP_POOL` + `RUFLO_STATUSLINE_EXTRA_TIP_LINES`,
  independent of Phase 2.
- **Phase 4 — Docs.** Note all new env vars alongside the existing `RUFLO_STATUSLINE_*` /
  `RUFLO_FUNNEL` docs (wherever those are currently documented for end users), including the
  visible-area tradeoff warning for Phase 3.

## Open Questions

- Does Claude Code's stdin payload carry session/week usage or effort level under any field
  today, and if so, what's the exact shape? (Blocks Phase 2 — see Phase 0.)
- If no stdin source exists, is a locally-computed approximation from `~/.claude/projects/*/*.jsonl`
  accurate enough to be trustworthy, or does it risk showing a confidently-wrong number (arguably
  worse than showing nothing)?
- Should the extra tip pool (Decision §4) ever be user-extensible (e.g. a project-local
  `.claude/statusline-tips.json`), or does that add more surface area than the feature is worth?

## References

- `.claude/helpers/statusline.cjs` — existing 3-line design doc comment (lines 802–806),
  `CONFIG.hideCost` precedent (lines 34–42), `getContextFromStdin()` (lines 598–604),
  `getPromoRow()` and its rotation-slot comment (lines 61–69, 937–1039)
- ADR-301 — Promotional Status Surface for CLI Runtime (the existing Line 3 mechanism)
- `ruvector/docs/research/claude-code-rvsource/07-context-and-session-management.md` —
  decompiled Claude Code research; cited as the negative-evidence source for "no documented
  session/week usage stdin field" in the Context section above
- `open-claude-code/docs/adr/ADR-002-path-to-100-percent.md` — independent Claude Code
  reimplementation's own feature-gap analysis, also silent on a session/week usage field
