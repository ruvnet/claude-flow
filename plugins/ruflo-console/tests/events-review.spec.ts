/**
 * The adversarial review of ADR-474 (Events and Timeline), part: what reaches the disk and the append (privacy, the write path). Each block names the defect it pins.
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { activityOf, append, loadActivity, tick } from '../hooks/activity-live'
import { appendArgv, BATCH_MAX, flush, queueLine, resetIo } from '../hooks/activity-io'
import { decodeEvent, decodeEvents, decodeLane, decodeLanes, decodePrefs, EVENTS_CAP, EVENTS_FILE, LANES_FILE, PREFS_FILE } from '../hooks/data/activity-store'
import { maskLine } from '../hooks/data/event-mask'
import type { ConsoleEvent } from '../hooks/data/events'
import { eventsActions, eventsUi } from '../hooks/events-ui'
import type { Host } from '../hooks/host'
import { newState } from '../hooks/state'
import { hostOn, newDisk, type Disk } from './fixtures/activity-fs'


const T = Date.UTC(2026, 9, 7, 12)
const CWD = '/work/proj'
const ev = (text: string, atS = 0, extra: Partial<ConsoleEvent> = {}): ConsoleEvent => ({ kind: 'swarm', text, atMs: T + atS * 1000, ...extra })

function consoleOn(disk: Disk, options: Record<string, string | number | boolean> = {}) {
  const state = newState(options)

  state.cwd = CWD

  const host = { ...hostOn(disk), every: () => ({ cancel: () => undefined }), invalidate: () => undefined } as unknown as Host

  return { state, host }
}

beforeEach(() => resetIo())

// ------------------------------------------------------------------------------------------------------------------ privacy

const SECRETS = [
  'sk-ant-api03-ZZZZ1234567890abcdefghij',
  'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
  'AKIAIOSFODNN7EXAMPLE',
  'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
  'hunter2hunter2',
  'sessionvalue-ABC123',
  'tailsecretIJKLMNOP',
  'carol@example.com',
]

const HOSTILE: string[] = [
  `agent failed: ANTHROPIC_API_KEY=${SECRETS[0]}`,
  `used ${SECRETS[1]} to push`,
  `export AWS_ACCESS_KEY_ID=${SECRETS[2]} AWS_SECRET_ACCESS_KEY=${SECRETS[3]}`,
  `curl -H "Authorization: Bearer ${SECRETS[4]}" https://x.test`,
  `.env line DB_PASS=${SECRETS[5]} and PASSWORD: ${SECRETS[5]}`,
  `sk-\u001b[0mant-api03-${'A'.repeat(20)}ZZZZ1234567890`,
  `sk-\u200bant-api03-ZZZZ1234567890abcdefghij`,
  `sk-ant-api03-${'B'.repeat(12)}\u0001tailsecretIJKLMNOP`,
  `\u001b]0;title ${SECRETS[0]}\u0007visible`,
  `‮${SECRETS[1]}`,
  `Cookie: session=${SECRETS[6]}; other=1`,
  `mail ${SECRETS[8]} about it`,
  `opened /home/ruvultra/projects/secret-client/notes.md and C:\\Users\\Carol\\Documents\\x.txt`,
  `${'x'.repeat(60_000)} token=${SECRETS[5]}`,
]

const LEAKS = [...SECRETS, 'ruvultra', 'Carol']

describe('what reaches the disk (privacy)', () => {
  it('hostile text through the real write path leaves no credential, email, user name or control character in any file', async () => {
    const disk = newDisk()
    const { state, host } = consoleOn(disk)

    await tick(state, host, T)
    for (const [i, text] of HOSTILE.entries()) state.events.push(ev(text, i, { agentId: `agent-${SECRETS[0]}`, ref: `run:${SECRETS[1]}` }))
    state.toolsByAgent.set('main', [{ atMs: T - 90_000, tool: SECRETS[0] as string }, { atMs: T - 80_000, tool: 'Bash' }])
    state.snapshot = { agents: [{ id: `a-${SECRETS[1]}`, type: `coder ${SECRETS[3]}`, status: 'busy' }], tasks: [] } as never
    await tick(state, host, T + 2000)
    await tick(state, host, T + 6000)
    ;(state.snapshot as unknown as { agents: { status: string }[] }).agents[0]!.status = 'idle'
    await tick(state, host, T + 12_000)
    await tick(state, host, T + 200_000)

    const act = activityOf(state)

    act.prefs.pins.push({ atMs: T, kind: 'swarm', text: maskLine(HOSTILE[0]), level: 'bad' })
    eventsUi(state).query = ''
    eventsActions(state, host, () => undefined, () => undefined, () => undefined).query(`failed token=${SECRETS[5]}`)
    eventsActions(state, host, () => undefined, () => undefined, () => undefined).saveSearch()
    eventsActions(state, host, () => undefined, () => undefined, () => undefined).addRule()
    await tick(state, host, T + 210_000)
    await tick(state, host, T + 215_000)

    const files = [...disk.files].filter(([path]) => path.includes('/.claude-flow/console/'))

    expect(files.map(([path]) => path.split('/').pop()).sort()).toEqual(expect.arrayContaining(['events.jsonl', 'events-prefs.json']))

    for (const [path, body] of files) {
      for (const leak of LEAKS) expect(body, `${path} holds ${leak}`).not.toContain(leak)
      // eslint-disable-next-line no-control-regex
      expect(body.replace(/\n/g, ''), path).not.toMatch(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]|[\u{e0000}-\u{e007f}]/u)
      for (const line of body.split('\n').filter(Boolean)) expect(line.length, path).toBeLessThan(1_200)
    }
  })

  it('every washing shape is masked on its own', () => {
    for (const text of HOSTILE.slice(0, 13)) {
      const out = maskLine(text)

      for (const leak of LEAKS) expect(out, text.slice(0, 40)).not.toContain(leak)
    }

    // A control character in the middle of a credential joins it (a space would leave the tail readable on disk).
    expect(maskLine('sk-ant-api03-BBBBBBBBBBBB\u0001tailsecretIJKLMNOP')).not.toContain('tailsecret')
    expect(maskLine('write to carol@example.com now')).toBe('write to ‹masked› now')
    expect(maskLine('C:\\Users\\Carol\\x')).toBe('~\\x')
    expect(maskLine('Set-Cookie: sid=abc; Path=/')).toBe('Set-Cookie: ‹masked›')
  })

  it('a 50 kB line and 10 000 long hostile lines are washed in bounded time', () => {
    const started = performance.now()

    maskLine('a'.repeat(50_000))
    maskLine(`${'a.'.repeat(25_000)}@`)
    maskLine(`${'@'.repeat(50_000)}`)
    maskLine(`${'ab '.repeat(17_000)}`)
    for (let i = 0; i < 2000; i++) maskLine(`${'q'.repeat(300)}${i}@${'w'.repeat(300)}`)

    expect(performance.now() - started).toBeLessThan(4000)
  })

  it('eventsPersist off writes nothing at all: no event, lane, saved search, pin, rule, folder or ignore file', async () => {
    const disk = newDisk()
    const { state, host } = consoleOn(disk, { eventsPersist: false })

    await tick(state, host, T)
    state.events.push(ev(HOSTILE[0] as string, 5))
    state.toolsByAgent.set('main', [{ atMs: T - 90_000, tool: 'Bash' }])
    state.snapshot = { agents: [{ id: 'a1', type: 'coder', status: 'busy' }], tasks: [] } as never

    const actions = eventsActions(state, host, () => undefined, () => undefined, () => undefined)

    actions.query('level:bad')
    actions.saveSearch()
    actions.addRule()
    actions.pin(ev('pinned secret token=hunter2hunter2'))

    for (const s of [2000, 6000, 12_000, 70_000, 140_000]) await tick(state, host, T + s)

    expect(disk.runs).toEqual([])
    expect([...disk.files.keys()]).toEqual([])
    expect(activityOf(state).prefs.searches).toHaveLength(1)
  })

  it('the folder carries its own .gitignore of *, because the one `ruflo init` writes does not list console/', async () => {
    const disk = newDisk()
    const { state, host } = consoleOn(disk)

    await tick(state, host, T)
    state.events.push(ev('something happened', 1))
    await tick(state, host, T + 5000)
    expect(disk.files.get(`${CWD}/.claude-flow/console/.gitignore`)).toMatch(/^\*$/m)

    // Written once, and the pins file written first (the folder made by install -D) gets it too.
    resetIo()

    const second = newDisk()
    const other = consoleOn(second)

    await tick(other.state, other.host, T)
    activityOf(other.state).prefs.pins.push({ atMs: T, kind: 'swarm', text: 'x', level: 'info' })
    activityOf(other.state).isPrefsDirty = true
    await tick(other.state, other.host, T + 5000)
    expect(second.files.has(`${CWD}/.claude-flow/console/events-prefs.json`)).toBe(true)
    expect(second.files.get(`${CWD}/.claude-flow/console/.gitignore`)).toMatch(/^\*$/m)
  })

  it('forget removes the events and lanes files, empties the page, and nothing old comes back; pins and searches stay (documented)', async () => {
    const disk = newDisk()
    const { state, host } = consoleOn(disk)
    const asked: { argv?: readonly string[]; onOutput?: (out: string) => void }[] = []
    const actions = eventsActions(state, host, () => undefined, spec => void asked.push(spec as never), () => undefined)

    await tick(state, host, T)
    state.events.push(ev('keep me out of the file after forget', 1))
    state.toolsByAgent.set('main', [{ atMs: T - 90_000, tool: 'Bash' }])
    await tick(state, host, T + 5000)
    await tick(state, host, T + 200_000)
    expect(disk.files.get(`${CWD}/${EVENTS_FILE}`)).toContain('keep me out')

    actions.forget()

    const spec = asked[0] as { argv: readonly string[]; onOutput: (out: string) => void }

    expect(spec.argv).toEqual(['rm', '-f', '--', `${CWD}/${EVENTS_FILE}`, `${CWD}/${LANES_FILE}`])
    await hostOn(disk).run(spec.argv, 1000)
    spec.onOutput('')
    expect(disk.files.has(`${CWD}/${EVENTS_FILE}`)).toBe(false)
    expect(disk.files.has(`${CWD}/${LANES_FILE}`)).toBe(false)
    expect(activityOf(state).log).toHaveLength(0)

    await tick(state, host, T + 210_000)
    await tick(state, host, T + 220_000)
    expect(disk.files.get(`${CWD}/${EVENTS_FILE}`) ?? '').not.toContain('keep me out')
    expect(activityOf(state).log).toHaveLength(0)
  })

  it('a hostile history file is masked when it is read, and a poisoned prefs file cannot pollute prototypes', async () => {
    const line = `${JSON.stringify({ v: 1, t: T, kind: 'swarm', level: 'info', text: `leaked ${SECRETS[0]} carol@example.com`, agent: SECRETS[1] })}\n`
    const disk = newDisk({ [`${CWD}/${EVENTS_FILE}`]: line, [`${CWD}/${PREFS_FILE}`]: '{"v":1,"__proto__":{"polluted":1},"constructor":{"prototype":{"polluted":2}},"searches":[{"name":"__proto__","q":"x"},{"name":"constructor","q":"y"}],"pins":[{"__proto__":{"polluted":3},"atMs":1,"text":"t","kind":"__proto__"}]}' })
    const { state, host } = consoleOn(disk)

    await loadActivity(state, host)

    const shown = activityOf(state).log[0] as ConsoleEvent

    expect(shown.text).not.toContain('sk-ant')
    expect(shown.text).not.toContain('carol@')
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(decodePrefs('{"v":1,"searches":[{"name":"a","q":"b"}],"__proto__":{"polluted":1}}').prefs.searches).toHaveLength(1)
    expect(activityOf(state).prefs.searches.map(item => item.name)).toEqual(['__proto__', 'constructor'])
    expect(activityOf(state).prefs.pins[0]?.kind).toBe('other')
  })

  it('NaN, Infinity, negative and absurd times in an old log are skipped or harmless; a future time is kept and shown as now', () => {
    for (const t of ['-5', '1e999', '"12"', 'null']) expect(decodeEvent(`{"v":1,"t":${t},"kind":"swarm","text":"x"}`)).toBeNull()
    expect(decodeEvent(`{"v":1,"t":${T + 10 * 86_400_000},"kind":"swarm","text":"x"}`)).not.toBeNull()
    expect(decodeLane('{"v":1,"t":"span","l":"a","g":"ruflo","n":"a","a":-1,"b":5,"y":1}')).toBeNull()
    expect(decodeLane('{"v":1,"t":"span","l":"a","g":"ruflo","n":"a","a":9,"b":5,"y":1}')).toBeNull()
    expect(decodeLane('{"v":1,"t":"span","l":"a","g":"ruflo","n":"a","a":1e999,"b":1e999,"y":1}')).toBeNull()

    const tools = (decodeLane('{"v":1,"t":"tick","l":"a","g":"claude","n":"a","m":5,"c":2,"tools":{"__proto__":2,"constructor":1,"Bash":1}}') as { tools: Record<string, number> }).tools

    expect(tools.constructor).toBe(1)
    expect(Object.keys(tools).sort()).toEqual(['Bash', '__proto__', 'constructor'])
  })

  it('a 2 MiB log of tiny lines and a 1 MiB lane log load fast and keep the newest', () => {
    const tiny = Array.from({ length: 200_000 }, (_, i) => `{"v":1,"t":${T + i},"kind":"swarm","text":"a${i}"}\n`).join('')
    const lanes = Array.from({ length: 60_000 }, (_, i) => `{"v":1,"t":"span","l":"l${i % 50}","g":"ruflo","n":"n","a":${T + i * 10},"b":${T + i * 10 + 5},"y":1}\n`).join('')
    const started = performance.now()
    const events = decodeEvents(tiny)
    const rows = decodeLanes(lanes)

    expect(events.items.length).toBeLessThanOrEqual(10_000)
    expect(events.items.at(-1)?.text).toBe('a199999')
    expect(rows.items.length).toBeLessThanOrEqual(20_000)
    expect(performance.now() - started).toBeLessThan(5000)
  })
})

// ------------------------------------------------------------------------------------------------------------------ the append

describe('the append path', () => {
  it('uses one block per batch (bs and iflag=fullblock) and every path as a single argv element, never a shell', async () => {
    const odd = "/work/it's a \"dir\" $(touch x); -rf\n"
    const disk = newDisk()

    disk.dirs.add(odd.replace(/\/+$/, ''))
    queueLine(`${odd}f.jsonl`, EVENTS_CAP, '{"v":1}\n')
    await flush(hostOn(disk), odd, `${odd}f.jsonl`, T)

    expect(disk.runs.every(argv => !['sh', 'bash', 'zsh'].includes(argv[0] as string) && !argv.includes('-c'))).toBe(true)
    expect(appendArgv('/p/a b', 'gnu')).toEqual(['dd', 'of=/p/a b', 'oflag=append', 'conv=notrunc', 'bs=1M', 'iflag=fullblock', 'status=none'])
    expect(BATCH_MAX + 2000).toBeLessThan(1024 * 1024)
  })

  it.skipIf(process.platform !== 'linux')('with the real GNU dd, eight writers of batches that are 55 kB each never tear a line', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ev-dd-'))

    try {
      const batch = (c: string): string => Array.from({ length: 60 }, (_, i) => `{"w":"${c}","n":${i},"pad":"${c.repeat(900)}"}\n`).join('')
      const file = join(dir, 'out.jsonl')
      const [cmd, ...rest] = appendArgv(file, 'gnu') as string[]
      const script = Array.from({ length: 8 }, (_, w) => {
        const src = join(dir, `b${w}.txt`)

        writeFileSync(src, batch(w % 2 === 0 ? 'A' : 'B'))

        return `( for k in 1 2 3 4 5; do cat '${src}' | ${[cmd, ...rest].map(arg => `'${arg}'`).join(' ')}; done ) &`
      }).join('\n')

      expect(spawnSync('bash', ['-c', `${script}\nwait`]).status).toBe(0)

      const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean)

      expect(lines).toHaveLength(8 * 5 * 60)
      expect(lines.filter(line => !/^\{"w":"(A+|B+)","n":\d+,"pad":"(A+|B+)"\}$/.test(line) || line.length < 900)).toHaveLength(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

