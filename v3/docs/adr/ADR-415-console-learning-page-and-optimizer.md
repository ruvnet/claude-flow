# ADR 415: The Learning page and the ruflo Optimizer

Status: Accepted (ships in ruflo-console 0.16.0 and 0.17.0)

Date: 2026 10 03

Decision owner: Ruflo maintainers

Scope: `plugins/ruflo-console`: `hooks/views/learning.ts`, `hooks/views/learning-pulse.ts`, `hooks/pulse.ts`, `hooks/neural.ts` (the new entries), `hooks/optimizer.ts`, `hooks/views/optimizer.ts` (a section of the Overview).

Extends: ADR 412 (answers open where asked). Detail of ADR 408 sections 13 and 14.

## 1. Context

Ruflo's value compounds when it learns (patterns, the router, memory, vectors) and degrades quietly when it does not. The Learning page showed numbers and three static pictures; learning actions lived in a separate lab; nothing told a person what was thin or broken or how to fix it. rUv asked for better animated charts and graphs, collapsed settings and configuration, more self-learning capabilities, and an optimizer that finds and fixes problems and improves learning, vectors and other advanced features, with options and results to click.

## 2. Decision

### 2.1 Learning page (0.16.0)
- **Learning pulse:** text charts that move while the page is in front: a marker travels RETRIEVE → JUDGE → DISTILL → CONSOLIDATE; the router's model mix is a bar chart with a highlight sweeping each bar; the running success rate over the last 24 routed outcomes is a sparkline with a scanning cursor; SONA's trajectories, patterns and signals are gauges. They draw only what was measured (no data, no chart; `n/a` says so). The frame loop asks for a redraw about three times a second (`pulseDue`, 350 ms) only while the Learning page is shown and focused.
- **Settings & configuration (folded):** `neural.enabled` and `hooks.enabled`, each a confirm-gated `ruflo config set` through the Settings actions.
- **Self-learning actions (folded)**: the Learning Lab's rows on this page plus new entries, all fixed argv through `mcp exec`, none calling a paid model: pretrain at three depths (`hooks_pretrain`: local, reads the repository, writes the intelligence store), consolidate (`agentdb_consolidate`, no options), pattern search (`hooks_intelligence_pattern-search`, a read), teach a pattern (`hooks_intelligence_pattern-store`, a local write). Each is also `/ruflo run nn-...`. Their answers open under the pressed button (ADR 412).

### 2.2 The Optimizer (0.17.0)
A section at the top of the Overview: **findings** from what the console already measured, worst first (nothing learned yet; the router missing under 60% of at least 10 outcomes; no router state; memory unchecked; thin vector coverage; a second memory store; a store large enough to compact; performance unmeasured; every alert the console already raises; the full health check), each with a **fix per button** that is an existing palette entry (so it asks first and adds no new way to write), a **scope** (safe, balanced, deep) limiting which fixes are offered, the metric **before and after** a fix, and **✦ ask Claude** about a finding. An unread store is a finding to check, never a verdict.

## 3. Alternatives considered

- **Real-time graphs from the daemon.** Rejected: the console reads files and local JSON only; a text pulse driven by the clock over measured data needs nothing new.
- **A new Optimizer view.** Rejected: no hotkey is free; the Overview is where health already lives.
- **One-click "fix everything".** Rejected: each fix writes ruflo's stores and asks; chaining confirms hides what is being agreed to. The scope and per-finding buttons keep each yes small.
- **Auto-optimise on a schedule.** Rejected here; the Loop Manager (ADR 414) can run the optimize worker if a person wants that, with its own cost note.

## 4. Consequences

- The Learning page has life without polling anything new; the redraw costs one invalidate per 350 ms while shown.
- A fix that names a palette entry that does not exist fails a spec: the Optimizer cannot ship a dead button.
- Findings depend on what has been read: opening Memory makes memory findings sharper.

## 5. Safety

No entry calls a paid model; every write asks first with its argv and note; pretrain and rebuilds are local compute that writes ruflo's own stores; model downloads are only in the deep scope; nothing is deleted from here.

## 6. Tests

`tests/learning.spec.ts` (argv, validation, headless ids, the pulse timer), `tests/learning.test.ts` (the pulse moves over real time; the folded sections; a confirm under the pretrain strip), `tests/optimizer.spec.ts` (findings, scopes, every fix a real palette entry, before/after, ask), `tests/optimizer.test.ts` (the section in the Overview; a fix's confirm sits under its finding; nothing runs before yes).
