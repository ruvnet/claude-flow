# ADR 453: Project Anatole: an optional, learning watchdog for unattended agents

Status: Proposed (default off; nothing here is built when this is merged)

Date: 2026-10-05

Builds on: ADR-404 (ruflo as a mod), ADR-444 (Claude controls the console), ADR-445 (AgentDB as a mod), ADR-446 (the plugin fleet as mods), ADR-450 (threat model of the mod system), ADR-451 (mod capability roadmap), ADR-452 (overnight hardening); related ADR-449 (guidance learning loop)

Evidence: the guard probe and capability review under `v3/docs/validation/` (`mod-guard-probe-2026-10.md`, `mod-capability-review-2026-10.md`); OWASP Top 10 for LLM Applications (2025) and the OWASP Agentic AI "Threats and Mitigations" guide. The numbering of both lists below is from memory of those documents and must be checked against the current publication before it is quoted outside this repository.

## 1. Context

Most agent work now runs with nobody watching: `/loop` ticks, sentries, headless `claude -p` workers, overnight swarms. The protections that exist are good but static and per-tool:

- the mod guards (ADR-445, ADR-446, ADR-452) refuse a secret in a specific write, a dangerous shell command, a fuzzy console action;
- the console (ADR-444, ADR-450) limits what Claude may drive;
- AIDefence scans text on request.

None of them answers the questions a person would ask if they were watching: *is this a normal thing for this project to do? did something I just read tell the agent to do this? is the agent suddenly doing much more than usual, or reaching somewhere it never has?* Each guard sees one call in isolation, so a slow or multi-step attack made of individually plausible calls passes. Nothing remembers what "normal" looks like, and nothing tells the person, in one place, what was blocked or noticed while they were away.

An anti-virus for agents has the same two jobs as the desktop kind: known-bad signatures that are blocked with high confidence, and behavioural baselines that flag the unusual. The failure that kills such a product is false positives: a protector that cries wolf gets switched off, and an unattended agent that is blocked for a harmless reason stalls a whole run. The design below is organised around not doing that.

## 2. Decision

**Project Anatole** is the name of this feature, and of nothing else: the mod system, the console and the other plugins keep their names. Anatole is an **optional** plugin, `ruflo-protector`, a mod in the ADR-404 pattern, plus a **Project Anatole** section in the console's Security & Doctor page for listing, running and editing it. The technical identifiers below (`ruflo-protector`, `/protector`, `.claude-flow/protector-mod/`, rule ids `PR-###`) stay descriptive; "Project Anatole" is what a person sees. It is not part of any default install.

1. **Two kinds of signal, never mixed up.** *Rules* are deterministic, mapped to OWASP, and the only thing that can ever block. *Anomalies* come from a learned baseline and can only notify, and only when corroborated by a risky action. A baseline can never turn a rule off or whitelist a rule's class.
2. **Four modes, no automatic escalation to blocking.** `off`, `learn` (the default once installed: record the baseline, say nothing), `notify` (alert, never block), `enforce` (rules marked `block` deny, everything else still only notifies). The plugin may graduate `learn` to `notify` when the baseline is mature. It never enables `enforce` by itself.
3. **Fail open, say so.** An error in the protector never blocks a tool call; it sets `degraded` in the status file and shows in the console.
4. **Everything the person needs is in one place.** Alerts, the baseline's maturity, rule modes and the false-positive record are files under `.claude-flow/protector-mod/`, shown and edited from the Security page and from `/protector`.

## 3. Keeping false positives out (the design constraint)

| Control | What it does |
|---|---|
| Learning period | No anomaly alert until the baseline is mature: at least 200 events, 3 sessions and 24 hours since first seen. Rules still work from the first call. |
| Corroboration | A novelty alone never alerts. A novel token (a new host, a new command head, a new directory area) alerts only when the action's class is risky: network egress, a write outside known areas, execution of an unknown binary, an agent-spawn burst. A novel *read* never alerts. |
| Rules are narrow | A blocking rule must be near-exact (a literal pattern, not a vibe). Rules that are heuristic ship as `notify` only. |
| Deduplication and rate limit | One alert per fingerprint per session; at most 20 alerts per hour per session; a burst collapses into one alert with a count. |
| Feedback | `ack` marks an alert as a false positive: its fingerprint goes to `allow.json` and the baseline learns it. A rule whose recent alerts are more than 30% acked, with at least 10 alerts, is automatically demoted to `notify` and the person is told. |
| Shadow replay | `/protector replay` re-scores the recorded event ring against the current rules and baseline and lists what would have fired, so a person can check precision before turning on `enforce`. |
| Corpus gate | CI replays a benign corpus (typical development traces) and requires zero alerts after maturity, and an attack corpus and requires every case to be caught. A change that adds a false positive to the benign corpus fails the build. |

## 4. How it works

### 4.1 Events

The mod hooks the events the engine offers (ADR-451 lists them): `tool.call` / `tool.check` for every tool use, `http.fetch` for network, `agent.spawn`, `prompt.submit`, `command.run`, `session.start`, `turn.start`, `turn.complete`. Anything the engine does not offer is not simulated. Each event is normalised into a small record: `{kind, tool, headToken, hostClass, areas, riskClass, tainted}`. **No argument values, no file contents and no prompt text are stored**, only these categorical tokens.

### 4.2 Pipeline

`normalise → classify risk class → hard rules → taint tracking → baseline novelty → score → verdict → alert → learn`

- **Taint tracking (LLM01, T6).** Content that came from outside the trust boundary (web fetch or search results, files outside the project, MCP results from remote services) marks the turn tainted. A risky action in a tainted turn that the person's own prompt did not ask for (its command head or host is not named in the latest user prompt) raises rule PR-005. It is correlation, so it is a notification, not a block.
- **Learning only from clean events.** An event is added to the baseline only if no rule fired, it was not denied, and the turn was not tainted. This is the poisoning defence (§6).

### 4.3 Verdicts

| Verdict | When | Effect |
|---|---|---|
| allow | nothing fired | none |
| note | an anomaly without corroboration, or a `learn`-mode hit | counted in status only, no alert |
| notify | rule at `notify`, or corroborated anomaly, in `notify` or `enforce` | alert written, toast shown, one line added to the conversation |
| block | rule at `block`, mode `enforce`, high confidence | `deny` with a reason that names the rule and the way to allow it; alert written |

`block` is a `deny`. It never asks: an unattended session has nobody to ask. The reason always includes the rule id and `/protector allow <fp>`.

## 5. Rule catalogue (version 1)

Severity is what an alert shows; `default` is the shipped mode of the rule (`block` only takes effect in `enforce`). OWASP references: LLM = Top 10 for LLM Applications 2025; T = Agentic AI Threats and Mitigations.

| Id | Detects | OWASP | Severity | Default | Basis |
|---|---|---|---|---|---|
| PR-001 | a secret-shaped value in a tool input that leaves the machine (network tool, `curl`, `nc`, an MCP call to a remote service) | LLM02, T2 | critical | block | the shared secret screen (SHARED SCREEN, ADR-445) plus a network sink |
| PR-002 | remote code piped into an interpreter (`curl … \| sh`, `wget -O- … \| bash`, `base64 -d \| sh`, `python -c` with a URL fetch) | T11, LLM06 | critical | block | literal shapes |
| PR-003 | persistence or self-modification: writes to Claude settings, hooks, helpers, shell rc files, `crontab`, `authorized_keys`, git hooks | T3, T11, LLM06 | high | block | path set, with the ruflo setup commands exempted by exact argv |
| PR-004 | reading credential stores (`~/.ssh`, `~/.aws`, gcloud/azure creds, browser profiles, keychain) followed in the same turn by network egress | LLM02, T3 | high | notify | two-event correlation |
| PR-005 | a risky action in a tainted turn that the person did not ask for | LLM01, T6 | high | notify | taint tracking (§4.2) |
| PR-006 | destructive operations: recursive delete of `/`, `~` or the project root, `git push --force` to the default branch, `DROP DATABASE`, disk wipe | LLM06, T2 | critical | block | the ADR-452 root-delete scanner, reused |
| PR-007 | unbounded consumption: tool-call rate or agent-spawn fan-out well above the baseline p95 | LLM10, T4 | medium | notify | baseline rate |
| PR-008 | a network host never seen in the baseline, carrying a body | LLM02 | medium | notify | baseline hosts; needs corroboration |
| PR-009 | file operations outside the project root in an area the baseline has never touched | LLM06, T3 | medium | notify | baseline areas; needs corroboration |
| PR-010 | an inter-agent or peer message that carries instruction-override phrasing | T12, LLM01 | high | notify | the delivery screen (ADR-451 item 3) |
| PR-011 | an agent spawn that escalates tools or permissions, or of a type never used in the baseline | T13, T3 | medium | notify | baseline spawns |
| PR-012 | installing an unfamiliar dependency from a git URL, a tarball or a non-default index | LLM03 | medium | notify | literal shapes |
| PR-013 | the system prompt or instruction markers sent to a network sink | LLM07 | high | notify | literal markers plus a network sink |

Rules not in version 1, by design: data/model poisoning (LLM04), vector weaknesses (LLM08) and misinformation (LLM09) need model-side evidence this layer does not have; T5 and T7 (cascading hallucination, deceptive behaviour) are not decidable from tool events.

## 6. The baseline

**Learned** (all categorical, all bounded): tool names; command heads (first token and subcommand of shell commands); host classes (registrable domain, never a path or query); path areas (the first two directory levels under the project root, and a coarse class for anything outside it); agent-spawn types; the per-minute call rate (p50, p95, max); first-seen and last-seen times. At most 2,000 entries, least recently seen dropped first.

**Never learned or stored:** argument values, file contents, prompt or response text, secrets, full URLs, full paths outside the project.

**Scope:** per project, in `.claude-flow/protector-mod/baseline.json`. A project that has no baseline yet is `learning`, whatever the person's other projects look like.

**Poisoning defence (the slow-boil attack).** Only clean events teach the baseline (§4.2). A hard rule never consults the baseline, so no amount of learned "normal" can allow a PR-001, 002, 003 or 006 shape. A new baseline entry for a risky class (a network host, a write outside known areas) takes effect only after it has been seen in two different sessions, so one tainted session cannot make an attacker's host normal.

## 7. Unattended operation

The protector has no UI of its own at 3 a.m., so every notification is durable and findable later:

1. `alerts.jsonl` (append-only, bounded), the source of truth;
2. `status.json` with open alert counts by severity, read by the console and by `/ruflo-mods`;
3. a toast, and one line in the conversation where the engine allows (`session` notice);
4. in `enforce`, a `deny` that names the rule, so the agent and the transcript both record why it stopped.

The console's Findings meter on the Security page includes open protector alerts, so the first thing a person sees when they come back is the count.

## 8. Files and commands (the contract the plugin and the console share)

Directory `.claude-flow/protector-mod/` (the `-mod` suffix is what the console's mod scanner already looks for). Every file carries `"schemaVersion": 1`. Only the mod writes them. A reader refuses anything larger than 64 KB (alerts: the last 200 lines are read).

- **`status.json`**: `{schemaVersion, version:1, name:"protector", modVersion, mode, guard, calls, blocked, startedAt, startedMs, updatedAt, updatedMs, summary, alerts:{open, critical, high, medium, low, total}, baseline:{state:"learning"|"mature", maturity:0-100, events, sessions, firstSeenAt}, rules:{total, block, notify, off}, degraded:false|"<reason>"}`. The console's existing mod scan (ADR-446) accepts only `version: 1` and reads `startedMs`/`updatedMs`, so those three keys are written as well as `schemaVersion`/`startedAt`/`updatedAt` (same numbers, epoch milliseconds); without them the Mods page lists Anatole as "refused". `calls`, `blocked`, `guard`, `modVersion` and `summary` have the meaning ADR-446 gives the same keys.
- **`rules.json`**: the person's overrides only, `{schemaVersion, mode?:"off"|"learn"|"notify"|"enforce", rules:{"PR-002":{mode:"off"|"notify"|"block", demoted?:true}}}`. `demoted: true` is written when the 30% acked rule demotes a rule (§3), so the console can say "auto-demoted". The shipped defaults live in code. There is no per-rule hit counter in the files: a reader derives hits and the acked share from the last 200 alerts and says so.
- **`baseline.json`**: `{schemaVersion, events, sessions, firstSeenAt, updatedAt, tools:{…}, commands:{…}, hosts:{…}, areas:{…}, spawns:{…}, rate:{p50, p95, max}}`, each map `{token:{n, first, last}}`.
- **`alerts.jsonl`**: one JSON object per line `{id, at, rule, owasp:[…], severity, action:"blocked"|"notified", tool, summary, fp, state:"open"|"acked"|"allowed", session}`; `id` matches `[A-Za-z0-9_.:-]{1,40}`. `summary` is at most 160 characters, a shape and never a value; `fp` is a 12-hex fingerprint of `(rule, headToken, hostClass|area)`.
- **`allow.json`**: `{schemaVersion, entries:[{fp, rule, at, note}]}`.

`/protector` (the mod answers it locally; no model turn):

| Command | Does |
|---|---|
| `status` | one-screen summary |
| `list` | every rule: id, OWASP refs, severity, mode, hits, acked share |
| `rule <id> <off\|notify\|block>` | change one rule's mode (writes `rules.json`) |
| `mode <off\|learn\|notify\|enforce>` | change the mode |
| `run` | evaluate now over the recorded event ring and the project's Claude configuration (settings, hooks, helpers) and report findings |
| `replay` | shadow-score the event ring against the current rules and baseline; say what would have fired in each mode |
| `alerts [n]` | the last n alerts |
| `ack <id>` / `unack <id>` | mark an alert a false positive (and teach the baseline) / undo |
| `allow <fp>` | allow a fingerprint without an alert |
| `reset-baseline` | forget the baseline and start learning again |

## 9. The console: a Project Anatole section in Security & Doctor

The Security & Doctor page (`secure` view) gets a collapsible **Project Anatole** section, in the page's existing list / run / edit style:

- **Status row**: mode, baseline maturity as a bar ("learning 62%"), open alerts by severity, blocked count, `degraded` if set. When the plugin is not loaded, one line says how to install it, and nothing else shows.
- **List**: one row per rule: id, OWASP refs, severity, current mode (a three-way chip: off · notify · block), hits, acked share. A rule that was auto-demoted says so.
- **Run**: buttons for `run` (config exposure scan) and `replay` (what would have fired), result in the page's Result panel.
- **Edit**: the mode chooser (off, learn, notify, enforce) and the per-rule chips. Each change goes through `host.runSlash('protector', …)`; changes to `enforce` and `reset-baseline` ask first (the latter is a delete-class action under ADR-450 T8); a mode or rule change is a write.
- **Alerts**: the open alerts with `ack` and `allow` buttons per row; the Findings meter at the top of the page counts them.

The console reads `status.json`, `rules.json` and the tail of `alerts.jsonl` through its bounded, regular-file-only reader (ADR-450 T2). Claude's model-control tools treat the section like any other: reads at `read`, rule and mode edits at `write`, `reset-baseline` as a delete (full).

## 10. Other mods and plugins

- **`ruflo-mods`**: `/ruflo-mods` shows one line from `protector-mod/status.json` (mode, open alerts, blocked); its trust gate documents `ruflo-protector@ruflo` as an expected allow-list entry (it uses `tool.check`).
- **`ruflo-aidefence`**: the protector reuses the shared secret screen (`sync-mod-screen` keeps its copy identical) and does not duplicate AIDefence's detectors; PR-010 uses the delivery-screen phrases.
- **`ruflo-security-audit`**: its README points at the protector for runtime monitoring.
- **Fleet checks**: the plugin joins `smoke-all-plugins` (48), `sync-mod-screen --check`, the guard probe corpus and the marketplace listing.

## 11. Threat model of the protector itself

| Threat | Response |
|---|---|
| A process writes `status.json` or `alerts.jsonl` to fake a clean state (ADR-450 T11) | The files are a courtesy to the reader, never an input to a decision. The decision state lives in the mod's memory; the console labels the data "reported by the mod, unauthenticated". |
| An attacker edits `rules.json` or `allow.json` to switch rules off | A hard-rule class cannot be switched off by the baseline or by `allow.json`; `rules.json` edits are honoured only for a rule's mode and are shown in the console as "changed from default". A file edit that disables a `block` rule is itself noted by PR-003 (it is a write into `.claude-flow`/Claude configuration). |
| Baseline poisoning | §6. |
| The protector is an attack surface (it parses hostile input) | Linear-time patterns only (the guard probe's regex-DoS gate applies), the shared bounded traversal, a per-event time budget; exceeding it fails open with `degraded`. |
| Denial of service by alert flooding | Rate limit and deduplication (§3); `alerts.jsonl` is bounded. |
| Prompt injection aimed at the protector's own output (an alert summary the model reads) | Summaries are shapes, not values, passed through the same control and bidi cleaning as other mod output. |

## 12. Performance and failure

- Budget: median under 1 ms added per tool call, measured with the existing hook-latency bench (the fleet costs about 19 µs per unrelated call today). A regression over budget fails the bench step.
- Every hook wraps its work: an exception becomes `degraded` plus a pass-through. The protector never throws into a tool call.
- Memory: the event ring is the last 500 normalised records, in memory and written to `.claude-flow/protector-mod/ring.json` at session end for `replay`.

## 13. Verification

1. Plugin tests with the engine kit: each rule fires on its attack fixture and not on its benign twin; modes behave as §4.3; learn-only learns nothing from tainted or denied events.
2. Corpus gate (§3): `tests/corpus/benign/` (at least 20 synthetic development traces) must give zero alerts after a mature baseline; `tests/corpus/attacks/` (at least one per rule) must all be caught.
3. Baseline tests: caps, eviction, maturity, the two-session rule for risky classes, and that no value ever reaches `baseline.json` (a canary secret is fed through and grepped for).
4. Bench: the per-call budget of §12.
5. Console: unit tests for the section with fixture files; a live drive against a project seeded with protector files; the existing console kit tests unchanged.

## 14. Rollout and open items

1. Ship `ruflo-protector` default-off (not in any install bundle), default mode `learn` once installed, `autoGraduate` to `notify` on maturity, never to `enforce`.
2. After a week of `notify` on real projects, review the acked share per rule and decide which rules deserve `block` by default.
3. Open: whether to offer an organisation-wide baseline (a shared allow list) without sharing values; whether the protector should also watch the other mods' status files for tampering (T11); and how to reach a person off-machine for a critical alert on a long unattended run (a channel outside the mod sandbox, which mods deliberately do not have).
