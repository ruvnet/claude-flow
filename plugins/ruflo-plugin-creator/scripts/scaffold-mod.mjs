#!/usr/bin/env node
// Scaffold a Claude Code mod from templates/mod into <dest> (must not exist or be empty).
// Usage: node scaffold-mod.mjs <name> <dest>
// The template keeps its manifest as plugin.json.tmpl: a real .claude-plugin/plugin.json under
// templates/ is mistaken for a second plugin by the claude.ai upload validator.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function scaffoldMod(name, dest) {
  if (!/^[a-z][a-z0-9-]{0,40}$/.test(name)) throw new Error(`name must be kebab-case, at most 41 characters: ${name}`)
  const out = resolve(dest)
  if (existsSync(out) && readdirSync(out).length > 0) throw new Error(`${out} is not empty`)
  const template = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'mod')
  mkdirSync(out, { recursive: true })
  cpSync(template, out, { recursive: true })
  mkdirSync(join(out, '.claude-plugin'), { recursive: true })
  renameSync(join(out, 'plugin.json.tmpl'), join(out, '.claude-plugin', 'plugin.json'))
  const statusDir = name.endsWith('-mod') ? name : `${name}-mod`
  const upper = name.toUpperCase().replace(/-/g, '_')
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry)
      if (statSync(p).isDirectory()) { walk(p); continue }
      const before = readFileSync(p, 'utf8')
      const after = before
        .replaceAll('.claude-flow/my-mod/', `.claude-flow/${statusDir}/`)
        .replaceAll('MY_MOD', upper)
        .replaceAll('my-mod', name)
      if (after !== before) writeFileSync(p, after)
    }
  }
  walk(out)
  return out
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const [name, dest] = process.argv.slice(2)
  if (!name || !dest) { console.error('usage: scaffold-mod.mjs <name> <dest>'); process.exit(2) }
  console.log(scaffoldMod(name, dest))
}
