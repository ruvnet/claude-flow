#!/usr/bin/env node
// One source for the mod secret screen (ADR-445) and the `flag` option parser. plugins/ruflo-agentdb/hooks/{screen,options}.ts are the origins; every other
// plugins/*/hooks copy carries the region between its BEGIN and END markers. Anything outside the markers (extra patterns, helpers) stays per plugin.
//   node scripts/sync-mod-screen.mjs           rewrite the shared region of every copy
//   node scripts/sync-mod-screen.mjs --check   exit 1 when a copy drifted, lacks the markers, or when no copies are found
//   --root <dir>                               use <dir>/plugins instead of this repo (tests)
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const argRoot = process.argv.indexOf('--root')
const ROOT = argRoot > 0 ? process.argv[argRoot + 1] : join(dirname(fileURLToPath(import.meta.url)), '..')
const PLUGINS = join(ROOT, 'plugins')
const ORIGIN = 'ruflo-agentdb'
// Each kit is one file name plus its marker pair; the screen (ADR-445) and the `flag` option parser are vendored the same way.
const KITS = [
  { file: 'screen.ts', begin: '// BEGIN SHARED SCREEN', end: '// END SHARED SCREEN' },
  // ruflo-mods parses a richer option set of its own and has no flag helper to share.
  { file: 'options.ts', begin: '// BEGIN SHARED FLAG', end: '// END SHARED FLAG', skip: ['ruflo-mods'] },
]
// Raw zero-width, bidi and line-separator characters must never sit in a regex literal (they are built from escapes).
const RAW_INVISIBLE = new RegExp('[\\u00ad\\u034f\\u061c\\u180b-\\u180e\\u2028\\u2029\\u200b-\\u200f\\u202a-\\u202e\\u2060-\\u206f\\ufe00-\\ufe0f\\ufeff]')

/** Split into the text before the begin line, the region (begin line to end line inclusive), and the text after. */
export function split(src, begin = KITS[0].begin, end = KITS[0].end) {
  const lines = src.split('\n')
  const b = lines.findIndex(l => l.startsWith(begin))
  const e = lines.findIndex((l, i) => i > b && l.trim() === end)
  if (b < 0 || e < 0 || lines.slice(b + 1).some(l => l.startsWith(begin))) return undefined
  return { head: lines.slice(0, b).join('\n'), region: lines.slice(b, e + 1).join('\n'), tail: lines.slice(e + 1).join('\n') }
}

const mode = process.argv.includes('--check') ? 'check' : 'write'
const fail = msg => {
  console.error(`sync-mod-screen: ${msg}`)
  process.exit(1)
}

for (const kit of KITS) {
  const originPath = join(PLUGINS, ORIGIN, 'hooks', kit.file)
  const origin = existsSync(originPath) ? split(readFileSync(originPath, 'utf8'), kit.begin, kit.end) : undefined
  if (!origin) fail(`${originPath} is missing or has no single ${kit.begin} ... ${kit.end} region`)
  if (RAW_INVISIBLE.test(origin.region)) fail('the shared region holds a raw zero-width, bidi or line-separator character; build it from escapes')

  const copies = readdirSync(PLUGINS)
    .map(name => ({ name, path: join(PLUGINS, name, 'hooks', kit.file) }))
    .filter(c => c.name !== ORIGIN && !kit.skip?.includes(c.name) && existsSync(c.path))
  if (copies.length === 0) fail(`found 0 copies of hooks/${kit.file} besides the origin; the glob is wrong or the tree moved, so a clean result would mean nothing`)

  const bad = []
  let changed = 0
  for (const c of copies) {
    const src = readFileSync(c.path, 'utf8')
    const parts = split(src, kit.begin, kit.end)
    if (!parts) {
      bad.push(`${c.name}: no single ${kit.begin} ... ${kit.end} region`)
      continue
    }
    if (parts.region === origin.region) continue
    if (mode === 'check') {
      bad.push(`${c.name}: shared region of ${kit.file} drifted from ${ORIGIN} (run node scripts/sync-mod-screen.mjs)`)
      continue
    }
    writeFileSync(c.path, [parts.head, origin.region, parts.tail].join('\n'))
    changed++
  }
  if (bad.length) fail(`${kit.file}: ${bad.length} of ${copies.length} copies\n  ${bad.join('\n  ')}`)
  console.log(mode === 'check' ? `sync-mod-screen: ${kit.file}: ${copies.length} copies match ${ORIGIN}` : `sync-mod-screen: ${kit.file}: ${copies.length} copies checked, ${changed} rewritten`)
}
