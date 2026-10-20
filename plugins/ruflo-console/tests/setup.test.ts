import { describe, expect, mock, test } from 'claude-code/testing'

import { RUFLO_FILES } from './fixtures/ruflo-run'
import { cliAnswer, command, HOME, paneAt, PLUGIN, SESSION, textOf, worldOf } from './fixtures/world'

describe('first-time setup', () => {
  test('an empty offline CLI cache shows an explicit install command and never retries online', { options: { boot: false } }, async ($, on) => {
    const world = worldOf(on, RUFLO_FILES)
    world.respond = argv => argv[0] === 'npx'
      ? { exitCode: 1, stdout: '', stderr: 'npm warn unrelated warning\nnpm error code ENOTCACHED' }
      : cliAnswer(argv)
    mock.clock(on)
    await $.session.start(SESSION)
    await $.command.run(command('overview'))

    const pane = await $.ui.mount({ ...paneAt(160), plugin: PLUGIN })
    const text = textOf(await pane.drawn())

    expect(text).toContain('ruflo CLI not cached')
    expect(text).toContain('npx -y @claude-flow/cli@latest --version')
    expect(text).not.toContain('npm error code ENOTCACHED')
    const runs = world.runs.filter(argv => argv[0] === 'npx')
    expect(runs.length).toBeGreaterThan(0)
    expect(runs.every(argv => argv.includes('--offline'))).toBe(true)
    await pane.unmount()
  })

  for (const present of [true, false]) {
    test(`a confirmed federation join verifies key presence ${present} once while background federation is off`, { options: { boot: false } }, async ($, on) => {
      const world = worldOf(on, RUFLO_FILES, { home: present ? { '.ruflo/nostr.key': 'never read this private key' } : {} })
      world.respond = argv => argv.includes('federation') && argv.includes('join')
        ? { exitCode: 0, stdout: 'joined', stderr: '' }
        : cliAnswer(argv)
      mock.clock(on)
      await $.session.start(SESSION)
      await $.command.run(command('run federation-join'))

      const keyStats = () => world.stats.filter(path => path === `${HOME}/.ruflo/nostr.key`)
      const joins = () => world.runs.filter(argv => argv.includes('federation') && argv.includes('join'))

      expect(keyStats()).toEqual([])
      expect(joins()).toEqual([])
      await $.command.run(command('yes'))
      expect(joins()).toHaveLength(1)
      expect(keyStats()).toHaveLength(1)

      const pane = await $.ui.mount({ ...paneAt(160), plugin: PLUGIN })
      const text = textOf(await pane.drawn())

      expect(text).toContain(present ? ' · on disk' : ' · not on disk yet')
      expect(world.reads).not.toContain(`${HOME}/.ruflo/nostr.key`)
      await $.command.run(command('status'))
      expect(keyStats()).toHaveLength(1)
      if (present) {
        await $.command.run(command('federation'))
        const federation = textOf(await pane.drawn())
        expect(federation).toContain('confirmed by JOIN')
        expect(federation).not.toMatch(/Start here: Join the federation/i)
        expect(keyStats()).toHaveLength(1)

        // A receipt is display evidence, not proof the key still exists: a later read may create it again.
        world.files.delete(`${HOME}/.ruflo/nostr.key`)
        await $.command.run(command('status'))
        await $.command.run(command('xruv'))
        expect(textOf(await pane.drawn())).toContain('confirmed by JOIN')
        await $.command.run(command('run x-read pub:general'))
        expect(textOf(await pane.drawn())).toContain('Confirm: read x.ruv.io channel pub:general?')
        expect(world.runs.some(argv => argv.includes('x_federation_channel_read'))).toBe(false)
        expect(keyStats()).toHaveLength(1)
        await $.command.run(command('no'))
      }
      await pane.unmount()
    })
  }

  test('cancelled and failed joins never inspect the private key', { options: { boot: false } }, async ($, on) => {
    const world = worldOf(on, RUFLO_FILES, { home: { '.ruflo/nostr.key': 'never read this private key' } })
    world.respond = argv => argv.includes('federation') && argv.includes('join')
      ? { exitCode: 1, stdout: '', stderr: 'relay unavailable' }
      : cliAnswer(argv)
    mock.clock(on)
    await $.session.start(SESSION)
    await $.command.run(command('run federation-join'))
    await $.command.run(command('no'))
    expect(world.runs.some(argv => argv.includes('join'))).toBe(false)
    await $.command.run(command('run federation-join'))
    await $.command.run(command('yes'))
    expect(world.runs.filter(argv => argv.includes('join'))).toHaveLength(1)
    expect(world.stats.some(path => path.endsWith('nostr.key'))).toBe(false)
    expect(world.reads.some(path => path.endsWith('nostr.key'))).toBe(false)
  })
})
