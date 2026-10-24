/**
 * Build the single installable bundle: inline every @dsh-evolve package into
 * `lib/<name>.js`, keeping host packages external. This is what makes the
 * published bundle a one-package install with no sibling @dsh-evolve deps.
 */
import { build } from 'esbuild'

const entries = {
  core: '../core/lib/index.js',
  'scoped-harness': '../core/lib/scoped-harness.js',
  observer: '../observer/lib/index.js',
  sandbox: '../sandbox/lib/index.js',
  probe: '../probe/lib/index.js',
  agent: '../agent/lib/index.js',
  worker: '../agent/lib/worker.js',
  tools: '../tools/lib/index.js',
  commands: '../commands/lib/index.js',
  ui: '../ui/lib/index.js',
  loop: '../loop/lib/index.js',
}

const external = [
  '@deepseek-ai/*',
  'yaml',
  'zod',
]

await Promise.all(Object.entries(entries).map(async ([name, entry]) => {
  await build({
    entryPoints: [entry],
    outfile: `lib/${name}.js`,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    external,
    sourcemap: false,
    legalComments: 'inline',
    logLevel: 'info',
  })
}))

import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const clientSource = await readFile(
  fileURLToPath(new URL('../ui/src/client/index.js', import.meta.url)),
  'utf8',
)
await writeFile(
  fileURLToPath(new URL('./lib/client.js', import.meta.url)),
  clientSource.replaceAll('__PLUGIN_ID__', '@dsh-evolve/bundle'),
  'utf8',
)

// Every installable tarball must retain the licenses of its inlined sources.
import { mkdir, copyFile } from 'node:fs/promises'
await mkdir(new URL('./LICENSES/', import.meta.url), { recursive: true })
for (const [source, target] of [
  ['../../../LICENSE', './LICENSE'],
  ['../../../NOTICE', './NOTICE'],
  ['../../../THIRD_PARTY_NOTICES.md', './THIRD_PARTY_NOTICES.md'],
  ['../../../licenses/Apache-2.0.txt', './LICENSES/Apache-2.0.txt'],
  ['../../../licenses/MIT-DeepSeek.txt', './LICENSES/MIT-DeepSeek.txt'],
]) {
  await copyFile(new URL(source, import.meta.url), new URL(target, import.meta.url))
}
