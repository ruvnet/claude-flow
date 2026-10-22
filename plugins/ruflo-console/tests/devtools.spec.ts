/**
 * The Dev Tools view's pure parts under vitest: every entry's argv against the MCP schemas and CLI flags it was checked
 * with, what asks first and what it says it costs, what each field refuses, and the readers against what `mcp exec`
 * printed. Run with
 *   npx vitest run plugins/ruflo-console/tests/devtools.spec.ts
 */
import { describe, expect, it, vi } from 'vitest'

import { brainLines, devLines, emptyFields, fieldValue, isToolError, unwrap, type DevFields } from '../hooks/data/devtools'
import { branchPathOf, DEV, DEV_GROUPS, devPalette, devSpec, devtoolsActions, devWhy } from '../hooks/devtools'
import type { Host } from '../hooks/host'
import { newState } from '../hooks/state'

/** Each MCP tool's input properties and required ones, as `@claude-flow/cli` 3.51.1 declares them (mcp-tools/*.ts). */
const SCHEMA: Record<string, { props: readonly string[]; req?: readonly string[] }> = {
  guidance_brain: { props: ['mode', 'task', 'domain'] },
  analyze_diff: { props: ['ref', 'includeFileRisks', 'includeReviewers', 'useRuVector'] },
  'analyze_diff-stats': { props: ['ref'] },
  'analyze_diff-classify': { props: ['ref'] },
  'analyze_diff-risk': { props: ['ref'] },
  'analyze_diff-reviewers': { props: ['ref', 'limit'] },
  'analyze_file-risk': { props: ['path', 'additions', 'deletions', 'status'], req: ['path'] },
  github_repo_analyze: { props: ['owner', 'repo', 'branch', 'deep'] },
  github_pr_manage: { props: ['action', 'owner', 'repo', 'prNumber', 'title', 'branch', 'baseBranch', 'body'] },
  github_issue_track: { props: ['action', 'owner', 'repo', 'issueNumber', 'title', 'body', 'labels', 'assignees'] },
  github_workflow: { props: ['action', 'owner', 'repo', 'workflowId', 'ref'] },
  github_metrics: { props: ['owner', 'repo', 'metric', 'timeRange'] },
  agenticow_status: { props: ['path'], req: ['path'] },
  agenticow_diff: { props: ['path'], req: ['path'] },
  agenticow_lineage: { props: ['path'], req: ['path'] },
  agenticow_checkpoint: { props: ['path', 'label'], req: ['path', 'label'] },
  agenticow_branch: { props: ['basePath', 'branchPath', 'label', 'dimension', 'nativeAnn'], req: ['basePath', 'branchPath', 'label'] },
  agenticow_rollback: { props: ['path', 'checkpointId'], req: ['path'] },
  agenticow_promote: { props: ['branchPath', 'basePath'], req: ['branchPath'] },
  wasm_gallery_list: { props: [] },
  wasm_gallery_categories: { props: [] },
  wasm_gallery_search: { props: ['query'], req: ['query'] },
  wasm_agent_list: { props: [] },
  browser_open: { props: ['url', 'session', 'waitUntil', 'args'], req: ['url'] },
  browser_snapshot: { props: ['session', 'interactive', 'compact', 'depth', 'selector'] },
  'browser_get-url': { props: ['session'] },
  browser_click: { props: ['target', 'session', 'button', 'count'], req: ['target'] },
  browser_back: { props: ['session'] },
  browser_screenshot: { props: ['session', 'path', 'fullPage'] },
  'browser_session-list': { props: [] },
  browser_close: { props: ['session'] },
  terminal_list: { props: ['status', 'includeHistory'] },
  terminal_history: { props: ['sessionId', 'limit', 'offset'] },
  terminal_create: { props: ['name', 'workingDir', 'env'] },
  terminal_execute: { props: ['sessionId', 'command', 'timeout', 'captureOutput'], req: ['command'] },
  terminal_close: { props: ['sessionId', 'force'], req: ['sessionId'] },
  'transfer_plugin-official': { props: [] },
  'transfer_plugin-featured': { props: ['limit'] },
  'transfer_plugin-search': { props: ['query', 'category', 'type', 'verified', 'minRating', 'limit'] },
  ruvllm_status: { props: [] },
  ruvllm_hnsw_create: { props: ['dimensions', 'maxPatterns', 'efSearch'], req: ['dimensions', 'maxPatterns'] },
  ruvllm_sona_create: { props: ['hiddenDim', 'learningRate', 'patternCapacity'] },
  ruvllm_microlora_create: { props: ['inputDim', 'outputDim', 'rank', 'alpha'], req: ['inputDim', 'outputDim'] },
  daa_learning_status: { props: ['agentId', 'detailed'] },
  daa_performance_metrics: { props: ['category', 'timeRange'] },
  daa_agent_create: { props: ['id', 'name', 'type', 'cognitivePattern', 'learningRate', 'enableMemory', 'capabilities'], req: ['id'] },
  daa_agent_adapt: { props: ['agentId', 'feedback', 'performanceScore', 'suggestions'], req: ['agentId'] },
  daa_workflow_create: { props: ['id', 'name', 'steps', 'strategy', 'dependencies'], req: ['id', 'name'] },
  daa_knowledge_share: { props: ['sourceAgentId', 'targetAgentIds', 'knowledgeDomain', 'knowledgeContent'], req: ['sourceAgentId', 'targetAgentIds'] },
  managed_agent_list: { props: ['limit'] },
  managed_agent_status: { props: ['sessionId'], req: ['sessionId'] },
  managed_agent_events: { props: ['sessionId', 'raw'], req: ['sessionId'] },
  managed_agent_create: { props: ['name', 'model', 'system', 'title', 'mcpServers', 'skills', 'packages', 'networking', 'initScript'] },
  managed_agent_prompt: { props: ['sessionId', 'message', 'maxWaitMs'], req: ['sessionId', 'message'] },
  managed_agent_terminate: { props: ['sessionId', 'environmentId'], req: ['sessionId'] },
}

/** The CLI subcommands and flags used, each read from its --help (3.51.1). */
const COMMANDS: Record<string, readonly string[]> = {
  'issues list': [],
  'issues board': [],
  'deployment status': [],
  'deployment history': ['--limit'],
  'providers list': [],
  'providers test': ['--all'],
  'plugins list': ['--installed'],
  cleanup: ['--force'],
  'update check': ['--json'],
  'update history': ['--json'],
  'update all': [],
  'update rollback': [],
  'migrate status': [],
  'migrate breaking': [],
  'migrate run': ['--target'],
  'process daemon': ['--action'],
  'process workers': ['--action'],
  'process logs': ['--tail'],
  'appliance inspect': ['-f', '--json'],
  'appliance verify': ['-f', '--quick'],
}

const FULL: DevFields = { ref: 'main..HEAD', path: '.swarm/memory.rvf', label: 'try-1', url: 'https://example.com/a?b=1', target: '@e3', query: 'neural', task: 'review my pull request', cmd: 'git status', id: 'agent-1', note: 'worked well', session: 'demo', send: 'git status' }

const runnable = DEV.filter(entry => entry.na === undefined)

describe('the Dev Tools catalog', () => {
  it('every entry has a unique dt- id and a known section; every runnable one builds an argv from filled fields', () => {
    const ids = DEV.map(entry => entry.id)

    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.every(id => id.startsWith('dt-'))).toBe(true)
    expect(DEV.every(entry => DEV_GROUPS.some(group => group.id === entry.group))).toBe(true)
    expect(DEV_GROUPS.every(group => DEV.some(entry => entry.group === group.id))).toBe(true)

    for (const entry of runnable) expect(devSpec(entry, FULL)?.args, entry.id).toBeDefined()
  })

  it('every MCP call names a tool and only parameters its schema declares, with its required ones', () => {
    for (const entry of runnable) {
      const argv = devSpec(entry, FULL)?.args ?? []

      if (argv[0] !== 'mcp') continue

      expect(argv.slice(0, 3), entry.id).toEqual(['mcp', 'exec', '-t'])
      expect(argv[4], entry.id).toBe('-p')
      expect(argv).toHaveLength(6)

      const schema = SCHEMA[argv[3] ?? '']
      const params = JSON.parse(argv[5] ?? '') as Record<string, unknown>

      expect(schema, `${entry.id}: ${argv[3]}`).toBeDefined()
      for (const key of Object.keys(params)) expect(schema?.props, `${entry.id} ${key}`).toContain(key)
      for (const key of schema?.req ?? []) expect(params, `${entry.id} needs ${key}`).toHaveProperty(key)
    }
  })

  it('every CLI call is a checked subcommand with checked flags, and nothing reaches a shell', () => {
    for (const entry of runnable) {
      const argv = devSpec(entry, FULL)?.args ?? []

      expect(argv.some(word => /^(sh|bash|zsh)$/.test(word)), entry.id).toBe(false)
      // A tmux entry is a fixed command outside ruflo (`exec`): tests/sandbox.spec.ts checks it.
      if (argv[0] === 'mcp' || entry.exec !== undefined) continue

      const name = Object.keys(COMMANDS).find(command => argv.join(' ').startsWith(command))

      expect(name, entry.id).toBeDefined()
      for (const flag of argv.filter(word => word.startsWith('-'))) expect(COMMANDS[name ?? ''], `${entry.id} ${flag}`).toContain(flag)
    }
  })

  it('local reads run at once; everything else asks first and says what it does; money and deletes say so loudly', () => {
    for (const entry of runnable) {
      const spec = devSpec(entry, FULL)

      expect(spec?.lab, entry.id).toBe(entry.id)
      expect(spec?.isReadOnly === true, entry.id).toBe(entry.cost === 'read')
      if (entry.cost !== 'read') expect(spec?.note, entry.id).toBeDefined()
      if (entry.cost === 'spends') expect(spec?.note, entry.id).toMatch(/^COSTS MONEY/)
      if (entry.cost === 'network') expect(spec?.note, entry.id).toMatch(/network|API|IPFS|npm|registry/)
      if (entry.cost === 'deletes') expect(spec?.note, entry.id).toMatch(/DELETES|DISCARDS|ends/)
    }

    // The GitHub reads call gh over the network: they ask, even though they change nothing.
    expect(DEV.filter(entry => entry.id.startsWith('dt-gh-')).every(entry => entry.cost === 'network')).toBe(true)
    // A terminal command runs in a shell: it asks, and the note says so.
    expect(devSpec(DEV.find(entry => entry.id === 'dt-term-exec')!, FULL)?.note).toMatch(/SHELL COMMAND/)
  })

  it('n/a rows have a reason and no argv; no key ever reaches an argv', () => {
    for (const entry of DEV.filter(candidate => candidate.na !== undefined)) {
      expect(devSpec(entry, FULL), entry.id).toBeNull()
      expect(devWhy(entry, FULL)).toMatch(/^n\/a: .{20,}/)
    }

    for (const entry of runnable) expect((devSpec(entry, FULL)?.args ?? []).some(word => /^(-k|--key|--api-key)$/.test(word)), entry.id).toBe(false)
    // Kebab flags the 3.51.1 parser hands over camelCased and these commands then read kebab: never passed, never trusted.
    for (const entry of runnable) expect((devSpec(entry, FULL)?.args ?? []).some(word => word === '--dry-run' || word === '--keep-config'), entry.id).toBe(false)
  })

  it('a branch sits beside its base; an empty field blocks the entry and names the field', () => {
    expect(branchPathOf('.swarm/memory.rvf', 'try')).toBe('.swarm/memory-try.rvf')
    expect(branchPathOf('data/mem', 'x')).toBe('data/mem-x.rvf')

    const fields = emptyFields()
    const checkpoint = DEV.find(entry => entry.id === 'dt-cow-checkpoint')!

    expect(devSpec(checkpoint, fields)).toBeNull()
    expect(devWhy(checkpoint, fields)).toMatch(/^path field( is empty: type it in the field above, then ▶ run)?: /)
    expect(devSpec(DEV.find(entry => entry.id === 'dt-diff-stats')!, fields)?.args).toEqual(['mcp', 'exec', '-t', 'analyze_diff-stats', '-p', '{"ref":"HEAD"}'])
  })
})

describe('the fields', () => {
  it('refuse what could read as a flag, control characters, and over-long text', () => {
    for (const field of ['ref', 'path', 'label', 'query', 'task', 'cmd', 'id', 'note'] as const) {
      expect(fieldValue(field, '-rf'), field).toBeNull()
      expect(fieldValue(field, '--help'), field).toBeNull()
      expect(fieldValue(field, 'a\nb'), field).toBeNull()
      expect(fieldValue(field, 'a\u0000b'), field).toBeNull()
      expect(fieldValue(field, 'x'.repeat(400)), field).toBeNull()
      expect(fieldValue(field, ''), field).toBeNull()
    }
  })

  it('a path stays under the project; a URL is http(s); a target is a snapshot ref', () => {
    expect(fieldValue('path', '.swarm/memory.rvf')).toBe('.swarm/memory.rvf')
    expect(fieldValue('path', '../etc/passwd')).toBeNull()
    expect(fieldValue('path', 'a/../../b')).toBeNull()
    expect(fieldValue('path', '/etc/passwd')).toBeNull()
    expect(fieldValue('path', 'a//b')).toBeNull()
    expect(fieldValue('url', 'https://example.com/x?y=1')).toBe('https://example.com/x?y=1')
    expect(fieldValue('url', 'javascript:alert(1)')).toBeNull()
    expect(fieldValue('url', 'file:///etc/passwd')).toBeNull()
    expect(fieldValue('url', 'https://a b')).toBeNull()
    expect(fieldValue('target', '@e12')).toBe('@e12')
    expect(fieldValue('target', 'button.submit')).toBeNull()
    expect(fieldValue('ref', 'HEAD~3')).toBe('HEAD~3')
    expect(fieldValue('ref', 'main..HEAD')).toBe('main..HEAD')
    expect(fieldValue('ref', 'HEAD; rm -rf')).toBeNull()
    expect(fieldValue('cmd', '  npm test -- --watch=false  ')).toBe('npm test -- --watch=false')
  })
})

const wrapped = (inner: unknown, isError = false) => `[INFO] Executing tool: x\n[OK] Tool executed in 6ms\nResult:\n${JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(inner, null, 2) }], ...(isError && { isError: true }) }, null, 2)}\n`

describe('reading what the CLI printed', () => {
  it('unwraps mcp exec content, plain JSON, and says when the tool failed though the CLI exited 0', () => {
    expect(unwrap(wrapped({ agents: [], count: 0 }))).toEqual({ value: { agents: [], count: 0 }, isError: false })
    expect(unwrap('Result:\n{\n  "ref": "HEAD",\n  "totalFiles": 1\n}\n')).toEqual({ value: { ref: 'HEAD', totalFiles: 1 }, isError: false })
    expect(unwrap('no json here')).toBeNull()
    expect(isToolError(wrapped({ error: 'Error: Failed to initialize @ruvector/rvagent-wasm' }, true))).toBe(true)
    expect(isToolError('Result:\n{\n  "success": false,\n  "error": "gh not found"\n}\n')).toBe(true)
    expect(isToolError(wrapped({ agents: [] }))).toBe(false)
  })

  it('a wrapped error reads as one ✗ line; a wrapped answer as its fields', () => {
    expect(devLines('dt-wasm-gallery', wrapped({ error: 'Error: Failed to initialize @ruvector/rvagent-wasm' }, true))).toEqual(['✗ Error: Failed to initialize @ruvector/rvagent-wasm'])
    expect(devLines('dt-llm-status', wrapped({ wasm: { available: false }, native: { available: true, coordinator: 'active' } }))).toEqual(['wasm:', 'available: false', 'native:', 'available: true', 'coordinator: active'])
    expect(devLines('dt-diff-stats', 'Result:\n{\n  "ref": "HEAD",\n  "totalFiles": 1,\n  "totalAdditions": 1\n}\n')).toEqual(['ref: HEAD', 'totalFiles: 1', 'totalAdditions: 1'])
    expect(devLines('dt-prov-list', '\nProviders\n───\nanthropic  Configured (env)\n')).toEqual(['Providers', 'anthropic Configured (env)'])
  })

  it('the brain: each domain with its tools and risk, then the loop and its guardrails', () => {
    const brain = {
      task: 'review my pull request',
      domains: [{ id: 'analysis-quality', name: 'Analysis & Quality', score: 1, registeredTools: ['analyze_diff', 'analyze_diff-risk'], authority: 'advisory', risk: 'read-only' }],
      implementationLoop: [{ id: 'recall', name: 'Recall', preferredTools: ['memory_search', 'guidance_brain'] }, { id: 'publish', name: 'Publish', preferredTools: [] }],
      guardrails: ['Ruflo coordinates and records; the executor performs implementation.'],
    }

    expect(brainLines(brain)).toEqual([
      'for: review my pull request',
      '▸ Analysis & Quality · read-only · advisory',
      '    tools: analyze_diff, analyze_diff-risk',
      'then the loop:',
      '  Recall     memory_search, guidance_brain',
      '  Publish    —',
      '! Ruflo coordinates and records; the executor performs implementation.',
    ])
    expect(devLines('dt-brain', wrapped(brain))[1]).toBe('▸ Analysis & Quality · read-only · advisory')
    expect(brainLines({ task: 'zzz', domains: [] })).toEqual(['for: zzz', 'no capability domain matched: try other words'])
  })
})

describe('headless and the fields', () => {
  it('a field entry is a text entry keyed by its id; its text fills the field before it builds the argv', () => {
    const state = newState({})
    const entries = devPalette(state)
    const diff = entries.find(entry => entry.id === 'dt-diff-stats')

    expect(entries.some(entry => entry.id === 'dt-wasm-agent')).toBe(false)
    expect(diff?.run.kind).toBe('text')
    if (diff?.run.kind !== 'text') return
    expect(diff.run.keyword).toBe('dt-diff-stats')
    expect(diff.run.make('HEAD~2')?.args).toEqual(['mcp', 'exec', '-t', 'analyze_diff-stats', '-p', '{"ref":"HEAD~2"}'])
    expect(state.devtools.fields.ref).toBe('HEAD~2')
    // An empty text uses what the field holds: the view's button press.
    expect(diff.run.make('')?.args[5]).toBe('{"ref":"HEAD~2"}')
    expect(entries.find(entry => entry.id === 'dt-prov-list')?.run).toMatchObject({ kind: 'spec', spec: { args: ['providers', 'list'], isReadOnly: true } })
  })

  it('a field entry with nothing to run says which field to fill, not a palette hint', () => {
    const entry = devPalette(newState({})).find(candidate => candidate.id === 'dt-brain')

    expect(entry?.run.kind).toBe('text')
    if (entry?.run.kind !== 'text') return
    expect(entry.run.make('')).toBeNull()
    expect(entry.run.why?.('')).toMatch(/^task field is empty: type it in the field above, then ▶ run: what you want to do/)
    expect(entry.run.why?.('-x')).toMatch(/^task field: what you want to do/)
    expect(entry.run.why?.('review my PR')).toBe('nothing to run')
  })

  it('Enter in a field keeps its text and runs its entry, or says the rule; a field with no entry only keeps it', () => {
    const state = newState({})
    const host = { invalidate: vi.fn() } as unknown as Host
    const run = vi.fn(() => true)
    const refuse = vi.fn()
    const actions = devtoolsActions(state, host, run, refuse)

    actions.submit('task', 'add OAuth login')
    expect(run).toHaveBeenCalledWith('dt-brain', '')
    expect(state.devtools.fields.task).toBe('add OAuth login')

    actions.submit('url', 'javascript:alert(1)')
    expect(refuse).toHaveBeenCalledWith(expect.stringMatching(/^url field: /))
    expect(run).toHaveBeenCalledTimes(1)

    actions.submit('label', 'try-1')
    expect(run).toHaveBeenCalledTimes(1)
    expect(state.devtools.fields.label).toBe('try-1')
  })
})
