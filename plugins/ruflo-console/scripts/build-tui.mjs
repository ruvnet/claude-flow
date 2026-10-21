#!/usr/bin/env node
// Bundles the standalone terminal console (ADR-489) into dist/tui.mjs: the plugin's own TypeScript, one file, no runtime
// dependencies. esbuild is a BUILD-time tool only (resolved from the repo's node_modules); nothing here ships as a dependency.
//   node plugins/ruflo-console/scripts/build-tui.mjs [--outfile <path>] [--check]
import { statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const flag = name => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined
const outfile = resolve(flag('--outfile') ?? join(root, 'dist', 'tui.mjs'))

// The repo's own esbuild (npm install at the root), or the one in RUFLO_ESBUILD_DIR (a directory with node_modules/esbuild: CI installs it alone, since a root install is heavy).
let esbuild
for (const base of [join(root, '..', '..', 'package.json'), ...(process.env.RUFLO_ESBUILD_DIR ? [join(process.env.RUFLO_ESBUILD_DIR, 'package.json')] : [])]) {
  try {
    esbuild = createRequire(base)('esbuild')
    break
  } catch {
    // try the next place
  }
}
if (esbuild === undefined) {
  console.error('build-tui: esbuild is not installed (run npm install at the repo root, or set RUFLO_ESBUILD_DIR to a directory that has node_modules/esbuild).')
  process.exit(1)
}

await esbuild.build({
  entryPoints: [join(root, 'tui', 'main.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  minify: true,
  legalComments: 'none',
  outfile,
  logLevel: 'warning',
})
console.log(`build-tui: ${outfile} (${Math.round(statSync(outfile).size / 1024)} KiB)`)
