/**
 * Library: task-type-indexed lessons adopted from earlier tasks (PRD §9.3).
 *
 * Entries are plain JSON files under `<dir>/entries/<id>.json`, with an
 * `<dir>/index.json` mapping task type to entry ids. Every write is atomic and
 * serialized per library with a cross-process lock file.
 */
import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { asLibraryEntryId, type LibraryEntryId, type RevisionId } from './ids.js'
import type { EvidenceRef } from './types.js'
import { CURRENT_SCHEMA, readMigratedJson } from './migrate.js'

/** One learned lesson, mirroring harness2's `<experience>`. */
export interface LibraryEntry {
  readonly id: LibraryEntryId
  readonly taskType: string
  readonly cue: string
  readonly lesson: string
  readonly evidence: readonly EvidenceRef[]
  /** Legacy display field, never a validation score. */
  readonly confidence: number
  readonly state?: 'hypothesis' | 'revoked'
  readonly adoptedRevision?: RevisionId
  readonly uses: number
  readonly rollbacks: number
  readonly lastUsedAt: string
}

/** Caller-supplied fields when recording a lesson. */
export interface LibraryEntryDraft {
  readonly taskType: string
  readonly cue: string
  readonly lesson: string
  readonly evidence?: readonly EvidenceRef[]
  readonly confidence?: number
  readonly adoptedRevision?: RevisionId
}

/** Construction options for {@link FileLibraryStore}. */
export interface LibraryOptions {
  readonly dir: string
  readonly maxEntriesPerType?: number
  /** Deterministic id source for tests. */
  readonly idFactory?: () => string
  /** Deterministic clock for tests. */
  readonly now?: () => string
}

const CONFIDENCE_MIN = 0
const CONFIDENCE_MAX = 1

interface LibraryIndex {
  readonly schema: number
  readonly byTaskType: Record<string, string[]>
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0.5
  return Math.min(CONFIDENCE_MAX, Math.max(CONFIDENCE_MIN, Number(value.toFixed(4))))
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

function sameEvidence(left: EvidenceRef, right: EvidenceRef): boolean {
  if (left.kind === 'experiment' || left.kind === 'experience' || right.kind === 'experiment' || right.kind === 'experience') return JSON.stringify(left) === JSON.stringify(right)
  return left.sessionId === right.sessionId
    && left.fromSeq === right.fromSeq
    && left.toSeq === right.toSeq
    && left.signal === right.signal
}

async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temp = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
  await writeFile(temp, content, 'utf8')
  await rename(temp, path)
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => { setTimeout(resolve, ms) })
}

async function withFileLock<T>(dir: string, task: () => Promise<T>): Promise<T> {
  await mkdir(dir, { recursive: true })
  const lockPath = join(dir, '.lock')
  const deadline = Date.now() + 5000
  let handle: Awaited<ReturnType<typeof open>> | undefined
  while (handle === undefined) {
    try {
      handle = await open(lockPath, 'wx')
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      if (Date.now() > deadline) {
        const info = await stat(lockPath).catch(() => undefined)
        if (info !== undefined && Date.now() - info.mtimeMs > 60000) {
          await rm(lockPath, { force: true })
          continue
        }
        throw new Error(`library lock timeout: ${lockPath}`)
      }
      await sleep(50)
    }
  }
  try {
    return await task()
  } finally {
    await handle.close()
    await rm(lockPath, { force: true })
  }
}

/** File-backed library with in-memory caching. */
export class FileLibraryStore {
  private readonly dir: string
  private readonly maxEntriesPerType: number
  private readonly idFactory: () => string
  private readonly now: () => string
  private index: LibraryIndex | undefined
  private entries: Map<string, LibraryEntry> | undefined

  constructor(options: LibraryOptions) {
    this.dir = options.dir
    this.maxEntriesPerType = options.maxEntriesPerType ?? 50
    this.idFactory = options.idFactory ?? (() => randomUUID())
    this.now = options.now ?? (() => new Date().toISOString())
  }

  private get indexPath(): string { return join(this.dir, 'index.json') }

  private entryPath(id: string): string { return join(this.dir, 'entries', `${id}.json`) }

  private async ensureLoaded(): Promise<{ index: LibraryIndex; entries: Map<string, LibraryEntry> }> {
    if (this.index !== undefined && this.entries !== undefined) {
      return { index: this.index, entries: this.entries }
    }
    const raw = await readFile(this.indexPath, 'utf8').catch(() => undefined)
    if (raw === undefined) {
      this.index = { schema: CURRENT_SCHEMA, byTaskType: {} }
      this.entries = new Map()
      return { index: this.index, entries: this.entries }
    }
    const { value } = await readMigratedJson(this.indexPath, 'library-index')
    const parsed = value as unknown as LibraryIndex
    const entries = new Map<string, LibraryEntry>()
    for (const ids of Object.values(parsed.byTaskType)) {
      for (const id of ids) {
        const file = await readFile(this.entryPath(id), 'utf8').catch(() => undefined)
        if (file === undefined) continue
        const { value: entryValue } = await readMigratedJson(this.entryPath(id), 'library-entry')
        const stored = entryValue as unknown as LibraryEntry & { schema?: number }
        entries.set(id, {
          id: asLibraryEntryId(stored.id),
          taskType: stored.taskType,
          cue: stored.cue,
          lesson: stored.lesson,
          evidence: stored.evidence ?? [],
          confidence: 0,
          state: stored.state === 'revoked' ? 'revoked' : 'hypothesis',
          ...stored.adoptedRevision === undefined ? {} : { adoptedRevision: stored.adoptedRevision },
          uses: stored.uses ?? 0,
          rollbacks: stored.rollbacks ?? 0,
          lastUsedAt: stored.lastUsedAt,
        })
      }
    }
    this.index = { schema: CURRENT_SCHEMA, byTaskType: { ...parsed.byTaskType } }
    this.entries = entries
    return { index: this.index, entries: this.entries }
  }

  private async persistEntry(entry: LibraryEntry): Promise<void> {
    await atomicWrite(this.entryPath(entry.id), JSON.stringify({ schema: CURRENT_SCHEMA, ...entry }, null, 2))
  }

  private async persistIndex(index: LibraryIndex): Promise<void> {
    await atomicWrite(this.indexPath, JSON.stringify(index, null, 2))
  }

  /** All entries for one task type, best first. */
  async lookup(taskType: string): Promise<LibraryEntry[]> {
    const { index, entries } = await this.ensureLoaded()
    const ids = index.byTaskType[taskType] ?? []
    return ids
      .map(id => entries.get(id))
      .filter((entry): entry is LibraryEntry => entry !== undefined)
      .sort((left, right) => right.confidence - left.confidence
        || right.uses - left.uses
        || right.lastUsedAt.localeCompare(left.lastUsedAt))
  }

  /** Every entry, for UI listing. */
  async all(): Promise<LibraryEntry[]> {
    const { entries } = await this.ensureLoaded()
    return [...entries.values()].sort((left, right) => right.lastUsedAt.localeCompare(left.lastUsedAt))
  }

  /**
   * Record or merge a lesson. Identical task type + cue + lesson merges into
   * the existing entry (evidence union and use count, never an efficacy bump).
   * @returns the stored entry.
   */
  async record(draft: LibraryEntryDraft): Promise<LibraryEntry> {
    if (draft.taskType.trim() === '') throw new TypeError('library entry taskType must not be empty')
    return await withFileLock(this.dir, async () => {
      this.index = undefined; this.entries = undefined
      const { index, entries } = await this.ensureLoaded()
      const taskType = draft.taskType.trim()
      const cue = normalizeText(draft.cue)
      const lesson = normalizeText(draft.lesson)
      const existing = (index.byTaskType[taskType] ?? [])
        .map(id => entries.get(id))
        .find(entry => entry !== undefined
          && normalizeText(entry.cue) === cue
          && normalizeText(entry.lesson) === lesson)
      const now = this.now()

      let entry: LibraryEntry
      if (existing !== undefined) {
        const evidence = [...existing.evidence]
        for (const ref of draft.evidence ?? []) {
          if (!evidence.some(other => sameEvidence(other, ref))) evidence.push(ref)
        }
        entry = {
          ...existing,
          cue: draft.cue.trim(),
          lesson: draft.lesson.trim(),
          evidence,
          confidence: 0,
          state: existing.state ?? 'hypothesis',
          ...draft.adoptedRevision === undefined ? {} : { adoptedRevision: draft.adoptedRevision },
          uses: existing.uses + 1,
          lastUsedAt: now,
        }
      } else {
        entry = {
          id: asLibraryEntryId(this.idFactory()),
          taskType,
          cue: draft.cue.trim(),
          lesson: draft.lesson.trim(),
          evidence: [...(draft.evidence ?? [])],
          confidence: 0,
          state: 'hypothesis',
          ...draft.adoptedRevision === undefined ? {} : { adoptedRevision: draft.adoptedRevision },
          uses: 1,
          rollbacks: 0,
          lastUsedAt: now,
        }
        const ids = index.byTaskType[taskType] ?? []
        index.byTaskType[taskType] = [...ids, entry.id]
      }

      entries.set(entry.id, entry)
      await this.persistEntry(entry)
      await this.pruneLocked(taskType, index, entries)
      await this.persistIndex(index)
      return entry
    })
  }

  /** Apply task feedback: success raises confidence, a rollback lowers it. */
  async feedback(id: LibraryEntryId, outcome: 'success' | 'rollback'): Promise<LibraryEntry | undefined> {
    return await withFileLock(this.dir, async () => {
      const { entries } = await this.ensureLoaded()
      const entry = entries.get(id)
      if (entry === undefined) return undefined
      const updated: LibraryEntry = {
        ...entry,
        confidence: 0,
        state: outcome === 'rollback' ? 'revoked' : entry.state ?? 'hypothesis',
        uses: entry.uses + (outcome === 'success' ? 1 : 0),
        rollbacks: entry.rollbacks + (outcome === 'rollback' ? 1 : 0),
        lastUsedAt: this.now(),
      }
      entries.set(id, updated)
      await this.persistEntry(updated)
      return updated
    })
  }

  private async pruneLocked(
    taskType: string,
    index: LibraryIndex,
    entries: Map<string, LibraryEntry>,
  ): Promise<void> {
    const ids = index.byTaskType[taskType] ?? []
    if (ids.length <= this.maxEntriesPerType) return
    const ranked = ids
      .map(id => entries.get(id))
      .filter((entry): entry is LibraryEntry => entry !== undefined)
      .sort((left, right) => right.confidence - left.confidence
        || right.uses - left.uses
        || right.lastUsedAt.localeCompare(left.lastUsedAt))
    const kept = ranked.slice(0, this.maxEntriesPerType)
    const dropped = ranked.slice(this.maxEntriesPerType)
    for (const entry of dropped) {
      entries.delete(entry.id)
      // Keep archived evidence on disk; only remove it from the retrieval index.
    }
    index.byTaskType[taskType] = kept.map(entry => entry.id)
  }
}
