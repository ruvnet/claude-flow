#!/usr/bin/env node
// ADR-477: the toast policy has ONE canonical source, plugins/ruflo-mods/hooks/toast/policy.ts. A plugin ships alone through the
// marketplace and cannot import a sibling, so each of the others carries a byte-identical copy at hooks/toast-policy.ts.
//   node scripts/sync-toast-policy.mjs           write the copies from the canonical file
//   node scripts/sync-toast-policy.mjs --check   exit 1 (naming the file) when a copy differs or is missing; writes nothing
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
export const CANONICAL = 'plugins/ruflo-mods/hooks/toast/policy.ts'
export const COPIES = ['plugins/ruflo-console/hooks/toast-policy.ts', 'plugins/ruflo-swarm/hooks/toast-policy.ts', 'plugins/ruflo-protector/hooks/toast-policy.ts']

const source = readFileSync(join(root, CANONICAL))
const read = path => {
  try {
    return readFileSync(join(root, path))
  } catch {
    return null
  }
}

if (process.argv.includes('--check')) {
  const bad = COPIES.filter(path => read(path)?.equals(source) !== true)

  if (bad.length > 0) {
    console.error(`toast policy copies differ from ${CANONICAL}: ${bad.join(', ')}\nrun: node scripts/sync-toast-policy.mjs`)
    process.exit(1)
  }
  console.log(`toast policy: ${COPIES.length} copies identical to ${CANONICAL}`)
} else {
  for (const path of COPIES) writeFileSync(join(root, path), source)
  console.log(`toast policy: wrote ${COPIES.length} copies from ${CANONICAL}`)
}
