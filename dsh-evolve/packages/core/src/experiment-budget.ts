/** Offline experiments favor complete executions; foreground limits remain separate. */
import { DEFAULT_EXPERIMENT_BUDGET, type ExperimentBudget, type TaskRun } from './lifecycle-types.js'

export const POST_TASK_TOKEN_CEILING = 512_000_000
export const POST_TASK_WALL_CEILING = 28_800_000
export const POST_TASK_OUTPUT_TOKENS = 1_000_000
export const POST_TASK_MODEL_INPUT_TOKENS = 8_000_000
export const POST_TASK_MODEL_OUTPUT_TOKENS = 8_000_000

export function experimentBudget(task: TaskRun, phase: 'during-task' | 'post-task', overrides: Partial<ExperimentBudget> = {}, reuse = false): ExperimentBudget {
  if (phase === 'during-task') return { ...DEFAULT_EXPERIMENT_BUDGET, ...overrides }
  const progress = task.progress.at(-1)
  const variants = overrides.strategyVariants ?? 2
  const depth = overrides.maxDepth ?? 3
  const slots = overrides.maxProbeRuns ?? (1 + 2 * variants + Math.max(0, depth - 1) + (reuse ? 1 : 0))
  const ceiling = overrides.maxProcessingTokens ?? POST_TASK_TOKEN_CEILING
  // Explicit small total ceilings also shrink implicit model allowances. Explicit
  // sublimits are never silently raised or rewritten, even if inconsistent.
  const proposalInput = overrides.maxProposalInputTokens ?? Math.min(POST_TASK_MODEL_INPUT_TOKENS, Math.floor(ceiling / 8))
  const proposalOutput = overrides.maxProposalOutputTokens ?? Math.min(POST_TASK_MODEL_OUTPUT_TOKENS, Math.floor(ceiling / 8))
  const desired = Math.max(8_000_000, Math.ceil((progress?.processingTokens ?? 0) * 2), (task.inputBytes ?? 0) * 16)
  const probeTokens = overrides.probeTokens ?? Math.max(1, Math.min(desired, Math.floor((ceiling - proposalInput - proposalOutput) / slots)))
  const maxProcessingTokens = overrides.maxProcessingTokens ?? Math.min(ceiling, probeTokens * slots + proposalInput + proposalOutput)
  const probeSteps = Math.min(2000, Math.max(400, (progress?.step ?? 0) * 2))
  const elapsed = task.finishedAt ? Date.parse(task.finishedAt) - Date.parse(task.startedAt) : 0
  const probeTimeoutMs = Math.min(5_400_000, Math.max(1_800_000, Number.isFinite(elapsed) ? elapsed * 2 : 0))
  return { ...DEFAULT_EXPERIMENT_BUDGET, maxProcessingTokens, maxProposalInputTokens: proposalInput,
    maxProposalOutputTokens: proposalOutput, probeMaxOutputTokens: POST_TASK_OUTPUT_TOKENS,
    modelMaxOutputTokens: POST_TASK_OUTPUT_TOKENS, strategyVariants: variants, maxDepth: depth, selectionRounds: 3, heldOutRuns: 2, heldOutDerivations: 2,
    probeTokens, probeSteps, probeTimeoutMs, maxProbeRuns: slots,
    maxWallMs: Math.min(POST_TASK_WALL_CEILING, slots * probeTimeoutMs + 1_800_000), ...overrides }
}
