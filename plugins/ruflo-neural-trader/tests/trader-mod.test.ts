import type { On } from 'claude-code'
import { describe, expect, test, tier } from 'claude-code/testing'

tier('user')

const ROOT = '/work'
const STATUS = `${ROOT}/.claude-flow/trader-mod/status.json`
const START = { surface: 'terminal', isInteractive: true, cwd: ROOT } as const
const slash = (args: string) => ({ command: 'trader-mod', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } }) as const
const KEY = `ghp_${'a1B2'.repeat(10)}`

/** The world beneath the mod: a project root, a file map, a command registry; every tool call is answered 'ok'. */
function world(on: On) {
  const files = new Map<string, string>()
  const registered: string[] = []
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: ROOT }))
  on('command.register', ($, e) => (registered.push(e.name), { value: { command: e.name } }))
  on('fs.write', ($, e) => (files.set(e.path, e.text), { value: undefined }))
  on('clock.now', () => ({ value: 1_700_000_000_000 }))
  on('tool.call', () => ({ result: 'ok' }))
  return { files, registered }
}

const call = (tool: string, input: Record<string, unknown>) => ({ tool, ...input }) as never
const store = (value: string) => call('mcp__plugin_ruflo-core_ruflo__memory_store', { key: 'k', namespace: 'trading-signals', value })
const status = (files: Map<string, string>) => JSON.parse(files.get(STATUS) ?? '{}')

/** Runs the call; a denial surfaces as a rejection or a deny result, flattened to text either way. */
async function outcome($: { tool: { call: (e: never) => Promise<unknown> } }, e: never): Promise<string> {
  try {
    return JSON.stringify(await $.tool.call(e))
  } catch (err) {
    return String(err)
  }
}

describe('session', () => {
  test('writes the status file and registers /trader-mod, guard on by default', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    expect(w.registered).toEqual(['trader-mod'])
    expect(status(w.files)).toMatchObject({ version: 1, guard: true, checked: 0, blocked: 0 })
    expect(typeof status(w.files).updatedMs).toBe('number')
  })
})

describe('guard', () => {
  test('refuses a secret in a memory write, passes a clean one, never echoes the value', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    const denied = await outcome($, store(`token ${KEY}`))
    expect(denied).toContain('ruflo-neural-trader')
    expect(denied).not.toContain('ghp_')
    expect(await outcome($, store('prefer small reversible steps'))).toContain('ok')
    expect(status(w.files)).toMatchObject({ checked: 2, blocked: 1, lastBlock: 'github token' })
  })

  test('ignores tools that are not this mod\'s business', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    expect(await outcome($, call('Bash', { command: `echo ${KEY}` }))).toContain('ok')
    expect(status(w.files).checked).toBe(0)
  })

  test('guard: off lets the write through', { options: { guard: 'off' } }, async ($, on) => {
    world(on)
    await $.session.start(START)
    expect(await outcome($, store(`token ${KEY}`))).toContain('ok')
  })

  const order = (input: Record<string, unknown>) => call('mcp__neural-trader__execute_trade', { symbol: 'SPY', qty: 1, ...input })

  test('a live order needs an explicit confirm or paper flag', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    expect(await outcome($, order({}))).toContain('confirm: true')
    expect(await outcome($, order({ confirm: true }))).toContain('ok')
    expect(await outcome($, order({ paper: true }))).toContain('ok')
    expect(await outcome($, call('mcp__neural-trader__backtest', { symbol: 'SPY' }))).toContain('ok')
    expect(status(w.files)).toMatchObject({ liveBlocked: 1, blocked: 1 })
  })

  test('the package\'s other order tools are gated too, and paper or simulated ones are not', async ($, on) => {
    world(on)
    await $.session.start(START)
    for (const name of ['execute_multi_asset_trade', 'place_prediction_order_tool', 'execute_trades']) {
      expect(await outcome($, call(`mcp__neural-trader__${name}`, { symbol: 'SPY' }))).toContain('confirm: true')
    }
    expect(await outcome($, call('mcp__neural-trader__place_prediction_order_tool', { confirm: true }))).toContain('ok')
    for (const name of ['simulate_trade', 'execute_paper_trade', 'get_market_orderbook_tool', 'run_backtest']) {
      expect(await outcome($, call(`mcp__neural-trader__${name}`, { symbol: 'SPY' }))).toContain('ok')
    }
  })

  test('a broker secret in a trader call is refused without echoing it', async ($, on) => {
    world(on)
    await $.session.start(START)
    const denied = await outcome($, order({ confirm: true, api_secret: 'abcdEFGH1234ijklMNOP5678' }))
    expect(denied).toContain('secret')
    expect(denied).not.toContain('abcdEFGH')
  })

  test('liveGuard: off lets an unconfirmed order through (the secret guard stays)', { options: { liveGuard: 'off' } }, async ($, on) => {
    world(on)
    await $.session.start(START)
    expect(await outcome($, order({}))).toContain('ok')
    expect(await outcome($, order({ api_secret: 'abcdEFGH1234ijklMNOP5678' }))).toContain('secret')
  })
})

describe('/trader-mod', () => {
  test('status and scan answer locally', async ($, on) => {
    world(on)
    await $.session.start(START)
    expect((await $.command.run(slash('status'))).text).toContain('guard on')
    const hit = (await $.command.run(slash(`scan key ${KEY}`))).text ?? ''
    expect(hit).toContain('github token')
    expect(hit).not.toContain('ghp_')
    expect((await $.command.run(slash('scan plain words'))).text).toContain('Nothing')
    expect((await $.command.run(slash('status'))).text).toContain('live-order guard on')
  })

  test('an unknown verb or none gets the help, not a model turn', async ($, on) => {
    world(on)
    await $.session.start(START)
    expect((await $.command.run(slash('how do I do this'))).text).toContain('/trader-mod status')
    expect((await $.command.run(slash(''))).text).toContain('/trader-mod scan')
  })
})

describe('guard: a write to a namespace this plugin does not own', () => {
  const put = (namespace: string | undefined, value: string) =>
    call('mcp__plugin_ruflo-core_ruflo__memory_store', { key: 'k', ...(namespace === undefined ? {} : { namespace }), value })

  test('is refused exactly as before, but the message neither claims the write nor echoes anything', async ($, on) => {
    world(on)
    await $.session.start(START)
    const own = await outcome($, put('trading-signals', `token ${KEY}`))
    expect(own).toContain('ruflo-neural-trader')
    expect(own).toContain('this call holds')
    for (const ns of ['unrelated-notes', undefined, 'x'.repeat(80)]) {
      const denied = await outcome($, put(ns, `token ${KEY}`))
      expect(denied).toContain('secret-shaped value')
      expect(denied).toMatch(ns === undefined ? /no namespace/ : new RegExp(`targeted namespace \\\\?"${ns.slice(0, 40)}\\\\?"`))
      expect(denied).not.toMatch(/this call|broker key|credentials/)
      expect(denied).not.toContain('ghp_')
      expect(denied).toContain('reference')
    }
    expect(await outcome($, put('unrelated-notes', 'prefer small reversible steps'))).toContain('ok')
  })

  test('a secret-shaped namespace is refused and never repeated', async ($, on) => {
    world(on)
    await $.session.start(START)
    const denied = await outcome($, put(KEY, 'a plain note'))
    expect(denied).toContain('secret-shaped value')
    expect(denied).not.toContain('ghp_')
  })
})
