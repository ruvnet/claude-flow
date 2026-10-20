# ADR 455: The learning pipeline diagram and the router picture

Status: Accepted

Date: 2026-10-05

Builds on: ADR-404 (ruflo as a mod; who owns `route`), the Learning page's pipeline and Router blocks

## 1. Context

The Learning page printed the four pipeline stages as one line of text and the router's last pick as a sentence. Two things a person wants were not visible: which stage has stopped learning, and what the router considered besides its winner. The console already reads every number needed; this adds pictures, not probes.

## 2. Decision

**Pipeline diagram.** `gfx/pipeline.ts` draws RETRIEVE, JUDGE, DISTILL, CONSOLIDATE as four boxes with the counts `stagesOf` already returns (trajectories, routed outcomes, patterns learned, EWC consolidations) and a note line with the age of the source.

**Staleness** (`data/pipeline.ts`, `STALE_AFTER_MS`): a stage is *stale* when its source has a timestamp and that timestamp is more than 24 h old (the threshold the Router block already uses for routed outcomes). Timestamps used: RETRIEVE and DISTILL, `neural/stats.json` `lastAdaptationMs`; JUDGE, the newest point of `routing-outcomes.json`. CONSOLIDATE's counter comes from a fresh `hooks_intelligence_stats` process and has no timestamp, so its age is "n/a" and it is never dimmed for age (an unknown age is not read as old). A stage with no count is *absent*: dim, "n/a". A stale or absent stage is drawn dim, and so is the arrow into it; a stale note is amber so the reason stays readable.

**Router picture.** Candidates with confidence bars, the pick first, under one line saying who owns routing: the mod, the classic hook-handler (`classicOwnsRoute`, reused unchanged from the view), or ruflo-mods not seated. Two real sources, in priority order:
1. the person's last Lab `nn-route` result (from `hooks route --format json`), which carries runner-ups; parsed from its printed lines (`→ agent · N%`, `  or agent · N%`);
2. ruflo-mods' in-process `lastRoute`, which stores only the winner, so one bar and a line saying runner-ups need a route query.
With neither, the picture says no route is recorded. No candidate is ever invented.

The view draws both pictures itself from live state (`drawn()` in `views/learning.ts`) instead of through the `picturesOf` registry in `views/frames.ts`, which this change does not touch. Where the terminal has no `Raster`, the same facts print as text.

## 3. Consequences

- Reading the route lines couples the picture to the Lab's line format (`neural.ts` `routeRead`); a format change yields no candidates and the mod pick or the empty state is shown, never a wrong bar. The coupling is covered by a test.
- Nothing new is read, spent or written. The page still has no mutation here.
- `frames.ts` still builds the older `pipeline` picture, now unused by Learning; the integrator can drop it.

## 4. Test and benchmark plan

`tests/pipeline.spec.ts`: staleness boundaries (exactly 24 h is live, past it stale, absent, unknown age, future timestamp), notes, diagram text and dimming by cell colour, narrow width, owner words, route-line parsing (clamps, missing percent, non-route text), source priority, bars and the empty state, and the page both with and without `Raster`. Pure functions, no I/O; each drawing is a 5-row grid, so cost is negligible and no benchmark is needed.

## 5. Rollback

Remove `gfx/pipeline.ts`, `data/pipeline.ts` and the spec, and restore `views/learning.ts` (the `picture(ctx, 'pipeline', ...)` call and the sentence-only route). No state, command or file format depends on them.
