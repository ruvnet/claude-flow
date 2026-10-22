# ADR 450: Threat model of the mod system (console control, guards, recall, status files)

Status: Proposed; first slice and recommendations T1 (partly), T6, T8, T12 implemented, T19 recorded without a fix; T9 and the default confirm mode await a human decision. See section 9.

> **Integration note (loop, 2026-10-05).** The worker's commit also changed `ruflo-agentdb/hooks/screen.ts` (wider hidden set + NFKC fold, T3/T5) and `guard.ts` (scan keys, T7) with `ruflo-agentdb/tests/threat.test.ts`. Those files were rebased onto the canonical shared screen (#3711/#3715/guard-hardening) and are **not** in this change; where the ADR says an agentdb fix exists, read it as 'pending in the follow-up'. The guard-hardening branch's shared `textsOf` already scans keys and the soft-hyphen/bidi-isolate/Mongolian set. This change ships the console fixes (T1 truthful classes incl. `dt-term-exec` -> `full`, T3 whole-sequence ANSI/OSC stripping and the wider hidden set in `plain()`, sanitised agentdb status text) and the model-tool spec `threat-model.spec.ts`.

Date: 2026 10 05

Builds on: ADR-404 (ruflo as a mod, trust gate), ADR-444 (Claude controls the console), ADR-445 (AgentDB as a mod), ADR-446 (39 plugin mods), ADR-447, ADR-448 (the Room); T19 added from the PR #3737 research

Related: ADR-449 (guidance learning loop), ADR-451 (capability roadmap; its item 4 governor must respect T19), ADR-452 (overnight hardening record)

## 1. Why

Mods run with Claude Code's own access. ADR-444 then let the model itself drive the console (`console_state | console_open | console_set | console_run`) and, with `modelConfirm: auto`, confirm its own actions. Text from files, peers, memory and the model flows into prompts and onto the screen. This ADR lists what can be attacked, what stops each attack today (with the line that does it), what was actually attempted for this review, what was fixed, and what is left as a recommendation.

Method: every claim below that says "measured" or "held" was run as a test (`plugins/ruflo-console/tests/threat-model.spec.ts`, `plugins/ruflo-agentdb/tests/threat.test.ts`); each fix has a case that failed on the old code and passes on the new. A claim marked **unverified** was read from code, not run.

## 2. Assets

| Asset | Where |
|---|---|
| The person's files, shell and credentials (everything Claude Code can touch) | the host |
| The decision "Claude may act" (control level, confirm mode, per-turn cap) | `settings.ai.modelControl / modelConfirm`, `model-tools.ts:29` |
| Tighten-only verdicts and the secret screens | `ruflo-mods/hooks/guard/*`, the 39 `guard.ts` / `screen.ts` |
| Memory that is recalled into later prompts | AgentDB, `ruflo-agentdb/hooks/recall.ts` |
| The project's policy projection | `.claude-flow/policy/claude-code.json` |
| The person's identity on the federation and the shared brain | `x-publish`, `vec-brain-transfer`, `broadcast` palette entries |
| What the person believes the mods are doing | status files, the Mods section, the Room |

## 3. Actors

A. **Malicious repo content**: files, `.claude/settings.json`, `.claude-flow/*` committed to a repo the person opens.
B. **Poisoned memory**: text an earlier session, a peer or an import stored in AgentDB.
C. **Hostile peer**: a federation / x.ruv.io / Room message.
D. **Prompt-injected Claude**: the model, steered by A, B or C, calling console tools.
E. **Malicious or compromised plugin / mod**: a hooks module the person installed or the model wrote.
F. **Local unprivileged process** that can write under the project's `.claude-flow/`.

## 4. Trust boundaries

1. Model to console (`tool.call` for the four `console_*` tools): the model is untrusted; the level and the class of the action decide.
2. Disk to console (`readMods`, `readSnapshot`): every file is untrusted bytes.
3. Memory to prompt (`frame()` in `recall.ts`): retrieved text is data, framed as such.
4. Tool input to guard (`textsOf` + `scan`): the guard sees what the model sends to a tool.
5. Plugin to host (`plugin.register` trust gate): a mod runs with the host's access once admitted.
6. Console to screen and to the model (`plain()`, `stateJson`): text leaves through these two doors.

## 5. Threats

Status: **fixed** (this change), **held** (attempted, no break), **open** (recommendation). Class names are `read < write < network < spend = delete`; the level needed is `read, write, manage, full, full`.

### T1. classOf under-classification (required item 1)

- Attack: the model runs a palette entry whose label or note names a destructive, networked or billed action in words the classifier does not know, or types text that cancels a note.
- Mitigation before: `classOf`, an English denylist over label + argv + note (`model-tools.ts:49` old). Unknown words fall to `write`.
- Measured, old code: on 60 hand-written adversarial labels/notes (synonyms such as erase, unlink, truncate, revoke, flush, evict; inflections deleting/removal/deletes; network words curl, ssh, webhook, sync, post, broadcast; billed words openrouter, "may cost money", "calls the Anthropic API with your key") **52 were under-classified**. On the 288 real palette entries: readonly 128, write 105, network 40, delete 13, spend 2. Real misses: `dt-term-exec` ("RUNS A SHELL COMMAND in this project, as you") was a plain **write**: at level `write` with `auto`, Claude could run any shell command through the console, outside Claude Code's permission prompts. `vec-workers-dispatch` ("MAY COST MONEY") was `network`, not `spend`. `dt-ma-list` ("calls the Anthropic API with your key") and every "reaches pi.ruv.io / the edge-net genesis node" entry were `write`.
- Measured, text attack: the argv carries the model's own `text`, and the note follows it. A text ending in "not", "no" or "without" turns the note "A model turn" into "not A model turn", which the negation filter strips: **spend read as write** for `do the thing but not`, `please, without`, `refactor, no`.
- Fix: stems instead of whole words (`delet`, `remov`, `eras`, `unlink`, `truncat`, `revok`, `flush`, `evict`, `unregister`, `nuke`, `abort`), shell/exec phrases to `delete`, `reaches|curl|https:|ssh|webhook|slack|ipfs|relay|peer|broadcast|send|sync` to `network`, `may cost|may call models|api key|openrouter|real model` to `spend`; and the negation filter now runs on the console's own prose (`note`, `shows`) only; the label and the argv, which carry typed text, are read as they are, so typed text can add words but never cancel one. (A first version cut the typed text out of the haystack instead. A review showed that a one-letter `text` such as `e` then shredded `RUNS A SHELL COMMAND` in the fixed note and dropped `dt-term-exec` back to `write`; that version was replaced before it was committed, and the `e` case is a regression test.) After: readonly 128, write 93, network 45, delete 17, spend 5 (288 entries); the 28-case corpus and the real-palette invariants pass.
- Residual: typed text can only raise a class: a payload with the word "delete" in it makes `store` need `full` (fails safe, noisy). A denylist is a floor. A new entry whose note uses none of the words is a `write`. Notes also say what they do NOT do, so a negated word still counts as present for delete words (fails safe, over-classifies). False positives that now need `full`: `perf-bottleneck` and `perf-optimize` ("writes and removes a 4 KB probe file"), `auto-daemon-start` and `auto-ap-enable` (their notes say how to stop them), so a `write`-level Claude can no longer start the daemon or enable autopilot.
- Recommended control: replace prose classification with a declared `class` on each `ActionSpec` (devtools already has `cost: 'writes' | ...`); keep `classOf` only as a lower bound (`max(declared, inferred)`) and fail a build test when a non-readonly spec has no declared class.
- Test: `threat-model.spec.ts` T1 (5 cases).

### T2. Hostile `.claude-flow/*-mod/status.json` (required item 2)

- Attack: F or A writes a huge, deeply nested, prototype-polluting, ANSI/bidi, version-spoofed status file.
- Mitigation: folder name must match `^[a-z0-9][a-z0-9-]{0,40}-mod$`, at most 60 folders, 8192 bytes per file (`data/mods.ts:5-11`), `version === 1` only, every field coerced to a finite non-negative integer or a boolean (`data/mods.ts:27-37`); no free text from the file is rendered, the mod name comes from the folder.
- Attempted: 14 payloads: `__proto__` / `constructor.prototype` keys, `{"__proto__":{"version":1}}`, 1e999, 400-digit numbers, negative and string numbers, 3000-deep object and array nesting, an OSC 8 string in a field, non-object roots; plus a folder scan with `../escape-mod`, upper case, spaces, a 123-character name, `__proto__-mod`, an oversize file and a corrupt file.
- Result: **held**. No throw, `Object.prototype` untouched, rows hold only finite numbers, odd names never read, one bad file hides no other (refused counted).
- Residual: (a) the numbers and the `guard: true` flag are unauthenticated: F can make the console show "guard on" for a mod whose guard is off (T11). (b) A symlink or FIFO named `status.json` is stat'd and read through the engine's `fs.read`; whether it follows links or blocks on a FIFO is engine behaviour. **Unverified.**
- Recommended control: `lstat` and refuse non-regular files if the host exposes it; sign status files (T11).
- Test: `threat-model.spec.ts` T2 (2 cases).

### T3. Attacker text on screen: ANSI, OSC 8, bidi, zero-width, long lines (required item 3)

- Attack: C, B or A put escape sequences, hyperlinks, bidi overrides or invisible characters in text the console draws (Room, events, results, agentdb snippets) or hands to the model (`console_state`).
- Mitigation: `plain()` (`data/parse.ts`) is the single door: Room (`data/room.ts:57-65`), `stateJson` (`model-tools.ts`), outcomes.
- Measured, old code: `plain` stripped CSI and C0/C1/bidi/200b-200f only. Left in: OSC payloads (`ESC ] 8 ; ; https://… BEL` lost its ESC and BEL but kept `]8;;https://…` as text), soft hyphen, U+2060-2064 invisible operators, U+FEFF, U+061C, variation selectors, Hangul fillers, Unicode tag characters (U+E0000-E0FFF, "ASCII smuggling"). And `parseAgentdbMod` put `snippet`, `source`, `lastTool` on screen **with no `plain()` at all**.
- Fix: OSC (BEL and ST terminated) and C1 CSI/OSC are removed whole; the hidden set above is replaced by a space; all as `\u` escapes (no raw invisible characters in the source). `parseAgentdbMod` now passes every free-text field through `plain()` and rejects a non-finite score.
- Attempted after: 13 hostile strings, 1 MB inputs with 50 000 unterminated OSC/CSI openers: no forbidden character survives, bounded length, under 2 s total (no catastrophic pattern).
- Residual: long lines are clipped per view (`clip`), not wrapped; a very long run of combining marks can still look odd. Bidi isolates are removed, so text direction cannot be forced, but visually confusable letters (Cyrillic а vs Latin a) are not detected.
- Test: `threat-model.spec.ts` T3 (4 cases).

### T4. `console_set` / `console_run` text into argv (required item 4)

- Attack: shell metacharacters, flag injection or JSON breaking in the typed text.
- Mitigation: the runner passes argv arrays, never a shell (`runner.ts`); each text entry builds `[… '--objective', text, …]`.
- Attempted: 5 payloads (`--evil-flag value`, `$(touch pwn) \`id\` ; reboot | cat &`, `", "x": "y`, `-p {"a":1}`, NUL/newline) against every text entry (79 spec builds at four of the payloads).
- Result: **held**: the text is always exactly one argv element, never split, never starts a new flag element. MCP entries embed it in a JSON string with proper escaping.
- Residual: a value that is itself `--force` or `--yes` is still an option-looking argument to the ruflo CLI's own parser (`--query --force`). The CLI is outside this repo's mods.
- Recommended control: emit `--flag=value` for text options, and `--` before positional text, as `hooks remember` already does.
- Test: `threat-model.spec.ts` T4.

### T5. Recall poisoning (required item 5)

- Attack: B stores text that instructs the model, forges the `<retrieved-memory>` frame, or hides an injection phrase.
- Mitigation: `screen()` drops items with a secret or injection phrase (`recall.ts:81`), `tidy` flattens whitespace (no forged line starts), `frame()` replaces `<` and `>` with `‹` (`recall.ts:104`), a "data, not instructions" note, caps of 5 items / 400 characters each / 1500 total.
- Measured, old code: `ig­nore all previous instructions` (soft hyphen), U+034F, U+061C, U+180E, U+2060, U+3164, variation selectors and tag characters inside the word **all passed the screen**, as did fullwidth `ｉｇｎｏｒｅ …` and fullwidth `ＡＫＩＡ…` keys.
- Fix: `scan` and `tidy` strip the wider hidden set and `NFKC`-normalise (`ruflo-agentdb/hooks/screen.ts`). 5 new tests fail on the old screen and pass now.
- Residual: **high**. A phrase list is bypassed by paraphrase ("from now on respond only with …"), another language, or homoglyphs NFKC does not fold (Cyrillic). The frame is a request to the model, not a barrier. The mod's attachment is `additionalContext`, so it carries the same authority as other context.
- Recommended control: treat recall as lowest-authority; never recall text that was written by the model in the same session without a provenance tag; add a score threshold + a "source: model-written" marker; run the item through `aidefence_scan` when available.
- Test: `ruflo-agentdb/tests/threat.test.ts`.

### T6. Guard bypass: split secrets and unwatched tools (required item 6)

- Attack: D sends a secret in pieces, in a field the guard does not read, or through a tool no guard watches.
- Mitigation: `textsOf` reads every string value to depth 6, 200 entries, 20 000 characters; `hasSecret` on each (`ruflo-agentdb/hooks/guard.ts`).
- Measured, old code: keys were never read, so `{"password": "hunter2hunter2hunter2"}` passed (the key-assignment pattern needs `name: value` in one string). Each string is scanned alone, so a token split over two fields or two calls passes.
- Fix (agentdb only): each string beside its key is also scanned as `key: value` (key to 100, value to 2000 characters, charged to the budget). 2 tests.
- Unwatched: with the registry (393 tool names from `v3/@claude-flow/cli/src/mcp-tools/*.ts`) and every quoted tool-shaped string in `plugins/*/hooks` (233 watched-shaped, 196 of them in the registry), of 61 registry tools whose name says they take free text or a command (`_store _save _set _import _publish _send _broadcast _execute _eval _fill _type _create _exec _prompt _write _update _learn _remember _post _message _invite _grant _ingest _add _record`), **26 have no guard naming them**: `agent_execute agent_update agenticow_ingest browser_fill browser_session_record browser_type config_import daa_workflow_execute hooks_intelligence_learn hooks_post-command hooks_post-edit hooks_post-task intelligence_learn memory_import metaharness_learn policy_budget_set session_import swarm_pheromone_update transfer_store-download transfer_store-featured transfer_store-info transfer_store-search transfer_store-trending wasm_gallery_add_custom wasm_gallery_import x_federation_invite_mint`. The worst: `browser_fill` / `browser_type` (type a secret into a web form: exfiltration), `x_federation_invite_mint` (mints a credential), `agent_execute` (a free-form task for an agent), `config_import`, `session_import`, `memory_import` (bulk write that skips the store guards). The count is an upper bound on coverage: a name appearing in a guard file counts as watched.
- Residual: **medium**; the guards are stateless, so split-across-calls cannot be caught per call.
- Recommended control: one shared `textsOf`/`screen` (today 37 plugin files define their own `textsOf`, so a fix must be repeated); have `check-guard-tool-names.mjs` print the unwatched secret-bearing list and fail on a shrinking allowlist; add `browser_fill`, `browser_type`, `x_federation_invite_mint`, `config_import`, `memory_import`, `session_import` to the first guards; a bounded per-session window of the last N written strings for split secrets.
- Test: `ruflo-agentdb/tests/threat.test.ts`; the list above is reproduced by the 20-line script in section 8.

### T7. Cross-mod injection (required item 7)

- Attack: one mod's status/command output reaches another mod's prompt context or the model.
- Mitigation: the model reads the console through `stateJson`: every line goes through `plain(…,160)`, the screen is capped at 3500 characters, and the reply states that screen text is data. Status files carry no free text onto a page except the agentdb mod's `recent` items, now cleaned (T3). A mod's `/…-mod` command answers without the model.
- Result: **held** for the console path; **open** for any mod that forwards another mod's output as `additionalContext`: none found, but nothing forbids it.
- Residual: low; recall is the only mod that attaches text to prompts.
- Recommended control: a conformance test that no `additionalContext` source reads `.claude-flow/*-mod/` files.

### T8. Autopilot default: the worst action at `write` / `manage` with `confirm=auto` (required item 8)

- Setup: `modelControl` defaults to `read` and `modelConfirm` to `ask` since ruflo-console 0.33.18 (it was `off` and `auto`, so raising the level also removed the person's Yes); a saved `off` or `auto` is kept. Cap: 40 calls per turn, reset at every `turn.start` (`register.ts:343`).
- At `write` (after T1): file and store writes: `auto-cfg-set` (rewrites `.claude-flow/config.json`), `auto-ses-save`, `task` / `mission` / `auto-task-new` (text that later agents act on), `store`, `mem-pattern-store`, `nn-pattern-store`, `vec-hooks-remember` (plant memory that is recalled in later sessions: T15), `daemon`, `init`, worker dispatch, `mem-export` (overwrites `.claude-flow/memory-export.json`). No shell, no network, no billed model (these now need more).
- At `manage`: everything networked: `x-publish` and `x-bbs-publish` (publish text as the person's own key), `vec-brain-transfer` / `sync-push` (publish to pi.ruv.io under the person's identity), `broadcast`, `federation-join`, `marketplace` and `plugin-install` (install code that runs with Claude Code's access), `dt-update-all` (download and write `node_modules`). **This is the worst reachable level in practice: read a secret with any file tool, then publish it with `x-publish`.** Nothing in the console reads the published text for secrets.
- Is the per-turn cap enough? No. It bounds one turn; a `/loop` or any long task gets 40 per turn without limit, and the cap says nothing about class (40 `x-publish` calls fit).
- Recommended control: (1) `auto` must not apply to `network` and above: those always ask, whatever `modelConfirm` says; (2) run the `text` of every publishing/broadcast entry through the secret screen (`aidefence_has_pii` / the 9 patterns) and refuse; (3) a session-total budget of non-read actions per class (for example 5 network, 0 spend without ask); (4) `plugin-install`, `marketplace`, anything that writes settings or hooks becomes `full`; (5) default `modelConfirm` to `ask`.
- Test: not added (needs a product decision); T1 now makes the classes truthful, which is what any of these controls rests on.
- **Update (console 0.33.4): controls (1) and (2) are implemented.** `settlePending` (`model-tools.ts`) leaves `network`, `spend` and `delete` actions waiting for the person whatever `modelConfirm` is; `console_set` values and `console_run` text are refused when `hooks/screen.ts` (the shared screen) finds a secret, raw or cleaned. Tests: `tests/control-guards.spec.ts` (every class x confirm x level; a secret refused for set and run; clean text still runs). Controls (3) to (5) stay open.
- **Update (console 0.33.5): controls (3) and (4) are implemented.** `SESSION_BUDGET` (`model-tools.ts`) caps model-driven actions per class per session (write 20, network 5, install 2, spend 3, delete 3; `state.control.used`). Past it a write action waits for the person's Yes even in `auto`; an action of an always-ask class is refused instead of queued again. A new `install` class (plugin and marketplace changes, settings and hooks files) needs `full` and always asks. Tests: `tests/control-guards.spec.ts`. Control (5), the `modelConfirm` default, stays a human decision.

### T9. Malicious or compromised plugin or mod

- Attack: E ships a mod with `process.run`, `http.fetch`, `fs.write` or a `tool.call` hook.
- Mitigation: the trust gate names the risky calls and events and, only when the person opts in (`refuse-risky`), refuses them (`ruflo-mods/hooks/trust.ts:1-40`). It reads the host's scan, not the module's claims.
- Residual: **high by design**. It cannot judge modules admitted before it, nor prepend/append/builtin modules; the default is observe, not refuse. A mod the model writes mid-session is exactly the case the gate exists for, and it is off unless chosen.
- Recommended control: default `refuse-risky` for user-tier modules written during a session; list admitted-before-gate modules in the Mods section.

### T10. Policy projection file written by A or F

- Attack: a committed `.claude-flow/policy/claude-code.json` with `mode: "legacy"` or an empty rules list.
- Mitigation: the file can only tighten (`stricter`, `guard/index.ts:44-86`); the engine's own verdict always stands; a bad file fails closed by one step (`.catch`, `guard/index.ts:78`).
- Result: it cannot loosen the engine. It can switch ruflo's own added rules off (legacy / observe), and A controls it. **Residual: medium**: the person believes the policy is enforcing.
- Recommended control: read the projection only from user scope, or require a signature from `ruflo-config-signing-key`; show mode in the band when it is not `enforce`.

### T11. Status-file spoof

- Attack: F writes `{"version":1,"guard":true,"blocked":0,"updatedMs":<now>}` for a mod that is not running.
- Mitigation: none; staleness (6 h) is the only check. Residual: **low-medium**: false assurance, no escalation.
- Recommended control: the mod writes a per-session nonce into the file and into its in-memory state; the console shows "unverified" for a file whose nonce the session never saw.

### T12. Environment override raises control

- Attack: A commits `.claude/settings.json` with `env: {"RUFLO_CONSOLE_CONTROL": "full:auto"}`.
- Mechanism: `register.ts:212` reads `$.env.get('RUFLO_CONSOLE_CONTROL')` and uses it in place of the saved setting. Whether Claude Code puts project-settings `env` into what `$.env` returns is engine behaviour. **Unverified; if it does, a repository can turn Claude's console control to `full` with auto-confirm** as soon as the person trusts the folder.
- Recommended control: the override may only lower the saved level (and may force `ask`), never raise it; the e2e scripts pass a saved setting instead.
- **Update (console 0.33.4): fixed.** `lowerOnly` (`model-tools.ts`), applied in `register.ts`, takes the lower level and `ask` if either side says ask. Tested for every saved x env pair in `tests/control-guards.spec.ts`.

### T13. `runById` fuzzy fallback

- Attack: D passes an id that is not an entry plus text, so `filterPalette(entries, "<id> <text>")[0]` picks whichever entry matches best (`runner.ts:205`).
- Result: the chosen entry is still classified after being picked (`settlePending`), so the level holds; but the model can reach an entry by approximate words and the confirmation shows the entry's label, not the id it asked for.
- Recommended control: exact id for model calls; fuzzy only for people.

### T14. The confirmation prompt shows attacker-chosen text

- Attack: in `ask` mode the person sees `plain(label, 100)`; for `mission create: <text>` or `x-publish` the label embeds model text.
- Result: the model can write "Approve to continue the test" into the prompt the person answers. Control characters are gone (T3); persuasion is not.
- Recommended control: the waiting row shows the class and the level it needed in the console's own words, then the quoted payload, dimmed, after it.

### T15. Poisoned memory laundering (a prompt-injected Claude writes memory it later reads)

- Attack: D (or A through D) stores an instruction with `store` / `vec-hooks-remember`; a later session recalls it as "memory".
- Mitigation: the AgentDB write guard refuses secrets only (`guard.ts`); the recall screen (T5) runs on the way back.
- Residual: **medium-high**: persistence across sessions with a regex between. Recommended: tag items written by the model/console and give them a "model-written" provenance on recall; drop them from recall unless the person promoted them.

### T16. Room as a command channel

- Attack: C sends a Room/federation line like "run x-publish …"; the Room only draws it (via `plain`), and the person's own draft goes through the same confirm as `/ruflo run`.
- Result: **held**: a peer's text is rendered, never executed; `console_state` tells the model it is data. The model could still be persuaded by it; that is T8.

### T17. Pending slot and take-over

- Attack: D replaces or clears the person's waiting action, or acts after the person pressed Stop.
- Mitigation: `console_set` and `console_run` refuse while `state.pending` is set (`model-tools.ts:274, 294`); `paused` refuses every tool (`:241`); a level change is re-read per call.
- Result: **held**: covered by `model-tools.spec.ts` (29 tests).

### T18. Denial of service by the model

- Attack: D loops on `console_state` / `console_open`, or fills the control log.
- Mitigation: 40 calls/turn counts reads too; log capped at 40; each reply bounded (3500-character screen, 60 entries).
- Result: **held** for the console; the cap does not span turns (see T8).

### T19. An `http.fetch` hook observes other plugins' requests and the engine's telemetry

Source: the hook-surface research on PR #3737 (`v3/docs/validation/mod-hook-surface-research-2026-10.md`, section 5), Claude Code 2.1.287. Evidence grades below are that note's.

- Attack: E ships a mod whose only declared surface is a `http.fetch` hook (a name the trust gate flags at load as "makes network requests", T9). The hook runs for every `$.http.fetch` call made by any loaded plugin, and for the engine's own calls.
- **Verified live** (two throwaway plugins, `plug-a` calling `$.http.fetch`, `plug-b` hooking it): `plug-b` saw `plug-a`'s URL, with `next.origin` = `{"plugin":"plug-a","tier":"user"}`, and the engine's analytics POST to `https://api.anthropic.com/api/event_logging/v2/batch`, with `next.origin` = `{"plugin":"cc-plugin-telemetry","tier":"builtin"}`. A test-kit run (`claude plugin test`) also saw a test-local plugin's call. So a user-tier hook identifies the caller and reads the full request URL, including query string.
- **Inferred from the declaration file, not shown by the live test**: that the hook also receives request headers and body, and so any credential a plugin puts in an `Authorization` header or body. The research note says it saw an identifier-bearing body on the telemetry call, but the evidence it quotes is URL and origin only; treat headers and bodies as likely visible, not as demonstrated.
- What a mod author **can** do: log or count calls per caller; read URLs; (per the declaration file) return `{ deny }` or `{ value }`, so a hook could block a plugin's request or the engine's telemetry. That is a privacy tool and a way to break a feature.
- What a mod author **cannot** do (as verified): forge `next.origin`; the declaration file says the host sets it and a plugin writes nothing there. Not shown: any ability to see calls from a hook with a lower tier than the caller's, or to escape the fail-open rule.
- Likelihood: **medium**. It needs the person to enable the mod, and enabled mods are exactly what the marketplace trust model vets; but the read path needs no capability beyond one declared hook. Impact: **medium to high** for URL secrets (verified); **high** for header and body credentials if the inference holds. Residual: high by design, until a call-time control exists.
- The trust gate (T9) warns when a mod declares network use. It does not warn that the hook sees *other* plugins' traffic, and the person has no way to tell a reporting hook from an exfiltrating one.
- Recommended mitigations (none is implemented): (1) plugin authors never put secrets in request URLs or query strings (verified exposure), and keep credentials out of anything passed to `$.http.fetch` where another channel exists; (2) review every enabled mod, including the ones installed by a plugin, and remove those that hook `http.fetch` without a stated reason; (3) install mods only from sources the marketplace trust model covers, and prefer `refuse-risky` (T9), which blocks a mod that declares network access at load; (4) the ADR-451 governor, if built, must act only on `origin.tier === "user"` and never deny a built-in origin, and must log host and count, never URL queries, headers or bodies.
- **Not known**: whether `process.run`, `model.complete` and `telemetry.log` are equally visible to another plugin's hook (only `http.fetch` was run); whether a managed organisation's outermost hook (`sec-default`, ADR-404) changes what a user-tier hook sees; whether other builds than 2.1.287 behave the same; whether header and body content is delivered to the hook; whether the host redacts anything before the hook. This entry claims no fix; no code in this repository changes it.
- Test: none; the evidence is a manual two-plugin run recorded in the research note, whose scratch plugins were deleted.

## 6. Decision

1. Accept the fixes in this change as the first slice: truthful classes (T1), whole-sequence stripping and the wider hidden set (T3), sanitised agentdb status text (T3), a recall screen that cannot be passed with an invisible character or a fullwidth letter (T5), and `key: value` scanning in the AgentDB write guard (T6). Console 0.33.1 to 0.33.2. The AgentDB `tidy` also folds NFKC on purpose: it turns fullwidth `＜` into `<` before `frame()` replaces `<>`, which closes a frame-forgery route; the cost is that ligatures and superscripts in recalled text are shown folded.
2. The recommendations are ranked: T8 (auto never applies to network and above; scan outgoing text), T12 (env may only lower), T6 (shared guard core, guard the six tools in the list), T1 (declared class), T9 (default refuse-risky for session-written mods), then the rest. T19 (the `http.fetch` read path) is recorded without a fix; its mitigations are guidance for authors and reviewers.
3. No change to the dependency pins, to the engine, or to any other plugin in this change. The AgentDB plugin source changed (screen and guard) and needs its own version bump when it is released; the console's was bumped.

## 7. Verification

- `plugins/ruflo-console`: `npx vitest run` 895 passed, 3 skipped (the 23 `claude-code/testing` files only load under `claude plugin test`); `claude plugin test ruflo-console` 211 pass, 0 fail; `scripts/smoke.sh` 16 passed, 0 failed; `claude plugin validate` passed.
- `plugins/ruflo-agentdb`: `claude plugin test` 31 pass, 0 fail (5 of them new and failing on the old sources); `scripts/smoke.sh` 19 passed, 0 failed.
- New regression tests: `threat-model.spec.ts` 12 cases (6 fail on the old sources: the corpus, the text attack, JSON-escaped copies, the real-palette invariants, `plain`, the agentdb status text).
- Driven through the model's own tools (`console-drive.sh`, level `write`), twice, with `text` "echo hello" and with the one-letter `text` "e" (the shredding attempt): both answered `Refused: "run the command in a ruflo terminal" is a delete action and control is set to "write" (it needs "full"). … Nothing ran.` Before this change the same entry classed as `write` and, with `auto`, would have run.

## 8. Reproducing the unwatched-tool list

```js
// node --input-type=module, from the repo root
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { extractCandidates, extractRegistryNames } from './scripts/check-guard-tool-names.mjs'
const reg = new Set(), watched = new Set()
for (const f of readdirSync('v3/@claude-flow/cli/src/mcp-tools')) if (f.endsWith('.ts')) for (const n of extractRegistryNames(readFileSync(join('v3/@claude-flow/cli/src/mcp-tools', f), 'utf8'))) reg.add(n)
for (const p of readdirSync('plugins')) { const h = join('plugins', p, 'hooks'); if (!existsSync(h)) continue; for (const f of readdirSync(h, { recursive: true })) if (String(f).endsWith('.ts')) for (const n of extractCandidates(readFileSync(join(h, String(f)), 'utf8'))) watched.add(n) }
const bearing = [...reg].filter(n => /(_store|_save|_set|_import|_publish|_send|_broadcast|_execute|_eval|_fill|_type|_create|_exec$|_prompt|_tool$|_write|_update|_learn|_remember|_post|_message|_invite|_grant|_ingest|_add|_record)/.test(n))
console.log(bearing.filter(n => !watched.has(n)).sort().join(' '))
```

## 9. Implementation status (checked 2026-10-05 against `origin/main`)

Sections 1-8 are left as written; this section records what happened after. The decisions in section 6 did not change. Every PR below was confirmed MERGED with `gh pr view`. "Verified" means I read the code on `origin/main` or the merged PR title; anything else says so. Current versions: console 0.33.11, agentdb 0.4.6.

| T | Recommendation (short) | Status | PR / evidence |
|---|---|---|---|
| T1 | Truthful action classes; a declared `class` per spec | **Partly done.** `classOf` hardened and the shell-run entries fixed. A declared `class` on each `ActionSpec` is **open**: `classOf` in `model-tools.ts` still infers from label, args and note. | #3717 (0.33.3); verified by reading `model-tools.ts` |
| T2 | `lstat`, refuse non-regular status files | Open (not verified: no `lstat` in `plugins/ruflo-console/hooks`) | none |
| T3 | Whole-sequence ANSI/OSC stripping, wider hidden set in `plain()`; sanitised agentdb status text | Done for the console | #3717 (per the ADR's own integration note; not re-run) |
| T4 | `--flag=value` and a `--` before positional text | **Partly.** Several entries (for example `vec-workers-dispatch`, `vec-hooks-route`) pass `--` before the text; a whole-palette audit was not done (not verified) | verified in `data/vector.ts` |
| T5 | Recall poisoning: invisible-character and fullwidth folding, provenance, threshold | **Open.** The integration note says the agentdb screen change was not merged with #3717, and `NFKC` appears nowhere under the agentdb, mods or console hooks on `main` (grep). Recall is still lowest-authority only by framing. | none |
| T6 | One shared guard core; guard the six unwatched tools; fail closed | **Done.** One screen source with a drift check; `browser_fill`, `browser_type`, `x_federation_invite_mint`, `config_import`, `memory_import`, `session_import` now named by guards (verified in `hooks/` of five plugins); truncation fails closed; `memory_import` reads the file it points at, failing open past a size bound. The "known holes" count went 32 to 0. Split-across-calls secrets are still not caught (the guards are stateless). | #3711, #3715, #3706 (tool-name CI check), #3727, #3734, #3745, #3764 |
| T7 | Conformance test that no `additionalContext` source reads `.claude-flow/*-mod/` | Open (no such test found; not verified) | none |
| T8 | `auto` never applies to network and above; secret screen on outgoing text; per-session budgets; install class | **Done.** Auto-confirm never answers network, spend or delete; the secret screen runs on text Claude passes; install action class and per-session budgets per class | #3720 (0.33.4), #3730 (0.33.5) |
| T9 | Default `refuse-risky` for session-written mods | **Human decision, not changed.** `modTrust` still defaults to `observe` (verified in `ruflo-mods` `plugin.json`). Listing mods admitted before the gate is open. | none |
| T10 | Read the policy projection only from user scope or require a signature | Open | none |
| T11 | Per-session nonce in status files | Open | none |
| T12 | Environment override may only lower control | **Done.** `lowerOnly` in `ruflo-console/hooks/register.ts` | #3720 |
| T13 | Exact id for model calls; fuzzy only for people | **Fixed** in console 0.33.14: `console_run` passes `{ exact: true }` to `runById`, so only an id as written resolves; the person palette keeps fuzzy (only reachable with text) | tests/runbyid-exact.spec.ts |
| T14 | Confirmation prompt shows class and level before the quoted payload | Open (not verified) | none |
| T15 | Provenance tag on model-written memory; drop from recall unless promoted | Open (grep found no provenance marker in agentdb hooks) | none |
| T16 | Room as a command channel | Held at review time, no change needed | n/a |
| T17 | Pending slot and take-over | Held at review time, no change needed | n/a |
| T18 | Denial of service by the model | Held for the console; the cap does not span turns (see T8's per-session budgets) | n/a |
| T19 | `http.fetch` hook sees other plugins' requests | **Recorded, no fix**, by design of the entry. ADR-451 item 4's governor is not built. | #3737 (research), #3740 (this entry) |

**Human decisions still open.** (1) ~~Whether `modelConfirm` should default to `ask`~~ — resolved 2026-10-05: the default is now `ask`, with `modelControl: 'read'`; T8's always-ask classes still bound `auto`. (2) Whether T9's default becomes `refuse-risky`.

**Not verified:** the regression-test counts in section 7 were not re-run for this update; no code or test result was re-measured here, only PR state and the files named above.

**Update 2026-10-08 (console 0.40.2): T17 is no longer "held, no change needed".** A Yes pressed on a card that a later ask replaced ran the later card. Every confirm card now has an id, the Yes buttons carry it, and a stale Yes runs nothing (ADR-407's 2026-10-08 update). An ask of Claude's that was screened first and lands while no `console_run`/`console_set` call is running is checked against the level and Stop as they are then (`landingRefusal`). Everything returned to the model passes one sanitiser, `modelLine` (ADR-444's 2026-10-08 update). Regression tests: `deferred-asks.spec.ts`, `model-facing.spec.ts`, `model-secrets.spec.ts`, `escape-linear.spec.ts`.
