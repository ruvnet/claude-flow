import { describe, expect, it } from 'vitest'

import { probeArgv, probeError, scoreProbe, versionProbe } from '../hooks/data/cli'
import { NOSTR_KEY, type ReaderFs } from '../hooks/data/files'
import { readSnapshot } from '../hooks/data/snapshot'
import { startSpec } from '../hooks/starts'

const keyPath = `/home/dev/${NOSTR_KEY}`

function keyFs(answer: 'present' | 'missing' | 'undefined' | 'refused') {
  const stats: string[] = []
  const reads: string[] = []
  const fs: ReaderFs = {
    stat: async path => {
      stats.push(path)
      if (path !== keyPath || answer === 'undefined') return undefined
      if (answer !== 'present') throw new Error(answer === 'missing' ? 'ENOENT' : 'EACCES')
      return { size: 64, mtimeMs: 1 }
    },
    read: async path => {
      reads.push(path)
      throw new Error('ENOENT')
    },
    list: async () => [],
  }
  return { fs, stats, reads }
}

describe('federation key checks', () => {
  it('the default snapshot never stats or reads the private key, even when it exists', async () => {
    const { fs, stats, reads } = keyFs('present')
    const snapshot = await readSnapshot(fs, new Map(), '/work', '/home/dev', {}, 0)

    expect(snapshot.hasNostrKey).toBeNull()
    expect(stats).not.toContain(keyPath)
    expect(reads).not.toContain(keyPath)
  })

  it.each(['present', 'missing', 'undefined', 'refused'] as const)('the explicit federation option checks %s without reading key contents', async answer => {
    const { fs, stats, reads } = keyFs(answer)
    const snapshot = await readSnapshot(fs, new Map(), '/work', '/home/dev', {}, 0, undefined, true)

    expect(snapshot.hasNostrKey).toBe(answer === 'present')
    expect(stats.filter(path => path === keyPath)).toHaveLength(1)
    expect(reads).not.toContain(keyPath)
  })

  it('turning federation off clears the key observation and stops further checks', async () => {
    const { fs, stats } = keyFs('present')
    const cache = new Map()

    expect((await readSnapshot(fs, cache, '/work', '/home/dev', {}, 0, undefined, true)).hasNostrKey).toBe(true)
    stats.length = 0
    expect((await readSnapshot(fs, cache, '/work', '/home/dev', {}, 1, undefined, false)).hasNostrKey).toBeNull()
    expect(stats).not.toContain(keyPath)
  })

  it.each(['present', 'missing', 'undefined', 'refused'] as const)('the consented join verifies %s once without enabling background key checks', async answer => {
    const { fs, stats, reads } = keyFs(answer)
    const spec = startSpec('federation-join', 0)

    expect(await spec?.verifyLocal?.({ fs, home: async () => '/home/dev' })).toBe(answer === 'present')
    expect(stats).toEqual([keyPath])
    expect(reads).toEqual([])
    stats.length = 0
    expect((await readSnapshot(fs, new Map(), '/work', '/home/dev', {}, 0)).hasNostrKey).toBeNull()
    expect(stats).not.toContain(keyPath)
  })
})

describe('offline CLI setup guidance', () => {
  const argv = probeArgv(versionProbe, 'npx-offline')
  const result = { exitCode: 1, stdout: '', stderr: 'npm warn unrelated warning\nnpm error code ENOTCACHED\nnpm error cache mode is only-if-cached' }

  it('an empty offline cache names the explicit command that installs the CLI without changing probe argv', () => {
    expect(probeError(argv, result)).toBe('ruflo CLI not cached; run: npx -y @claude-flow/cli@latest --version')
    expect(argv).toEqual(['npx', '--offline', '-y', '@claude-flow/cli@latest', '--version'])
  })

  it('recognizes the cache failure when npm writes it to stdout', () => {
    expect(probeError(argv, { ...result, stdout: result.stderr, stderr: '' })).toContain('ruflo CLI not cached')
  })

  it('keeps other failures and failures from non-Ruflo commands accurate', () => {
    expect(probeError(argv, { ...result, stderr: 'npm error code EACCES' })).toBe('exit 1: npm error code EACCES')
    expect(probeError(['npx', '--offline', 'other-cli'], result)).not.toContain('ruflo CLI not cached')
    expect(probeError(['ruflo', '--version'], result)).not.toContain('ruflo CLI not cached')
    expect(probeError(argv, { ...result, exitCode: 0 })).toBe('no JSON in the CLI output')
  })

  it('names an absent optional package from its degraded answer instead of calling it "no JSON" (ADR-150)', () => {
    const degraded = JSON.stringify({ degraded: true, reason: 'metaharness-not-available', hint: 'Install with npm i -D metaharness@~0.3.0' }, null, 2)

    expect(probeError(['metaharness', 'score'], { exitCode: 0, stdout: degraded, stderr: '' })).toBe('unavailable: metaharness-not-available')
    expect(probeError(['metaharness', 'score'], { exitCode: 0, stdout: '{"degraded":true}', stderr: '' })).toBe('unavailable: degraded')
    expect(probeError(['metaharness', 'score'], { exitCode: 0, stdout: '{"degraded":false}', stderr: '' })).toBe('no JSON in the CLI output')
    expect(scoreProbe.parse(degraded)).toBeNull()
  })
})
