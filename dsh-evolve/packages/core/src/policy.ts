/**
 * Policy: autonomy ladder, approval rules, and session budgets (PRD §7.13,
 * §8.1, §13).
 *
 * The ladder is intentionally small and closed. No autonomy value ever
 * auto-approves L3 promotion, L5 switching, or a profile-level change.
 */

/** Deployment autonomy. */
export type Autonomy = 'off' | 'l1-only' | 'ask-promote' | 'auto-l2'

/** One decision the policy can make. */
export type EvolutionAction =
  | 'l1-apply'
  | 'l2-write'
  | 'l3-candidate'
  | 'l3-promote'
  | 'l4-rule'
  | 'l5-switch'
  | 'profile-change'

/** Policy outcome: apply now, ask a human, or refuse. */
export type Decision = 'allow' | 'ask' | 'deny'

const LADDER: Readonly<Record<Autonomy, Readonly<Record<EvolutionAction, Decision>>>> = Object.freeze({
  off: {
    'l1-apply': 'deny',
    'l2-write': 'deny',
    'l3-candidate': 'deny',
    'l3-promote': 'deny',
    'l4-rule': 'deny',
    'l5-switch': 'deny',
    'profile-change': 'deny',
  },
  'l1-only': {
    'l1-apply': 'allow',
    'l2-write': 'deny',
    'l3-candidate': 'deny',
    'l3-promote': 'deny',
    'l4-rule': 'deny',
    'l5-switch': 'deny',
    'profile-change': 'deny',
  },
  'ask-promote': {
    'l1-apply': 'allow',
    'l2-write': 'allow',
    'l3-candidate': 'allow',
    'l3-promote': 'ask',
    'l4-rule': 'allow',
    'l5-switch': 'ask',
    'profile-change': 'ask',
  },
  'auto-l2': {
    'l1-apply': 'allow',
    'l2-write': 'allow',
    'l3-candidate': 'allow',
    'l3-promote': 'ask',
    'l4-rule': 'allow',
    'l5-switch': 'ask',
    'profile-change': 'ask',
  },
})

/** Decide one action under the deployment autonomy. */
export function decide(action: EvolutionAction, autonomy: Autonomy): Decision {
  return LADDER[autonomy][action]
}

/** Whether the action may proceed without a human. */
export function isAutonomous(action: EvolutionAction, autonomy: Autonomy): boolean {
  return decide(action, autonomy) === 'allow'
}

/** Hard budget caps. */
export interface BudgetLimits {
  readonly maxEvolutionsPerSession: number
  readonly maxProposalInputTokens: number
  readonly maxProposalOutputTokens: number
  readonly maxExtraTokenRatio: number
  readonly cooldownSteps: number
}

/** PRD §7.13 defaults. */
export const DEFAULT_BUDGET: BudgetLimits = Object.freeze({
  maxEvolutionsPerSession: 6,
  maxProposalInputTokens: 24000,
  maxProposalOutputTokens: 6000,
  maxExtraTokenRatio: 0.15,
  cooldownSteps: 3,
})

/** Why a budget check refused. */
export type BudgetRefusal =
  | 'evolutions-exhausted'
  | 'input-tokens-exhausted'
  | 'output-tokens-exhausted'
  | 'extra-token-ratio-exceeded'
  | 'cooldown'

/** Per-session budget ledger. Pure in-memory; the caller persists counters. */
/** @deprecated Legacy compatibility counter; Lifecycle reservations govern production jobs. */
export class SessionBudget {
  private evolutions = 0
  private inputTokens = 0
  private outputTokens = 0
  private extraTokens = 0
  private lastTriggerStep = new Map<string, number>()

  constructor(private readonly limits: BudgetLimits = DEFAULT_BUDGET) {}

  /** Check whether one more evolution may start at this step. */
  canEvolve(step: number, signal?: string, baselineTokens?: number): { readonly ok: true } | { readonly ok: false; readonly reason: BudgetRefusal } {
    if (this.evolutions >= this.limits.maxEvolutionsPerSession) {
      return { ok: false, reason: 'evolutions-exhausted' }
    }
    if (this.inputTokens >= this.limits.maxProposalInputTokens) {
      return { ok: false, reason: 'input-tokens-exhausted' }
    }
    if (this.outputTokens >= this.limits.maxProposalOutputTokens) {
      return { ok: false, reason: 'output-tokens-exhausted' }
    }
    if (baselineTokens !== undefined) {
      const ratio = baselineTokens <= 0 ? Number.POSITIVE_INFINITY : this.extraTokens / baselineTokens
      if (ratio > this.limits.maxExtraTokenRatio) return { ok: false, reason: 'extra-token-ratio-exceeded' }
    }
    if (signal !== undefined) {
      const last = this.lastTriggerStep.get(signal)
      if (last !== undefined && step - last < this.limits.cooldownSteps) return { ok: false, reason: 'cooldown' }
    }
    return { ok: true }
  }

  /** Record one completed evolution and its token cost. */
  record(step: number, signal: string | undefined, usage: { inputTokens: number; outputTokens: number }): void {
    this.evolutions += 1
    this.inputTokens += Math.max(0, usage.inputTokens)
    this.outputTokens += Math.max(0, usage.outputTokens)
    this.extraTokens += Math.max(0, usage.inputTokens) + Math.max(0, usage.outputTokens)
    if (signal !== undefined) this.lastTriggerStep.set(signal, step)
  }

  /** Current counters, for status output and audit. */
  snapshot(): {
    readonly evolutions: number
    readonly inputTokens: number
    readonly outputTokens: number
    readonly extraTokens: number
  } {
    return {
      evolutions: this.evolutions,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      extraTokens: this.extraTokens,
    }
  }
}

/** Trigger defaults from PRD §7.13. */
export interface TriggerConfig {
  readonly taskStart: boolean
  readonly repeatFailureThreshold: number
  readonly compaction: boolean
  readonly turnEnd: boolean
  readonly taskEnd: boolean
}

/** PRD §7.13 defaults. */
export const DEFAULT_TRIGGERS: TriggerConfig = Object.freeze({
  taskStart: true,
  repeatFailureThreshold: 3,
  compaction: true,
  turnEnd: false,
  taskEnd: true,
})

/**
 * Whether a repeated-failure signal has crossed its threshold.
 * @param count - consecutive equivalent failures observed.
 * @param config - trigger configuration.
 */
export function repeatFailureReached(count: number, config: TriggerConfig = DEFAULT_TRIGGERS): boolean {
  return count >= config.repeatFailureThreshold
}
