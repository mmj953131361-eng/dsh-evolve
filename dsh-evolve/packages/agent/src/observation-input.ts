import { digest } from '@dsh-evolve/core/task-snapshot'

/** Offsets count UTF-16 code units, as String.slice does. Totals describe selected text, not an entire source file. */
export interface ObservationSourceCoverage {
  offset: number
  length: number
  selectedTotal: number
}

export interface ObservationSourceBatch {
  /** Identity of all prompt-visible source text and its positions. */
  key: string
  sources: Record<string, string>
  sourceCoverage: Record<string, ObservationSourceCoverage>
  /** Selected source characters in this batch, excluding the repeated task request. */
  selectedSourceChars: number
}

/**
 * Partition already-selected evidence without dropping any text. The task request is
 * repeated verbatim; other sources share a bounded payload, in stable path order.
 * Callers must budget the returned batch count rather than truncate the array.
 */
export function requirementSourceBatches(sources: Record<string, string>, maxSourceChars = 10000): ObservationSourceBatch[] {
  if (!Object.hasOwn(sources, '$task') || typeof sources.$task !== 'string') throw new Error('Observation sources must include $task.')
  if (!Number.isSafeInteger(maxSourceChars) || maxSourceChars < 2) throw new Error('Observation source limit must be an integer of at least 2.')
  const task = sources.$task
  const batches: ObservationSourceBatch[] = []
  let entries: [string, string][] = []
  let coverage: [string, ObservationSourceCoverage][] = []
  let used = 0
  const flush = () => {
    const batchSources = Object.fromEntries([['$task', task], ...entries])
    const sourceCoverage = Object.fromEntries([
      ['$task', { offset: 0, length: task.length, selectedTotal: task.length }], ...coverage,
    ])
    batches.push({ key: digest(JSON.stringify({ sources: batchSources, sourceCoverage })), sources: batchSources, sourceCoverage, selectedSourceChars: used })
    entries = []; coverage = []; used = 0
  }
  for (const path of Object.keys(sources).filter(path => path !== '$task').sort()) {
    const value = sources[path]!
    if (typeof value !== 'string') throw new Error('Observation sources must contain text.')
    if (value.length === 0) {
      entries.push([path, value]); coverage.push([path, { offset: 0, length: 0, selectedTotal: 0 }])
      continue
    }
    let offset = 0
    while (offset < value.length) {
      if (used === maxSourceChars) flush()
      let end = Math.min(value.length, offset + maxSourceChars - used)
      // Keep a Unicode character intact when the payload boundary bisects a surrogate pair.
      if (end < value.length && /[\uD800-\uDBFF]/.test(value[end - 1]!) && /[\uDC00-\uDFFF]/.test(value[end]!)) end -= 1
      if (end === offset) { flush(); continue }
      entries.push([path, value.slice(offset, end)])
      coverage.push([path, { offset, length: end - offset, selectedTotal: value.length }])
      used += end - offset
      offset = end
      if (offset < value.length) flush()
    }
  }
  if (entries.length || batches.length === 0) flush()
  return batches
}
