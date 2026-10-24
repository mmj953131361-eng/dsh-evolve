import { randomUUID } from 'node:crypto'
import { atomicJson, withLock } from './persistence.js'
/**
 * Immutable file storage for revisions (PRD §9.1).
 *
 * Layout:
 *   <root>/state.json
 *   <root>/revisions/<id>/meta.json
 *   <root>/revisions/<id>/tree/<path...>
 *
 * A revision directory is content-addressed and never rewritten: saving an
 * existing id verifies its fingerprint and returns. `state.json` holds only the
 * current pointer and carries a schema version; an unknown newer schema fails
 * loudly instead of silently degrading.
 */
import { mkdir, readFile, readdir, rename, stat, writeFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { asRevisionId, type RevisionId } from './ids.js'
import type { Revision } from './revision.js'
import { contentHash, fingerprint, normalizeTreePath, type HarnessTree } from './tree.js'
import type { CacheImpact, EvidenceRef, Level, RevisionOrigin, ValidationReport } from './types.js'
import { CURRENT_SCHEMA, readMigratedJson } from './migrate.js'

/** Revision without its tree, used for listings. */
export type RevisionSummary = Omit<Revision, 'tree'>

interface StoredMeta extends RevisionSummary {
  readonly schema: number
  readonly paths: readonly string[]
}

interface StoreState {
  readonly schema: number
  readonly current: string | null
}

/** Raised when on-disk content no longer matches its content address. */
export class RevisionCorruptionError extends Error {
  constructor(readonly id: string, detail: string) {
    super(`revision ${id} is corrupt: ${detail}`)
    this.name = 'RevisionCorruptionError'
  }
}

async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temp = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
  await writeFile(temp, content, 'utf8')
  await rename(temp, path)
}

async function exists(path: string): Promise<boolean> {
  return await stat(path).then(() => true, () => false)
}

/** File-backed immutable revision store. */
export class FileRevisionStore {
  constructor(private readonly root: string, private readonly sessionKey?: string) {
    if (sessionKey && !/^[a-zA-Z0-9_-]+$/.test(sessionKey)) throw new Error('invalid session pointer key')
  }

  private get statePath(): string { return this.sessionKey ? join(this.root, 'sessions', `${this.sessionKey}.json`) : join(this.root, 'state.json') }

  private revisionDir(id: string): string { return join(this.root, 'revisions', id) }

  private metaPath(id: string): string { return join(this.revisionDir(id), 'meta.json') }

  /** Persist a revision. Idempotent for an already-stored id. */
  async save(revision: Revision): Promise<void> {
    await withLock(join(this.root, 'revisions-save'), async () => {
      const dir = this.revisionDir(revision.id)
      if (await exists(dir)) {
        const stored = await this.load(revision.id)
        if (stored.contentHash !== revision.contentHash || stored.parent !== revision.parent
          || JSON.stringify(stored.origin) !== JSON.stringify(revision.origin)) throw new RevisionCorruptionError(revision.id, 'event identity reused with different provenance')
        return
      }
      const staging = `${dir}.stage-${randomUUID()}`
      try {
        await mkdir(staging, { recursive: true })
        for (const [path, text] of Object.entries(revision.tree)) {
          const safe = normalizeTreePath(path)
          await atomicWrite(join(staging, 'tree', ...safe.split('/')), text)
        }
        const { tree: _tree, ...metadata } = revision
        await atomicJson(join(staging, 'meta.json'), { schema: CURRENT_SCHEMA, ...metadata, paths: Object.keys(revision.tree).sort() })
        await rename(staging, dir)
      } finally { await rm(staging, { recursive: true, force: true }) }
    })
  }

  /** Read and verify one revision. */
  async load(id: RevisionId): Promise<Revision> {
    const meta = await this.readMeta(id)
    const tree: Record<string, string> = {}
    for (const path of meta.paths) {
      const safe = normalizeTreePath(path)
      const text = await readFile(join(this.revisionDir(id), 'tree', ...safe.split('/')), 'utf8')
        .catch(() => undefined)
      if (text === undefined) throw new RevisionCorruptionError(id, `missing tree file ${safe}`)
      tree[safe] = text
    }
    const actual = fingerprint(tree)
    if ((meta.contentHash ? contentHash(tree) !== meta.contentHash : actual !== id)) {
      throw new RevisionCorruptionError(id, `content fingerprint is ${actual}`)
    }
    return Object.freeze({
      id,
      contentHash: contentHash(tree),      parent: meta.parent,
      tree: Object.freeze(tree),
      origin: meta.origin,
      evidence: meta.evidence,
      validation: meta.validation,
      createdAt: meta.createdAt,
      level: meta.level,
      cacheImpact: meta.cacheImpact,
    })
  }

  /** List revisions with metadata only, oldest first. */
  async list(): Promise<RevisionSummary[]> {
    const base = join(this.root, 'revisions')
    const names = await readdir(base).catch(() => [] as string[])
    const summaries: RevisionSummary[] = []
    for (const name of names) {
      if (!/^(?:[0-9a-f]{16}|[0-9a-f]{32})$/.test(name)) continue
      const meta = await this.readMeta(asRevisionId(name))
      summaries.push({
        id: meta.id,
        contentHash: meta.contentHash ?? '',
        parent: meta.parent,
        origin: meta.origin,
        evidence: meta.evidence,
        validation: meta.validation,
        createdAt: meta.createdAt,
        level: meta.level,
        cacheImpact: meta.cacheImpact,
      })
    }
    return summaries.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
  }

  /** The current revision pointer, or null when none is set. */
  async currentId(): Promise<RevisionId | null> {
    const state = await this.readState()
    if (state.current === null) return null
    return asRevisionId(state.current)
  }

  /** Load the current revision, if any. */
  async current(): Promise<Revision | null> {
    const id = await this.currentId()
    return id === null ? null : await this.load(id)
  }

  /** Point the store at a stored revision. */
  async setCurrent(id: RevisionId | null): Promise<void> {
    if (id !== null) await this.readMeta(id)
    const state: StoreState = { schema: CURRENT_SCHEMA, current: id }
    await atomicWrite(this.statePath, JSON.stringify(state, null, 2))
  }

  private async readState(): Promise<StoreState> {
    const exists = await readFile(this.statePath, 'utf8').then(() => true, () => false)
    if (!exists) return { schema: CURRENT_SCHEMA, current: null }
    const { value } = await readMigratedJson(this.statePath, 'state')
    return {
      schema: typeof value.schema === 'number' ? value.schema : CURRENT_SCHEMA,
      current: typeof value.current === 'string' ? value.current : null,
    }
  }

  private async readMeta(id: RevisionId): Promise<StoredMeta> {
    const raw = await readFile(this.metaPath(id), 'utf8').catch(() => undefined)
    if (raw === undefined) throw new RevisionCorruptionError(id, 'meta.json is missing')
    const { value } = await readMigratedJson(this.metaPath(id), 'revision-meta')
    const meta = value as unknown as StoredMeta
    if (meta.id !== id) throw new RevisionCorruptionError(id, `meta.json names ${String(meta.id)}`)
    const paths = Array.isArray(meta.paths) && meta.paths.length > 0
      ? meta.paths.filter((path): path is string => typeof path === 'string')
      : await this.treePaths(id)
    return {
      contentHash: meta.contentHash ?? '',
      schema: typeof meta.schema === 'number' ? meta.schema : CURRENT_SCHEMA,
      id,
      parent: meta.parent,
      origin: meta.origin as RevisionOrigin,
      evidence: meta.evidence as EvidenceRef[],
      validation: meta.validation as ValidationReport,
      createdAt: meta.createdAt,
      level: meta.level as Level,
      cacheImpact: meta.cacheImpact as CacheImpact,
      paths,
    }
  }

  /** Legacy metadata has no `paths`; recover them from the tree directory. */
  private async treePaths(id: RevisionId): Promise<string[]> {
    const root = join(this.revisionDir(id), 'tree')
    const paths: string[] = []
    const walk = async (dir: string, prefix: string): Promise<void> => {
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
      for (const entry of entries) {
        const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`
        if (entry.isDirectory()) await walk(join(dir, entry.name), path)
        else paths.push(path)
      }
    }
    await walk(root, '')
    return paths.sort()
  }
}

/** Rebuild a tree object from a stored revision's file list (test helper). */
export function treeFromFiles(files: Readonly<Record<string, string>>): HarnessTree {
  return Object.freeze({ ...files })
}
