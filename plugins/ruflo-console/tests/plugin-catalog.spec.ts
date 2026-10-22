import { describe, expect, it } from 'vitest'

import { readCatalog, readDoc, visible, type CatalogPlugin } from '../hooks/data/plugin-catalog'
import type { ReaderFs } from '../hooks/data/files'

const ROOT = '/h/.claude/plugins/marketplaces/ruflo'
const CACHE = '/h/.claude/plugins/cache/ruflo'
const GIT = { source: 'git-subdir', url: 'https://example.com/qe.git', path: 'plugins/qe', ref: 'v2.0.0', sha: 'a'.repeat(40) }
const files: Record<string, string> = {
  [`${ROOT}/.claude-plugin/marketplace.json`]: JSON.stringify({
    plugins: [
      { name: 'a-plugin', source: './plugins/a-plugin', description: 'Does A things' },
      { name: 'b-mod', source: './plugins/b-mod', description: 'A mod' },
      { name: 'evil', source: './../../etc', description: 'climbs out' },
      { name: 'bad name!', source: './plugins/x', description: 'not a word' },
      { name: 'ext-installed', source: GIT, description: 'An external plugin, installed' },
      { name: 'ext-missing', source: { ...GIT, path: 'plugins/other' }, description: 'An external plugin, not installed' },
      { name: 'ext-odd', source: { source: 'npm', package: 'x' }, description: 'a source kind it does not read' },
    ],
  }),
  [`${ROOT}/plugins/a-plugin/.claude-plugin/plugin.json`]: '{"version":"1.2.3"}',
  [`${ROOT}/plugins/a-plugin/skills/alpha/SKILL.md`]: '---\nname: alpha\ndescription: "Alpha does a"\n---\nbody\n',
  [`${ROOT}/plugins/a-plugin/agents/helper.md`]: 'x',
  [`${ROOT}/plugins/a-plugin/commands/go.md`]: 'x',
  [`${ROOT}/plugins/a-plugin/.mcp.json`]: '{}',
  [`${ROOT}/plugins/b-mod/hooks/register.ts`]: 'x',
  [`${CACHE}/ext-installed/2.0.0/.claude-plugin/plugin.json`]: '{"version":"2.0.0","userConfig":{"guardMode":{}}}',
  [`${CACHE}/ext-installed/2.0.0/commands/qe-go.md`]: '---\ndescription: Go\n---\n',
  [`${CACHE}/ext-installed/2.0.0/.mcp.json`]: '{}',
  [`${CACHE}/ext-installed/2.0.0/hooks/register.ts`]: 'x',
}

const fs: ReaderFs = {
  read: async path => {
    if (!(path in files)) throw new Error('ENOENT')

    return files[path] as string
  },
  stat: async path => (path in files ? { size: (files[path] as string).length } : undefined),
  list: async path => {
    const below = Object.keys(files).filter(file => file.startsWith(`${path}/`)).map(file => file.slice(path.length + 1))

    if (below.length === 0) throw new Error('ENOENT')

    return [...new Set(below.map(name => name.split('/')[0] as string))].map(name => ({ name, kind: below.some(file => file === name) ? 'file' : 'dir' }))
  },
}

describe('plugin catalog reader', () => {
  it('lists each plugin with what it ships, skipping a climbing source, a non-word name and a source kind it does not read', async () => {
    const plugins = (await readCatalog(fs, ROOT)) as CatalogPlugin[]

    expect(plugins.map(plugin => plugin.name)).toEqual(['a-plugin', 'b-mod', 'ext-installed', 'ext-missing'])
    expect(plugins[0]).toMatchObject({ version: '1.2.3', skills: ['alpha'], agents: ['helper'], commands: ['go'], hasMcp: true, isMod: false })
    expect(plugins[0]?.external).toBeUndefined()
    expect(plugins[1]).toMatchObject({ isMod: true, skills: [] })
  })

  it('reads an external plugin from its install path, and lists one that is not installed by its entry alone', async () => {
    const plugins = (await readCatalog(fs, ROOT, new Map([['ext-installed', `${CACHE}/ext-installed/2.0.0`]]))) as CatalogPlugin[]
    const installed = plugins.find(plugin => plugin.name === 'ext-installed') as CatalogPlugin
    const missing = plugins.find(plugin => plugin.name === 'ext-missing') as CatalogPlugin

    expect(installed).toMatchObject({ dir: `${CACHE}/ext-installed/2.0.0`, version: '2.0.0', commands: ['qe-go'], options: ['guardMode'], hasMcp: true, isMod: true, external: 'https://example.com/qe.git plugins/qe @ v2.0.0' })
    expect((await readDoc(fs, installed, 'command', 'qe-go'))?.description).toBe('Go')
    expect(missing).toMatchObject({ dir: '', version: null, skills: [], agents: [], commands: [], hasMcp: false, isMod: false, external: 'https://example.com/qe.git plugins/other @ v2.0.0' })
    expect(await readDoc(fs, missing, 'command', 'qe-go')).toBeNull()
  })

  it('refuses a location with .. or a relative one, and a missing manifest', async () => {
    expect(await readCatalog(fs, '/h/../etc')).toBeNull()
    expect(await readCatalog(fs, 'relative/clone')).toBeNull()
    expect(await readCatalog(fs, '/nowhere')).toBeNull()
  })

  it('reads a skill’s description from its frontmatter and bounds the lines', async () => {
    const [plugin] = (await readCatalog(fs, ROOT)) as CatalogPlugin[]
    const doc = await readDoc(fs, plugin as CatalogPlugin, 'skill', 'alpha')

    expect(doc?.description).toBe('Alpha does a')
    expect(doc?.lines.length).toBeLessThanOrEqual(40)
    expect(await readDoc(fs, plugin as CatalogPlugin, 'skill', '../escape')).toBeNull()
  })

  it('filters by mode and by a word found in a name, description, or skill name', async () => {
    const plugins = (await readCatalog(fs, ROOT)) as CatalogPlugin[]
    const installed = new Set(['a-plugin'])

    expect(visible(plugins, installed, 'installed', '').map(plugin => plugin.name)).toEqual(['a-plugin'])
    expect(visible(plugins, installed, 'missing', '').map(plugin => plugin.name)).toEqual(['b-mod', 'ext-installed', 'ext-missing'])
    expect(visible(plugins, installed, 'mods', '').map(plugin => plugin.name)).toEqual(['b-mod'])
    expect(visible(plugins, installed, 'all', 'alpha').map(plugin => plugin.name)).toEqual(['a-plugin'])
    expect(visible(plugins, installed, 'skills', '').map(plugin => plugin.name)).toEqual(['a-plugin'])
    expect(visible(plugins, installed, 'all', 'nothing-like-this')).toEqual([])
  })
})

describe('plugin catalog reader: hostile text from an external plugin', () => {
  // ESC/CSI colour, an OSC 8 hyperlink and an OSC title, and the bidi embeddings, overrides and isolates (U+202A–202E, U+2066–2069),
  // written as \u escapes so no control character sits in this source.
  const ESC = '\u001b'
  const BIDI = ['‪', '‫', '‬', '‭', '‮', '⁦', '⁧', '⁨', '⁩']
  const hostile = `${ESC}[31mred${ESC}[0m ${ESC}]8;;https://evil.example${ESC}\\link${ESC}]8;;${ESC}\\ ${ESC}]0;title\u0007${BIDI.join('')}txt.exe`
  const dir = `${CACHE}/ext-hostile/1.0.0`
  const hostileFiles: Record<string, string> = {
    [`${ROOT}/.claude-plugin/marketplace.json`]: JSON.stringify({ plugins: [{ name: 'ext-hostile', source: { ...GIT, url: `https://github.com/o/r${ESC}[2J` } }] }),
    [`${dir}/.claude-plugin/plugin.json`]: JSON.stringify({ name: 'ext-hostile', version: `1.0.0${ESC}[2J${BIDI[4]}`, description: hostile }),
    [`${dir}/commands/go.md`]: `---\ndescription: ${hostile}\n---\n${hostile}\n`,
    [`${dir}/commands/${ESC}[2Jbad.md`]: 'x',
  }
  const hostileFs: ReaderFs = {
    read: async path => {
      if (!(path in hostileFiles)) throw new Error('ENOENT')

      return hostileFiles[path] as string
    },
    stat: async path => (path in hostileFiles ? { size: (hostileFiles[path] as string).length } : undefined),
    list: async path => {
      const below = Object.keys(hostileFiles).filter(file => file.startsWith(`${path}/`)).map(file => file.slice(path.length + 1))

      if (below.length === 0) throw new Error('ENOENT')

      return [...new Set(below.map(name => name.split('/')[0] as string))].map(name => ({ name, kind: below.some(file => file === name) ? 'file' : 'dir' }))
    },
  }
  const clean = (text: string) => {
    expect(text).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/)
    for (const mark of BIDI) expect(text.includes(mark), `U+${mark.charCodeAt(0).toString(16)}`).toBe(false)
    expect(text).not.toMatch(/\]8;;|\[31m|\[2J|\]0;/)
  }

  it('strips escape sequences and bidi controls from its description, version, source line and docs, and drops a hostile file name', async () => {
    const [plugin] = (await readCatalog(hostileFs, ROOT, new Map([['ext-hostile', dir]]))) as CatalogPlugin[]

    expect(plugin?.name).toBe('ext-hostile')
    for (const text of [plugin?.description ?? '', plugin?.version ?? '', plugin?.external ?? '']) clean(text)
    expect(plugin?.description).toBe('red link txt.exe')
    expect(plugin?.commands).toEqual(['go'])

    const doc = await readDoc(hostileFs, plugin as CatalogPlugin, 'command', 'go')

    clean(doc?.description ?? 'missing')
    for (const line of doc?.lines ?? []) clean(line)
  })
})
