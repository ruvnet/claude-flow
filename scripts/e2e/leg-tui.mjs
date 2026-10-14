// TUI leg (ADR-490 + ADR-489 phase 3): the standalone `ruflo tui` bundle, in this process, with an injected terminal. Keyless part ($0, what CI
// runs): the six pages, the not-a-terminal exit, the AI page's card and refusals against a stub fetch and no Codex. Live part (RUFLO_E2E_LIVE=1):
// one cheap OpenRouter question and one read-only turn on the pinned Codex, each after a card, capped by the shared spend cap.
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { recorder, sandbox, addSecret, redact } from './lib.mjs'
import { findOpenRouterKey } from './leg-openrouter.mjs'

const ESC = '\u001b'
const strip = s => s.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '')

/** An injected terminal: keys in, the last drawn frame out. */
function terminal(columns = 100, rows = 32) {
  const out = []
  const keys = []
  const io = {
    stdin: { isTTY: true, setRawMode: () => undefined, on: (_e, fn) => void keys.push(fn), off: () => void keys.splice(0), resume: () => undefined, pause: () => undefined },
    stdout: { isTTY: true, columns, rows, write: t => void out.push(t), on: () => undefined, off: () => undefined },
    stderr: { write: () => undefined },
    env: { TERM: 'xterm-256color' },
  }
  const frame = () => strip((out.join('').split(`${ESC}[H`).pop() ?? '').replace(/\r/g, ''))
  const press = k => keys.forEach(fn => fn(k))
  const waitFor = async (re, ms = 8000) => {
    const end = Date.now() + ms
    while (Date.now() < end) { if (re.test(frame())) return true; await new Promise(r => setTimeout(r, 25)) }
    return false
  }
  return { io, press, frame, waitFor, all: () => strip(out.join('')) }
}

async function ask(mod, options, text, { target = 'codex', env = {} } = {}) {
  const t = terminal()
  t.io.env = { ...t.io.env, ...env }
  const running = mod.runTui({ ...options, view: 'ai' }, t.io)
  await t.waitFor(/codex ›|openrouter ›/)
  if (target === 'openrouter') t.press('\u0014')
  t.press(text)
  t.press('\r')
  const card = await t.waitFor(/Ask first, #\d+/)
  const cardText = t.frame()
  if (card) t.press('y')
  return { t, running, card, cardText }
}

export async function tuiLeg({ live, spend }) {
  const rec = recorder('tui')
  const bundle = fileURLToPath(new URL('../../plugins/ruflo-console/dist/tui.mjs', import.meta.url))
  if (!existsSync(bundle)) { rec.skipped('tui bundle present', 'plugins/ruflo-console/dist/tui.mjs is not built (node plugins/ruflo-console/scripts/build-tui.mjs)'); return rec.rows }
  const mod = await import(pathToFileURL(bundle).href)
  const sb = sandbox('e2e-tui.')
  const project = sb.project('proj')
  const SENTINEL = 'sk-or-v1-e2esentinel0123456789abcdef0123456789'
  addSecret(SENTINEL)

  try {
    rec.check('six pages: overview cost swarm events missions ai', JSON.stringify(mod.TUI_VIEWS) === JSON.stringify(['overview', 'cost', 'swarm', 'events', 'missions', 'ai']), JSON.stringify(mod.TUI_VIEWS))

    for (const view of mod.TUI_VIEWS) {
      const out = []
      const code = await mod.runTui({ cwd: project, home: sb.home, plain: true, view, aiPage: {} }, { stdin: { on() {}, off() {}, resume() {}, pause() {} }, stdout: { columns: 100, rows: 30, write: t => void out.push(t) }, stderr: { write() {} }, env: {} })
      const text = out.join('')
      rec.check(`--plain ${view}: exit 0, page bar with the page marked, no escapes, no key`, code === 0 && /\[\d [A-Za-z]+\]/.test(text.split('\n')[0]) && !text.includes(ESC) && !text.includes(SENTINEL), text.split('\n')[0])
    }

    const err = []
    const code = await mod.runTui({ cwd: project, home: sb.home }, { stdin: { isTTY: false, on() {}, off() {}, resume() {}, pause() {} }, stdout: { isTTY: false, write() {} }, stderr: { write: t => void err.push(t) }, env: {} })
    rec.check('no terminal and no --plain: one-line hint on stderr and exit 2', code === 2 && /not an interactive terminal/.test(err.join('')), err.join('').trim())

    // Keyless AI: OpenRouter against a stub fetch (the host allows only https openrouter.ai; the stub stands in for it).
    process.env.OPENROUTER_API_KEY = SENTINEL
    const calls = []
    const stub = async (url, init) => { calls.push({ url: String(url), redirect: init.redirect, auth: init.headers.authorization }); return new Response(JSON.stringify({ choices: [{ message: { content: 'STUB-PONG' } }], usage: { prompt_tokens: 5, completion_tokens: 2, cost: 0.00003 }, model: 'stub/model' }), { status: 200 }) }
    const one = await ask(mod, { cwd: project, home: sb.home, aiPage: { fetch: stub, model: 'stub/model' } }, 'say pong', { target: 'openrouter' })
    rec.check('ai: Enter shows a card naming the host, the model and the key variable, and sends nothing before y', one.card && /openrouter\.ai\/api\/v1\/chat\/completions/.test(one.cardText.replace(/\s+/g, ' ')) && /\$OPENROUTER_API_KEY/.test(one.cardText.replace(/\s+/g, ' ')) && !one.cardText.includes(SENTINEL), one.cardText.split('\n').find(l => /Ask first/.test(l)) ?? '')
    const answered = await one.t.waitFor(/STUB-PONG/)
    rec.check('ai: after y exactly one request went to openrouter.ai, redirects off, key in one header, reply drawn with the reported cost, key never drawn', answered && calls.length === 1 && calls[0].url.startsWith('https://openrouter.ai/') && calls[0].redirect === 'manual' && calls[0].auth === `Bearer ${SENTINEL}` && /\$0\.000030/.test(one.t.frame()) && !one.t.all().includes(SENTINEL), JSON.stringify({ n: calls.length, url: calls[0]?.url }))
    one.t.press('\u0003')
    await one.running

    // Keyless AI: no pinned Codex under this HOME, so a Codex question fails with the reason and nothing falls back to PATH or current.
    const two = await ask(mod, { cwd: project, home: sb.home, aiPage: { fetch: stub } }, 'hello', { target: 'codex' })
    // The answer row (✗ codex: …), not the status line above it, which says the same thing before any question is asked.
    const refused = await two.t.waitFor(/✗ codex: .*pinned Codex 0\.162\.0 is not installed/s)
    rec.check('ai: without the pinned Codex release the answer says so (never current, never PATH)', refused, two.t.frame().split('\n').find(l => /✗ codex/.test(l)) ?? '')
    two.t.press('\u0003')
    await two.running
    delete process.env.OPENROUTER_API_KEY
  } catch (e) { rec.fail('keyless tui leg ran to completion', redact(String(e?.stack ?? e)).slice(0, 400)) }

  if (!live) { rec.skipped('live: OpenRouter and Codex through the TUI', 'RUFLO_E2E_LIVE not set'); sb.cleanup(); return rec.rows }

  const key = findOpenRouterKey()
  if (!key) rec.blocked('live: OpenRouter question through the TUI', 'no OPENROUTER_API_KEY in env or GCP Secret Manager')
  else {
    try {
      process.env.OPENROUTER_API_KEY = key
      const run = await ask(mod, { cwd: project, home: sb.home, aiPage: { model: 'openai/gpt-4o-mini', maxSpendUsd: Math.min(0.25, spend.left()) } }, 'Reply with exactly the single word: PONG', { target: 'openrouter' })
      const ok = await run.t.waitFor(/PONG/, 60_000)
      // The answer arrives before its end row (✓ <s> s · $<reported cost> · tokens): wait for that row, then read the cost off it.
      await run.t.waitFor(/✓ \d+ s/, 10_000)

      const frame = run.t.frame()
      const cost = Number(/✓ \d+ s · \$([0-9.]+)/.exec(frame)?.[1] ?? NaN)
      if (Number.isFinite(cost)) spend.add(cost)
      rec.check('live: OpenRouter answered PONG through the TUI after a card; key never drawn', ok && !run.t.all().includes(key), redact(frame.split('\n').find(l => /PONG|✓/.test(l)) ?? ''), { long: false })
      rec.check('live: the provider reported a cost (not computed here)', Number.isFinite(cost) && cost > 0, `reported $${cost}`)
      run.t.press('\u0003')
      await run.running
    } catch (e) { rec.fail('live OpenRouter leg ran to completion', redact(String(e?.message ?? e))) } finally { delete process.env.OPENROUTER_API_KEY }
  }

  // The pinned Codex under the real HOME, read-only, one trivial turn (a ChatGPT plan turn, no dollars). Run in a throwaway working directory.
  try {
    const realHome = process.env.HOME ?? sb.home
    const run = await ask(mod, { cwd: sb.project('codex-live'), home: realHome, aiPage: {} }, 'Reply with exactly the single word: PONG', { target: 'codex' })
    const done = await run.t.waitFor(/PONG|not installed|✗/, 120_000)
    const frame = run.t.frame()
    rec.check('live: the pinned Codex answered PONG through the TUI, read-only', done && /PONG/.test(frame) && /sandbox read-only/.test(run.cardText.replace(/\s+/g, ' ')), redact(frame.split('\n').find(l => /PONG|✗|not installed/.test(l)) ?? '').slice(0, 200))
    run.t.press('\u0003')
    await run.running
  } catch (e) { rec.fail('live Codex leg ran to completion', redact(String(e?.message ?? e))) }

  sb.cleanup()
  return rec.rows
}
