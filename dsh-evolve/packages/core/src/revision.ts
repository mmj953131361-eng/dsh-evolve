import { randomUUID } from 'node:crypto'
import { asRevisionId } from './ids.js'
/**
 * Revision: one immutable HarnessTree snapshot plus provenance.
 *
 * A Revision is one immutable event. Equal trees share a content hash, never an event identity.
 */
import { contentHash, normalizeTree, type HarnessTree } from './tree.js'
import type { RevisionId } from './ids.js'
import type { CacheImpact, EvidenceRef, Level, RevisionOrigin, ValidationReport } from './types.js'

/** One immutable revision of the harness tree. */
export interface Revision {
  readonly id: RevisionId
  readonly contentHash: string
  readonly parent: RevisionId | null
  readonly tree: HarnessTree
  readonly origin: RevisionOrigin
  readonly evidence: readonly EvidenceRef[]
  readonly validation: ValidationReport
  readonly createdAt: string
  readonly level: Level
  readonly cacheImpact: CacheImpact
}

/** Input accepted by {@link createRevision}; `id` is derived, never supplied. */
export interface RevisionDraft {
  readonly parent: RevisionId | null
  readonly tree: HarnessTree
  readonly origin: RevisionOrigin
  readonly evidence?: readonly EvidenceRef[]
  readonly validation?: ValidationReport
  readonly createdAt: string
  readonly level: Level
  readonly cacheImpact: CacheImpact
}

const LEVELS: readonly Level[] = ['L1', 'L2', 'L3', 'L4', 'L5']
const CACHE_IMPACTS: readonly CacheImpact[] = ['none', 'low', 'high']

/**
 * Build a frozen revision from a draft.
 * @param draft - tree, provenance, and caller-supplied timestamp.
 * @returns an immutable revision with an independent event id.
 * @throws TreePathError/TypeError for an illegal tree, RangeError for an
 * invalid level or cache impact.
 */
export function createRevision(draft: RevisionDraft): Revision {
  if (!LEVELS.includes(draft.level)) throw new RangeError(`invalid revision level "${String(draft.level)}"`)
  if (!CACHE_IMPACTS.includes(draft.cacheImpact)) {
    throw new RangeError(`invalid cache impact "${String(draft.cacheImpact)}"`)
  }
  if (!isIsoTimestamp(draft.createdAt)) {
    throw new TypeError(`createdAt must be an ISO 8601 timestamp, got "${draft.createdAt}"`)
  }
  const tree = normalizeTree(draft.tree)
  return Object.freeze({
    id: asRevisionId(randomUUID().replaceAll('-', '')),
    contentHash: contentHash(tree),
    parent: draft.parent,
    tree,
    origin: Object.freeze(draft.origin),
    evidence: Object.freeze([...(draft.evidence ?? [])]),
    validation: Object.freeze(draft.validation ?? { ok: true, checks: Object.freeze([]) }),
    createdAt: draft.createdAt,
    level: draft.level,
    cacheImpact: draft.cacheImpact,
  })
}

/** Whether two revisions have identical content. */
export function sameContent(left: Revision, right: Revision): boolean {
  return left.contentHash === right.contentHash
}

/** The empty root revision used before any editing. */
export function rootRevision(createdAt: string): Revision {
  return createRevision({
    parent: null,
    tree: {},
    origin: { kind: 'manual', by: 'user' },
    createdAt,
    level: 'L1',
    cacheImpact: 'none',
  })
}

function isIsoTimestamp(value: string): boolean {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
}
