import { describe, expect, mock, test } from 'claude-code/testing'

import { RUFLO_FILES } from './fixtures/ruflo-run'
import { command, elementsOf, keyOf, paneAt, PLUGIN, SESSION, textOf, worldOf } from './fixtures/world'

const NOW = Date.now()
const STATUS = (extra: Record<string, unknown>) => JSON.stringify({ version: 1, updatedMs: NOW - 5000, guard: true, calls: 7, blocked: 2, startedMs: NOW - 600_000, ...extra })
// A good mod, and a hostile one: escape sequences, a bidi override, a huge summary, a nonsense version.
const FILES = {
  ...RUFLO_FILES,
  '.claude-flow/docs-mod/status.json': STATUS({ modVersion: '1.4.0', summary: 'blocks writes to .env files', lastDenied: 'read of an api key' }),
  '.claude-flow/evil-mod/status.json': STATUS({ modVersion: '\u001b[2J99', summary: `\u001b[31mred‮${'A'.repeat(4000)}`, lastDenied: '\u001b]0;pwn\u0007' }),
}

describe('the Room: Mods rows and the blocked chip', () => {
  test('each Mods row is a button that opens its detail, and a hostile file renders as plain text', { options: { boot: false } }, async ($, on) => {
    worldOf(on, FILES)
    mock.clock(on)
    await $.session.start(SESSION)
    await $.command.run(command('room'))

    const pane = await $.ui.mount({ ...paneAt(120), surface: 'terminal' as const, plugin: PLUGIN })
    const before = textOf(await pane.drawn())

    expect(before).toContain('2 reporting')
    expect(before).not.toContain('last refusal')
    await pane.press({ key: 'mod-open-docs' })

    const open = textOf(await pane.drawn())

    expect(open).toMatch(/guards\s+blocks writes to .env files/)
    expect(open).toMatch(/last refusal\s+secret/)
    expect(open).toMatch(/version\s+1.4.0/)
    await pane.press({ key: 'mod-open-docs' })
    expect(textOf(await pane.drawn())).not.toContain('last refusal')
    await pane.press({ key: 'mod-open-evil' })

    const hostile = textOf(await pane.drawn())

    expect(hostile).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f‮]/)
    expect(hostile).not.toContain('pwn')
    await pane.unmount()
  })

  test('the blocked chip is reachable, shows its count, and toggles', { options: { boot: false } }, async ($, on) => {
    worldOf(on, FILES)
    mock.clock(on)
    await $.session.start(SESSION)
    await $.command.run(command('room'))

    const pane = await $.ui.mount({ ...paneAt(120), surface: 'terminal' as const, plugin: PLUGIN })
    const tree = await pane.drawn()

    expect(elementsOf(tree, 'Button').map(keyOf)).toContain('room-blocked')
    expect(textOf(tree)).toContain('○ ⛔ blocked')
    await pane.press({ key: 'room-blocked' })
    expect(textOf(await pane.drawn())).toContain('● ⛔ blocked')
    await pane.unmount()
  })
})
