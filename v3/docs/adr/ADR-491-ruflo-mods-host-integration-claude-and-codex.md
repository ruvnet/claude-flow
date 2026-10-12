# ADR 491: ruflo-mods across Claude Code and Codex: a host-neutral core and a thin Codex adapter

Status: Proposed (evidence table is measured; the adapter and `--host` flag are not built)

Date: 2026-10-11

Builds on: ADR-404 (Claude Code mods, function hooks), ADR-406 (no command is removed or renamed), ADR-444, ADR-447 (native guidance), ADR-451 (capability roadmap), ADR-490 (three-host e2e loop; the evidence below comes from it).
Related: ADR-489 (standalone TUI and its `Host` interface), ADR-488 (`compactKeep`).

## 1. Context

`ruflo-mods` is a Claude Code mod: a plugin of **function hooks** (`hooks/hooks.json` -> `"modules": ["./register.ts"]`, ADR-404). It has a
`.claude-plugin/plugin.json` and nothing for Codex. Its README says what it needs: Claude Code >= 2.1.287 (or `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`)
and a cloned `ruflo` marketplace; with function hooks off it does nothing and the classic `hook-handler.cjs` hooks keep every event.

On a Codex host a ruflo user gets only what `ruflo init --dual` installs: the `ruflo-core@ruflo` plugin, whose hooks (`plugins/ruflo-core/hooks/
hooks.json`) are best-effort **telemetry** (`scripts/ruflo-hook.cjs` always exits 0, swallows CLI output, and, per its own header comment, returns empty stdout to Codex), and
`ruflo-swarm`, whose Codex manifest `hooks/codex-hooks.json` is a deliberate no-op (`"hooks": {}`; verified by the ADR-490 matrix). None of the
mod's *policies* (routing context, tool checks, budget ladder and hard stop, compaction carry, delivery screen, trust gate) runs under Codex.

Two things make this worth revisiting now. (a) Codex 0.162.0 has a real hook engine: events `PreToolUse`, `PermissionRequest`, `PostToolUse`,
`PreCompact`, `PostCompact`, `SessionStart`, `SessionEnd`, `SubagentStart`, `SubagentStop`, `UserPromptSubmit`, `Stop`, `Interrupt` (names read
from the binary's strings), `hooks.json` at `CODEX_HOME` or in a plugin, hook input shaped like Claude Code's (`hook_event_name`, `tool_name`,
`tool_input`, `transcript_path`, `permission_mode`), and `CLAUDE_PLUGIN_ROOT` honoured for plugin hooks. (b) The ADR-490 loop can now test what a
Codex hook can *do*, instead of arguing it.

## 2. Evidence: which mod policies have a Codex equivalent

"Proven" means a live assertion in the ADR-490 matrix (Codex 0.162.0 through OpenRouter, `openai/gpt-5.1-codex-mini`, Linux, 2026-10-11).
"Event exists" means only that the binary names the event; **no behaviour was exercised**. Everything else is "no equivalent found".

| ruflo-mods policy (Claude function hook) | Codex mechanism | State |
|---|---|---|
| Routing: `prompt.submit` hands the route and ranked memory to the model as context | `UserPromptSubmit` command hook returning `hookSpecificOutput.additionalContext` | **Proven.** A hook returned a marker; the model repeated it (`CTX-...`) in 8 of 9 runs after the probe script was fixed. The one miss was the model ignoring the context; the hook fired in every run where the log was recorded. The harness retries once and records the try count. |
| Tool checks: `tool.check` only tightens (dangerous-command list, `claude-code.*` policy rules) | `PreToolUse` hook returning `permissionDecision: "deny"` | **Proven** for a shell call: the hook fired with `tool_name: "Bash"`, the command did not run, the model reported it blocked. MCP and edit tools **not tested**. |
| Edit learning: `tool.call` records finished edits for the consolidator | `PostToolUse` | Event **fired** live; its payload for edit tools (`apply_patch`) was **not inspected**. |
| Budget ladder (`costBudgetUsd`): live cost via `session.measure`, announced once per rung | none live; `Stop` / `SessionEnd` fire, and `cost-tracker` already reads Codex rollouts after the fact | **Partial, unproven.** Cost is available only post hoc from the rollout ledger (counted live: 5 rows, one owning session). No per-turn cost hook was found. |
| `costHardStop`: deny a new subagent at 100% | `SubagentStart` / `SubagentStop` | **Event exists, not exercised** (`codex exec` cannot force a subagent). Whether a start hook can deny is **unknown**. |
| `compactCarry`: append facts to the compaction instructions | `PreCompact` / `PostCompact` (a `PreCompactCommandOutputWire` type exists) | **Event exists, not exercised** (no non-interactive compaction). Whether a hook can append summarizer instructions is **unknown**. |
| Trust gate (`plugin.register`, `modTrust`) | Codex's own hook trust (`hooks.state."<id>".trusted_hash`, `--dangerously-bypass-hook-trust`) | **Different model.** Codex never auto-trusts a command hook; a person reviews it in `/hooks`. Not equivalent, and the adapter cannot grant it. |
| `deliveryScreen`, `toolHints`, `agentTrim`, `guidanceContext` | no Codex equivalent identified (Codex's permission-request output can rewrite an *input* via `updatedInput`; nothing found rewrites a tool *description* or the agent list) | **No equivalent found.** Not tested beyond reading the event names. |
| `statusLine`, panes, toasts, `$.ruflo.segment`, `/ruflo-mods` | none: Codex's UI is not extensible | **None.** The display surface for Codex users is the standalone TUI (ADR-489), not a hook. |
| Observability options (`capabilityProbe`, `sessionRollup`, `sessionAttention`, `grounding`) | `SessionEnd` / `Stop` hooks plus the ledger | **Plausible, untested.** |

What the proven rows say: the two policies that matter most for safety and value (inject the route, tighten tool calls) are expressible as
ordinary command hooks. What they do not say: that every mod policy is. The budget hard stop and compaction carry hinge on two questions
(can `SubagentStart` deny; can `PreCompact` append instructions) that need a live answer before any promise.

Latency: a command hook is a process spawn. The classic `hook-handler.cjs` measured 23 to 43 ms for a PreToolUse(Bash) call on this machine
(ADR-490 row), against in-process function hooks. Per-tool-call cost is therefore real on Codex and must be budgeted, not assumed.

## 3. Decision (proposed)

### 3.1 A host-neutral policy core

Move the pure logic of the mod's policies out of `register.ts` wiring into a host-neutral module (`plugins/ruflo-mods/core/`): the dangerous-command
and policy-projection check, route text building, the budget ladder arithmetic, the compaction-carry block builder, the screening. These already
take and return plain data (the kit tests exercise them without Claude Code). `register.ts` becomes the Claude Code adapter that calls them with
`$` facts; behaviour on Claude Code is byte-for-byte unchanged (ADR-406).

### 3.2 A thin Codex adapter

Add `plugins/ruflo-mods/.codex-plugin/plugin.json` and `hooks/codex-hooks.json` whose commands run one Node entry (`hooks/codex-runner.mjs`) that
reads the hook JSON from stdin, calls the same core, and prints the Codex output shape. Only the rows marked **Proven** are implemented in the
first phase (routing context, shell tool-check tightening); the rest stay off until their question is answered live. Constraints carried from the
Claude adapter: the adapter **only tightens** (never loosens a verdict), fails open (a crash or timeout never blocks a turn), screens everything it
puts in front of the model through `modelLine` (ADR-481), and never prints a path or branch of another project (#3981).

No double firing: `ruflo-core@ruflo` already installs Codex lifecycle hooks, and its `PreToolUse` hook must keep returning empty stdout. The adapter
joins the existing ownership handshake (`RUFLO_MODS_OWNS`, `.claude-flow/mods/`), so an event the adapter owns is skipped by the classic helper, as
on Claude Code (the #2640 class).

### 3.3 Install and doctor: `--host`

`ruflo mods install [--host claude|codex|both]` and `ruflo mods doctor [--host ...]`, default `claude` so nothing changes for existing users (ADR-406).

- `--host codex` runs `codex plugin marketplace add` (a git clone: allow minutes, see ADR-490 finding 2) then `codex plugin add ruflo-mods@ruflo`,
  and never edits `~/.codex/auth.json` or the `current` install links.
- `doctor --host codex` reports the Codex version (a loud `!` for 0.162.1, the build that crashes with a #GP), the marketplace source, whether the
  plugin is installed, whether `features.hooks` is on (stable, default true in 0.162.0), and hook trust. **Installed but untrusted is a `!` with the
  one-line repair ("open /hooks and review the ruflo-mods definitions"), never a `✓`**: the hooks are inactive until a person trusts them.
- `--host both` does both and prints one table.

### 3.4 Relation to ADR-489

ADR-489's `Host` interface is the *display and session* boundary for the console views. This ADR is the *policy* boundary for the mod. They share a
rule (a refused capability is a missing fact, never a crash) and, later, the core: the standalone TUI can run the same policy core as a third
host without Claude Code or Codex. The two are deliberately not merged: views draw; policies decide.

## 4. Phases

1. **Spike (this ADR + ADR-490).** Done: the evidence table above. Remaining questions to answer live before phase 3: can `SubagentStart` deny;
   can `PreCompact` append instructions; what does `PostToolUse` carry for `apply_patch`; do MCP calls reach `PreToolUse`.
2. **Core extraction** with no behaviour change (the existing mods suite is the gate: 152 tests at mods 0.5.1).
3. **Codex adapter for the proven rows**, `--host codex`, doctor, plus ADR-490 matrix rows that fail without it.
4. **Further rows** only as their question is answered by a matrix assertion.

## 5. Risks and non-goals

- **Hook trust is a human step.** An installed-but-untrusted mod does nothing; the doctor must say so. We do not bypass it outside a throwaway test home.
- **Process-spawn latency** per tool call; mitigate by registering only the events and matchers a policy needs.
- **Divergence.** Two adapters can drift; the shared core and the matrix (one assertion per policy per host) are the guard.
- **Codex changes.** Event names and output shapes came from a binary at 0.162.0; the 0.162.1 crash is a reminder that the pin matters. The matrix pins the version.
- Non-goals: function hooks on Codex (it has none); a UI on Codex (ADR-489); rewriting history or vetoing compaction (ADR-488 territory); an agent harness of our own.

## 6. Not verified

Everything marked "Event exists", "unknown" or "untested" above; Windows and macOS; Codex authenticated by ChatGPT (the matrix uses OpenRouter, ADR-490
section 5); any Codex version other than 0.162.0; Claude Code versions other than 2.1.289.
