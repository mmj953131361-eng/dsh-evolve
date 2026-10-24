/** Frozen input snapshots including uncommitted files; copies never follow symlinks. */
import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { atomicJson, readJson } from './persistence.js'
import type { Requirement, RequirementCheck } from './lifecycle-types.js'

export interface TaskSnapshot {
  schema: 1
  id: string
  scope: 'full-task' | 'local'
  files: Record<string, { digest: string; base64: string }>
  excluded: string[]
  createdAt: string
  digest: string
}
const OMIT = new Set(['.git', '.dsh-evolve', 'node_modules', '.venv', '__pycache__', 'lib', 'dist', '.next', '.ds_store'])
/** One policy shared by capture, restoration and every probe file operation.
 * Names are defense in depth, not a guarantee that arbitrary source files lack secrets.
 */
export function excludedTaskPath(path: string): boolean {
  const parts = path.toLowerCase().split('/')
  return parts.some(part => OMIT.has(part) || part.startsWith('.env')
    || ['.aws', '.ssh', '.azure', '.gcloud', '.gnupg', '.docker', '.kube', '.config', '.npmrc', '.yarnrc', '.yarnrc.yml', '.netrc', '_netrc', '.pypirc', '.git-credentials', '.boto', '.s3cfg'].includes(part)
    || /^(credentials(?:[._-].*)?|secrets?(?:[._-].*)?|id_(?:rsa|dsa|ecdsa|ed25519)(?:[._-].*)?)$/.test(part)
    || /\.(?:pem|key|p12|pfx|keystore)$/.test(part))
}
export const digest = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex')

/** Resolve a relative artifact path without allowing symlink traversal or credentials. */
export async function safeTaskPath(root: string, path: string): Promise<string> {
  if (!path || isAbsolute(path) || path.includes('\\') || path.split('/').some(p => p === '..' || p === '.' || !p || excludedTaskPath(p))) {
    throw new Error(`forbidden task path: ${path}`)
  }
  const base = await realpath(root)
  const target = resolve(base, path)
  if (!target.startsWith(base + sep)) throw new Error('path escapes task directory')
  let cursor = base
  for (const part of relative(base, target).split(sep)) {
    cursor = join(cursor, part)
    const info = await lstat(cursor).catch((e: NodeJS.ErrnoException) => { if (e.code !== 'ENOENT') throw e; return undefined })
    if (info?.isSymbolicLink()) throw new Error(`symlink not allowed: ${path}`)
  }
  return target
}

/** Capture before writes, or explicitly label a later snapshot local. Bounded and fail-closed. */
export async function captureTaskSnapshot(root: string, store: string, options: {
  scope: 'full-task' | 'local'; maxMs?: number; maxBytes?: number; signal?: AbortSignal
}): Promise<TaskSnapshot> {
  const deadline = Date.now() + (options.maxMs ?? 400)
  const maxBytes = options.maxBytes ?? 20_000_000
  const files: TaskSnapshot['files'] = {}
  const excluded: string[] = []
  const stamps = new Map<string, { size: number; mtimeMs: number; ctimeMs: number; ino: number }>()
  const directories = new Map<string, { mtimeMs: number; ctimeMs: number; ino: number }>()
  let bytes = 0
  const check = () => { options.signal?.throwIfAborted(); if (Date.now() > deadline) throw new Error('snapshot-time-budget'); if (bytes > maxBytes) throw new Error('snapshot-size-budget') }
  const walk = async (dir: string, prefix = ''): Promise<void> => {
    check()
    const directory = await lstat(dir)
    if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error('snapshot directory changed')
    directories.set(dir, { mtimeMs: directory.mtimeMs, ctimeMs: directory.ctimeMs, ino: directory.ino })
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      check()
      const path = prefix + entry.name
      if (excludedTaskPath(path)) { excluded.push(path); continue }
      if (entry.isSymbolicLink()) throw new Error(`snapshot contains symlink: ${path}`)
      if (entry.isDirectory()) { await walk(join(dir, entry.name), `${path}/`); continue }
      if (!entry.isFile()) throw new Error(`snapshot contains special file: ${path}`)
      const absolute = join(root, path)
      const info = await lstat(absolute)
      if (!info.isFile() || info.isSymbolicLink()) throw new Error(`snapshot entry changed: ${path}`)
      bytes += info.size; check()
      const data = await readFile(absolute); check()
      files[path] = { digest: digest(data), base64: data.toString('base64') }
      stamps.set(path, { size: info.size, mtimeMs: info.mtimeMs, ctimeMs: info.ctimeMs, ino: info.ino })
    }
  }
  await walk(root)
  for (const [path, before] of stamps) {
    check(); const after = await lstat(join(root, path))
    if (!after.isFile() || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || after.ino !== before.ino) throw new Error(`snapshot changed while reading: ${path}`)
  }
  for (const [path, before] of directories) {
    check(); const after = await lstat(path)
    if (!after.isDirectory() || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || after.ino !== before.ino) throw new Error(`snapshot directory changed while reading: ${path}`)
  }
  const id = randomUUID()
  const snapshot: TaskSnapshot = { schema: 1, id, scope: options.scope, files, excluded, createdAt: new Date().toISOString(), digest: digest(JSON.stringify(files)) }
  check(); await atomicJson(join(store, 'checkpoints', `${id}.json`), snapshot)
  return snapshot
}

/** Materialize exactly a saved starting point, never the current task output. */
export async function restoreTaskSnapshot(store: string, id: string, destination: string): Promise<TaskSnapshot> {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('invalid snapshot id')
  const snapshot = await readJson<TaskSnapshot>(join(store, 'checkpoints', `${id}.json`), () => { throw new Error('snapshot missing') })
  if (snapshot.schema !== 1 || digest(JSON.stringify(snapshot.files)) !== snapshot.digest) throw new Error('snapshot corrupt')
  await mkdir(destination, { recursive: true })
  for (const [path, value] of Object.entries(snapshot.files)) {
    const data = Buffer.from(value.base64, 'base64')
    if (digest(data) !== value.digest) throw new Error(`snapshot file corrupt: ${path}`)
    const target = await safeTaskPath(destination, path)
    await mkdir(dirname(target), { recursive: true }); await writeFile(target, data, { flag: 'wx', mode: 0o600 })
  }
  return snapshot
}

/** Run declared local checks; semantic requirements remain unknown until evidence is evaluated. */
export async function checkRequirements(root: string, requirements: readonly Requirement[]): Promise<RequirementCheck[]> {
  return Promise.all(requirements.map(async requirement => {
    if (!requirement.check) return { id: requirement.id, status: 'unknown' as const, evidence: 'semantic requirement; needs content evaluation' }
    try {
      const { path, kind, value } = requirement.check
      const file = await safeTaskPath(root, path)
      const info = await lstat(file)
      if (!info.isFile() || info.size > 5_000_000) throw new Error('not a bounded regular artifact')
      const data = await readFile(file, 'utf8')
      let pass = data.length > 0
      if (kind === 'json') JSON.parse(data)
      if (kind === 'contains') pass = typeof value === 'string' && value.length > 0 && data.includes(value)
      return { id: requirement.id, status: pass ? 'pass' as const : 'fail' as const, evidence: `${path} ${kind} sha256:${digest(data)}` }
    } catch (error) { return { id: requirement.id, status: 'fail' as const, evidence: String(error) } }
  }))
}
