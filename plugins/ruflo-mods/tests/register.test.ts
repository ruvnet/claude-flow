import { describe, expect, test, tier } from 'claude-code/testing'
import type { Plugin } from 'claude-code/testing'

import { HELPER, prompt, ROOT, START, world } from './fixtures/world'
import { cachedFile, isMissing } from '../hooks/files'
import { flushObservations, guidanceState } from '../hooks/guidance/observations'

tier('user')

const CLASSIC_ROUTE = {
  hooks: { UserPromptSubmit: [{ hooks: [{ command: 'node "$CLAUDE_PROJECT_DIR/.claude/helpers/hook-handler.cjs" route' }] }] },
}

/** A second tighten-only guard, as ruOS ships one: deny destructive ruOS tools. */
const ruosGuard: Plugin = {
  name: 'ruos-guard',
  tier: 'user',
  register: on => {
    on('tool.check', async ($, e, next) => {
      const verdict = await next(e)
      return /^mcp__ruos__(desktop|secret)_delete$/.test(e.tool) ? { decision: 'deny', reason: 'ruos: confirm first' } : verdict
    })
  },
}

describe('register', () => {
  test('two tighten-only tool.check mods compose: a deny from either holds, nothing loosens', { plugins: [ruosGuard] }, async ($, on) => {
    world(on)
    on('tool.check', ($, e) => (e.tool === 'Read' ? { decision: 'deny', reason: 'rule', rule: 'Read(.env)' } : { decision: 'allow' }))
    await $.session.start(START)

    expect(await $.tool.check({ tool: 'mcp__ruos__desktop_delete', input: {} })).toMatchObject({ decision: 'deny', reason: 'ruos: confirm first' })
    expect((await $.tool.check({ tool: 'Bash', input: { command: 'rm -rf /' } })).decision).toBe('deny')
    expect(await $.tool.check({ tool: 'Read', input: { file_path: '.env' } })).toMatchObject({ decision: 'deny', rule: 'Read(.env)' })
    expect((await $.tool.check({ tool: 'Bash', input: { command: 'ls' } })).decision).toBe('allow')
  })

  test('owns route and post-edit where no classic hook runs them, and says so to the classic hooks', async ($, on) => {
    const w = world(on)
    await $.session.start(START)

    expect(w.env.get('RUFLO_MODS_OWNS')).toBe('route,post-edit')
    expect(w.commands).toEqual(['ruflo-mods'])
    expect(JSON.parse(w.files.get(`${ROOT}/.claude-flow/mods/session.json`) ?? '{}').owned).toEqual(['route', 'post-edit'])
  })

  test('a user-scoped mod does not inject routing or create state in an unrelated project; its guard stays active', async ($, on) => {
    const w = world(on)
    w.dirs.delete(`${ROOT}/.claude-flow`)
    w.env.set('RUFLO_MODS_OWNS', 'route,post-edit')
    let context: readonly string[] | undefined
    on('prompt.submit', ($, e) => ((context = e.context), { text: e.text }))
    on('tool.call', () => ({ result: 'edited' }))
    on('turn.complete', ($, e) => ({ text: e.answer }))
    on('tool.check', () => ({ decision: 'allow' }))

    await $.session.start(START)
    await $.prompt.submit(prompt('review this code'))
    await $.tool.call({ tool: 'Edit', file_path: `${ROOT}/a.ts`, old_string: 'a', new_string: 'b' })
    await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })

    expect(context).toBeUndefined()
    expect(w.env.has('RUFLO_MODS_OWNS')).toBe(false)
    expect(w.files.size).toBe(0)
    expect((await $.tool.check({ tool: 'Bash', input: { command: 'rm -rf /' } })).decision).toBe('deny')
  })

  test('a file named .claude-flow does not enable project event ownership or a heartbeat', async ($, on) => {
    const w = world(on, {}, { [`${ROOT}/.claude-flow`]: 'not a directory' })
    await $.session.start(START)

    expect(w.env.has('RUFLO_MODS_OWNS')).toBe(false)
    expect(w.files.size).toBe(1)
  })

  test('stands down where a classic helper too old for the handshake runs route', async ($, on) => {
    const w = world(on, CLASSIC_ROUTE, { [HELPER]: '// an older helper' })
    let context: readonly string[] | undefined
    on('prompt.submit', ($, e) => ((context = e.context), { text: e.text }))

    await $.session.start(START)
    await $.prompt.submit(prompt('implement the api'))

    expect(w.env.get('RUFLO_MODS_OWNS')).toBe('post-edit')
    expect(context).toBeUndefined()
  })

  test('routes a prompt in-process: the route rides as context, #3567 no-match included', async ($, on) => {
    world(on, CLASSIC_ROUTE, { [HELPER]: '// RUFLO_MODS_OWNS' })
    const seen: (readonly string[] | undefined)[] = []
    on('prompt.submit', ($, e) => (seen.push(e.context), { text: e.text }))

    await $.session.start(START)
    await $.prompt.submit(prompt('write tests for the parser'))
    await $.prompt.submit(prompt('hello'))

    expect(seen[0]?.[0]).toContain('| Agent: tester')
    expect(seen[0]?.[0]).toContain('Confidence: 60.0%')
    expect(seen[1]?.[0]).toContain('Confidence: 30.0%')
  })

  test('tool.check: the dangerous-command list tightens an allow; a deny is never loosened', async ($, on) => {
    world(on)
    on('tool.check', ($, e) =>
      e.tool === 'Read' ? { decision: 'deny', reason: 'rule', rule: 'Read(.env)' } : { decision: 'allow' },
    )
    await $.session.start(START)

    expect((await $.tool.check({ tool: 'Bash', input: { command: 'rm -rf /' } })).decision).toBe('deny')
    expect((await $.tool.check({ tool: 'Bash', input: { command: 'ls' } })).decision).toBe('allow')
    expect(await $.tool.check({ tool: 'Read', input: { file_path: '.env' } })).toEqual({
      decision: 'deny',
      reason: 'rule',
      rule: 'Read(.env)',
    })
  })

  test('tool.check: an enforced ruflo policy rule denies or asks; one that cannot be read asks', async ($, on) => {
    const projection = JSON.stringify({
      version: 1,
      mode: 'enforce',
      rules: [
        { id: 'no-push', effect: 'deny', actions: ['claude-code.tool.Bash'], resources: ['git push*'] },
        { id: 'review', effect: 'require_approval', actions: ['claude-code.tool.Edit'] },
      ],
    })
    const w = world(on, {}, { [`${ROOT}/.claude-flow/policy/claude-code.json`]: projection })
    on('tool.check', () => ({ decision: 'allow' }))
    await $.session.start(START)

    expect(await $.tool.check({ tool: 'Bash', input: { command: 'git push origin' } })).toMatchObject({ decision: 'deny' })
    expect(await $.tool.check({ tool: 'Edit', input: { file_path: 'a.ts' } })).toMatchObject({ decision: 'ask' })
    expect((await $.tool.check({ tool: 'Read', input: { file_path: 'a.ts' } })).decision).toBe('allow')

    w.files.set(`${ROOT}/.claude-flow/policy/claude-code.json`, '{ torn')
    expect((await $.tool.check({ tool: 'Read', input: { file_path: 'a.ts' } })).decision).toBe('ask')
  })

  test('tool.check: a parse error that quotes "ENOENT" is still unreadable, never "no policy"', async ($, on) => {
    const PATH = `${ROOT}/.claude-flow/policy/claude-code.json`
    const rule = { id: 'no-push', effect: 'deny', actions: ['claude-code.tool.Bash'], resources: ['git push*'] }
    const w = world(on, {}, { [PATH]: JSON.stringify({ version: 1, mode: 'enforce', rules: [rule] }) })
    on('tool.check', () => ({ decision: 'allow' }))
    await $.session.start(START)
    const push = { tool: 'Bash', input: { command: 'git push origin' } }
    expect((await $.tool.check(push)).decision).toBe('deny')

    // JSON.parse and the validator both put the file's own text in their message.
    for (const text of ['{"version": 1, "mode": "enforce", ENOENT', JSON.stringify({ version: 'ENOENT', mode: 'enforce', rules: [rule] })]) {
      w.files.set(PATH, text)
      const out = await $.tool.check(push)
      expect(out.decision, text).toBe('ask')
      expect(out.reason).toContain('unreadable')
    }
  })

  test('tool.check: a legacy or unknown-mode projection is unreadable, so the call asks; the report names the state (ADR-450 T10)', async ($, on) => {
    const PATH = `${ROOT}/.claude-flow/policy/claude-code.json`
    const rule = { id: 'no-push', effect: 'deny', actions: ['claude-code.tool.Bash'], resources: ['git push*'] }
    const mk = (mode: unknown) => JSON.stringify({ version: 1, mode, rules: [rule] })
    const w = world(on, {}, { [PATH]: mk('enforce') })
    on('tool.check', () => ({ decision: 'allow' }))
    on('command.run', () => ({ text: 'core' }))
    await $.session.start(START)
    const read = { tool: 'Read', input: { file_path: 'a.ts' } }
    const report = async () => ((await $.command.run({ command: 'ruflo-mods', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })).text ?? '')

    expect((await $.tool.check(read)).decision).toBe('allow')
    expect(await report()).toContain('policy:      enforce (projection read)')

    for (const bad of ['legacy', 'LEGACY', 'off', '', null, 7, ['enforce'], {}]) {
      w.files.set(PATH, mk(bad))
      const out = await $.tool.check(read)
      expect(out.decision).toBe('ask')
      expect(out.reason).toContain('unreadable')
      expect(await report()).toContain('policy:      unreadable')
    }

    w.files.set(PATH, mk('observe'))
    expect((await $.tool.check(read)).decision).toBe('allow')
    expect(await report()).toContain('policy:      observe (projection read)')
  })

  test('records a finished edit once per turn, in the classic pending-insights format', async ($, on) => {
    const w = world(on)
    on('tool.call', () => ({ result: 'edited' }))
    on('turn.complete', ($, e) => ({ text: e.answer }))
    await $.session.start(START)

    await $.tool.call({ tool: 'Edit', file_path: `${ROOT}/a.ts`, old_string: 'a', new_string: 'b' })
    expect(w.files.has(`${ROOT}/.claude-flow/data/pending-insights.jsonl`)).toBe(false)
    await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })

    const line = JSON.parse(w.files.get(`${ROOT}/.claude-flow/data/pending-insights.jsonl`) ?? '{}')
    expect(line).toMatchObject({ type: 'edit', file: `${ROOT}/a.ts`, success: true, sessionId: null })
  })

  test('/ruflo-mods reports what the session did', async ($, on) => {
    world(on)
    on('prompt.submit', ($, e) => ({ text: e.text }))
    on('command.run', () => ({ text: 'core' }))
    await $.session.start(START)
    await $.prompt.submit(prompt('deploy with docker'))

    const { text } = await $.command.run({ command: 'ruflo-mods', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
    expect(text).toContain('owns:        route, post-edit')
    expect(text).toContain('last devops (60%, matched)')
  })

  test('/ruflo mods answers the same report; other /ruflo words pass on to the console', async ($, on) => {
    world(on)
    on('prompt.submit', ($, e) => ({ text: e.text }))
    on('command.run', ($, e) => ({ text: `beneath: ${e.args}` }))
    await $.session.start(START)
    await $.prompt.submit(prompt('deploy with docker'))

    const run = (args: string) => $.command.run({ command: 'ruflo', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
    const alias = await $.command.run({ command: 'ruflo-mods', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })

    expect((await run('mods')).text).toBe(alias.text)
    expect((await run('mods')).text).toContain('owns:        route, post-edit')
    expect((await run('claims')).text).toBe('beneath: claims')
    expect((await $.command.run({ command: 'ruflo-console', args: 'mods', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })).text).toBe(alias.text)
  })
})

describe('missing means the read said ENOENT, not that some text did (#3793)', () => {
  test('a quoted path containing ENOENT is not "missing"; a real ENOENT still is', async () => {
    const path = '/home/u/ENOENT-repo/.claude-flow/policy/claude-code.json'
    expect(isMissing(new Error(`EACCES: permission denied, open '${path}'`), path)).toBe(false)
    expect(isMissing(new Error(`ENOENT: no such file or directory, open '${path}'`), path)).toBe(true)
    const read = cachedFile(() => path, text => text)
    const fs = { stat: async () => ({ kind: 'file', size: 1, mtimeMs: 1, isLink: false }) as never, read: async () => { throw new Error(`EACCES: permission denied, open '${path}'`) } }
    expect((await read(fs)).kind).toBe('error')
  })

  test('a corrupt observation queue whose text quotes ENOENT is never overwritten', async () => {
    const s = guidanceState()
    s.runId = 'mod-a-b-c'
    s.pending = [{ id: 'x' } as never]
    const writes: string[] = []
    await flushObservations(s, '/q.json', { read: async () => '[{"id": ENOENT', write: async (_p, t) => void writes.push(t) })
    expect(writes).toEqual([])
  })
})

/** settings.json as `ruflo init` wrote it before the hook-handler.cjs switch (Feb 2026). */
const LEGACY = {
  hooks: {
    UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'npx @claude-flow/cli@latest hooks route --task "$PROMPT"' }] }],
    PostToolUse: [{ matcher: 'Write|Edit|MultiEdit', hooks: [{ type: 'command', command: 'npx @claude-flow/cli@latest hooks post-edit --file "$TOOL_INPUT_file_path" --success "${TOOL_SUCCESS:-true}"' }] }],
  },
}

describe('ownership: the legacy CLI hooks route (pre-hook-handler init)', () => {
  test('a legacy `npx @claude-flow/cli hooks route` hook (no handshake) keeps route; the mod does not route too', async ($, on) => {
    const w = world(on, LEGACY)
    const seen: (readonly string[] | undefined)[] = []
    on('prompt.submit', ($, e) => (seen.push(e.context), { text: e.text }))
    await $.session.start(START)
    await $.prompt.submit(prompt('implement the api'))

    expect(w.env.get('RUFLO_MODS_OWNS') ?? '').not.toContain('route')
    expect(seen[0]).toBeUndefined()
  })
})

/** settings-generator hookCmd on Windows: project copy, else %USERPROFILE%'s. */
const WIN_ROUTE = {
  hooks: {
    UserPromptSubmit: [{ hooks: [{ command: 'cmd /c "IF EXIST \\"%CLAUDE_PROJECT_DIR%\\.claude\\helpers\\hook-handler.cjs\\" (node \\"%CLAUDE_PROJECT_DIR%\\.claude\\helpers\\hook-handler.cjs\\" route) ELSE (node \\"%USERPROFILE%\\.claude\\helpers\\hook-handler.cjs\\" route)"' }] }],
  },
}

describe('ownership: Windows %USERPROFILE% helper', () => {
  test('an old helper under %USERPROFILE% (HOME unset, as on Windows) makes the mod stand down for route', async ($, on) => {
    // A POSIX-style path: the test engine resolves paths as POSIX (C:/... would read as relative and never exist).
    const PROFILE = '/c/Users/me'
    const w = world(on, WIN_ROUTE, { [`${PROFILE}/.claude/helpers/hook-handler.cjs`]: '// an older helper' })
    w.env.set('USERPROFILE', PROFILE)
    await $.session.start(START)

    expect(w.env.get('RUFLO_MODS_OWNS') ?? '').not.toContain('route')
  })
})
