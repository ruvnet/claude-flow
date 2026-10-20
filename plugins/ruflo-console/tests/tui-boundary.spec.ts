/**
 * The host-adapter boundary (ADR-489), kept true by test: `hooks/` is the part of the console that is the same on every host. It has no
 * value import of the Claude Code engine, no Node module and no package, and only `register.ts` and `model-tools.ts` reach `$`. The
 * standalone shell (`tui/`) imports neither of those two. Run with
 *   npx vitest run plugins/ruflo-console/tests/tui-boundary.spec.ts
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const walk = (dir: string): string[] => readdirSync(dir).flatMap(name => (statSync(join(dir, name)).isDirectory() ? walk(join(dir, name)) : name.endsWith('.ts') ? [join(dir, name)] : []))
const bare = (file: string): string => readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
/** Every `import … from 'x'` / `export … from 'x'` statement as [is it type-only, the specifier]; a statement cannot cross a quote, so none runs into the next. */
const importsOf = (text: string): Array<[boolean, string]> => [...text.matchAll(/^(import|export)\b([^'";]*?)from\s+'([^']+)'/gm)].map(match => [/^\s*type\b/.test(match[2] ?? ''), match[3] as string])
const hooks = walk(join(root, 'hooks')).map(file => ({ file: relative(join(root, 'hooks'), file), text: bare(file) }))

/** The two modules that talk to the Claude Code engine directly. */
const ENGINE_ONLY = ['model-tools.ts', 'register.ts']
const ENGINE = /\$\.(ui|clock|store|fs|http|process|session|tool|settings|env|plugin|command|prompt|ruflo)\.[a-zA-Z]+\(|\bon\('|EngineInterface|\bRegister\b/

describe('hooks/ is host-neutral', () => {
  it('imports the Claude Code declarations as types only', () => {
    const offenders = hooks.filter(({ text }) => importsOf(text).some(([isType, from]) => !isType && /^claude-code/.test(from))).map(({ file }) => file)

    expect(offenders).toEqual([])
  })

  it('imports no Node module and no package: every import is a relative path or a type', () => {
    const offenders = hooks.filter(({ text }) => importsOf(text).some(([isType, from]) => !isType && !from.startsWith('.')) || /\bimport\(\s*'(?![./])/.test(text) || /\brequire\(/.test(text)).map(({ file }) => file)

    expect(offenders).toEqual([])
  })

  it('reaches the engine only from register.ts and model-tools.ts', () => {
    expect(hooks.filter(({ text }) => ENGINE.test(text)).map(({ file }) => file).sort()).toEqual(ENGINE_ONLY)
  })
})

describe('tui/ is the second adapter', () => {
  const tui = walk(join(root, 'tui')).map(file => ({ file: relative(root, file), text: bare(file), lines: readFileSync(file, 'utf8').split('\n').length }))

  it('exists, stays under 500 lines a file, and never imports the engine-only modules', () => {
    expect(tui.length).toBeGreaterThanOrEqual(5)
    expect(tui.filter(({ lines }) => lines > 500)).toEqual([])
    expect(tui.filter(({ text }) => /from\s+'\.\.\/hooks\/(register|model-tools)'/.test(text))).toEqual([])
  })

  it('has no runtime dependency: only node: modules, relative paths and types', () => {
    const offenders = tui.filter(({ text }) => importsOf(text).some(([isType, from]) => !isType && !from.startsWith('node:') && !from.startsWith('.'))).map(({ file }) => file)

    expect(offenders).toEqual([])
  })

  it('keeps register.ts (the one file that binds $) out of the bundle, even through hooks/; model-tools.ts is in it only for the helpers the controller shares', () => {
    let esbuild: typeof import('esbuild')

    try {
      esbuild = createRequire(import.meta.url)('esbuild')
    } catch {
      return // esbuild is a build-time tool; without it the build script itself says so
    }

    const built = esbuild.buildSync({ entryPoints: [join(root, 'tui', 'main.ts')], bundle: true, write: false, metafile: true, platform: 'node', format: 'esm', logLevel: 'silent' })
    const inputs = Object.keys(built.metafile.inputs)

    expect(inputs.some(input => /hooks\/views\/pane\.ts$/.test(input))).toBe(true)
    expect(inputs.filter(input => /hooks\/register\.ts$/.test(input))).toEqual([])
    // The console_* tool server inside model-tools.ts is started only by register.ts; the standalone shell never calls it.
    expect(readdirSync(join(root, 'tui')).map(name => readFileSync(join(root, 'tui', name), 'utf8')).some(text => /serveModelTools|announceModelTools/.test(text))).toBe(false)
  })

  it('implements every member of Host the controller can call, and nothing in hooks/ changed shape', async () => {
    const { createNodeHost } = await import('../tui/node-host')
    const host = createNodeHost({ cwd: root })

    for (const member of ['fs', 'every', 'after', 'storeGet', 'storeSet', 'fetchText', 'askChoice', 'toast', 'invalidate', 'scrollTop', 'focus', 'blit', 'openPane', 'closePane', 'panes', 'registerCommand', 'run', 'spawn', 'usage', 'rufloTools', 'settings', 'home', 'configDir', 'pluginRoot', 'rufloSnapshot', 'rufloRoute', 'rufloSegment', 'submitPrompt', 'fillPrompt', 'listCommands', 'runSlash']) expect(host).toHaveProperty(member)
  })
})
