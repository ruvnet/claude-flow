# ADR 438: Research integration: the deep-researcher record, the console section and the guard

Status: Accepted (shipped in ruflo-console 0.28.0 and its companion plugins, PR #3667)

Date: 2026 10 04

Scope: `plugins/ruflo-goals` (agent, skill), `plugins/ruflo-console` (Missions "Research" section, start and confirm), `plugins/ruflo-mods` (web-fetch guard)

Source: research report on plugin and console integration (2026-10-04). Companion ADRs: 439 (console start and confirm), 440 (the guard).

## 1. Decision

Make deep research visible, capped and consented to, with one record that all three pieces share.

- **A capped, screened agent.** `deep-researcher` and the `deep-research` skill take a spend cap (USD) and a depth (quick, standard, deep). Fetched text is screened with AIDefence before it is stored or quoted. When the cap is reached the run stops and the record says `truncated`.
- **One record**, written to memory namespace `research`, key `research-<slug>-<yyyymmddhhmm>`, value JSON:
  `{ "version": 1, "question": string, "depth": "quick"|"standard"|"deep", "capUsd": number, "spentUsd": number|null, "status": "done"|"truncated"|"failed", "at": ISO-8601, "findings": [ { "claim": string, "grade": "High"|"Medium"|"Low", "sources": [string] } ], "screened": boolean }`.
  `spentUsd` is `null` when unknown; it is never invented. Grades are the agent's existing High/Medium/Low.
- **A run marker** for the guard: while a run is active the skill writes `.claude-flow/research-active.json` (`{ "question": string, "capUsd": number, "startedAt": ISO-8601 }`) and removes it at the end. A stale marker (older than 2 hours) is ignored.
- **Console, read-only first.** The Missions page gets a "Research" section that lists the newest records (question, status, finding count, grade counts, spend). Same pattern as the Cost page: the data comes from a probe that runs only while the page is in front; absent / too-old / ready states for the `ruflo-goals` plugin (ready from 0.3.0). Nothing is stored or started by this section.
- **Start and confirm (ADR 439).** A question field, depth and cap; the question is screened first; a confirm row says in words that it starts a billed Claude Code turn and allows web search and fetch up to the cap. The console only prepares the command; it never fetches.
- **The guard (ADR 440).** In `ruflo-mods`, a `tool.check` hook asks before the first `WebFetch` or `WebSearch` of a run that has a fresh marker, and never loosens another verdict. The console's own `tool.call` and `tool.check` stay observe-only.

- **Loop-centric missions (ADR 441).** The mission system's settings and guidance prompts teach and default to loop-driven development: a bounded `/loop` with a fixed interval, a tick that checks progress, fixes failures and runs named gates, writers in isolated worktrees with disjoint file ownership, stated defaults instead of mid-loop questions, an explicit finish condition, and no commit, push or publish beyond the branch without the user's word.

## 2. Defaults taken (the user can change them)

- Research spend counts against the shared cost-tracker budget, not a separate one; the per-run cap is an additional limit.
- One confirm allows web fetching for the run; it is not per domain.
- Findings are written to memory only after the user accepts the report; until then the record is held in the report, and `status` stays `done` only once stored.
- All hooks live in `ruflo-mods`; no new `ruflo-goals` mod.
- The view is a Missions section, not a new page, so `VIEWS` and `state.ts` do not change.

## 3. Constraints

- Console smoke: no `$.http` beyond the one update check; no node imports in hooks; every file at most 500 lines (`controller.ts` is at 498, so wiring goes in new files); new specs are listed in the CI baseline file.
- `ruflo-goals` must keep working with no console installed. The console must keep working with no `ruflo-goals`.
- Versions: `ruflo-goals` 0.3.0 (and its smoke), `ruflo-console` 0.28.0 (and `version.ts`, smoke step 1), `ruflo-mods` per its own rule.

## 4. Not decided here

- Whether subagent turns of a research run appear in the Cost ledger: UNVERIFIED, to be measured, not assumed.
- Per-domain consent, a new Research page and a `ruflo-goals` mod are deferred.
