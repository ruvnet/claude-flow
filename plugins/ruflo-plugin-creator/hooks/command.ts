import type { Stats } from './status'

/** `/creator-mod` is answered locally, read-only and takes no model turn. */
export type CommandDeps = {
  readonly stats: Stats
  readonly read: (path: string) => Promise<string>
  readonly list: (path: string) => Promise<readonly { readonly name: string; readonly kind: string }[]>
}

const HELP = ['/creator-mod status', '/creator-mod reserved <plugin-dir>', '/creator-mod check <plugin-dir>'].join('\n')

/** A plugin directory the user typed: relative or absolute, never a parent traversal. */
export const safeDir = (arg: string): string | undefined => {
  const dir = arg.trim().replace(/\/+$/, '')
  return dir === '' || dir.includes('\0') || dir.split('/').includes('..') ? undefined : dir
}

/** Names the plugin's markdown commands and skill directories already hold: a mod command may not reuse one. */
async function reservedIn(dir: string, deps: CommandDeps): Promise<string[]> {
  const names: string[] = []
  for (const [sub, want] of [['commands', 'file'], ['skills', 'dir']] as const) {
    try {
      for (const e of await deps.list(`${dir}/${sub}`)) {
        if (e.kind === want || e.kind === 'directory') names.push(e.name.replace(/\.md$/, ''))
      }
    } catch {
      /* no such folder */
    }
  }
  return [...new Set(names)].sort()
}

const readJson = async (deps: CommandDeps, path: string): Promise<Record<string, unknown> | undefined> => {
  try {
    const v: unknown = JSON.parse(await deps.read(path))
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

export async function answer(args: string, deps: CommandDeps): Promise<string> {
  const [verb = '', ...rest] = args.trim().split(/\s+/)
  const { stats } = deps

  if (verb === '' || verb === 'help') return HELP
  if (verb === 'status') return `checks run ${stats.checked} · reserved lookups ${stats.reserved}${stats.lastTarget ? ` · last ${stats.lastTarget}` : ''}`

  if (verb !== 'reserved' && verb !== 'check') return `Unknown: ${verb}\n${HELP}`
  const dir = safeDir(rest.join(' '))
  if (dir === undefined) return `usage: /creator-mod ${verb} <plugin-dir>  (no .. segments)`
  stats.lastTarget = dir

  if (verb === 'reserved') {
    stats.reserved++
    const names = await reservedIn(dir, deps)
    return names.length ? `Names ${dir} already uses (a mod command must differ): ${names.join(', ')}` : `No commands or skills found under ${dir}.`
  }

  stats.checked++
  const manifest = await readJson(deps, `${dir}/.claude-plugin/plugin.json`)
  if (!manifest) return `${dir}: no readable .claude-plugin/plugin.json.`
  const hooks = await readJson(deps, `${dir}/hooks/hooks.json`)
  const modules = Array.isArray(hooks?.modules) ? (hooks.modules as unknown[]).length : 0
  const config = typeof manifest.userConfig === 'object' && manifest.userConfig !== null ? Object.keys(manifest.userConfig).length : 0
  const name = typeof manifest.name === 'string' ? manifest.name : '?'
  return [
    `${name} ${typeof manifest.version === 'string' ? manifest.version : '(no version)'}`,
    `hooks.json ${hooks ? 'present' : 'absent'} · mod modules ${modules} · userConfig options ${config}`,
    `reserved names: ${(await reservedIn(dir, deps)).join(', ') || 'none'}`,
  ].join('\n')
}
