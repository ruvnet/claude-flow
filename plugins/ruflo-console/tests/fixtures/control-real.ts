/**
 * What a real interactive Claude Code answered, copied from the ADR-471 measurement run (Claude Code 2.1.289, 2026-10-06, isolated config, haiku,
 * a file-driven probe mod calling `$.tool.call`). Ids are the run's own; the only key in this folder is a made-up test string. Nothing here was edited
 * except to drop fields no test reads.
 */
export const VERSION = '2.1.289'

type Reply = { result?: unknown; text?: string; isError?: boolean; deny?: string }

/** The Workflow tool's launch result, as the session transcript holds it (`toolUseResult`), inside the line a task-id search reads. */
export const LAUNCH_LINE = '{"type":"user","message":{"role":"user","content":[{"type":"tool_result","content":"Workflow started in the background."}]},"toolUseResult":{"status":"async_launched","taskId":"wyp2n5acy","taskType":"local_workflow","workflowName":"ctl-wf","runId":"wf_186c6243-718","summary":"two haiku agents, node timer steps","transcriptDir":"/c/projects/-tmp-ctl-test/0ba58c85/subagents/workflows/wf_186c6243-718","scriptPath":"/tmp/ctl-test/ctl-wf.js"},"sessionId":"0ba58c85-964c-447e-af40-914e6aeb706b"}'

export const WF = { runId: 'wf_186c6243-718', taskId: 'wyp2n5acy', agentA: 'af9570828161afcaf', agentB: 'a77af355be2b4d9a0' }

export const REAL: Record<string, Reply> = {
  // TaskStop
  stopWorkflowTask: { result: { message: 'Successfully stopped task: wyp2n5acy (two haiku agents, node timer steps)', task_id: 'wyp2n5acy', task_type: 'local_workflow', command: 'two haiku agents, node timer steps' }, text: '{"message":"Successfully stopped task: wyp2n5acy (two haiku agents, node timer steps)","task_id":"wyp2n5acy","task_type":"local_workflow","command":"two haiku agents, node timer steps"}' },
  stopWorkflowRunId: { result: 'Error: No task found with ID: wf_186c6243-718', text: '<tool_use_error>No task found with ID: wf_186c6243-718</tool_use_error>', isError: true },
  stopWorkflowAgent: { result: 'Error: No task found with ID: a77af355be2b4d9a0', text: '<tool_use_error>No task found with ID: a77af355be2b4d9a0</tool_use_error>', isError: true },
  stopUnnamedBackgroundAgent: { result: { message: 'Successfully stopped task: a5d7590f2256bbb08 (Run 10 Node setTimeout calls and report done)', task_id: 'a5d7590f2256bbb08', task_type: 'local_agent', command: 'Run 10 Node setTimeout calls and report done' }, text: '{"message":"Successfully stopped task: a5d7590f2256bbb08 (Run 10 Node setTimeout calls and report done)","task_id":"a5d7590f2256bbb08","task_type":"local_agent","command":"Run 10 Node setTimeout calls and report done"}' },
  stopNamedAgentById: { result: "Error: No task found with ID: asleeper-5b260a36f5ca5237. Running teammates: sleeper@session-0ba58c85", text: "<tool_use_error>No task found with ID: asleeper-5b260a36f5ca5237. Running teammates: sleeper@session-0ba58c85</tool_use_error>", isError: true },
  stopNamedAgentByTeammateId: { result: { message: "Successfully stopped task: tx8xpvkja (run bash 'sleep 240' once, then reply done)", task_id: 'tx8xpvkja', task_type: 'in_process_teammate', command: "run bash 'sleep 240' once, then reply done" }, text: '{"message":"Successfully stopped task: tx8xpvkja (run bash \'sleep 240\' once, then reply done)","task_id":"tx8xpvkja","task_type":"in_process_teammate","command":"run bash \'sleep 240\' once, then reply done"}' },
  stopTaskOfAnotherSession: { text: '<tool_use_error>No task found with ID: wyp2n5acy</tool_use_error>', isError: true },
  // SendMessage
  messageRunningWorkflowAgent: { result: { success: true, message: 'Resuming agent af95708', resumedAgentId: 'af9570828161afcaf', pin: { id: 'af9570828161afcaf', name: 'af9570828161afcaf', ref: 'db25dd' } }, text: '{"success":true,"message":"Resuming agent af95708","resumedAgentId":"af9570828161afcaf","pin":{"id":"af9570828161afcaf","name":"af9570828161afcaf","ref":"db25dd"}}' },
  messageWorkflowAgentByLabel: { text: '{"success":false,"message":"No agent named \'wa\' is reachable.\\nUse ListAgents to see everyone you can message."}' },
  messageFinishedWorkflowAgent: { text: '{"success":false,"message":"Agent \\"a77af355be2b4d9a0\\" could not be resumed: No transcript found for agent ID: a77af355be2b4d9a0. If you read this id in a message from another Claude Code process (e.g. the lead\'s subagent, seen from a teammate pane), it never ran in this session — reply through \\"team-lead\\" or the session that sent it instead of the raw id."}' },
  messageNamedTeammateByName: { result: { success: true, message: "Message sent to sleeper's inbox", msg_id: '89717ea8-11c5-4558-ba40-f7130f6a6652', routing: { sender: 'team-lead', target: '@sleeper', targetColor: 'blue', summary: 'console test', content: 'Console test: at your next tool round, use Bash t…' } } },
  messageRunningTeammateById: { text: '{"success":true,"message":"Teammate \\"asleeper-31d8fd41a7f1dcb1\\" is already running; queued your message for its next turn.","msg_id":"7fdaa767-6f24-4cd6-bcea-4fe403bafd7e"}' },
  messagePeerSession: { text: '{"success":true,"message":"“ping” → ctl-peer-bb (another Claude session on this machine; in that session\'s inbox, not yet read by its Claude — a [Cross-session delivery notice] follows if that session holds it (usually a different permission mode) or refuses it)","msg_id":"4cdd61b0-3e65-4ce4-9305-5ddf5001d13f"}' },
  // permission
  writeRefusedInDialog: { deny: "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed." },
  bashAcceptedInDialog: { result: { stdout: '', stderr: '', interrupted: false, isImage: false, noOutputExpected: true }, text: '(Bash completed with no output)' },
}

/** `$.tool.check` answers, default (manual) permission mode. */
export const CHECKS = {
  bashEcho: { decision: 'allow' },
  taskStop: { decision: 'allow' },
  sendMessage: { decision: 'allow' },
  write: { decision: 'ask', reason: "Claude requested permissions to write to /tmp/ctl-test/w.txt, but you haven't granted it yet." },
  bashTouch: { decision: 'ask', reason: "touch in '/tmp/ctl-test/t1' needs approval. The path is inside the working directories for this session ('/tmp/ctl-test'), and Claude Code asks before a shell command creates, changes or removes files there." },
} as const

/** `$.tool.call({tool:'Workflow'})` from a mod: refused by the host. */
export const WORKFLOW_FROM_MOD = 'ctl-probe: tool.call: runs the Workflow tool, whose agents run outside the at-once bound on spawns: $.agent.spawn is the door (host check)'

/** `codex exec -s read-only --skip-git-repo-check --ephemeral -C <cwd> -` with the prompt "Reply with exactly the word: pong" on stdin (codex-cli 0.160.0). */
export const CODEX = {
  stdout: 'pong\n',
  stderr: 'OpenAI Codex v0.160.0\n--------\nworkdir: /tmp/ctl-test\nmodel: gpt-6-astra\nprovider: openai\napproval: never\nsandbox: read-only\nreasoning effort: high\nreasoning summaries: none\nsession id: 01a11359-564d-7791-86e8-6b52a425d1fd\n--------\nuser\nReply with exactly the word: pong\n\ncodex\npong\nhook: Stop\nhook: Stop Completed\ntokens used\n5,271\n',
}

/** `bash ~/.claude/helpers/federation.sh dispatch ...` refusals, both before any ssh (exit 1, stdout empty). */
export const FEDERATION = {
  noSuchPeer: { argv: ['bash', 'federation.sh', 'dispatch', 'ctl-no-such-peer', 'hello'], exitCode: 1, stdout: '', stderr: 'federation: no such peer: ctl-no-such-peer\n' },
  untrusted: { argv: ['bash', 'federation.sh', 'dispatch', "Reuven's Mac mini", 'hello'], exitCode: 1, stdout: '', stderr: "federation: peer 'Reuven's Mac mini' is not trusted — pass --confirm to override (one-shot)\n" },
}

/** What the stub OpenAI-compatible server (127.0.0.1) received and answered when `$.http.fetch` posted to it from an interactive session. */
export const HTTP_STUB = {
  seen: { method: 'POST', url: '/v1/chat/completions', auth: 'present', contentType: 'application/json', body: '{"model":"m","messages":[{"role":"user","content":"hi"}]}' },
  answer: { ok: true, status: 200, text: '{"id":"x","model":"stub-model","choices":[{"message":{"role":"assistant","content":"stub says hi; echo auth=Bearer sk-test-KEY123456"}}],"usage":{"prompt_tokens":7,"completion_tokens":5,"cost":0.00012}}' },
  metadataHostFromEngine: 'ctl-probe: $.http.fetch(http://169.254.169.254/latest/) aborted: no complete answer within 30000ms',
}
