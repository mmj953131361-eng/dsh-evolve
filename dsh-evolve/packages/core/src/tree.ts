/**
 * HarnessTree: the immutable `path -> UTF-8 text` map a Revision carries.
 *
 * Paths are relative, POSIX-shaped, and whitespace-free. Every path must be
 * accepted by the surface classifier before it can enter a tree.
 */
import { createHash } from 'node:crypto'
import { asRevisionId, type RevisionId } from './ids.js'

/** A tree of relative path to text content. */
export type HarnessTree = Readonly<Record<string, string>>

/** A rejected tree path (absolute, traversal, backslash, drive prefix, bad segment). */
export class TreePathError extends Error {
  constructor(readonly path: string, reason: string) {
    super(`invalid harness path "${path}": ${reason}`)
    this.name = 'TreePathError'
  }
}

const SEGMENT = /^[A-Za-z0-9._-]+$/

/**
 * Validate and canonicalize one relative harness path.
 * @param raw - candidate path.
 * @returns the same path when every segment is legal.
 * @throws TreePathError for absolute paths, `..`/`.`, backslashes, drive
 * prefixes, empty segments, trailing slashes, or unsupported characters.
 */
export function normalizeTreePath(raw: string): string {
  if (raw.length === 0) throw new TreePathError(raw, 'path is empty')
  if (raw.includes('\\')) throw new TreePathError(raw, 'backslashes are not allowed')
  if (raw.includes(':')) throw new TreePathError(raw, 'colons are not allowed')
  if (raw.startsWith('/')) throw new TreePathError(raw, 'absolute paths are not allowed')
  if (raw.endsWith('/')) throw new TreePathError(raw, 'trailing slash is not allowed')
  const segments = raw.split('/')
  for (const segment of segments) {
    if (segment === '') throw new TreePathError(raw, 'empty segment')
    if (segment === '.' || segment === '..') throw new TreePathError(raw, 'path traversal is not allowed')
    if (!SEGMENT.test(segment)) throw new TreePathError(raw, `segment "${segment}" contains unsupported characters`)
  }
  return segments.join('/')
}

/** Count Unicode code points, matching harness2's Python `len`. */
export function charCount(text: string): number {
  let count = 0
  for (const _ of text) count += 1
  return count
}

/** Total code points across the given paths that exist in the tree. */
export function treeChars(tree: HarnessTree, paths: readonly string[]): number {
  let total = 0
  for (const path of paths) {
    const text = tree[path]
    if (text !== undefined) total += charCount(text)
  }
  return total
}

/** Sum of code points across every value in the tree. */
export function totalChars(tree: HarnessTree): number {
  let total = 0
  for (const text of Object.values(tree)) total += charCount(text)
  return total
}

/** Sorted path list, used for deterministic iteration and fingerprints. */
export function sortedPaths(tree: HarnessTree): string[] {
  return Object.keys(tree).sort()
}

/**
 * Validate every path and copy the tree into a frozen plain object.
 * @param tree - untrusted path/text map.
 * @returns a frozen tree with normalized paths.
 * @throws TreePathError for an illegal path, or TypeError for a non-string value.
 */
export function normalizeTree(tree: HarnessTree): HarnessTree {
  const out: Record<string, string> = {}
  for (const [rawPath, text] of Object.entries(tree)) {
    const path = normalizeTreePath(rawPath)
    if (typeof text !== 'string') throw new TypeError(`harness path "${path}" must map to a string`)
    if (out[path] !== undefined) throw new TypeError(`duplicate harness path "${path}" after normalization`)
    out[path] = text
  }
  return Object.freeze(out)
}

/**
 * Deterministic content fingerprint of a tree.
 *
 * Encoding is length-prefixed UTF-8 over sorted paths and values, so distinct
 * trees cannot collide through separator injection.
 * @param tree - any tree; paths must already be normalized.
 * @returns the first 16 hex chars of SHA-256.
 */
export function fingerprint(tree: HarnessTree): RevisionId {
  const hash = createHash('sha256')
  for (const path of sortedPaths(tree)) {
    const text = tree[path] as string
    hash.update(`${Buffer.byteLength(path, 'utf8')}:`)
    hash.update(path, 'utf8')
    hash.update(`${Buffer.byteLength(text, 'utf8')}:`)
    hash.update(text, 'utf8')
  }
  return asRevisionId(hash.digest('hex').slice(0, 16))
}

/** Paths added, removed, and changed between two trees. */
export interface TreeDiff {
  readonly added: readonly string[]
  readonly removed: readonly string[]
  readonly changed: readonly string[]
  /** Code points that differ: added/changed content plus removed content. */
  readonly diffChars: number
}

/** Compute a deterministic diff between a base tree and a candidate tree. */
export function diffTrees(base: HarnessTree, next: HarnessTree): TreeDiff {
  const basePaths = new Set(Object.keys(base))
  const nextPaths = new Set(Object.keys(next))
  const added: string[] = []
  const removed: string[] = []
  const changed: string[] = []
  let diffChars = 0
  for (const path of [...nextPaths].sort()) {
    const before = base[path]
    const after = next[path] as string
    if (before === undefined) {
      added.push(path)
      diffChars += charCount(after)
    } else if (before !== after) {
      changed.push(path)
      diffChars += charCount(after)
    }
  }
  for (const path of [...basePaths].sort()) {
    if (!nextPaths.has(path)) {
      removed.push(path)
      diffChars += charCount(base[path] as string)
    }
  }
  return Object.freeze({ added, removed, changed, diffChars })
}

/** Human-readable one-line summary used by logs, commands, and revision metadata. */
export function diffSummary(diff: TreeDiff): string {
  return `${diff.added.length} added, ${diff.removed.length} removed, ${diff.changed.length} changed, ${diff.diffChars} chars`
}

/** Full content digest, independent of revision history. */
export function contentHash(tree: HarnessTree): string {
  return createHash('sha256').update(JSON.stringify(Object.entries(normalizeTree(tree)).sort(([a], [b]) => a.localeCompare(b)))).digest('hex')
}
