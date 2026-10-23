/**
 * The autopilot envelope's path checks on Windows. #4434 added Windows path parity across the console but the envelope's own path
 * validator still refused any `\`, and `pathAllowed` compared with POSIX-only string ops; so `C:\work\app` and `\\srv\share\app` were
 * unusable and a file at `C:\work\app\file.ts` was NOT inside envelope path `C:\work\app`. This spec pins down:
 *   - validateEnvelope accepts both `C:\...` and `C:/...` forms, and UNC paths
 *   - canonical output strips a trailing `\` on a Windows path (same semantics as it strips `/` on a POSIX one)
 *   - isProtectedPath catches the two protected directories whichever separator the path uses
 *   - pathAllowed matches a file inside a Windows envelope path ignoring case and separator style
 *   - the drive-letter root check still refuses `C:\` and `C:/` and `C:`
 * Run with
 *   npx vitest run plugins/ruflo-console/tests/ap-envelope-windows-paths.spec.ts
 */
import { describe, expect, it } from 'vitest'

import { isProtectedPath, pathAllowed, validateEnvelope, type Envelope } from '../hooks/data/ap-envelope'

const H = 3_600_000

const envWith = (paths: string[]): unknown => ({
  name: 'win shift',
  toolClasses: ['edit', 'read', 'test'],
  paths,
  repos: [],
  network: [],
  secretEnv: [],
  spend: { hourUsd: 2, dayUsd: 10, totalUsd: 40 },
  concurrency: 2,
  maxDurationMs: 7 * 24 * H,
  verify: [['true']],
  acceptWithoutAnatole: false,
})

describe('validateEnvelope on Windows paths', () => {
  it('accepts a native backslash drive path', () => {
    const result = validateEnvelope(envWith(['C:\\work\\app']))

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.envelope.paths).toEqual(['C:\\work\\app'])
  })

  it('accepts a forward-slash drive path', () => {
    const result = validateEnvelope(envWith(['C:/work/app']))

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.envelope.paths).toEqual(['C:/work/app'])
  })

  it('accepts a UNC share path', () => {
    const result = validateEnvelope(envWith(['\\\\server\\share\\app']))

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.envelope.paths).toEqual(['\\\\server\\share\\app'])
  })

  it('still refuses the bare drive root in either separator', () => {
    for (const bad of ['C:', 'C:\\', 'C:/']) {
      const result = validateEnvelope(envWith([bad]))

      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.errors.some(e => e.startsWith('paths'))).toBe(true)
    }
  })

  it('still refuses .. in a backslash path', () => {
    const result = validateEnvelope(envWith(['C:\\work\\..\\etc']))

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.some(e => e.startsWith('paths'))).toBe(true)
  })

  it('strips a trailing backslash from a Windows path, same as it strips a trailing slash on POSIX', () => {
    const result = validateEnvelope(envWith(['C:\\work\\app\\']))

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.envelope.paths).toEqual(['C:\\work\\app'])
  })

  it('refuses a Windows path that names the autopilot folder, whichever separator', () => {
    for (const bad of ['C:\\work\\app\\.claude-flow\\console', 'C:/work/app/.claude-flow/console']) {
      const result = validateEnvelope(envWith([bad]))

      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.errors.some(e => /autopilot's or Project Anatole/.test(e))).toBe(true)
    }
  })
})

describe('isProtectedPath on Windows', () => {
  it('catches the protected dirs through either separator and either case', () => {
    expect(isProtectedPath('C:\\Users\\me\\app\\.claude-flow\\console')).toBe(true)
    expect(isProtectedPath('C:\\Users\\ME\\app\\.CLAUDE-FLOW\\CONSOLE')).toBe(true)
    expect(isProtectedPath('C:/Users/me/app/.claude-flow/protector-mod')).toBe(true)
    expect(isProtectedPath('\\\\srv\\share\\.claude-flow\\console')).toBe(true)
  })

  it('does not catch an unrelated Windows path', () => {
    expect(isProtectedPath('C:\\work\\app\\src\\index.ts')).toBe(false)
    expect(isProtectedPath('\\\\srv\\share\\app\\src\\index.ts')).toBe(false)
  })
})

describe('pathAllowed on Windows', () => {
  const ENV: Envelope = {
    name: 'win',
    toolClasses: ['edit', 'read', 'test'],
    paths: ['C:\\work\\app'],
    repos: [],
    network: [],
    secretEnv: [],
    spend: { hourUsd: 2, dayUsd: 10, totalUsd: 40 },
    concurrency: 2,
    maxDurationMs: 7 * 24 * H,
    verify: [['true']],
    acceptWithoutAnatole: false,
  }

  it('matches a file inside the envelope folder ignoring case and separator', () => {
    expect(pathAllowed(ENV, 'C:\\work\\app\\file.ts')).toBe(true)
    expect(pathAllowed(ENV, 'C:/work/app/src/index.ts')).toBe(true)
    expect(pathAllowed(ENV, 'c:\\WORK\\app\\file.ts')).toBe(true)
    expect(pathAllowed(ENV, 'C:\\work\\app')).toBe(true)
  })

  it('refuses a file whose folder is only a prefix of the envelope folder', () => {
    expect(pathAllowed(ENV, 'C:\\work\\application\\file.ts')).toBe(false)
    expect(pathAllowed(ENV, 'C:\\work\\appother\\file.ts')).toBe(false)
  })

  it('refuses a path with .. in either separator', () => {
    expect(pathAllowed(ENV, 'C:\\work\\app\\..\\etc')).toBe(false)
    expect(pathAllowed(ENV, 'C:/work/app/../etc')).toBe(false)
  })

  it('refuses a protected folder below the envelope path', () => {
    expect(pathAllowed(ENV, 'C:\\work\\app\\.claude-flow\\console')).toBe(false)
  })
})
