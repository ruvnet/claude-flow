/**
 * What's new (ADR-478) through the real console: the page under the TOOLS group, reached by the nav, the search, the menu and /ruflo; the
 * entries read from each plugin's own CHANGELOG.md; the "new" marker that appears and clears; one toast per new version; the switch;
 * the pinned breaking change and its dismissal; and a hostile changelog. The page's drawing in both looks is covered in
 * tests/whatsnew.spec.ts. Run with
 *   scripts/kit-seq.sh whatsnew
 */
import type { TestBody } from 'claude-code/testing'
import { describe, expect, mock, test } from 'claude-code/testing'

import { RUFLO_FILES } from './fixtures/ruflo-run'
import { command, elementsOf, keyOf, paneAt, PLUGIN, SESSION, textOf as rawText, worldOf } from './fixtures/world'
import { CONSOLE_VERSION } from '../hooks/version'

/** The BBS look draws headers in capitals, so the page's words are compared in lower case. */
const textOf = (tree: Parameters<typeof rawText>[0]) => rawText(tree).toLowerCase()

type Body = Parameters<TestBody>

const ESC = '\u001b'
const CACHE = '/home/dev/.claude/plugins/cache/ruflo'
const installed = (swarm: string) =>
  JSON.stringify({
    version: 2,
    plugins: {
      'ruflo-swarm@ruflo': [{ scope: 'user', version: swarm, installPath: `${CACHE}/ruflo-swarm/${swarm}` }],
      'ruflo-core@ruflo': [{ scope: 'user', version: '0.2.6', installPath: `${CACHE}/ruflo-core/0.2.6` }],
    },
  })
const NOTES = '## 0.5.0 — 2026-10-05\n- breaking: the --old flag is gone\n- feat: the new thing\n- fix: a crash\n## 0.4.0 — 2026-09-01\n- feat: older thing\n'
const HOSTILE = `## 0.5.0 — 2026-10-05\n- fix: ${ESC}[2J${ESC}]52;c;ZXZpbA==\u0007 wiped ‮ sk-ant-api03-AAAAAAAAAAAAAAAAAAAA\n- feat: ${'w'.repeat(9_000)}\n`

/** The console with ruflo-swarm at `version`, its CHANGELOG at the install path, and the store holding what was last looked at. */
async function start($: Body[0], on: Body[1], options: { swarm?: string; notes?: string; seen?: Record<string, string> | null; toasted?: Record<string, string> } = {}) {
  const swarm = options.swarm ?? '0.5.0'
  const world = worldOf(on, RUFLO_FILES, {
    home: { '.claude/plugins/installed_plugins.json': installed(swarm), [`.claude/plugins/cache/ruflo/ruflo-swarm/${swarm}/CHANGELOG.md`]: options.notes ?? NOTES },
  })
  const clock = mock.clock(on)

  if (options.seen !== null) world.stored.set('whatsnew', JSON.stringify({ v: 1, seen: options.seen ?? { 'ruflo-swarm': '0.4.0', 'ruflo-core': '0.2.6', 'ruflo-console': CONSOLE_VERSION }, toasted: options.toasted ?? { 'ruflo-swarm': '0.5.0', 'ruflo-core': '0.2.6', 'ruflo-console': CONSOLE_VERSION }, pinned: [], dismissed: [], toast: true }))

  let fetches = 0

  on('http.fetch', () => (fetches += 1, { deny: 'no network in this test' }) as never)
  await $.session.start(SESSION)

  return { world, clock, fetches: () => fetches }
}

async function mounted($: Body[0], view: string, columns = 130) {
  await $.command.run(command(view))

  const pane = await $.ui.mount({ ...paneAt(columns), surface: 'terminal' as const, plugin: PLUGIN })

  await pane.drawn()

  return pane
}

describe('What’s new, end to end', () => {
  test('opens from /ruflo whatsnew: newest entries above the divider, the earlier ones below, nothing fetched', { options: { boot: false } }, async ($, on) => {
    const { fetches, clock } = await start($, on)
    const pane = await mounted($, 'whatsnew')

    await clock.advance(1_600)

    const tree = await pane.drawn()
    const text = textOf(tree)

    expect(text).toContain('what’s new')
    expect(text).toContain('ruflo-swarm 0.5.0')
    expect(text).toContain('the new thing')
    expect(text.indexOf('ruflo-swarm 0.5.0')).toBeLessThan(text.indexOf('you last looked here'))
    expect(text.indexOf('you last looked here')).toBeLessThan(text.indexOf('ruflo-swarm 0.4.0'))
    expect(elementsOf(tree, 'Button').map(keyOf)).toEqual(expect.arrayContaining(['whatsnew-check', 'whatsnew-toast', 'whatsnew-dismiss-ruflo-swarm-0.5.0']))
    expect(fetches()).toBe(0)
    await pane.unmount()
  })

  test('is reached by the nav (the TOOLS group and by its search), by the menu entry, and has no hotkey of its own', { options: { boot: false } }, async ($, on) => {
    await start($, on)

    const pane = await mounted($, 'overview')

    await pane.press({ key: 'nav-group-TOOLS' })
    expect(elementsOf(await pane.drawn(), 'Button').map(keyOf)).toContain('tab-whatsnew')
    await pane.press({ key: 'tab-whatsnew' })
    expect(textOf(await pane.drawn())).toContain('what’s new')

    await pane.press({ key: 'tab-menu' })
    // One match opens the page, as a search does for any page.
    await pane.input({ key: 'nav-find', text: 'changelog', kind: 'submit' })
    expect(textOf(await pane.drawn())).toContain('since you last looked')
    await pane.unmount()
  })

  test('the new marker is on the page and on the TOOLS group while a version is unseen, and clears once the page has been opened', { options: { boot: false } }, async ($, on) => {
    await start($, on)

    const pane = await mounted($, 'overview')
    const before = await pane.drawn()

    expect(textOf(before)).toContain('tools •')
    await pane.press({ key: 'nav-group-TOOLS' })
    expect(textOf(await pane.drawn())).toContain('new')
    await pane.press({ key: 'tab-whatsnew' })
    await pane.drawn()
    await pane.press({ key: 'tab-overview' })

    const after = await pane.drawn()

    expect(textOf(after)).not.toContain('tools •')
    await pane.unmount()
  })

  test('one info toast when a new version is found, none for the same version again, and none when the switch is off', { options: { boot: false } }, async ($, on) => {
    const { world, clock } = await start($, on, { toasted: { 'ruflo-swarm': '0.4.0', 'ruflo-core': '0.2.6', 'ruflo-console': CONSOLE_VERSION } })

    const pane = await mounted($, 'overview')

    for (let i = 0; i < 4; i += 1) await clock.advance(3_100)
    expect(world.toasts.filter(line => line.includes('new:'))).toEqual(['› What\'s new: ruflo-swarm 0.5.0 (TOOLS → What\'s new)'])
    for (let i = 0; i < 4; i += 1) await clock.advance(3_100)
    expect(world.toasts.filter(line => line.includes('new:'))).toHaveLength(1)
    await pane.unmount()
  })

  test('the toast switch is a button that saves, and pressing it twice is back where it began', { options: { boot: false } }, async ($, on) => {
    const { world } = await start($, on)
    const pane = await mounted($, 'whatsnew')

    await pane.press({ key: 'whatsnew-toast' })
    expect(textOf(await pane.drawn())).toContain('☐ toast when something new lands')
    expect(JSON.parse(String(world.stored.get('whatsnew'))).toast).toBe(false)
    await pane.press({ key: 'whatsnew-toast' })
    expect(textOf(await pane.drawn())).toContain('☑ toast when something new lands')
    await pane.unmount()
  })

  test('a breaking change is pinned and stays until dismissed; the dismissal is remembered', { options: { boot: false } }, async ($, on) => {
    const { world, clock } = await start($, on)
    const pane = await mounted($, 'whatsnew')

    await clock.advance(1_600)

    const tree = await pane.drawn()

    expect(textOf(tree)).toContain('pinned until you dismiss')
    expect(textOf(tree).indexOf('the --old flag is gone')).toBeLessThan(textOf(tree).indexOf('since you last looked'))
    await pane.press({ key: 'whatsnew-dismiss-ruflo-swarm-0.5.0' })
    expect(textOf(await pane.drawn())).not.toContain('pinned until you dismiss')
    expect(JSON.parse(String(world.stored.get('whatsnew'))).dismissed).toEqual(['ruflo-swarm@0.5.0'])
    await pane.unmount()
  })

  test('a changelog that is not the format, or missing, says so plainly and the rest of the page still draws', { options: { boot: false } }, async ($, on) => {
    await start($, on, { notes: 'this is not a changelog' })

    const pane = await mounted($, 'whatsnew')
    const text = textOf(await pane.drawn())

    expect(text).toContain('no installed ruflo plugin ships a readable changelog.md yet')
    expect(text).toContain('check for an update now')
    await pane.unmount()
  })

  test('a hostile changelog draws as clean, bounded text', { options: { boot: false } }, async ($, on) => {
    const { clock } = await start($, on, { notes: HOSTILE })
    const pane = await mounted($, 'whatsnew')

    await clock.advance(1_600)

    const text = textOf(await pane.drawn())

    expect(text).toContain('wiped')
    expect(text).not.toMatch(/[\u001b\u0007‮]|sk-ant-api03/)
    expect(Math.max(...text.split('\n').map(line => line.length))).toBeLessThan(400)
    await pane.unmount()
  })

  test('the check-now button is the update flow’s own action and nothing else reaches out', { options: { boot: false } }, async ($, on) => {
    const { world, clock } = await start($, on)
    const pane = await mounted($, 'whatsnew')

    await pane.press({ key: 'whatsnew-check' })
    await clock.advance(1_600)
    expect(textOf(await pane.drawn())).toContain('what’s new')
    expect(world.runs.every(argv => argv[0] !== 'curl' && argv[0] !== 'wget')).toBe(true)
    await pane.unmount()
  })
})
