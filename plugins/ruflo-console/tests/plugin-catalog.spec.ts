import { describe, expect, it } from 'vitest'

import { readCatalog, readDoc, visible, type CatalogPlugin } from '../hooks/data/plugin-catalog'
import type { ReaderFs } from '../hooks/data/files'

const ROOT = '/h/.claude/plugins/marketplaces/ruflo'
const files: Record<string, string> = {
  [`${ROOT}/.claude-plugin/marketplace.json`]: JSON.stringify({
    plugins: [
      { name: 'a-plugin', source: './plugins/a-plugin', description: 'Does A things' },
      { name: 'b-mod', source: './plugins/b-mod', description: 'A mod' },
      { name: 'evil', source: './../../etc', description: 'climbs out' },
      { name: 'bad name!', source: './plugins/x', description: 'not a word' },
    ],
  }),
  [`${ROOT}/plugins/a-plugin/.claude-plugin/plugin.json`]: '{"version":"1.2.3"}',
  [`${ROOT}/plugins/a-plugin/skills/alpha/SKILL.md`]: '---\nname: alpha\ndescription: "Alpha does a"\n---\nbody\n',
  [`${ROOT}/plugins/a-plugin/agents/helper.md`]: 'x',
  [`${ROOT}/plugins/a-plugin/commands/go.md`]: 'x',
  [`${ROOT}/plugins/a-plugin/.mcp.json`]: '{}',
  [`${ROOT}/plugins/b-mod/hooks/register.ts`]: 'x',
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
  it('lists each plugin with what it ships, skipping a climbing source and a non-word name', async () => {
    const plugins = (await readCatalog(fs, ROOT)) as CatalogPlugin[]

    expect(plugins.map(plugin => plugin.name)).toEqual(['a-plugin', 'b-mod'])
    expect(plugins[0]).toMatchObject({ version: '1.2.3', skills: ['alpha'], agents: ['helper'], commands: ['go'], hasMcp: true, isMod: false })
    expect(plugins[1]).toMatchObject({ isMod: true, skills: [] })
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
    expect(visible(plugins, installed, 'missing', '').map(plugin => plugin.name)).toEqual(['b-mod'])
    expect(visible(plugins, installed, 'mods', '').map(plugin => plugin.name)).toEqual(['b-mod'])
    expect(visible(plugins, installed, 'all', 'alpha').map(plugin => plugin.name)).toEqual(['a-plugin'])
    expect(visible(plugins, installed, 'skills', '').map(plugin => plugin.name)).toEqual(['a-plugin'])
    expect(visible(plugins, installed, 'all', 'nothing-like-this')).toEqual([])
  })
})
