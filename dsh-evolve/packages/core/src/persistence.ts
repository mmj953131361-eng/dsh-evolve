/** Atomic, cross-process transactions for local durable state. */
import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'

/** Write and fsync a replacement before making it visible. */
export async function atomicJson(file: string, value: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  const temp = `${file}.${randomUUID()}.tmp`
  const handle = await open(temp, 'wx', 0o600)
  try { await handle.writeFile(JSON.stringify(value, null, 2)); await handle.sync() }
  finally { await handle.close() }
  try { await rename(temp, file) } finally { await rm(temp, { force: true }) }
}

/** Read JSON, distinguishing a missing document from corruption/permissions. */
export async function readJson<T>(file: string, initial: () => T): Promise<T> {
  try { return JSON.parse(await readFile(file, 'utf8')) as T }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return initial()
    throw error
  }
}

/** Dead-process recovery; a live slow owner is never evicted by age. */
export async function withLock<T>(file: string, operation: () => Promise<T>): Promise<T> {
  await mkdir(dirname(file), { recursive: true })
  const lock = `${file}.lock`
  const deadline = Date.now() + 10000
  let handle: Awaited<ReturnType<typeof open>>
  for (;;) {
    try { handle = await open(lock, 'wx', 0o600); break }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const owner = await readFile(lock, 'utf8').catch(() => '')
      const pid = Number(owner)
      if (Number.isInteger(pid) && pid > 0) {
        try { process.kill(pid, 0) }
        catch (e) {
          if ((e as NodeJS.ErrnoException).code === 'ESRCH') {
            // Serialize reclamation; reread before unlinking a dead owner's lock.
            const reclaim = `${lock}.reclaim`
            const claim = await open(reclaim, 'wx').catch(() => undefined)
            if (claim) {
              try { if (await readFile(lock, 'utf8').catch(() => '') === owner) await rm(lock, { force: true }) }
              finally { await claim.close(); await rm(reclaim, { force: true }) }
            }
          }
        }
      }
      if (Date.now() >= deadline) throw new Error(`transaction lock unavailable: ${file}`)
      await new Promise(resolve => setTimeout(resolve, 10))
    }
  }
  try { await handle.writeFile(String(process.pid)); return await operation() }
  finally { await handle.close(); await rm(lock, { force: true }) }
}

/** Serialize read-modify-write and refuse unknown future schemas. */
export class JsonJournal<T extends { schema: number }> {
  constructor(readonly file: string, private readonly initial: () => T) {}
  async read(): Promise<T> {
    const state = await readJson(this.file, this.initial)
    if (state.schema !== this.initial().schema) throw new Error(`unsupported schema ${state.schema}: ${this.file}`)
    return state
  }
  async update<R>(operation: (state: T) => R | Promise<R>): Promise<R> {
    return withLock(this.file, async () => {
      const state = await this.read()
      const result = await operation(state)
      await atomicJson(this.file, state)
      return result
    })
  }
}
