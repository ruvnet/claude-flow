/**
 * The Automation view's and the Learning Lab's pure parts under vitest: the catalog's invariants (fixed argv, what asks
 * first, what says it spends or deletes), the checks every typed value passes, the secret masks, and the readers
 * against what the CLI printed. Run with
 *   npx vitest run plugins/ruflo-console/tests/automate.spec.ts
 */
import { describe, expect, it } from 'vitest'

import { automateEntries, configGet, configSet, historySpec, sessionSave, sessionSpec, taskCreate, taskVerbs, workflowCreate, workflowSpec, workflowValidate, workflowVerbs } from '../hooks/automate'
import { configKeyOf, configValueOf, freeText, keyValueOf, laneOf, MASK, parseAutopilot, parseConfig, parseSessions, parseTemplates, parseTrain, parseWorkflows, relPathOf, sparkline } from '../hooks/data/automate'
import { neuralEntries, routeSpec, trainArgs, trainSpec } from '../hooks/neural'
import { newState } from '../hooks/state'
import { AUTO_OUT, FAKE_SECRET, SESSION_ID, WF_ID } from './fixtures/automate'

const listed = () => {
  const state = newState({})

  state.auto.workflows = parseWorkflows(AUTO_OUT['workflow-list'] ?? '')
  state.auto.templates = parseTemplates(AUTO_OUT['template-list'] ?? '')
  state.auto.sessions = parseSessions(AUTO_OUT['session-list'] ?? '')

  return state
}

describe('the catalog', () => {
  it('every id is unique and prefixed; no argv reaches a shell; reads alone skip the confirm', () => {
    const state = listed()
    const entries = [...automateEntries(state), ...neuralEntries(state)]
    const ids = entries.map(entry => entry.id)

    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.every(id => /^(auto|nn)-/.test(id))).toBe(true)

    for (const entry of entries) {
      const spec = entry.spec

      if (spec === undefined || spec === null) continue
      expect(spec.args.some(word => /^(sh|bash|-c)$/.test(word)), entry.id).toBe(false)
      expect(spec.lab, entry.id).toBe(entry.id)
      if (spec.isReadOnly !== true) expect(spec.note, entry.id).toBeDefined()
    }
  })

  it('a workflow run says it costs money; restore overwrites; delete deletes; worker cancel is n/a with the reason', () => {
    const state = listed()
    const entries = automateEntries(state)
    const run = workflowSpec('run', WF_ID, state)

    expect(run?.args).toEqual(['mcp', 'exec', '-t', 'workflow_execute', '-p', JSON.stringify({ workflowId: WF_ID })])
    expect(run?.isReadOnly).toBeUndefined()
    expect(run?.note).toMatch(/^COSTS MONEY/)
    expect(sessionSpec('restore', SESSION_ID)?.note).toMatch(/OVERWRITES/)
    expect(sessionSpec('delete', SESSION_ID)?.note).toMatch(/DELETES/)
    expect(entries.find(entry => entry.id === 'auto-worker-cancel')).toMatchObject({ spec: null, why: expect.stringMatching(/per-process/) })
    expect(entries.filter(entry => entry.id.startsWith('auto-worker-') && entry.spec !== null && entry.spec !== undefined)).toHaveLength(12)
    expect(entries.find(entry => entry.id === 'auto-worker-ultralearn')?.spec?.args).toEqual(['hooks', 'worker', 'dispatch', '--trigger', 'ultralearn'])
    expect(entries.map(entry => entry.id)).toEqual(expect.arrayContaining([`auto-wf-status-${WF_ID}`, `auto-wf-run-${WF_ID}`, `auto-ses-export-${SESSION_ID}`, 'auto-tpl-new-template-1790990000001-zz9']))
    expect(neuralEntries(state).every(entry => !/COSTS MONEY/.test(entry.spec?.note ?? ''))).toBe(true)
  })

  it('verbs follow status: running pauses, paused resumes, pending tasks are assigned, failed ones retried', () => {
    expect(workflowVerbs('running')).toEqual(['status', 'pause', 'cancel'])
    expect(workflowVerbs('paused')).toContain('resume')
    expect(workflowVerbs('pending')).toContain('run')
    expect(taskVerbs('pending')).toEqual(['assign', 'cancel'])
    expect(taskVerbs('in_progress')).toEqual(['done', 'cancel'])
    expect(taskVerbs('failed')).toEqual(['retry'])
    expect(taskVerbs('completed')).toEqual([])
    expect(['pending', 'in_progress', 'completed', 'cancelled', 'weird'].map(laneOf)).toEqual(['pending', 'running', 'done', 'done', 'pending'])
  })

  it('a task an older CLI stored as "complete" is done, not pending, and offers no assign or cancel', () => {
    expect(['complete', 'Completed ', 'in-progress', 'canceled'].map(laneOf)).toEqual(['done', 'done', 'running', 'done'])
    expect(taskVerbs('complete')).toEqual([])
  })
})

describe('typed values', () => {
  it('free text is bounded, printable and never a flag', () => {
    expect(freeText('fix the login bug')).toBe('fix the login bug')
    expect(freeText('--force')).toBeNull()
    expect(freeText('')).toBeNull()
    expect(freeText('x'.repeat(8000))).not.toBeNull()
    expect(freeText('x'.repeat(8001))).toBeNull()
    expect(freeText('a\u0000b')).toBe('a b')
    expect(freeText('fix the login — it loops “again”…')).toBe('fix the login — it loops “again”…')
  })

  it('config keys, values, pairs and paths', () => {
    expect(configKeyOf('swarm.maxAgents')).toBe('swarm.maxAgents')
    expect(configKeyOf('__proto__.x')).toBeNull()
    expect(configKeyOf('a..b')).toBeNull()
    expect(configValueOf('8')).toBe(8)
    expect(configValueOf('true')).toBe(true)
    expect(configValueOf('mesh')).toBe('mesh')
    expect(keyValueOf('swarm.topology mesh')).toEqual({ key: 'swarm.topology', value: 'mesh' })
    expect(keyValueOf('swarm.topology')).toBeNull()
    expect(relPathOf('workflows/build.json')).toBe('workflows/build.json')
    expect(relPathOf('../etc/passwd')).toBeNull()
    expect(relPathOf('/etc/passwd')).toBeNull()
    expect(relPathOf('-rf')).toBeNull()
  })

  it('typed specs build one fixed argv each, and refuse what fails the checks', () => {
    const state = newState({})

    expect(taskCreate('bugfix: the login loop')?.args).toEqual(['mcp', 'exec', '-t', 'task_create', '-p', JSON.stringify({ type: 'bugfix', description: 'the login loop' })])
    expect(taskCreate('ship it: now')?.args[5]).toBe(JSON.stringify({ type: 'feature', description: 'ship it: now' }))
    expect(taskCreate('-x')).toBeNull()
    expect(historySpec('auth refactor')?.args).toEqual(['autopilot', 'history', '--query', 'auth refactor', '--json'])
    expect(sessionSave(state, 'before-refactor')?.args).toEqual(['mcp', 'exec', '-t', 'session_save', '-p', '{"name":"before-refactor"}'])
    expect(workflowValidate('../x.json')).toBeNull()
    expect(workflowCreate(state, 'review the diff')?.label).toContain('no agent yet')
    expect(trainArgs('coordination 150')).toEqual({ pattern: 'coordination', epochs: 150 })
    expect(trainArgs('coordination 9999')).toBeNull()
    expect(trainArgs('nope 10')).toBeNull()
    expect(trainSpec(state, 'testing')?.args).toEqual(['neural', 'train', '--pattern', 'testing', '--epochs', '20'])
    expect(routeSpec('fix the login bug')?.args).toEqual(['hooks', 'route', '--task', 'fix the login bug', '--format', 'json'])
  })
})

describe('secrets', () => {
  it('config_list values are masked as they are parsed: by key, and by a credential-shaped value', () => {
    const rows = parseConfig(AUTO_OUT['config-list'] ?? '') ?? []

    expect(rows.map(row => [row.key, row.shown])).toEqual([
      ['logging.level', 'info'],
      ['providers.anthropic.apiKey', MASK],
      ['swarm.maxAgents', '8'],
      ['webhook.url', MASK],
    ])
    expect(JSON.stringify(rows)).not.toContain(FAKE_SECRET)
  })

  it('config get never prints a secret; config set refuses a secret key or value outright', () => {
    const lines = configGet('providers.anthropic.apiKey')?.read?.(AUTO_OUT['config-get-secret'] ?? '', '', true) ?? []

    expect(lines.join('\n')).not.toContain(FAKE_SECRET)
    expect(lines[0]).toBe(`providers.anthropic.apiKey = ${MASK}`)
    expect(configSet('providers.anthropic.apiKey abc')).toBeNull()
    expect(configSet(`webhook.url ${FAKE_SECRET}`)).toBeNull()
    expect(configSet('swarm.maxAgents 8')?.args).toEqual(['mcp', 'exec', '-t', 'config_set', '-p', '{"key":"swarm.maxAgents","value":8}'])
  })

  it('a session export shows its id and path, never its data', () => {
    const lines = sessionSpec('export', SESSION_ID)?.read?.(`Result:\n${JSON.stringify({ sessionId: SESSION_ID, path: `session-${SESSION_ID}.json`, data: { memory: FAKE_SECRET }, exportedAt: '2026-10-02T10:00:00.000Z' })}`, '', true) ?? []

    expect(lines).toEqual([`${SESSION_ID} → session-${SESSION_ID}.json`, 'exported 2026-10-02T10:00:00.000Z'])
  })
})

describe('readers', () => {
  it('workflows, templates, sessions and autopilot from their JSON', () => {
    expect(parseWorkflows(AUTO_OUT['workflow-list'] ?? '')).toEqual([{ id: WF_ID, name: 'ship the console', status: 'pending', steps: 1, createdAtMs: Date.parse('2026-10-02T10:00:00.000Z') }])
    expect(parseWorkflows(AUTO_OUT['workflow-empty'] ?? '')).toEqual([])
    expect(parseWorkflows('nope')).toBeNull()
    expect(parseSessions(AUTO_OUT['session-list'] ?? '')?.[0]?.name).toBe('before-refactor')
    expect(parseAutopilot(AUTO_OUT['autopilot-status'] ?? '')).toEqual({ isEnabled: false, iterations: 0, maxIterations: 50, timeoutMinutes: 240, done: 0, total: 0, percent: 100, sources: ['team-tasks', 'swarm-tasks', 'file-checklist'] })
  })

  it('a training run: Final Loss from the native table, Avg Loss from the JS one; the sparkline rises with the loss', () => {
    expect(parseTrain(AUTO_OUT['neural-train'] ?? '', 5)).toEqual({ pattern: 'coordination', epochs: 5, atMs: 5, loss: 0.004289, seconds: 0.4, backend: 'native' })
    expect(parseTrain(AUTO_OUT['neural-train-js'] ?? '', 6)?.loss).toBe(0.0213)
    expect(parseTrain('Training failed', 7)).toBeNull()
    expect(sparkline([0.5, 0.25, 0])).toBe('█▅▁')
    expect(sparkline([1])).toBe('▄')
  })

  it('a train spec keeps its run for the sparkline; the route reader names the pick and the runner-up', () => {
    const state = newState({})
    const lines = trainSpec(state, 'coordination 5')?.read?.(AUTO_OUT['neural-train'] ?? '', '', true) ?? []

    expect(state.auto.trains).toHaveLength(1)
    expect(lines).toContain('Final Loss: 4.289e-3')
    expect(routeSpec('fix the login bug')?.read?.(AUTO_OUT['hooks-route'] ?? '', '', true)).toEqual(['→ tester · 49% · semantic-native · pattern testing-task', '  or reviewer · 39%', 'Semantic similarity to "testing-task" pattern (49%)'])
  })
})
