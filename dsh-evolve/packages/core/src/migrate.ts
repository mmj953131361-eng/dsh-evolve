/**
 * Schema migration chain for workspace documents (PRD §9.5).
 *
 * Every document carries `schema`. Older documents are upgraded through an
 * ordered, pure `vN -> vN+1` chain, backed up as `<file>.bak.vN` before the
 * migrated value is written. A document newer than this bundle supports is
 * refused instead of silently rewritten.
 */
import { constants } from 'node:fs'
import { copyFile, readFile, rename, writeFile } from 'node:fs/promises'

/** Schema version written by this bundle. */
export const CURRENT_SCHEMA = 2

/** Document families with their own migration chains. */
export type DocumentKind = 'state' | 'revision-meta' | 'library-index' | 'library-entry'

/** One pure upgrade step. */
export interface Migration {
  readonly from: number
  readonly to: number
  readonly migrate: (value: Record<string, unknown>) => Record<string, unknown>
}

/** Raised when a document was written by a newer bundle. */
export class SchemaTooNewError extends Error {
  constructor(readonly file: string, readonly schema: number) {
    super(
      `${file}: schema v${String(schema)} is newer than the supported v${String(CURRENT_SCHEMA)}; `
      + 'update dsh-evolve instead of rewriting the workspace',
    )
    this.name = 'SchemaTooNewError'
  }
}

const number = (value: unknown, fallback: number): number => (
  typeof value === 'number' && Number.isFinite(value) ? value : fallback
)

const STATE_V0: Migration = {
  from: 0,
  to: 1,
  migrate: value => ({
    schema: 1,
    current: typeof value.current === 'string' ? value.current : null,
  }),
}

const META_V0: Migration = {
  from: 0,
  to: 1,
  migrate: value => ({
    ...value,
    schema: 1,
    parent: typeof value.parent === 'string' ? value.parent : null,
    origin: value.origin ?? { kind: 'manual', by: 'user' },
    evidence: Array.isArray(value.evidence) ? value.evidence : [],
    validation: value.validation ?? { ok: true, checks: [] },
    level: typeof value.level === 'string' ? value.level : 'L1',
    cacheImpact: typeof value.cacheImpact === 'string' ? value.cacheImpact : 'low',
    paths: Array.isArray(value.paths) ? value.paths : [],
  }),
}

const LIBRARY_INDEX_V0: Migration = {
  from: 0,
  to: 1,
  migrate: value => {
    if (typeof value.byTaskType === 'object' && value.byTaskType !== null) {
      return { schema: 1, byTaskType: value.byTaskType }
    }
    // Legacy shape: task type -> entry ids at the top level.
    const byTaskType: Record<string, string[]> = {}
    for (const [key, entry] of Object.entries(value)) {
      if (key === 'schema' || key === 'byTaskType' || !Array.isArray(entry)) continue
      byTaskType[key] = entry.filter((id): id is string => typeof id === 'string')
    }
    return { schema: 1, byTaskType }
  },
}

const LIBRARY_ENTRY_V0: Migration = {
  from: 0,
  to: 1,
  migrate: value => ({
    ...value,
    schema: 1,
    evidence: Array.isArray(value.evidence) ? value.evidence : [],
    confidence: number(value.confidence, 0.5),
    uses: number(value.uses, 1),
    rollbacks: number(value.rollbacks, 0),
    lastUsedAt: typeof value.lastUsedAt === 'string'
      ? value.lastUsedAt
      : new Date(0).toISOString(),
  }),
}

const V1: Migration = { from: 1, to: 2, migrate: value => ({ ...value, schema: 2 }) }
const META_V1: Migration = { from: 1, to: 2, migrate: value => ({ ...value, schema: 2,
  identity: typeof value.contentHash === 'string' && value.contentHash.length === 64 ? 'event' : 'legacy-content-id',
  evidenceStatus: 'legacy-unverified',
}) }
const LIBRARY_V1: Migration = { from: 1, to: 2, migrate: value => ({ ...value, schema: 2,
  state: 'hypothesis', legacyConfidence: value.confidence, confidence: 0,
  evidenceStatus: 'legacy-unverified',
}) }

const CHAINS: Readonly<Record<DocumentKind, readonly Migration[]>> = Object.freeze({
  state: [STATE_V0, V1],
  'revision-meta': [META_V0, META_V1],
  'library-index': [LIBRARY_INDEX_V0, V1],
  'library-entry': [LIBRARY_ENTRY_V0, LIBRARY_V1],
})

/** Detect the schema of a raw document; a missing field means v0. */
export function schemaOf(value: Record<string, unknown>): number {
  return typeof value.schema === 'number' ? value.schema : 0
}

/**
 * Apply the migration chain to one parsed document.
 * @param kind - document family.
 * @param raw - parsed JSON object.
 * @returns the migrated value and the version it started from.
 * @throws SchemaTooNewError when the document is newer than this bundle.
 */
export function migrateDocument(
  kind: DocumentKind,
  raw: Record<string, unknown>,
): { readonly value: Record<string, unknown>; readonly from: number } {
  const from = schemaOf(raw)
  if (from > CURRENT_SCHEMA) throw new SchemaTooNewError(`<${kind}>`, from)
  let value = raw
  let version = from
  while (version < CURRENT_SCHEMA) {
    const step = CHAINS[kind].find(candidate => candidate.from === version)
    if (step === undefined) {
      throw new Error(`no migration from schema v${String(version)} for ${kind}`)
    }
    value = step.migrate(value)
    version = step.to
    value = { ...value, schema: version }
  }
  return { value, from }
}

async function atomicWrite(path: string, text: string): Promise<void> {
  const temp = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
  await writeFile(temp, text, 'utf8')
  await rename(temp, path)
}

/**
 * Read one JSON document, migrate it, back up the original, and persist the
 * migrated form. Backups never overwrite an earlier `.bak.vN`.
 * @param path - absolute file path.
 * @param kind - document family.
 * @returns the current-schema value and the original version when migrated.
 */
export async function readMigratedJson(
  path: string,
  kind: DocumentKind,
): Promise<{ readonly value: Record<string, unknown>; readonly from: number }> {
  const text = await readFile(path, 'utf8')
  const raw: unknown = JSON.parse(text)
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(`${path}: expected a JSON object`)
  }
  const record = raw as Record<string, unknown>
  const from = schemaOf(record)
  if (from > CURRENT_SCHEMA) throw new SchemaTooNewError(path, from)
  if (from === CURRENT_SCHEMA) return { value: record, from }
  const migrated = migrateDocument(kind, record)
  const backup = `${path}.bak.v${String(from)}`
  try {
    await copyFile(path, backup, constants.COPYFILE_EXCL)
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
  await atomicWrite(path, `${JSON.stringify(migrated.value, null, 2)}\n`)
  return { value: migrated.value, from }
}

/** Directory helper for callers that need to place backups beside a file. */
export function backupPath(path: string, from: number): string {
  return `${path}.bak.v${String(from)}`
}

/** Exposed for tests; resolves the next migration. */
export function nextMigration(kind: DocumentKind, from: number): Migration | undefined {
  return CHAINS[kind].find(candidate => candidate.from === from)
}

