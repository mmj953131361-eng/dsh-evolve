/** Build the browser half: inject the owning package id into the loader handoff. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const id = process.env.EVOLVE_UI_ID ?? '@dsh-evolve/ui'
const source = await readFile(fileURLToPath(new URL('./src/client/index.js', import.meta.url)), 'utf8')
await mkdir(fileURLToPath(new URL('./lib/', import.meta.url)), { recursive: true })
await writeFile(
  fileURLToPath(new URL('./lib/client.js', import.meta.url)),
  source.replaceAll('__PLUGIN_ID__', id),
  'utf8',
)
console.log(`[dsh-evolve/ui] client bundle: ${id}`)
