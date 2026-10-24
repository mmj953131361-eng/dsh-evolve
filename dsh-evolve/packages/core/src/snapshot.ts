/** Read-only projections the Web panel consumes. */
import type { RevisionId } from './ids.js'
import type { CacheImpact, Level } from './types.js'

/** One live agent's evolution state. */
export interface AgentSnapshot {
  readonly view?: import('./view.js').EvolutionView
  readonly sessionId?: string
  readonly adoptions?: readonly import('./adoption.js').AdoptionSummary[]
  readonly tasks: ReturnType<typeof import('./lifecycle.js').lifecycleSummary>['tasks']
  readonly experiments: ReturnType<typeof import('./lifecycle.js').lifecycleSummary>['experiments']
  readonly experiences: ReturnType<typeof import('./lifecycle.js').lifecycleSummary>['experiences']
  readonly recommendations?: ReturnType<typeof import('./lifecycle.js').lifecycleSummary>['recommendations']
  readonly id: string
  readonly workspace: string
  /** Current convergence of the session/workspace work. */
  readonly workstreamTitle?: string
  readonly enabled: boolean
  readonly revision: RevisionId | null
  readonly level: Level | null
  readonly cacheImpact: CacheImpact | null
  readonly taskType: string
  readonly task: string
  readonly automation?: { readonly status: string; readonly detail?: string; readonly taskId?: string }
  readonly step: number
  readonly budget: {
    readonly evolutions: number
    readonly inputTokens: number
    readonly outputTokens: number
    readonly extraTokens: number
    /** Actual settled processing tokens, excluding unknown reservations. */
    readonly settledTokens?: number
    /** Conservatively reserved tokens whose external outcome is still unknown. */
    readonly unknownTokens?: number
    readonly stageTokens?: readonly { readonly stage: string; readonly charged: number; readonly unknown: number }[]
  }
  readonly history: readonly {
    readonly id: RevisionId
    readonly parent: RevisionId | null
    readonly level: Level
    readonly origin: string
    readonly createdAt: string
    readonly current: boolean
  }[]
  readonly library: readonly {
    readonly id: string
    readonly taskType: string
    readonly cue: string
    readonly lesson: string
    readonly confidence: number
    readonly uses: number
    readonly rollbacks: number
    readonly lastUsedAt: string
  }[]
  readonly candidates: readonly {
    readonly id: string
    readonly name: string
    readonly status: string
    readonly verified: boolean
    readonly findings: readonly string[]
  }[]
}
