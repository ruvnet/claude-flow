/**
 * Event levels (ADR-474): the one pure rule that gives every event ok, info, warn or bad, and the mask that washes what is stored.
 */
import { describe, expect, it } from 'vitest'

import { maskLine } from '../hooks/data/event-mask'
import { levelOf, levelOfEvent, rankOf } from '../hooks/data/event-severity'

describe('levelOf', () => {
  it.each([
    ['swarm', 'agent coder: busy → failed', 'bad'],
    ['workflows', 'run x is stuck: no progress', 'bad'],
    ['tools', 'permission denied: Bash (policy)', 'bad'],
    ['autopilot', 'step s1 parked: which branch?', 'warn'],
    ['swarm', 'swarm paused (was running)', 'warn'],
    ['claims', 'ISSUE-1 released', 'warn'],
    ['autopilot', 'step s1 done (verified)', 'ok'],
    ['learning', '+2 patterns learned', 'ok'],
    ['swarm', 'topology mesh', 'info'],
    ['anatole', 'Anatole blocked Bash: rule r1 (high)', 'bad'],
    ['anatole', 'Anatole notified Read: rule r2 (low)', 'warn'],
  ])('%s "%s" is %s', (kind, text, level) => expect(levelOf(kind, text)).toBe(level))

  it('a bad word wins over a warn word, and "0 failed" is not a failure', () => {
    expect(levelOf('swarm', 'paused after an error')).toBe('bad')
    expect(levelOf('workflows', 'run finished: 0 failed')).toBe('ok')
    expect(levelOf('workflows', 'run finished: no errors')).toBe('ok')
  })

  it('ranks bad over warn over info over ok, and remembers per event object', () => {
    expect([rankOf('bad'), rankOf('warn'), rankOf('info'), rankOf('ok')]).toEqual([3, 2, 1, 0])

    const event = { kind: 'swarm', text: 'x failed' }

    expect(levelOfEvent(event)).toBe('bad')
    event.text = 'fine'
    expect(levelOfEvent(event)).toBe('bad')
  })
})

describe('maskLine', () => {
  it('masks credentials, keyed secrets, bearer strings and home paths', () => {
    expect(maskLine('token=abcdef123456 used')).not.toContain('abcdef123456')
    expect(maskLine('Authorization: Bearer abcdefghijklmnop')).not.toContain('abcdefghijklmnop')
    expect(maskLine('key sk-ant-abcdefghijklmnopqrstuvwxyz0123 leaked')).not.toContain('abcdefghijklmnopqrstuvwxyz')
    expect(maskLine('read /home/alice/secret/notes.txt')).toBe('read ~/secret/notes.txt')
    expect(maskLine('password: hunter2')).not.toContain('hunter2')
  })

  it('strips escapes, control, bidi and tag characters, and caps the length with an ellipsis', () => {
    const hostile = `a\u001b[31mred\u001b[0m‮evil\u0007${String.fromCodePoint(0xe0041)}​z`

    expect(maskLine(hostile)).toBe('aredevilz')
    expect(maskLine(hostile)).not.toMatch(/[\u001b‮\u0007​]/u)
    expect(maskLine(hostile)).not.toContain(String.fromCodePoint(0xe0041))
    expect(maskLine('word '.repeat(100), 20)).toHaveLength(20)
    expect(maskLine('word '.repeat(100), 20).endsWith('…')).toBe(true)
    expect(maskLine(42 as unknown as string)).toBe('')
  })
})
