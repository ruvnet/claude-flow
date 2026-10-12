/**
 * The Dev Tools view's catalog: ruflo's integration surface (GitHub, git diff analysis, agenticow, WASM agents, the
 * browser, ruflo's terminal sessions, providers, the plugin registry, RuVLLM, DAA, the capability brain, managed agents
 * and maintenance), each entry one fixed argv checked against the CLI source (commands/*.ts, mcp-tools/*.ts) and its
 * --help. A local $0 read runs at once and fills the result panel; anything that writes, deletes, reaches the network
 * or may spend asks first, and its confirm row says which. What a fixed argv cannot carry honestly is an n/a row with
 * its reason, never a button that can only fail. Pure: entries, specs and closures; nothing here touches `$`.
 */
import type { ActionSpec } from './actions'
import { devLines, fieldRule, fieldValue, need, tool, type DevField, type DevFields } from './data/devtools'
import type { Host } from './host'
import type { PaletteEntry } from './palette'
import { SANDBOX, SANDBOX_GROUPS } from './sandbox'
import type { State } from './state'

/** `read`: local, $0, changes nothing. `local`: local compute that keeps nothing. Then writes, the network, money, deletes. */
export type DevCost = 'read' | 'local' | 'writes' | 'network' | 'spends' | 'deletes'

export type DevGroup = 'github' | 'analyze' | 'cow' | 'wasm' | 'browser' | 'terminal' | 'providers' | 'plugins' | 'ruvllm' | 'daa' | 'brain' | 'managed' | 'maint' | 'tmux' | 'rvm'

export type DevEntry = {
  id: string
  group: DevGroup
  /** The row's name, and what the row says it does. */
  name: string
  about: string
  /** The palette's line and the confirm row's question. */
  label: string
  cost: DevCost
  /** The field this entry reads first: headless `/ruflo run <id> <text>` fills it. */
  input?: DevField
  /** The argv after the CLI prefix, from the fields; null when a field breaks its rule. */
  args?: (fields: DevFields) => readonly string[] | null
  /** A fixed command outside ruflo (tmux): the whole argv, run as it is, with no CLI prefix; null when a field breaks its rule. */
  exec?: (fields: DevFields) => readonly string[] | null
  /** The program the entry needs: while it is known missing, the row is n/a. */
  needs?: 'tmux'
  /** How its output reads, when `labLines` would not say it well. */
  read?: (stdout: string, stderr: string, ok: boolean) => string[]
  /** Not runnable from the console: the reason the row shows instead of a button. */
  na?: string
  note?: string
  timeoutMs?: number
}

export const DEV_GROUPS: readonly { id: DevGroup; title: string; right: string }[] = [
  { id: 'brain', title: 'Capability brain', right: 'guidance_brain · local · $0' },
  { id: 'analyze', title: 'Analyze · git diff', right: 'local · $0 · runs at once' },
  { id: 'github', title: 'GitHub & delivery', right: 'gh + GitHub API · asks first' },
  { id: 'cow', title: 'Agenticow · copy-on-write memory', right: 'an .rvf file · writes ask' },
  { id: 'wasm', title: 'WASM agents', right: 'sandboxed · gallery' },
  { id: 'browser', title: 'Browser', right: 'agent-browser session ruflo-console' },
  { id: 'terminal', title: 'Terminal sessions', right: 'ruflo terminal_* · a command asks' },
  { id: 'providers', title: 'Providers', right: 'keys are never shown or passed' },
  { id: 'plugins', title: 'Plugin registry', right: 'local list · IPFS asks' },
  { id: 'ruvllm', title: 'RuVLLM', right: 'status · creates ask' },
  { id: 'daa', title: 'DAA · dynamic agents', right: '.claude-flow/daa · writes ask' },
  { id: 'managed', title: 'Managed agents', right: 'Anthropic cloud · every call asks' },
  { id: 'maint', title: 'Maintenance', right: 'cleanup · update · migrate · process · appliance' },
  ...SANDBOX_GROUPS,
]

const SESSION = 'ruflo-console'
const SHOT = 'ruflo-console-screenshot.png'

/** A `.rvf` file's branch beside it: `memory.rvf` with label `try` branches to `memory-try.rvf`. */
export const branchPathOf = (path: string, label: string): string => (path.endsWith('.rvf') ? `${path.slice(0, -4)}-${label}.rvf` : `${path}-${label}.rvf`)

const fixed = (argv: readonly string[]) => () => argv
const GH = 'gh CLI in this repo: it reads GitHub over the network'
const IN_PROCESS = 'a WASM agent lives inside one MCP server process; ruflo mcp exec starts a fresh process per call, so an agent id never reaches the next call. Use the ruflo MCP server (/mcp) for a session'

export const DEV: readonly DevEntry[] = [
  { id: 'dt-brain', group: 'brain', name: 'WHAT SHOULD I DO?', about: 'ask ruflo which tools fit a task: type it above', label: 'capability brain: recommend tools for the task', cost: 'read', input: 'task', args: f => need(f, ['task'], v => tool('guidance_brain', { mode: 'recommend', task: v.task })) },
  { id: 'dt-brain-overview', group: 'brain', name: 'OVERVIEW', about: 'every capability domain and its health facts', label: 'capability brain: the overview', cost: 'read', args: fixed(tool('guidance_brain', { mode: 'overview' })) },
  { id: 'dt-brain-loop', group: 'brain', name: 'IMPLEMENTATION LOOP', about: 'recall → inspect → … → publish, each step its tools', label: 'capability brain: the implementation loop', cost: 'read', args: fixed(tool('guidance_brain', { mode: 'implementation-loop' })) },

  { id: 'dt-diff', group: 'analyze', name: 'DIFF', about: 'classification, risk, file risks and reviewers for the ref', label: 'analyze the diff (risk, class, reviewers)', cost: 'read', input: 'ref', args: f => need(f, ['ref'], v => tool('analyze_diff', { ref: v.ref, includeFileRisks: true, includeReviewers: true })) },
  { id: 'dt-diff-stats', group: 'analyze', name: 'STATS', about: 'files, additions and deletions by status', label: 'diff stats for the ref', cost: 'read', input: 'ref', args: f => need(f, ['ref'], v => tool('analyze_diff-stats', { ref: v.ref })) },
  { id: 'dt-diff-classify', group: 'analyze', name: 'CLASSIFY', about: 'feature, fix, refactor, docs … with confidence', label: 'classify the diff', cost: 'read', input: 'ref', args: f => need(f, ['ref'], v => tool('analyze_diff-classify', { ref: v.ref })) },
  { id: 'dt-diff-risk', group: 'analyze', name: 'RISK', about: 'the overall risk score and what drives it', label: 'risk of the diff', cost: 'read', input: 'ref', args: f => need(f, ['ref'], v => tool('analyze_diff-risk', { ref: v.ref })) },
  { id: 'dt-diff-reviewers', group: 'analyze', name: 'REVIEWERS', about: 'who should review it, from the history', label: 'suggested reviewers for the diff', cost: 'read', input: 'ref', args: f => need(f, ['ref'], v => tool('analyze_diff-reviewers', { ref: v.ref, limit: 5 })) },
  { id: 'dt-file-risk', group: 'analyze', name: 'FILE RISK', about: 'the risk of changing the file in the path field', label: 'risk of changing the file at the path', cost: 'read', input: 'path', args: f => need(f, ['path'], v => tool('analyze_file-risk', { path: v.path })) },

  { id: 'dt-gh-repo', group: 'github', name: 'REPO', about: 'branches, commits, open issues and PRs of this repo', label: 'analyze this GitHub repo', cost: 'network', args: fixed(tool('github_repo_analyze', {})), note: GH },
  { id: 'dt-gh-prs', group: 'github', name: 'PULL REQUESTS', about: 'the last 20 pull requests and their state', label: 'list pull requests', cost: 'network', args: fixed(tool('github_pr_manage', { action: 'list' })), note: GH },
  { id: 'dt-gh-issues', group: 'github', name: 'ISSUES', about: 'the issues ruflo tracks for this repo', label: 'list tracked issues', cost: 'network', args: fixed(tool('github_issue_track', { action: 'list' })), note: GH },
  { id: 'dt-gh-runs', group: 'github', name: 'WORKFLOW RUNS', about: 'the last 10 Actions runs and how they ended', label: 'list GitHub Actions runs', cost: 'network', args: fixed(tool('github_workflow', { action: 'list' })), note: GH },
  { id: 'dt-gh-metrics', group: 'github', name: 'METRICS', about: 'commits, contributors, releases', label: 'GitHub metrics for this repo', cost: 'network', args: fixed(tool('github_metrics', { metric: 'all' })), note: GH },
  { id: 'dt-issues', group: 'github', name: 'ISSUE CLAIMS', about: 'who claimed which issue (ADR-016), from disk', label: 'issues list: issue claims', cost: 'read', args: fixed(['issues', 'list']) },
  { id: 'dt-issues-board', group: 'github', name: 'CLAIMS BOARD', about: 'the claims as a board, by state', label: 'issues board', cost: 'read', args: fixed(['issues', 'board']) },
  { id: 'dt-deploy-status', group: 'github', name: 'DEPLOYMENTS', about: 'each environment and what is deployed there', label: 'deployment status', cost: 'read', args: fixed(['deployment', 'status']) },
  { id: 'dt-deploy-history', group: 'github', name: 'DEPLOY HISTORY', about: 'the last 10 deployments and rollbacks', label: 'deployment history', cost: 'read', args: fixed(['deployment', 'history', '--limit', '10']) },

  { id: 'dt-cow-status', group: 'cow', name: 'STATUS', about: 'the .rvf in the path field: size, edits, checkpoints', label: 'agenticow status of the .rvf', cost: 'read', input: 'path', args: f => need(f, ['path'], v => tool('agenticow_status', { path: v.path })) },
  { id: 'dt-cow-diff', group: 'cow', name: 'DIFF', about: 'its edits against its base', label: 'agenticow diff of the .rvf', cost: 'read', input: 'path', args: f => need(f, ['path'], v => tool('agenticow_diff', { path: v.path })) },
  { id: 'dt-cow-lineage', group: 'cow', name: 'LINEAGE', about: 'base → checkpoints → working, from its manifest', label: 'agenticow lineage of the .rvf', cost: 'read', input: 'path', args: f => need(f, ['path'], v => tool('agenticow_lineage', { path: v.path })) },
  { id: 'dt-cow-checkpoint', group: 'cow', name: 'CHECKPOINT', about: 'mark the working state with the label', label: 'agenticow checkpoint the .rvf', cost: 'writes', input: 'label', args: f => need(f, ['path', 'label'], v => tool('agenticow_checkpoint', { path: v.path, label: v.label })), note: 'writes a checkpoint into the .rvf lineage manifest' },
  { id: 'dt-cow-branch', group: 'cow', name: 'BRANCH', about: 'fork it to <name>-<label>.rvf beside it', label: 'agenticow branch the .rvf', cost: 'writes', input: 'label', args: f => need(f, ['path', 'label'], v => tool('agenticow_branch', { basePath: v.path, branchPath: branchPathOf(v.path, v.label), label: v.label })), note: 'writes a new branch .rvf beside the base' },
  { id: 'dt-cow-rollback', group: 'cow', name: 'ROLLBACK', about: 'discard every edit since the last checkpoint', label: 'agenticow rollback the .rvf to its last checkpoint', cost: 'deletes', input: 'path', args: f => need(f, ['path'], v => tool('agenticow_rollback', { path: v.path })), note: 'DISCARDS every edit made since the most recent checkpoint' },
  { id: 'dt-cow-promote', group: 'cow', name: 'PROMOTE', about: 'merge this branch .rvf into its base', label: 'agenticow promote the branch into its base', cost: 'writes', input: 'path', args: f => need(f, ['path'], v => tool('agenticow_promote', { branchPath: v.path })), note: 'writes the branch edits and tombstones into its base .rvf' },
  { id: 'dt-cow-vectors', group: 'cow', name: 'QUERY · INGEST · SPECULATE', about: 'n/a here: they take vectors and records as JSON arrays', label: 'agenticow query, ingest, speculate', cost: 'read', na: 'they take vectors or records (JSON arrays) a field cannot carry: call agenticow_query/ingest/speculate from an agent' },

  { id: 'dt-wasm-gallery', group: 'wasm', name: 'GALLERY', about: 'every agent template in the gallery', label: 'WASM gallery: the templates', cost: 'read', args: fixed(tool('wasm_gallery_list', {})) },
  { id: 'dt-wasm-categories', group: 'wasm', name: 'CATEGORIES', about: 'the gallery by category', label: 'WASM gallery categories', cost: 'read', args: fixed(tool('wasm_gallery_categories', {})) },
  { id: 'dt-wasm-search', group: 'wasm', name: 'SEARCH', about: 'the gallery for the search field’s words', label: 'search the WASM gallery', cost: 'read', input: 'query', args: f => need(f, ['query'], v => tool('wasm_gallery_search', { query: v.query })) },
  { id: 'dt-wasm-list', group: 'wasm', name: 'AGENTS', about: 'agents in the answering process (exec keeps none)', label: 'list WASM agents', cost: 'read', args: fixed(tool('wasm_agent_list', {})) },
  { id: 'dt-wasm-agent', group: 'wasm', name: 'CREATE · PROMPT · STATE · STOP', about: 'n/a here: an agent id dies with its CLI process', label: 'WASM agent create, prompt, state, terminate', cost: 'read', na: IN_PROCESS },

  { id: 'dt-br-open', group: 'browser', name: 'OPEN', about: 'open the URL field in the session', label: 'open the URL in the browser', cost: 'network', input: 'url', args: f => need(f, ['url'], v => tool('browser_open', { url: v.url, session: SESSION })), note: 'the browser loads the page from the network' },
  { id: 'dt-br-snapshot', group: 'browser', name: 'SNAPSHOT', about: 'the page as an accessibility tree with @e refs', label: 'snapshot the open page', cost: 'read', args: fixed(tool('browser_snapshot', { session: SESSION, interactive: true, compact: true })) },
  { id: 'dt-br-url', group: 'browser', name: 'WHERE', about: 'the URL the page is on now', label: 'the open page’s URL', cost: 'read', args: fixed(tool('browser_get-url', { session: SESSION })) },
  { id: 'dt-br-click', group: 'browser', name: 'CLICK', about: 'click the @e ref in the target field', label: 'click the element in the browser', cost: 'network', input: 'target', args: f => need(f, ['target'], v => tool('browser_click', { target: v.target, session: SESSION })), note: 'a click can submit a form or navigate: the page may reach the network' },
  { id: 'dt-br-back', group: 'browser', name: 'BACK', about: 'go back one page', label: 'browser back', cost: 'network', args: fixed(tool('browser_back', { session: SESSION })), note: 'the browser may load the page again from the network' },
  { id: 'dt-br-shot', group: 'browser', name: 'SCREENSHOT', about: `a PNG of the page to ./${SHOT}`, label: 'screenshot the page', cost: 'writes', args: fixed(tool('browser_screenshot', { session: SESSION, path: SHOT })), note: `writes ./${SHOT}` },
  { id: 'dt-br-sessions', group: 'browser', name: 'SESSIONS', about: 'the browser sessions open now', label: 'list browser sessions', cost: 'read', args: fixed(tool('browser_session-list', {})) },
  { id: 'dt-br-close', group: 'browser', name: 'CLOSE', about: 'close the console’s browser session', label: 'close the browser session', cost: 'writes', args: fixed(tool('browser_close', { session: SESSION })), note: 'closes the ruflo-console browser session' },

  { id: 'dt-term-list', group: 'terminal', name: 'SESSIONS', about: 'ruflo’s terminal sessions and their state', label: 'list terminal sessions', cost: 'read', args: fixed(tool('terminal_list', { status: 'all' })) },
  { id: 'dt-term-history', group: 'terminal', name: 'HISTORY', about: 'the last 20 commands they ran', label: 'terminal history', cost: 'read', args: fixed(tool('terminal_history', { limit: 20 })) },
  { id: 'dt-term-create', group: 'terminal', name: 'NEW SESSION', about: 'a session named ruflo-console', label: 'create a terminal session', cost: 'writes', args: fixed(tool('terminal_create', { name: SESSION })), note: 'writes a session to .claude-flow/terminals/store.json' },
  { id: 'dt-term-exec', group: 'terminal', name: 'RUN COMMAND', about: 'run the command field (in the id field’s session)', label: 'run the command in a ruflo terminal', cost: 'writes', input: 'cmd', args: f => need(f, ['cmd'], v => { const session = fieldValue('id', f.id); return tool('terminal_execute', { command: v.cmd, ...(session !== null && { sessionId: session }) }) }), note: 'RUNS A SHELL COMMAND in this project, as you: read it on the line above' },
  { id: 'dt-term-close', group: 'terminal', name: 'CLOSE SESSION', about: 'close the session in the id field', label: 'close the terminal session', cost: 'writes', input: 'id', args: f => need(f, ['id'], v => tool('terminal_close', { sessionId: v.id })), note: 'closes that terminal session' },

  { id: 'dt-prov-list', group: 'providers', name: 'PROVIDERS', about: 'each provider: configured (env/config) or not, never the key', label: 'providers list', cost: 'read', args: fixed(['providers', 'list']) },
  { id: 'dt-prov-test', group: 'providers', name: 'TEST ALL', about: 'ask each configured provider for its models', label: 'test every configured provider', cost: 'network', args: fixed(['providers', 'test', '--all']), note: 'calls each provider’s API (a models list, no completion)' },
  { id: 'dt-prov-configure', group: 'providers', name: 'CONFIGURE', about: 'n/a here: a key never goes through the console', label: 'providers configure', cost: 'read', na: 'a key on an argv shows in the process list: run ruflo providers configure -p <provider> yourself, or set the provider’s env var' },

  { id: 'dt-plug-installed', group: 'plugins', name: 'INSTALLED', about: 'ruflo plugins installed here (local manifest)', label: 'plugins list --installed', cost: 'read', args: fixed(['plugins', 'list', '--installed']) },
  { id: 'dt-plug-official', group: 'plugins', name: 'OFFICIAL', about: 'the official plugins in the registry', label: 'registry: official plugins', cost: 'network', args: fixed(tool('transfer_plugin-official', {})), note: 'reads the plugin registry from IPFS' },
  { id: 'dt-plug-featured', group: 'plugins', name: 'FEATURED', about: 'ten featured plugins', label: 'registry: featured plugins', cost: 'network', args: fixed(tool('transfer_plugin-featured', { limit: 10 })), note: 'reads the plugin registry from IPFS' },
  { id: 'dt-plug-search', group: 'plugins', name: 'SEARCH', about: 'the registry for the search field’s words', label: 'search the plugin registry', cost: 'network', input: 'query', args: f => need(f, ['query'], v => tool('transfer_plugin-search', { query: v.query, limit: 10 })), note: 'reads the plugin registry from IPFS' },

  { id: 'dt-llm-status', group: 'ruvllm', name: 'STATUS', about: 'WASM, native coordinator and graph backends', label: 'ruvllm status', cost: 'read', args: fixed(tool('ruvllm_status', {})) },
  { id: 'dt-llm-hnsw', group: 'ruvllm', name: 'HNSW ROUTER', about: 'a 384-dim router for 64 patterns', label: 'create a ruvllm HNSW router', cost: 'local', args: fixed(tool('ruvllm_hnsw_create', { dimensions: 384, maxPatterns: 64 })), note: 'in memory in that one CLI process: it answers its id and config, and keeps nothing' },
  { id: 'dt-llm-sona', group: 'ruvllm', name: 'SONA', about: 'a SONA adapter with the default sizes', label: 'create a SONA adapter', cost: 'local', args: fixed(tool('ruvllm_sona_create', {})), note: 'in memory in that one CLI process: it answers its id and config, and keeps nothing' },
  { id: 'dt-llm-lora', group: 'ruvllm', name: 'MICROLORA', about: 'a rank-8 384→384 MicroLoRA', label: 'create a MicroLoRA', cost: 'local', args: fixed(tool('ruvllm_microlora_create', { inputDim: 384, outputDim: 384, rank: 8 })), note: 'in memory in that one CLI process: it answers its id and config, and keeps nothing' },

  { id: 'dt-daa-status', group: 'daa', name: 'LEARNING', about: 'each DAA agent’s learning and adaptations', label: 'DAA learning status', cost: 'read', args: fixed(tool('daa_learning_status', { detailed: true })) },
  { id: 'dt-daa-metrics', group: 'daa', name: 'METRICS', about: 'agents, workflows and learning, all time', label: 'DAA performance metrics', cost: 'read', args: fixed(tool('daa_performance_metrics', { category: 'all' })) },
  { id: 'dt-daa-create', group: 'daa', name: 'NEW AGENT', about: 'an adaptive agent with the id field', label: 'create a DAA agent', cost: 'writes', input: 'id', args: f => need(f, ['id'], v => tool('daa_agent_create', { id: v.id, cognitivePattern: 'adaptive', enableMemory: true })), note: 'writes the agent to .claude-flow/daa' },
  { id: 'dt-daa-adapt', group: 'daa', name: 'ADAPT', about: 'feed the note to the agent in the id field', label: 'adapt the DAA agent with the note', cost: 'writes', input: 'note', args: f => need(f, ['id', 'note'], v => tool('daa_agent_adapt', { agentId: v.id, feedback: v.note })), note: 'writes the adaptation to .claude-flow/daa' },
  { id: 'dt-daa-workflow', group: 'daa', name: 'NEW WORKFLOW', about: 'an adaptive workflow named by the label field', label: 'create a DAA workflow', cost: 'writes', input: 'label', args: f => need(f, ['label'], v => tool('daa_workflow_create', { id: v.label, name: v.label, strategy: 'adaptive' })), note: 'writes the workflow to .claude-flow/daa' },
  { id: 'dt-daa-share', group: 'daa', name: 'SHARE', about: 'the note, from the id agent to the label agent', label: 'share knowledge between DAA agents', cost: 'writes', input: 'note', args: f => need(f, ['id', 'label', 'note'], v => tool('daa_knowledge_share', { sourceAgentId: v.id, targetAgentIds: [v.label], knowledgeDomain: 'console', knowledgeContent: { note: v.note } })), note: 'writes the shared knowledge to .claude-flow/daa' },

  { id: 'dt-ma-list', group: 'managed', name: 'SESSIONS', about: 'your cloud sessions (ANTHROPIC_API_KEY)', label: 'list managed-agent sessions', cost: 'network', args: fixed(tool('managed_agent_list', { limit: 10 })), note: 'calls the Anthropic API with your key' },
  { id: 'dt-ma-status', group: 'managed', name: 'STATUS', about: 'the session in the id field', label: 'managed-agent status', cost: 'network', input: 'id', args: f => need(f, ['id'], v => tool('managed_agent_status', { sessionId: v.id })), note: 'calls the Anthropic API with your key' },
  { id: 'dt-ma-events', group: 'managed', name: 'TRANSCRIPT', about: 'that session’s events', label: 'managed-agent transcript', cost: 'network', input: 'id', args: f => need(f, ['id'], v => tool('managed_agent_events', { sessionId: v.id })), note: 'calls the Anthropic API with your key' },
  { id: 'dt-ma-create', group: 'managed', name: 'NEW SESSION', about: 'a cloud agent session, networking off', label: 'create a managed-agent session', cost: 'spends', args: fixed(tool('managed_agent_create', { name: SESSION, networking: 'none' })), note: 'COSTS MONEY: starts a billed cloud session on the Anthropic API' },
  { id: 'dt-ma-prompt', group: 'managed', name: 'PROMPT', about: 'send the note to the id session', label: 'prompt the managed agent with the note', cost: 'spends', input: 'note', args: f => need(f, ['id', 'note'], v => tool('managed_agent_prompt', { sessionId: v.id, message: v.note })), note: 'COSTS MONEY: a model turn in that cloud session', timeoutMs: 180_000 },
  { id: 'dt-ma-stop', group: 'managed', name: 'TERMINATE', about: 'end the id session', label: 'terminate the managed-agent session', cost: 'deletes', input: 'id', args: f => need(f, ['id'], v => tool('managed_agent_terminate', { sessionId: v.id })), note: 'ends that cloud session on the Anthropic API' },

  { id: 'dt-cleanup', group: 'maint', name: 'CLEANUP PLAN', about: 'what cleanup would remove (dry run)', label: 'cleanup dry run', cost: 'read', args: fixed(['cleanup']) },
  // --keep-config is not offered: the parser hands it over as keepConfig and cleanup.ts reads ['keep-config'], so it is ignored.
  { id: 'dt-cleanup-force', group: 'maint', name: 'CLEANUP', about: 'remove everything CLEANUP PLAN lists', label: 'cleanup --force', cost: 'deletes', args: fixed(['cleanup', '--force']), note: 'DELETES what CLEANUP PLAN lists: .claude-flow, .swarm, .hive-mind, .claude/helpers, claude-flow.config.json, ruflo’s blocks in .claude/settings.json' },
  { id: 'dt-update-check', group: 'maint', name: 'UPDATE CHECK', about: 'newer @claude-flow packages on npm', label: 'update check', cost: 'network', args: fixed(['update', 'check', '--json']), note: 'asks the npm registry' },
  { id: 'dt-update-history', group: 'maint', name: 'UPDATE HISTORY', about: 'the updates applied here', label: 'update history', cost: 'read', args: fixed(['update', 'history', '--json']) },
  { id: 'dt-update-all', group: 'maint', name: 'UPDATE ALL', about: 'install the newer @claude-flow packages', label: 'update all @claude-flow packages', cost: 'network', args: fixed(['update', 'all']), note: 'downloads from npm and writes node_modules', timeoutMs: 300_000 },
  { id: 'dt-update-rollback', group: 'maint', name: 'UPDATE ROLLBACK', about: 'undo the last update', label: 'update rollback', cost: 'writes', args: fixed(['update', 'rollback']), note: 'reinstalls the versions before the last update', timeoutMs: 300_000 },
  { id: 'dt-migrate-status', group: 'maint', name: 'MIGRATE STATUS', about: 'what of v2 is left to migrate', label: 'migrate status', cost: 'read', args: fixed(['migrate', 'status']) },
  { id: 'dt-migrate-breaking', group: 'maint', name: 'BREAKING', about: 'the v3 breaking changes', label: 'migrate breaking', cost: 'read', args: fixed(['migrate', 'breaking']) },
  { id: 'dt-migrate-plan', group: 'maint', name: 'MIGRATE PLAN', about: 'n/a: this CLI ignores migrate run --dry-run', label: 'migrate run --dry-run', cost: 'read', na: 'migrate.ts reads flags["dry-run"] but the parser passes dryRun, so --dry-run runs the real migration (with a backup): use MIGRATE STATUS to see what is left' },
  { id: 'dt-migrate-run', group: 'maint', name: 'MIGRATE', about: 'run the full v2 → v3 migration', label: 'migrate run --target all', cost: 'writes', args: fixed(['migrate', 'run', '--target', 'all']), note: 'migrates config, memory, agents, hooks, workflows and embeddings to v3 in place' },
  { id: 'dt-daemon', group: 'maint', name: 'DAEMON', about: 'is the daemon up, its pid and port', label: 'process daemon status', cost: 'read', args: fixed(['process', 'daemon', '--action', 'status']) },
  { id: 'dt-daemon-start', group: 'maint', name: 'DAEMON START', about: 'start the background daemon', label: 'start the ruflo daemon', cost: 'writes', args: fixed(['process', 'daemon', '--action', 'start']), note: 'starts a background process and writes .claude-flow/daemon.pid' },
  { id: 'dt-daemon-stop', group: 'maint', name: 'DAEMON STOP', about: 'stop the background daemon', label: 'stop the ruflo daemon', cost: 'writes', args: fixed(['process', 'daemon', '--action', 'stop']), note: 'stops the background daemon' },
  { id: 'dt-workers', group: 'maint', name: 'WORKERS', about: 'the background worker processes', label: 'process workers list', cost: 'read', args: fixed(['process', 'workers', '--action', 'list']) },
  { id: 'dt-logs', group: 'maint', name: 'LOGS', about: 'the last 50 log lines', label: 'process logs', cost: 'read', args: fixed(['process', 'logs', '--tail', '50']) },
  { id: 'dt-app-inspect', group: 'maint', name: 'APPLIANCE', about: 'the RVFA header and sections of the path field’s .rvf', label: 'appliance inspect', cost: 'read', input: 'path', args: f => need(f, ['path'], v => ['appliance', 'inspect', '-f', v.path, '--json']) },
  { id: 'dt-app-verify', group: 'maint', name: 'APPLIANCE VERIFY', about: 'its integrity (quick, no capability tests)', label: 'appliance verify --quick', cost: 'read', input: 'path', args: f => need(f, ['path'], v => ['appliance', 'verify', '-f', v.path, '--quick']) },
  ...SANDBOX,
]

/** What an entry's own `cost` says its class is: the console's confirm gate never reads an action as less than this. `local` and `read` declare nothing. */
const DECLARED: Partial<Record<DevCost, NonNullable<ActionSpec['declared']>>> = { writes: 'write', network: 'network', spends: 'spend', deletes: 'delete' }

/** The confirm-free spec for a local read, the asked one for the rest; null when a field breaks its rule or it is n/a. */
export function devSpec(entry: DevEntry, fields: DevFields): ActionSpec | null {
  const args = entry.na === undefined ? ((entry.exec ?? entry.args)?.(fields) ?? null) : null

  if (args === null) return null

  return {
    label: entry.label,
    args: entry.exec === undefined ? args : [],
    ...(entry.exec !== undefined && { argv: args, shows: args.join(' ') }),
    ...(entry.read !== undefined && { read: entry.read }),
    expect: entry.cost === 'read' ? 'its output in Dev Tools' : `its result in Dev Tools${entry.note !== undefined ? `; ${entry.note}` : ''}`,
    lab: entry.id,
    lines: (stdout, stderr) => devLines(entry.id, stdout, stderr),
    ...(entry.cost === 'read' && { isReadOnly: true }),
    ...(DECLARED[entry.cost] !== undefined && { declared: DECLARED[entry.cost] }),
    ...(entry.note !== undefined && { note: entry.note }),
    ...(entry.timeoutMs !== undefined && { timeoutMs: entry.timeoutMs }),
  }
}

/** Why an entry has nothing to run now, in the footer's words. */
export function devWhy(entry: DevEntry, fields: DevFields): string {
  if (entry.na !== undefined) return `n/a: ${entry.na}`
  const build = entry.exec ?? entry.args

  // With every failing field given a passing value it builds: the first failing field it cannot build without is the one to name.
  const failing = (Object.keys(SAMPLE) as DevField[]).filter(field => fieldValue(field, fields[field]) === null)
  const filled = (except: DevField | null): DevFields => ({ ...fields, ...Object.fromEntries(failing.filter(field => field !== except).map(field => [field, SAMPLE[field]])) })
  const broken = build === undefined || build(filled(null)) === null ? undefined : failing.find(field => build(filled(field)) === null)

  if (broken === undefined) return 'nothing to run'

  // An empty field is the common case: say where to type, not only the rule.
  return `${broken} field${fields[broken].trim() === '' ? ' is empty: type it in the field above, then ▶ run' : ''}: ${fieldRule(broken)}`
}

/** A value each field accepts, to find which field kept an entry from running. */
const SAMPLE: DevFields = { ref: 'HEAD', path: 'memory.rvf', label: 'l', url: 'https://example.com', target: '@e1', query: 'q', task: 't', cmd: 'c', id: 'i', note: 'n', session: 's', send: 'c' }

/**
 * Every runnable entry as a palette entry, so `/ruflo run dt-diff HEAD~3` works headless: an entry with an input field
 * is a text entry whose keyword is its id, and its text (when given) fills that field first.
 */
export function devPalette(state: State): PaletteEntry[] {
  const fields = state.devtools.fields

  return DEV.map(entry => withTmux(entry, state.devtools.tmux)).filter(entry => entry.na === undefined).map(entry => {
    const input = entry.input

    if (input === undefined) return { id: entry.id, group: 'devtools', label: entry.label, run: { kind: 'spec', spec: devSpec(entry, fields), why: devWhy(entry, fields) } }

    return {
      id: entry.id,
      group: 'devtools',
      label: entry.label,
      run: {
        kind: 'text',
        keyword: entry.id,
        // Said when nothing builds: the field to fill and its rule, not a generic palette hint.
        why: text => devWhy(entry, text.trim() === '' ? fields : { ...fields, [input]: text.trim() }),
        make: text => {
          if (text.trim() !== '') fields[input] = text.trim()

          return devSpec(entry, fields)
        },
      },
    }
  })
}

/** The entry as the console can use it now: n/a, with the reason, while the program it needs is known to be missing. */
export const withTmux = (entry: DevEntry, tmux: State['devtools']['tmux']): DevEntry => (entry.needs === 'tmux' && tmux === 'missing' && entry.na === undefined ? { ...entry, na: 'tmux is not installed on this machine: install it, then open this page again' } : entry)

/** Which entry Enter in each field runs; a field with none only keeps its text. */
const SUBMITS: Partial<Record<DevField, string>> = { task: 'dt-brain', ref: 'dt-diff', path: 'dt-cow-status', session: 'dt-sb-capture', send: 'dt-sb-send', url: 'dt-br-open', target: 'dt-br-click', query: 'dt-plug-search', cmd: 'dt-term-exec' }

export type DevtoolsActions = {
  draft: (field: DevField, text: string) => void
  /** Enter in a field: keep its text and run its entry (a read at once, the rest asked first). */
  submit: (field: DevField, text: string) => void
}

export function devtoolsActions(state: State, host: Host, run: (id: string, text: string) => boolean, refuse: (why: string) => void): DevtoolsActions {
  return {
    draft: (field, text) => {
      state.devtools.fields[field] = text
    },
    submit: (field, text) => {
      state.devtools.fields[field] = text
      host.invalidate()

      const id = SUBMITS[field]

      if (id === undefined) return
      if (fieldValue(field, text) === null) refuse(`${field} field: ${fieldRule(field)}`)
      else run(id, '')
    },
  }
}
