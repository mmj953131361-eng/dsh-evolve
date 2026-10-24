/** Durable human review of an exact revision for one session. */
import type { Revision } from './revision.js'
import type { HarnessTree } from './tree.js'
import { contentHash } from './tree.js'
import type { LifecycleState } from './lifecycle-types.js'
import type { ScopedHarnessPlan, ScopedHarnessReceipt } from './scoped-harness.js'
import { compactText } from './view.js'

export type AdoptionChangeKind = 'instruction' | 'skill' | 'memory' | 'project-instruction' | 'profile-config'

export interface AdoptionPlan {
  readonly id: string
  status: 'pending' | 'applied' | 'rejected' | 'stale' | 'failed' | 'undone'
  readonly scope: 'session' | 'project' | 'profile'
  readonly adoptionMode?: 'auto' | 'review'
  /** Short list-card label; full rationale stays in expectedEffect/reason. */
  readonly headline?: string
  readonly changeKinds?: readonly AdoptionChangeKind[]
  readonly fileCount?: number
  readonly expectedEffect?: string
  readonly targetLabel?: string
  readonly targetId?: string
  readonly targetDirectory?: string
  readonly profileName?: string
  readonly affectedSessions?: readonly string[]
  readonly affectedProjects?: readonly string[]
  readonly impactNote?: string
  appliedRevisionId?: string
  canUndo?: boolean
  readonly scopedPlan?: ScopedHarnessPlan
  readonly support?: readonly { project: string; problem: string; session: string; episode: string }[]
  scopedReceipt?: ScopedHarnessReceipt
  confirmation?: { at: string; targetId: string; contentHash: string }
  readonly files?: readonly { path: string; status: 'added' | 'removed' | 'changed'; before: string; after: string }[]
  readonly targetSessionId: string
  readonly contentHash: string
  readonly parent: Revision['parent']
  readonly revision: Revision
  readonly beforeTree: HarnessTree
  readonly taskStamp: string
  readonly reason: string
  readonly verification?: readonly string[]
  readonly createdAt: string
  updatedAt: string
  readonly activation: 'next-request' | 'new-session' | 'restart' | 'manual'
  readonly activationDetail?: string
  readonly rollback: string
  detail?: string
}

export interface AdoptionState { schema: 1; plans: Record<string, AdoptionPlan> }
export type AdoptionSummary = Omit<AdoptionPlan, 'revision' | 'beforeTree' | 'taskStamp' | 'verification' | 'scopedPlan' | 'scopedReceipt' | 'confirmation' | 'files'> & { readonly paths: readonly string[]; readonly sourceEpisodeIds?: readonly string[] }

/** Bind review to task identity, requirements generation and completion state. */
export function taskStamp(state: LifecycleState, sessionId: string): string {
  return contentHash(Object.fromEntries(Object.values(state.tasks)
    .filter(task => task.sessionId === sessionId).sort((a, b) => a.id.localeCompare(b.id))
    .map(task => [task.id, JSON.stringify([task.generation, task.status, task.activeRevision])])))
}

/** Stable across pre-step retries, even when each retry constructs a fresh Revision. */
export function adoptionId(plan: Pick<AdoptionPlan, 'scope' | 'targetSessionId' | 'parent' | 'revision' | 'beforeTree' | 'taskStamp' | 'reason' | 'verification' | 'activation' | 'activationDetail' | 'rollback' | 'targetId' | 'scopedPlan' | 'expectedEffect' | 'impactNote' | 'support'>): string {
  return contentHash({ plan: JSON.stringify({
    scope: plan.scope, session: plan.targetSessionId, parent: plan.parent,
    tree: contentHash(plan.revision.tree), before: contentHash(plan.beforeTree), tasks: plan.taskStamp,
    origin: plan.revision.origin, evidence: plan.revision.evidence,
    level: plan.revision.level, cacheImpact: plan.revision.cacheImpact,
    reason: plan.reason, verification: plan.verification, activation: plan.activation, activationDetail: plan.activationDetail, rollback: plan.rollback,
    targetId: plan.targetId, scopedPlan: plan.scopedPlan?.id, expectedEffect: plan.expectedEffect, impactNote: plan.impactNote, support: plan.support,
  }) })
}

/** Map changed paths to the user-facing component categories shown on a change card. */
export function adoptionChangeKinds(paths: readonly string[]): AdoptionChangeKind[] {
  const kinds = new Set<AdoptionChangeKind>()
  for (const path of paths) {
    const normalized = path.split('\\').join('/')
    if (/(^|\/)AGENTS(?:\.local)?\.md$/.test(normalized)) kinds.add('project-instruction')
    else if (/(^|\/)cordis\.patch\.yml$/.test(normalized) || /(^|\/)profile\.overlay\.yml$/.test(normalized)) kinds.add('profile-config')
    else if (/(^|\/)skills\//.test(normalized) || normalized.endsWith('/SKILL.md')) kinds.add('skill')
    else if (/(^|\/)memory\//.test(normalized)) kinds.add('memory')
    else kinds.add('instruction')
  }
  const order: AdoptionChangeKind[] = ['instruction', 'memory', 'skill', 'project-instruction', 'profile-config']
  return order.filter(kind => kinds.has(kind))
}

/** A bounded card label derived from model-authored effect text. */
export function adoptionHeadline(text: string | undefined, fallback: string, max = 80): string {
  return compactText((text ?? '').split(/\n+/)[0] ?? '', max) || fallback
}

export function adoptionSummary(plan: AdoptionPlan): AdoptionSummary {
  const { revision, beforeTree, taskStamp: _stamp, verification: _verification, scopedPlan: _scoped, scopedReceipt: _receipt, confirmation: _confirmation, files, ...summary } = plan
  return { ...summary, sourceEpisodeIds: revision.evidence.flatMap(ref => ref.kind === 'experiment' ? [ref.episodeId] : []), paths: files?.map(file => file.path) ?? [...new Set([...Object.keys(beforeTree), ...Object.keys(revision.tree)])]
    .filter(path => beforeTree[path] !== revision.tree[path]).sort() }
}
