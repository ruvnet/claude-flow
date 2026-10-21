/**
 * The terminal view's agents and the x.ruv.io registry probe, under vitest: what argv each harness runs (a new session
 * or a resumed one), that the person's text never becomes a flag, how codex's and claude's JSON streams land in the
 * scrollback, that a session id is kept for the next question, that the swarm runs both agents at once, and a stop.
 */
import { describe, expect, it } from 'vitest'

import { registryProbe } from '../hooks/data/cli'
import { argvOf, harnessSpec, isLive, newSession, send, termText, whyNotRun } from '../hooks/harness'
import type { Host } from '../hooks/host'
import { newState, restoreSessions, type State } from '../hooks/state'
import { claudeParser, codexEvent, eventOf, type Sink } from '../hooks/stream'
import { screenOf } from '../hooks/views/terminal'

type Chunk = { stream: 'stdout' | 'stderr'; text: string }

const json = (value: unknown) => `${JSON.stringify(value)}\n`

/** A spawn answering each program with its own chunks; `hang` keeps a run open until `return()`. */
function fakeSpawn(script: Record<string, Chunk[]>, hang = false) {
  const calls: { argv: readonly string[]; input?: string }[] = []
  const spawn = (argv: readonly string[], input?: string) => {
    calls.push({ argv, ...(input !== undefined && { input }) })

    // As the engine's stream: `return()` kills the child, the loop then ends, and `result` rejects (closed early).
    let release: () => void = () => undefined
    let isClosed = false
    const stream = (async function* () {
      for (const chunk of script[argv[0] as string] ?? []) yield chunk
      if (hang) await new Promise<void>(resolve => (release = resolve))

      return { code: 0, signal: null }
    })()
    const result = { then: (ok: (value: unknown) => void, fail: (error: Error) => void) => (isClosed ? fail(new Error('closed')) : ok({ code: 0, signal: null })) }

    return Object.assign(stream, {
      result,
      return: async () => {
        isClosed = true
        release()

        return { done: true, value: undefined }
      },
    }) as never
  }

  return { spawn, calls }
}

function hostWith(spawn: Host['spawn']) {
  const stored = new Map<string, unknown>()
  const host = { spawn, invalidate: () => undefined, after: () => ({ cancel: () => undefined }), storeSet: async (key: string, value: unknown) => void stored.set(key, JSON.parse(JSON.stringify(value))) } as unknown as Host

  return { host, stored }
}

const settled = async (state: State) => {
  for (let i = 0; i < 100 && (state.terminal.runs.size > 0 || i < 2); i++) await new Promise(resolve => setTimeout(resolve, 2))
}
const shown = (state: State) => state.terminal.lines.map(line => `${line.from ?? ''}${line.from ? ' ' : ''}${line.kind}:${line.text}`)

const CODEX = [
  { stream: 'stdout' as const, text: json({ type: 'thread.started', thread_id: '01a0fe1f-b077-7793-9612-f134bd61bc85' }) },
  { stream: 'stdout' as const, text: json({ type: 'item.started', item: { type: 'command_execution', command: 'rg -n auth src' } }) },
  { stream: 'stdout' as const, text: `${json({ type: 'item.completed', item: { type: 'agent_message', text: 'Auth lives in src/auth.ts.' } })}${json({ type: 'turn.completed', usage: { input_tokens: 900, output_tokens: 40 } })}`.slice(0, 50) },
  { stream: 'stdout' as const, text: `${json({ type: 'item.completed', item: { type: 'agent_message', text: 'Auth lives in src/auth.ts.' } })}${json({ type: 'turn.completed', usage: { input_tokens: 900, output_tokens: 40 } })}`.slice(50) },
  { stream: 'stderr' as const, text: 'Reading prompt from stdin...\n' },
]
const CLAUDE = [
  { stream: 'stdout' as const, text: json({ type: 'system', subtype: 'init', session_id: '6b1c2d3e-0000-4000-8000-000000000001' }) },
  { stream: 'stdout' as const, text: json({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hel' } } }) },
  { stream: 'stdout' as const, text: json({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'lo \u001b[31mthere\nsecond' } } }) },
  { stream: 'stdout' as const, text: json({ type: 'assistant', message: { content: [{ type: 'text', text: 'Hello there\nsecond' }, { type: 'tool_use', name: 'Read', input: { file_path: 'src/auth.ts' } }] } }) },
  { stream: 'stdout' as const, text: json({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.0123, session_id: '6b1c2d3e-0000-4000-8000-000000000001' }) },
]

describe('terminal sessions', () => {
  it('a new codex session reads the text from stdin; a known thread is resumed, still read-only', () => {
    const state = newState({})

    state.terminal.harness = 'codex'

    expect(argvOf(state, 'codex', '--yolo')).toEqual(['codex', 'exec', '--json', '--sandbox', 'read-only', '--skip-git-repo-check', '-'])
    state.terminal.sessions.codex = '01a0fe1f-b077-7793-9612-f134bd61bc85'
    expect(argvOf(state, 'codex', 'next')).toEqual(['codex', 'exec', 'resume', '--json', '--skip-git-repo-check', '-c', 'sandbox_mode="read-only"', '01a0fe1f-b077-7793-9612-f134bd61bc85', '-'])
    expect(argvOf(state, 'claude', 'x')).not.toContain('--resume')
    state.terminal.sessions.claude = '6b1c2d3e-0000-4000-8000-000000000001'
    expect(argvOf(state, 'claude', 'x')?.slice(-2)).toEqual(['--resume', '6b1c2d3e-0000-4000-8000-000000000001'])
  })

  it('the first message of a session is asked; the swarm shows both commands; once live, Enter sends', async () => {
    const state = newState({})

    state.terminal.harness = 'codex'
    const { spawn, calls } = fakeSpawn({ codex: CODEX, claude: CLAUDE })
    const { host } = hostWith(spawn)

    state.terminal.harness = 'swarm'
    expect(isLive(state)).toBe(false)

    const spec = harnessSpec(state, host, 'where is auth?')

    expect(spec?.label).toBe('start a swarm session: where is auth?')
    expect(spec?.shows).toContain('codex exec --json')
    expect(spec?.shows).toContain('&  claude -p')

    await spec?.run?.()
    expect(isLive(state)).toBe(true)
    expect(state.terminal.runs.size).toBe(2)
    await settled(state)

    expect(calls.map(call => call.input)).toEqual(['where is auth?', 'where is auth?'])
    expect(calls[1]?.argv).toContain('--session-id')
  })

  it('codex: the thread id is kept, commands and the answer show, and the turn closes with its tokens', async () => {
    const state = newState({})

    state.terminal.harness = 'codex'
    const { spawn } = fakeSpawn({ codex: CODEX })
    const { host, stored } = hostWith(spawn)

    state.cwd = '/work'
    send(state, host, 'where is auth?')
    await settled(state)

    expect(shown(state)).toEqual(['codex in:where is auth?', 'codex head:codex', 'codex tool:$ rg -n auth src', 'codex out:Auth lives in src/auth.ts.', expect.stringMatching(/^codex end:✓ \d+ s · 940 tokens$/)])
    expect(state.terminal.sessions.codex).toBe('01a0fe1f-b077-7793-9612-f134bd61bc85')
    expect(stored.get('ruflo-console/term:/work')).toEqual({ codex: '01a0fe1f-b077-7793-9612-f134bd61bc85' })
    expect(state.terminal.turns.codex).toBe(1)
    expect(state.terminal.costReports).toBe(0)
  })

  it('claude: the answer types out from deltas (not twice), tool calls show, the cost is counted', async () => {
    const state = newState({})

    state.terminal.harness = 'codex'
    const { spawn } = fakeSpawn({ claude: CLAUDE })
    const { host } = hostWith(spawn)

    state.terminal.harness = 'claude'
    send(state, host, 'hi')
    await settled(state)

    expect(shown(state)).toEqual(['claude in:hi', 'claude head:claude', 'claude out:Hello there', 'claude out:second', 'claude tool:⚙ Read src/auth.ts', expect.stringMatching(/^claude end:✓ \d+ s · \$0\.012$/)])
    expect(state.terminal.sessions.claude).toBe('6b1c2d3e-0000-4000-8000-000000000001')
    expect(state.terminal.costUsd).toBeCloseTo(0.0123)
    expect(state.terminal.costReports).toBe(1)
  })

  it('a busy agent refuses a second question; s stops it; /new forgets the session', async () => {
    const state = newState({})

    state.terminal.harness = 'codex'
    const { spawn } = fakeSpawn({ codex: [] }, true)
    const { host, stored } = hostWith(spawn)

    state.cwd = '/work'
    state.terminal.sessions.codex = '01a0fe1f-b077-7793-9612-f134bd61bc85'
    send(state, host, 'long job')
    await new Promise(resolve => setTimeout(resolve, 5))
    expect(whyNotRun(state, 'more')).toContain('still answering')

    for (const run of state.terminal.runs.values()) run.stop()
    await settled(state)
    expect(state.terminal.lines.at(-1)?.text).toMatch(/^stopped after \d+ s$/)

    newSession(state, host)
    expect(state.terminal.sessions.codex).toBeUndefined()
    expect(stored.get('ruflo-console/term:/work')).toEqual({})
  })

  it('saved sessions come back only as id-shaped strings', () => {
    const state = newState({})

    state.terminal.harness = 'codex'

    restoreSessions(state, { codex: '01a0fe1f-b077-7793-9612-f134bd61bc85', claude: '--resume; rm -rf' })
    expect(state.terminal.sessions).toEqual({ codex: '01a0fe1f-b077-7793-9612-f134bd61bc85' })
  })

  it('the ruflo harness splits words onto the CLI prefix with no shell and is asked every time', () => {
    const state = newState({})

    state.terminal.harness = 'codex'
    const { host } = hostWith(fakeSpawn({}).spawn)

    state.terminal.harness = 'ruflo'
    expect(harnessSpec(state, host, ' swarm   status; rm x ')?.args).toEqual(['npx', '--offline', '-y', '@claude-flow/cli@latest', 'swarm', 'status;', 'rm', 'x'])
    expect(isLive(state)).toBe(false)
    expect(whyNotRun(state, '')).toBe('type something first')
  })

  it('stream readers skip what is not an event, and termText keeps indentation but drops escapes and bidi', () => {
    const lines: string[] = []
    const sink: Sink = { line: (kind, text) => lines.push(`${kind}:${text}`), type: text => lines.push(`type:${text}`), session: id => lines.push(`id:${id}`), done: () => lines.push('done') }

    expect(eventOf('not json')).toBeNull()
    codexEvent({ type: 'item.completed', item: { type: 'file_change', changes: [{ kind: 'update', path: 'a.ts' }] } }, sink)
    claudeParser()({ type: 'assistant', message: { content: [{ type: 'text', text: 'whole' }] } }, sink)
    expect(lines).toEqual(['tool:✎ update a.ts', 'out:whole'])
    expect(termText('  a‮b\u0007\u001b]0;title\u0007c  ')).toBe('  abc')
  })
})

describe('terminal screen', () => {
  it('frames each turn, reads light markdown, and lets a question be clicked to ask again', () => {
    const rows = screenOf(
      [
        { kind: 'in', text: 'explain auth', from: 'claude' },
        { kind: 'head', text: 'claude', from: 'claude' },
        { kind: 'out', text: '## Auth', from: 'claude' },
        { kind: 'out', text: '- tokens expire', from: 'claude' },
        { kind: 'out', text: '```ts', from: 'claude' },
        { kind: 'out', text: 'const a = 1', from: 'claude' },
        { kind: 'out', text: '```', from: 'claude' },
        { kind: 'end', text: '✓ 3 s', from: 'claude' },
      ],
      60,
    )

    expect(rows.map(entry => `${entry.gutter}${entry.text}`)).toEqual(['  ', '╭─ you → claude', '│  explain auth', '├─ claude', '│  Auth', '│  • tokens expire', '│  ┌┄ ts', '│  ┆ const a = 1', '│  └┄', '╰─ ✓ 3 s'])
    expect(rows[2]?.reuse).toBe('explain auth')
  })

  it('wraps a long answer at word boundaries instead of cutting it', () => {
    const rows = screenOf([{ kind: 'out', text: 'one two three four five six seven', from: 'codex' }], 14)

    expect(rows.map(entry => entry.text)).toEqual(['one two three', 'four five six', 'seven'])
  })
})

describe('x.ruv.io registry probe', () => {
  it('asks the network only with federationNetwork on, and keeps the join steps and rooms as capped data', () => {
    expect(registryProbe.isNetwork).toBe(true)
    expect(registryProbe.views).toEqual(['xruv'])

    const out = registryProbe.parse(
      `Result:\n${JSON.stringify({
        relay: 'wss://relay.ruv.io',
        gatewayPubkey: 'a'.repeat(64),
        swarmTag: 'ruflo-swarm',
        registration: { enabled: true, authentication: 'NIP-98', limits: { ipHourly: 3, daily: 100 } },
        join: ['1. generate a key', '2. \u001b[31mPOST\u001b[0m'],
        defaultChannels: [{ channel: 'pub:help', purpose: 'Questions' }, { purpose: 'no name' }],
      })}`,
    )

    expect(out).toEqual({
      relay: 'wss://relay.ruv.io',
      gatewayPubkey: 'a'.repeat(64),
      swarmTag: 'ruflo-swarm',
      registration: { isOpen: true, auth: 'NIP-98', limits: 'ipHourly 3 · daily 100' },
      join: ['1. generate a key', '2. POST'],
      channels: [{ name: 'pub:help', purpose: 'Questions' }],
    })
    expect(registryProbe.parse('not json')).toBeNull()
  })
})
