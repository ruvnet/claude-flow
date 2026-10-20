# ADR 471: The control plane, measured

Status: Accepted

Date: 2026-10-06

Amends: ADR-465 §2.1 (the Stop labels and the id Stop is called with), §2.2 (Codex tokens, the `@agent` arrival text) and §4 (its "Unverified" list), ADR-464's amendment sentences that carried the same labels.

Builds on: ADR-465 (the control plane and the multi-model bridge), ADR-453 (confirm-gated verbs)

## 1. Context

ADR-465 shipped Stop, Message, Redirect and the Conversation with a proof label on each action, and listed what no one had tried: TaskStop with a
workflow run's id and with the id of an agent inside a run, SendMessage to a workflow-engine agent, delivery (not "queued") of a message, a
permission dialog during `$.tool.call`, the Codex output shape, a federation argv, and a call to an OpenAI-compatible endpoint. This ADR is the
measurement of every one of those in a real interactive session, and the change of the code and the words to what was measured.

Method: Claude Code **2.1.289**, 2026-10-06, `claude --model haiku` in a tmux pane with an isolated `CLAUDE_CONFIG_DIR` (the login copied 0600 and
shredded), working directory a throwaway git repo, default permission mode ("manual"). A throwaway probe mod (a file-driven poller calling
`$.tool.call`, `$.tool.check`, `$.agent.list`, `$.http.fetch` and writing each answer with its timestamps) stood in for the console where the
console was not the thing under test; the console itself (this plugin, loaded with `--plugin-dir`) was driven by mouse and keys for the Stop
confirm card. Real answers are the fixtures in `plugins/ruflo-console/tests/fixtures/control-real.ts`. Model spend about $0.6 (measured from the
session transcripts, haiku list prices); the Codex run is the person's own subscription.

## 2. The capability matrix

"Works" means observed to take effect, not only an answer of `success`.

| # | Call (as the console makes it) | Answer | Verdict |
|---|---|---|---|
| 1 | `TaskStop {task_id: <Workflow task id>}` (`wyp2n5acy`, from the Workflow tool's launch result) | `Successfully stopped task: wyp2n5acy (...)`, `task_type: local_workflow`; both agents were interrupted mid-tool-call within the same second (their transcripts end `[Request interrupted by user for tool use]`), no `node` child left | **works: stops the whole run** |
| 2 | `TaskStop {task_id: "wf_186c6243-718"}` (the run id) | `No task found with ID: wf_186c6243-718` (`isError`) | **does not work** |
| 3 | `TaskStop {task_id: <id of an agent inside the run>}` | `No task found with ID: a77af355be2b4d9a0` (`isError`) | **does not work: one workflow agent cannot be stopped** |
| 4 | the same task id from another session | `No task found with ID: wyp2n5acy` | does not work: a run another session launched cannot be stopped from here |
| 5 | `TaskStop` of an Agent-tool background agent, unnamed, by `id` | `Successfully stopped task: a5d7590f2256bbb08`, `task_type: local_agent`, `agent.list` status `killed` | works (ADR-465's spike case) |
| 6 | the same, **named** (`Agent({name:'sleeper'})`), by the `id` `agent.list` shows (`asleeper-...`) | `No task found with ID: asleeper-... Running teammates: sleeper@session-0ba58c85` | does not work: ADR-465's "verified" was for unnamed agents |
| 7 | the same, by the `teammateId` (`sleeper@session-0ba58c85`) | `Successfully stopped task: ... task_type: in_process_teammate`; gone from `agent.list` | works (running or idle) |
| 8 | `SendMessage {to: <id of a RUNNING workflow agent>}` | `{success:true, message:"Resuming agent af95708", resumedAgentId, pin}`. In that agent's own transcript 28 ms later: "The coordinator sent a message while you were working: ... Address this before completing your current task."; 1.6 s after, the agent began to act on it (a `ToolSearch` for SendMessage to reply). The agent then also shows in `agent.list` as a standalone background agent | **works: delivered mid-task** |
| 9 | the same, the run stopped or the agent finished | `{success:false, message:"Agent ... could not be resumed: No transcript found for agent ID: ..."}` | refused by the engine (error) |
| 10 | `SendMessage {to: "wa"}` (the agent's workflow label) | `{success:false, message:"No agent named 'wa' is reachable. Use ListAgents ..."}` | does not work by label |
| 11 | `SendMessage {to: "sleeper"}` (a named Agent-tool agent, running a long turn) | `Message sent to sleeper's inbox`. Not in the agent's context until its **turn ended**: sent 22:15:48, injected 22:18:29.49 (161 s), then 22:27:54 to 22:30:39.97 (165 s) in a second trial; the agent ran its Bash 1.5 s after injection. By `id` the engine says `Teammate "..." is already running; queued your message for its next turn.` | **works, delivered at the next turn, not the next tool round** |
| 12 | what the agent then does needs approval | a Bash `echo > file` of the agent raised its own dialog in that agent's view ("Bash command from the sleeper agent"); the file was written only after "Yes" | the agent's own permissions apply |
| 13 | `SendMessage {to: <peer session>}` (a second interactive session started in another folder) | `in that session's inbox, not yet read by its Claude`; enqueued in the peer's transcript 17 ms after the call; the idle peer started a turn by itself and answered ("Got it — ping received") | **works: delivered and acted on** |
| 14 | `ListAgents` from a mod | lists this session's teammates and the peer sessions of the **same config dir** (an isolated config sees only its own) | works |
| 15 | `$.agent.list()` during a workflow run | `[]`: workflow agents are not in it | so run and agent ids come from disk |
| 16 | `$.tool.call({tool:'Workflow', ...})` from a mod | thrown: "runs the Workflow tool, whose agents run outside the at-once bound on spawns: `$.agent.spawn` is the door (host check)" | refused: a mod cannot launch a workflow; only the model's turn can |
| 17 | `$.tool.check` (default mode) | Bash `echo` allow; `TaskStop` allow; `SendMessage` allow; `Write` and a Bash `touch` **ask** with the engine's reason | verdict available without a dialog |
| 18 | `$.tool.call` of a tool the check says **ask** | a real dialog opens in the interactive session, titled "from the ctl-probe plugin" (Create file / Bash command); the call waits (15.6 s and 3.5 s in the two trials). "No" resolves `{deny: "The user doesn't want to proceed with this tool use..."}` and nothing is written; "Yes" runs it and resolves the tool's output | **never bypassed**: the engine's dialog decides |
| 19 | `TaskStop` / `SendMessage` through `$.tool.call` in default mode | no dialog (their check is allow) | the confirm card is the only gate for these two |
| 20 | `codex exec -s read-only --skip-git-repo-check --ephemeral -C <cwd> -`, prompt on stdin (codex-cli 0.160.0, logged in) | stdout is the final message only (`pong\n`); stderr is a banner then `tokens used\n5,271`; exit 0 | works; the figure is a **total** (no in/out split) |
| 21 | federation helper, `dispatch <host> "<prompt>" [--confirm]` | the helper has no dry run. Refusals measured, both before any ssh, exit 1, empty stdout: `federation: no such peer: X`; `federation: peer 'X' is not trusted — pass --confirm to override (one-shot)`. No real peer was dispatched to | argv builder confirmed against the helper's own parser; a dispatch itself **not run** (see §5) |
| 22 | OpenAI-compatible POST to a stub on 127.0.0.1 through `$.http.fetch` from an interactive session | 200; the stub saw `POST /v1/chat/completions`, `content-type: application/json`, the `Authorization` header and the body byte for byte | works |
| 23 | `$.http.fetch("http://169.254.169.254/...")` | **not refused**: it waited and aborted at 30 s ("no complete answer within 30000ms") | the engine has no link-local rule: the console's own `isBaseUrl` is the only SSRF gate |
| 24 | `Workflow({scriptPath, resumeFromRunId})` after a stop | started again under the **same** `runId`, with a **new** `taskId` | the resume text is valid; the live task id changes |

## 3. Decision

### 3.1 Stop a run by its task id; remove Stop-one-agent

The Workflow tool's **task id** is what TaskStop takes (rows 1 to 3). While a run is live it exists in one place on disk: the launching
session's transcript (`<session>.jsonl`, the line whose `toolUseResult` has `status:"async_launched"`, `taskType:"local_workflow"`, `taskId` and
`runId`); the run record `workflows/<run>.json` carries it only after the run ends. `data/wf-control.ts` gains `taskIdOf` (pure; the **last**
launch of a run id wins, row 24), `transcriptOf` (the transcript path from the run directory, inside the projects folder only) and
`taskPattern`. `views/wf-control.ts` reads it (the file itself up to 2 MB, else `grep -o -E <pattern> <path>` with fixed argv, no shell; a read that
fails is a reason shown on the row, never a guess) and re-reads it every 5 s, because a resume changes it.

- `stop-run` is `TaskStop {task_id: <task id>}`, label `verified`.
- `stop-agent` has no spec and shows the engine's refusal (row 3) with the date and version. The extras-row Stop button always stops the run.
- Redirect's stop half uses the task id; its resume half is text in the prompt box and never sent (the resume itself was run once, row 24, and its
  text is right: `resumeFromRunId` with the run id).
- A run launched by another session is answered "No task found" (row 4): the row says so and points at Claude Code's Workflows panel.

### 3.2 Message

`SendMessage {to: <agent id>}` is `verified` for a running workflow agent (rows 8 to 10) and the words say what the engine answers for a finished
agent and for a label. The Conversation's `@<agent>` target (Agent-tool agents, `to` = the id `agent.list` shows) now states the measured arrival:
in the inbox at once, **read when the agent's turn ends** (rows 11 and 12), and a tool the agent then runs raises its own dialog.

Note for a later feature, not built: stopping an Agent-tool agent needs its `teammateId` when it is named (row 6 and 7); `ENGINE_ID` rejects `@`.
The Workflows page lists only workflow runs, so it never issues that call.

### 3.3 Labels

`Proof` is `verified | does-not-work | prefill`; every proof sentence begins with `verified:` or `does not work:` and carries Claude Code 2.1.289,
2026-10-06. "unverified" and "queued-only" are gone from the code and the UI, including `data/wf-triage.ts`'s re-run text, which now says Stop
asks first, calls TaskStop with the run's task id, and cannot stop one agent. The proof and call lines on the tab are wrapped, not cut, so the date
is never clipped.

### 3.4 Replies and tokens

`classifyReply` strips the engine's `<tool_use_error>` wrapper (the real miss has the tag in `text` and a string in `result`). Codex's one "tokens
used" figure is stored as `tokensTotal` and shown as "N total (no in/out split reported)", not as output tokens; Codex and peer answers and error
text are trimmed of the trailing newline.

### 3.5 What was already right

The permission handling stands (rows 17 to 19): the console asks `$.tool.check`, stops on `deny`, calls `$.tool.call`, and shows the engine's answer;
a refused dialog is a refusal and no other route is tried. The SSRF rules stand and are now known to be the only ones (row 23). The federation argv
`bash federation.sh dispatch <host> <body> [--confirm]` matches the helper's parser, which takes any non-flag word as the prompt, so the console's
refusal of a body that begins with a dash is what stops a body being read as a flag.

## 4. Evidence and tests

- `tests/fixtures/control-real.ts`: the real answers of rows 1 to 20 and 22 to 23 (ids kept, no secret; the key in the stub test is a made-up string).
- `tests/wf-control.spec.ts`: every real TaskStop and SendMessage answer classified; the task id from the real launch line, last launch wins,
  hostile run ids refused; Stop never passes the run id or an agent id; Stop-agent has no spec and carries the refusal; the redirect uses the task id.
- `tests/wf-control-views.spec.ts`: the id is read from the transcript (small file, huge file by grep with its exact argv, another session's run,
  a missing file); the card shows `TaskStop {"task_id":"wyp2n5acy"}`; no "unverified" anywhere in the tab.
- `tests/wf-send-stub.spec.ts`: a real HTTP server on 127.0.0.1, a real `printenv`, node `fetch`: the bytes received equal the bytes on the card
  (`chatBody`), the key rides one header and an echoed key is masked in the answer, an unset variable sends nothing, `NONE` sends no header; twelve
  hostile base URLs are refused.
- `tests/wf-convo.spec.ts`: the real Codex stdout and stderr, the helper's two real refusals, the dash-first body refused.
- Live, in the interactive session: the console's Stop button, its confirm card (`runs: TaskStop {"task_id":"wyoffjclz"}`) and the outcome row
  "stop workflow run wf_740b4be5-aa0: Successfully stopped task: wyoffjclz"; both agents interrupted. After a resume the card showed the new task
  id (`wekh7caqa`) without a restart.
- Mutations of the code under test, each killed by a test, are listed in the commit message.

## 5. Still unverified, and why

- A real federation peer dispatch: it runs `claude -p` on another machine with that machine's permissions and spends its login; the task forbade
  dispatching to a real peer. Only the argv and the helper's refusals are measured. (A peer host such as `Reuven's Mac mini` also fails the console's
  host pattern, so it is not offered; unchanged.)
- A run launched by another session being stopped from this one: the engine answers "No task found" (row 4), not tried in the other direction.
- OpenRouter itself (a real key and the real service), `usage.cost`, and a metered gateway: only a stub was called, so no money was spent.
- Stop-one-agent for Agent-tool agents from the console: the engine allows it (rows 5 to 7) but the Workflows page does not list those agents, so no
  button exists to test.
- The `--permission-mode` variants (acceptEdits, bypass, auto): only the default mode was driven; `$.tool.check` is the console's guard for the rest.

## 6. Rollback

Revert this ADR's commit: the code returns to ADR-465's labels and ids (and to a Stop that the engine answers "No task found").
