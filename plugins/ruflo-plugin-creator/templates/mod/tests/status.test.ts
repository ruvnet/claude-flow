import { describe, expect, test, tier } from 'claude-code/testing'

import { modStatus, STATUS_PATH } from '../hooks/status'

tier('user')

const FOLDER = /^[a-z0-9][a-z0-9-]{0,40}-mod$/

describe('status contract', () => {
  test('the path is .claude-flow/<name>-mod/status.json, a folder the console scans', () => {
    const [dir, folder, file] = STATUS_PATH.split('/')
    expect(dir).toBe('.claude-flow')
    expect(folder).toMatch(FOLDER)
    expect(file).toBe('status.json')
  })

  test('carries exactly the fields the console reads, calls as a number', () => {
    const doc = modStatus({ calls: 3, blocked: 0 }, 9_000, 1_000)
    expect(doc).toEqual({ version: 1, updatedMs: 9000, startedMs: 1000, modVersion: '0.1.0', summary: expect.any(String), guard: false, calls: 3, blocked: 0 })
    expect(typeof doc.calls).toBe('number')
    expect('lastDenied' in doc).toBe(false)
    expect(modStatus({ calls: 1, blocked: 1, lastDenied: 'policy' }, 2, 1).lastDenied).toBe('policy')
  })
})
