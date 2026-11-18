/**
 * Build the two plugin artifacts:
 * - lib/index.js   Host half (ESM, Node)
 * - lib/client.js  browser half wrapped in the DSH `__ModuleLoader__.load`
 *                  factory protocol
 * - lib/popup.ps1  notification card sidecar
 */

import { copyFileSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const PACKAGE = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const OUT = join(ROOT, 'lib')

mkdirSync(OUT, { recursive: true })

await build({
  entryPoints: [join(ROOT, 'src', 'index.ts')],
  outfile: join(OUT, 'index.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  sourcemap: true,
  logLevel: 'warning',
})

await build({
  entryPoints: [join(ROOT, 'src', 'client', 'index.ts')],
  outfile: join(OUT, 'client.js'),
  bundle: true,
  platform: 'browser',
  format: 'cjs',
  target: 'es2022',
  sourcemap: true,
  banner: {
    js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PACKAGE.name)}, factory: (require) => {\nvar module = { exports: {} };\nvar exports = module.exports;`,
  },
  footer: {
    js: 'return module.exports;\n} });',
  },
  logLevel: 'warning',
})

copyFileSync(join(ROOT, 'src', 'popup.ps1'), join(OUT, 'popup.ps1'))

const client = readFileSync(join(OUT, 'client.js'), 'utf8')
if (!client.includes('__ModuleLoader__.load')) throw new Error('client bundle is missing the module loader wrapper')
if (!client.includes(PACKAGE.name)) throw new Error('client bundle is missing its package id')
const host = readFileSync(join(OUT, 'index.js'), 'utf8')
if (!host.includes('popup.ps1')) throw new Error('host bundle is missing the popup sidecar path')

console.log(`built ${PACKAGE.name}@${PACKAGE.version}: lib/index.js, lib/client.js, lib/popup.ps1`)
