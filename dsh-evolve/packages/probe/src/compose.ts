/**
 * @deprecated 0.1 historical test fixture; not used by the production lifecycle.
 * Probe comparison and composition.
 *
 * Scores combine failed tools (weighted highest), steps, tokens, and whether
 * the run completed. A candidate must be meaningfully better to win; a
 * tie defaults to neutral so probes never churn revisions for noise.
 */
import { createRevision, type Revision } from '@dsh-evolve/core/revision'

/** Metrics collected from one rerun. */
export interface RunMetrics {
  readonly completed: boolean
  readonly steps: number
  readonly toolCalls: number
  readonly toolErrors: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly trace: string
  readonly error?: string
}

/** Verdict of a baseline/candidate comparison. */
export type ProbeVerdict = 'better' | 'worse' | 'neutral'

/** Averaged metrics for one side. */
export interface Aggregate {
  readonly completed: boolean
  readonly steps: number
  readonly toolCalls: number
  readonly toolErrors: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly score: number
}

/** Average one or more runs. */
export function aggregate(runs: readonly RunMetrics[]): Aggregate {
  const count = Math.max(1, runs.length)
  const sum = runs.reduce((total, run) => ({
    steps: total.steps + run.steps,
    toolCalls: total.toolCalls + run.toolCalls,
    toolErrors: total.toolErrors + run.toolErrors,
    inputTokens: total.inputTokens + run.inputTokens,
    outputTokens: total.outputTokens + run.outputTokens,
    completed: total.completed + (run.completed ? 1 : 0),
  }), { steps: 0, toolCalls: 0, toolErrors: 0, inputTokens: 0, outputTokens: 0, completed: 0 })
  const steps = sum.steps / count
  const toolErrors = sum.toolErrors / count
  const inputTokens = sum.inputTokens / count
  const outputTokens = sum.outputTokens / count
  return {
    completed: sum.completed / count >= 0.5,
    steps,
    toolCalls: sum.toolCalls / count,
    toolErrors,
    inputTokens,
    outputTokens,
    score: score({ steps, toolErrors, inputTokens, outputTokens, completed: sum.completed / count >= 0.5 }),
  }
}

/** Scalar score; lower is better. */
export function score(input: {
  steps: number
  toolErrors: number
  inputTokens: number
  outputTokens: number
  completed: boolean
}): number {
  return input.toolErrors * 10
    + input.steps
    + (input.inputTokens + input.outputTokens) / 1000
    + (input.completed ? 0 : 5)
}

/** Compare candidate against baseline with a 5% noise margin. */
export function compare(baseline: Aggregate, candidate: Aggregate): ProbeVerdict {
  if (candidate.completed !== baseline.completed) return candidate.completed ? 'better' : 'worse'
  if (candidate.score < baseline.score * 0.95) return 'better'
  if (candidate.score > baseline.score * 1.05) return 'worse'
  return 'neutral'
}

/**
 * Build the composed revision. The candidate tree is kept as-is; provenance
 * records the probe ids and the baseline revision.
 */
export interface ComposeInput {
  readonly candidate: Revision
  readonly probeIds: readonly string[]
  readonly createdAt: string
}

/** Create a `probe-composed` revision with the candidate tree. */
export function composeRevision(input: ComposeInput): Revision {
  return createRevision({
    parent: input.candidate.parent,
    tree: input.candidate.tree,
    origin: { kind: 'probe-composed', probeIds: input.probeIds },
    evidence: input.candidate.evidence,
    validation: input.candidate.validation,
    createdAt: input.createdAt,
    level: input.candidate.level,
    cacheImpact: input.candidate.cacheImpact,
  })
}
