# ADR 465: Interactive control plane and multi-model bridge

Status: Accepted

Date: 2026-10-05

Builds on: ADR-458 (the Workflows page), ADR-460 (guidance), ADR-464 (slot seams), ADR-444 (Claude controls the console), ADR-453 (confirm-gated verbs)

Amends: ADR-458 and ADR-460, which said the console cannot stop or message a running workflow.

## 1. Context

ADR-458 and ADR-460 told the person the console "cannot stop or message a running workflow" and offered only a prompt-box prefill. That was
true of the console's own verbs and untrue of the host: Claude Code lets a mod call the engine's own tools. A spike (headless `claude -p`,
2.1.289, a throwaway plugin; recorded in the task that produced this ADR) measured what is real:

| Path | Result | What it does NOT show |
|---|---|---|
| `$.tool.call({tool:'TaskStop', task_id})` on a running background agent | `Successfully stopped task: ... (sleeper)`, `agent.list` then `killed`; a bad id resolves `isError` ("No task found") | Never tried on a workflow run's id, nor on an agent inside a workflow run |
| `$.tool.call({tool:'SendMessage', to})`, by name and by id | `success:true`, "Message queued for delivery ... at its next tool round" | Delivery and effect: the agent was stopped right after. Not tried on a workflow-engine agent |
| `$.tool.check` | `{decision}` for Bash and TaskStop under default, dontAsk, acceptEdits; a denied call resolves `{deny}` | Behaviour in an interactive session with a dialog |
| `$.tool.call` of `mcp__*` tools | listed (1178 tools) only | Never called |
| `ListAgents` from a mod | works, lists peer sessions | Never sent to a peer: cross-session delivery is unverified |

The person also wants the console to be interactive between them, Claude agents and other AIs.

## 2. Decision

### 2.1 Control actions, through the engine and nothing else

`data/wf-control.ts` (pure) builds three actions for a Claude Code workflow run: **Stop** (agent: `TaskStop {task_id: agent id}`; whole run:
`TaskStop {task_id: run id}`), **Message** (`SendMessage {to: agent id, message}`) and **Redirect** (the run stop, then the resume text
prepared in the prompt box, only when the stop worked). Each is an `ActionSpec` whose `shows` is the exact call, so the confirm card shows
it, and whose `run` calls the host's `toolCall` (`$.tool.call`, from a clock tick as `submitPrompt` is, never inside the hook that asked).

- The engine's permission check and dialog decide the call. Before it, `toolCheck` (`$.tool.check`) is asked and a `deny` ends the action.
- **No laundering.** A `deny` (from the check or from the call) is shown as a refusal and nothing else is tried in its place: no Bash
  `kill`, no other tool, no peer. Only the person may press "prepare as text instead", which fills the prompt box (the main session's own
  permissions then apply when they press Enter).
- Each action carries a proof label that says how far its path is known: Stop an agent `verified` (the spike's exact case); Stop a run
  `unverified`; Message `queued-only`; Redirect `unverified` (two halves, said as two). The tab prints the label and the words. An answer
  of `isError`, `success:false` or "not reachable" is an error in the outcome row, never a success.
- Where a build does not bind `toolCall`, the specs are absent and the tab says so and offers the text prefill: the honest degradation.
- A ruflo swarm run's agents are not Claude tasks; the tab points at the page's own stop and the guide tab.

`Host` gains three optional members (`toolCall`, `toolCheck`, `httpSend`) and `register.ts` binds them: the one shared-file change the
control plane needs, because nothing may reach `$` but through the Host.

### 2.2 Targets and the Conversation

`data/wf-targets.ts` is the registry. A target declares its **transport**, **what leaves the machine** (machine, tailnet, internet, in
words), its **cost class** and **how a reply arrives**, and these are drawn before anything is sent:

| Target | Transport | Leaves | Reply |
|---|---|---|---|
| `@claude` | `host.submitPrompt` (a visible turn) | nothing extra | the next transcript turn, not captured here |
| `@<agent>` | `SendMessage` through the engine | nothing | none routed back; queued only |
| `@hive`, `@hive-propose`, `@task` | `ruflo mcp exec` (`hive-mind_broadcast`, `hive-mind_consensus`, `task_update`) | nothing | none; a worker sees it when it reads the store |
| `@<room>` | `federation_bbs_publish`, read back with `federation_bbs_watch` | this machine, peers where the room syncs | polled |
| `@x-<channel>` | `x_federation_channel_publish`, `x_federation_channel_read` | the relay (a `pub:` channel is public) | polled |
| `@peer-<host>` | the federation helper `dispatch`, which is `claude -p` over ssh on the peer | the tailnet | the peer's stdout |
| `@codex` | `codex exec -s read-only --skip-git-repo-check --ephemeral -C <cwd> -`, prompt on stdin | OpenAI, via the codex CLI | its final message |
| `@openrouter`, `@<endpoint>` | `POST <base>/chat/completions` through `host.httpSend` | the provider | the same response |

Configuration is one option, `convoTargets`: `endpoint:<name>=<base-url>|<KEY_ENV>|<model>; bbs:<room>; x:<channel>`. A key is named by its
environment variable and read with `printenv` at send time; it rides one header and is masked out of the card, the thread, the transcript
and the provider's own reply. A key pasted where a name belongs is refused. A base URL must be https (http only to localhost, a bare host
or a tailnet address), with no credentials, query or fragment. OpenRouter (`OPENROUTER_API_KEY`, `openrouter/auto`) is offered by default;
the meta-llm gateway is just an endpoint the person names.

`data/wf-send.ts` builds the payload the card shows and runs the same strings (`payloadOf` and `sendTo` share one builder), so the card cannot
show something other than what is sent. `data/wf-convo.ts` holds the threads (24 targets, 100 messages, 4000 characters each, all masked on
the way in), `@mention` routing (`@all` is the agents, the hive and the rooms, never anything that leaves the machine), fan-out to at most 6
targets on ONE card listing every payload, answers side by side, relay of one target's answer to another (through the target's own card),
per-thread tokens and cost, polling (20 s, at most 30 reads, started and stopped by the person, the read named on the card), and the
transcript (new file under `.claude-flow/console/exports/`, never overwrites, no link on the way, masked again, cut at 60000 characters with
the cut said). Cost is shown only where the provider billed one (`usage.cost`); otherwise "n/a", never a guessed figure or $0.

### 2.3 Autopilot and permissions

The relayed request asks that the swarm mission loop run for days or weeks without "acting for permission". That loop is **not built here**, and this ADR does not pre-empt it. What it does fix is the boundary: every control and conversation action is an `ActionSpec` with a `run`, and the runner never remembers such a spec (`remember.ts rememberKey` returns null for any spec with `run`, `argv` or `stdin`), so each one always stops at the confirm card. A loop therefore cannot send, stop or message through these actions without the person's own press; a separate, explicit authorisation record (what may be sent, to whom, how often, at what cost) is the right place to widen that, and is a different feature set. The engine's permission decision is never bypassed, and a learning or adaptive system may propose a send but never widen its own tools, network, secrets, spend, concurrency or release authority.

### 2.4 Wiring (the merge owner's switch)

New modules plug in through ADR-464's seams: `views/wf-control.ts` registers the `control` tab and the `ctl-stop` action (no hotkey);
`views/wf-convo.ts` registers the `conversation` board (order 60, folded shut). They are switched on by one import each in
`views/wf-register.ts` and one call each in `wf-wire.ts` (`wireWfControl(state, host)`, `wireWfConvo(state, host, <convoTargets>)`). The pages say
where Stop is done according to whether the `control` tab is registered, so the wording is true in either state.

## 3. Consequences

- The person can stop, message and redirect a running workflow from the page, each behind a card that shows the exact call, and talk to other
  models from one place with the cost and exposure of each declared.
- Stop on a workflow run and Message to a workflow agent may be answered "not found/not reachable" by the engine; the page shows that as an error
  and says what is proven. No claim of delivery is made anywhere: "queued" is the strongest word.
- A message to a peer or to Codex runs a model elsewhere with that machine's permissions: the card says so, and the federation helper still
  enforces trust and blocks destructive prompts.
- The conversation is in memory (and the saved transcripts); a console restart drops the threads.
- `Host` has three more optional members; a host that lacks them degrades to the prefill and to "this host cannot send an HTTP request".

## 4. Test and benchmark plan

Tests are pure with fake bridges and transports (`tests/wf-control.spec.ts`, `wf-convo.spec.ts`, `wf-control-views.spec.ts`): the spike's real
answers classified; the exact call on the card equals the call made; a permission `deny` stops before the call and by the call; the redirect
does not prefill after a failed stop; every transport's argv, stdin, headers and timeout; a key read from the named variable, sent, and masked
out of an echoed reply; refusal of keys-as-names, credential URLs and plain http; thread, message and transcript caps; n/a cost; side-by-side
compare; relay; polling cursor and stop at the cap; the slots registering beside the others with no hotkey clash; and the old "cannot stop"
sentences gone from the pages. Ten mutations of the code under test were each killed by a test. Micro-benchmark (this host, per call):
`targetsOf` with 33 targets 0.006 ms, `parseMentions` 0.002 ms, `payloadOf` 0.004 ms, `compareOf` over 24 threads 0.005 ms, a transcript at
its cap about 1 ms: nothing on the render path is measurable. Unverified, and to be measured in an interactive session by the merge owner:
TaskStop on a workflow run's id, SendMessage to a workflow agent, a dialog opening during `$.tool.call`.

## 5. Rollback

Remove the import line from `views/wf-register.ts` and the two `wire` calls: the tab, the button and the board disappear and the pages say
"Stop and message ... need the control tab, which is not switched on in this build" (no dead button). The `Host` members are optional and
unused then. Nothing is stored outside the person's own transcripts and the optional `convoTargets` option.
