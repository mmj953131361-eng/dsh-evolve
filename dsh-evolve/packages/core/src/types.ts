/** Shared value types for revisions, evidence, and validation. */
import type { RevisionId } from './ids.js'

/** One evolution layer (PRD §8). */
export type Level = 'L1' | 'L2' | 'L3' | 'L4' | 'L5'

/** How strongly a revision invalidates the provider's KV-cache prefix. */
export type CacheImpact = 'none' | 'low' | 'high'

/** Behavioral signals the observer folds from the session log. */
export type SignalKind =
  | 'repeat-tool-error'
  | 'repeat-tool-call'
  | 'user-correction'
  | 'turn-error'
  | 'compaction'
  | 'long-no-progress'
  | 'task-start'
  | 'task-end'

/** A reference to one interval of one session log. */
export interface SessionEvidenceRef {
  readonly kind?: 'session'
  readonly sessionId: string
  readonly fromSeq: number
  readonly toSeq: number
  readonly signal: SignalKind
  readonly note: string
}
export type EvidenceRef = SessionEvidenceRef
  | { readonly kind: 'experiment'; readonly episodeId: string; readonly candidateId: string; readonly snapshotId: string; readonly contentHash: string }
  | { readonly kind: 'experience'; readonly experienceId: string; readonly episodeIds: readonly string[] }

/** Where a revision came from. */
export type RevisionOrigin =
  | { readonly kind: 'task-shaping'; readonly taskType: string; readonly libraryEntry?: string }
  | { readonly kind: 'cold-start'; readonly taskType: string }
  | { readonly kind: 'incremental'; readonly trigger: string }
  | { readonly kind: 'reflection' }
  | { readonly kind: 'probe-composed'; readonly probeIds: readonly string[] }
  | { readonly kind: 'manual'; readonly by: 'user' }
  | { readonly kind: 'rollback'; readonly of: RevisionId }

/** Validator (V*) and evaluator (E*) check identifiers. */
export type CheckId =
  | 'V1' | 'V2' | 'V3' | 'V4' | 'V5' | 'V6' | 'V7' | 'V8' | 'V9' | 'V10' | 'V11' | 'V12' | 'V13'
  | 'E1' | 'E2' | 'E3' | 'E4' | 'E5' | 'E6'

/** One check outcome. */
export interface ValidationCheck {
  readonly id: CheckId
  readonly ok: boolean
  /** Human-readable reason; present when the check fails or needs qualification. */
  readonly detail?: string
  /** True when the check failed but the caller declared it non-blocking; see `ValidationContext.advisoryChecks`. */
  readonly advisory?: boolean
}

/** Result of a validation pass. `ok` is true only when every check passed. */
export interface ValidationReport {
  readonly ok: boolean
  readonly checks: readonly ValidationCheck[]
}
