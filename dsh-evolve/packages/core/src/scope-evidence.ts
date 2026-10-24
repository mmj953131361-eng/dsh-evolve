/** Independent, source-bound support for expanding a native harness's scope. */
import type { LifecycleState, TaskRun } from './lifecycle-types.js'
import type { HarnessTree } from './tree.js'
import { contentHash } from './tree.js'
import { NATIVE_DISCLOSURE_VERSION, unsupportedNativePaths } from './native-components.js'
import { eligibleCandidate } from './selection.js'

export interface ScopeSupport {
  project: string
  problem: string
  session: string
  episode: string
  taskType: string
  contentHash: string
  tree: HarnessTree
  reason: string
  expectedEffect: string
}

/** Freeze task content instead of its adoption counter, which can advance after validation. */
export function taskEvidenceHash(task: TaskRun): string {
  return contentHash({ task: JSON.stringify([task.prompt, task.snapshotId, task.requirements]) })
}

/** A state label alone is insufficient: every support must still have a valid executed winner. */
export function scopeSupport(state: LifecycleState, project: string): ScopeSupport[] {
  const revoked = new Set(Object.values(state.experiences).filter(entry => entry.state === 'revoked').map(entry => contentHash(entry.tree)))
  return Object.values(state.episodes).flatMap(job => {
    const task = state.tasks[job.taskId]
    const candidate = job.candidates.find(item => item.id === job.comparison?.winner)
    if (!task || !candidate || job.status !== 'selected' || !job.comparison?.complete || job.checkpoint === true
      || job.phase !== 'post-task' || job.scope !== 'full-task' || !['completed', 'failed', 'timeout'].includes(task.status)
      || !task.snapshotId || job.snapshotId !== task.snapshotId || job.taskEvidenceHash !== taskEvidenceHash(task)
      || job.runnerCapabilities?.loaderVersion !== NATIVE_DISCLOSURE_VERSION
      || job.comparison.loaderVersion !== NATIVE_DISCLOSURE_VERSION || candidate.rollout?.loaderVersion !== NATIVE_DISCLOSURE_VERSION
      || !eligibleCandidate(candidate, task.requirements) || unsupportedNativePaths(candidate.tree).length
      || !Object.keys(candidate.tree).length || revoked.has(contentHash(candidate.tree))) return []
    return [{ project, problem: task.problemKey ?? task.prompt, session: task.sessionId, episode: job.id,
      taskType: task.taskType, contentHash: contentHash(candidate.tree), tree: candidate.tree,
      reason: job.comparison.rationale, expectedEffect: candidate.expectedChanges.join('；') || candidate.hypothesis }]
  })
}

export function supportsScope(facts: readonly ScopeSupport[], hash: string, scope: 'project' | 'profile', project: string): boolean {
  const matching = facts.filter(fact => fact.contentHash === hash && (scope === 'profile' || fact.project === project))
  if (new Set(matching.map(fact => fact.problem)).size < 2) return false
  return scope === 'profile' ? new Set(matching.map(fact => fact.project)).size >= 2
    : new Set(matching.map(fact => fact.session)).size >= 2
}
